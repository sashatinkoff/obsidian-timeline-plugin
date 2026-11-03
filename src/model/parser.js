'use strict';

/*
 * Разбор содержимого блока ```timeline (и устаревшего ```track).
 *
 * Совместимо с Timeline Card v2:
 *   ## Заголовок карточки
 *   %% color: green %%
 *   #### Секция
 *   ### !Событие          (! — акцентный маркер)
 *   Строка даты (всегда первая строка после ###, может быть пустой)
 *   Текст события…
 *
 * Новое в v3 (всё необязательно):
 *   %% badge: Справочник %%   %% tags: #a #b %%   %% status: Проверено %%
 *   Любые строки до первого события/секции — описание карточки.
 *   Под строкой даты: marker:: done | warning | info | accent | empty
 *                     label:: Тревога / Финансы
 *                     tags:: #экономика #бюджет
 *                     id:: fin-2026-02
 *                     break:: Период консультаций   (разрыв линии перед событием)
 */

const { MARKER_ALIASES, EVENT_FIELDS, CARD_META } = require('../constants');
const { parseDate } = require('../utils/dates');
const { parseTags } = require('../utils/text');

const FIELD_RE = /^\s*([A-Za-z_-]+)::\s?(.*)$/;
const META_RE = /^%%\s*([A-Za-z_-]+)\s*:\s*(.*?)\s*%%\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

function trimEmptyEdges(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].trim() === '') a++;
  while (b > a && lines[b - 1].trim() === '') b--;
  return lines.slice(a, b);
}

function normalizeMarker(value) {
  const key = String(value || '').trim().toLowerCase();
  return MARKER_ALIASES[key] || null;
}

function newEvent(title) {
  return {
    type: 'event', title, date: '', marker: 'empty', label: '', tags: [], id: '',
    breakText: null, body: '', _bodyLines: [],
  };
}

function parseCard(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const card = { title: '', color: '', badge: '', tags: [], status: '', description: '', entries: [] };
  const descLines = [];
  let current = null;
  let stage = 'body'; // date | fields | body (для текущего события)
  let inFence = false;

  const flush = () => {
    if (!current) return;
    current.body = trimEmptyEdges(current._bodyLines).join('\n');
    delete current._bodyLines;
    card.entries.push(current);
    current = null;
  };

  for (const line of lines) {
    if (inFence) {
      if (FENCE_RE.test(line)) inFence = false;
      current._bodyLines.push(line);
      continue;
    }

    const noEntriesYet = !current && card.entries.length === 0;

    if (noEntriesYet && /^##\s/.test(line) && !card.title) {
      card.title = line.replace(/^##\s+/, '').trim();
      continue;
    }
    if (!current) {
      const meta = line.match(META_RE);
      if (meta && CARD_META.includes(meta[1].toLowerCase())) {
        const key = meta[1].toLowerCase();
        if (key === 'tags') card.tags = parseTags(meta[2]);
        else card[key] = meta[2].trim();
        continue;
      }
    }
    if (/^####\s/.test(line)) {
      flush();
      card.entries.push({ type: 'section', label: line.replace(/^####\s+/, '').trim() });
      continue;
    }
    if (/^###\s/.test(line)) {
      flush();
      let title = line.replace(/^###\s+/, '').trim();
      let accent = false;
      if (title.startsWith('!')) { accent = true; title = title.slice(1).trim(); }
      current = newEvent(title);
      if (accent) current.marker = 'accent';
      stage = 'date';
      continue;
    }
    if (!current) {
      if (card.entries.length === 0) descLines.push(line);
      continue;
    }
    if (stage === 'date') {
      current.date = line.trim();
      stage = 'fields';
      continue;
    }
    if (stage === 'fields') {
      const f = line.match(FIELD_RE);
      const key = f && f[1].toLowerCase();
      if (f && EVENT_FIELDS.includes(key)) {
        const value = f[2].trim();
        if (key === 'marker') current.marker = normalizeMarker(value) || current.marker;
        else if (key === 'tags') current.tags = parseTags(value);
        else if (key === 'break') current.breakText = value;
        else current[key] = value;
        continue;
      }
      stage = 'body';
    }
    if (FENCE_RE.test(line)) inFence = true;
    current._bodyLines.push(line);
  }
  flush();
  card.description = trimEmptyEdges(descLines).join('\n');
  resolveDates(card);
  return card;
}

/**
 * Разбор дат событий в порядке заметки. Даты без года («начало октября»,
 * «12 октября») получают год от предыдущего события с датой, а если его нет —
 * от следующего.
 */
function resolveDates(card) {
  const events = card.entries.filter((e) => e.type === 'event');
  let prev = null;
  for (const ev of events) {
    ev.dateSpec = parseDate(ev.date, { prev });
    if (ev.dateSpec.valid) prev = ev.dateSpec;
  }
  let next = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.dateSpec.needsYear) ev.dateSpec = parseDate(ev.date, { next, fallbackYear: new Date().getFullYear() });
    if (ev.dateSpec.valid) next = ev.dateSpec;
  }
}

/** Все события карточки (без секций). */
function eventsOf(card) {
  return card.entries.filter((e) => e.type === 'event');
}

/** Wiki-ссылки (не встраивания) из текста: [[Цель|Алиас]] -> 'Цель'. */
function extractWikiLinks(text) {
  const out = [];
  const re = /(!?)\[\[([^\]\n]+?)\]\]/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    if (m[1]) continue;
    const target = m[2].split('|')[0].split('#')[0].trim();
    if (target && !out.includes(target)) out.push(target);
  }
  return out;
}

/** Все блоки таймлайна в тексте заметки: [{ source, language, lineStart, lineEnd }] (номера строк ограждений). */
function findTrackBlocks(content, languages) {
  const langs = Array.isArray(languages) ? languages : [languages];
  const lines = String(content || '').split('\n');
  const blocks = [];
  let open = null;
  lines.forEach((line, i) => {
    if (!open) {
      const m = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w-]+)\s*$/);
      if (m && langs.includes(m[3])) open = { fence: m[2], start: i, language: m[3] };
    } else if (line.trim().startsWith(open.fence) && line.trim().replace(/[`~]/g, '') === '') {
      blocks.push({ source: lines.slice(open.start + 1, i).join('\n'), language: open.language, lineStart: open.start, lineEnd: i });
      open = null;
    }
  });
  return blocks;
}

module.exports = { parseCard, resolveDates, eventsOf, extractWikiLinks, findTrackBlocks, normalizeMarker };
