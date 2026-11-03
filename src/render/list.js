'use strict';

/*
 * Лента событий: группы (секции #### или годы), разрывы линии, поиск, сортировка.
 */

const { setIcon } = require('obsidian');
const { plural } = require('../utils/text');
const { monthLabel } = require('../utils/dates');
const { renderEventCard } = require('./eventCard');
const { allTags } = require('../model/linkedTags');

const RECORDS = ['ключевая запись', 'ключевые записи', 'ключевых записей'];

function matches(ev, query) {
  if (!query) return true;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${ev.title}\n${ev.body}\n${ev.label}\n${ev.date}\n${ev.id}`.toLowerCase();
  return terms.every((t) => (t.startsWith('marker:') ? ev.marker === t.slice(7) : t.startsWith('#') && t.length > 1
    ? allTags(ev).some((tag) => tag.toLowerCase().startsWith(t.slice(1)))
    : hay.includes(t) || allTags(ev).some((tag) => tag.toLowerCase().includes(t))));
}

/**
 * Проставляет каждому событию «эффективные» ключ сортировки и год.
 * Событие с нераспознанной датой («Весной как-то») не улетает в конец и не
 * рвёт группу года: оно наследует позицию предыдущего события в заметке
 * (а если его нет — следующего).
 */
function annotate(items) {
  let lastKey = null;
  let lastYear = null;
  for (const it of items) {
    const s = it.ev.dateSpec;
    if (s && s.valid) { lastKey = s.sortKey; lastYear = s.year; }
    it.key = s && s.valid ? s.sortKey : lastKey;
    it.year = s && s.valid ? s.year : lastYear;
  }
  let nextKey = null;
  let nextYear = null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.key == null) { it.key = nextKey; it.year = nextYear; } else { nextKey = it.key; nextYear = it.year; }
  }
  return items;
}

function sortEvents(items, mode) {
  annotate(items);
  if (mode === 'file') return items;
  return [...items].sort((a, b) => (a.key == null || b.key == null ? 0 : a.key - b.key) || a.index - b.index);
}

/** Делит события на группы: [{ label, kind: 'section'|'year'|'none', items: [{ev, index}] }] */
function buildGroups(card, settings, sortMode) {
  const hasSections = card.entries.some((e) => e.type === 'section');
  let groups = [];
  if (hasSections) {
    let cur = { label: '', kind: 'none', items: [] };
    card.entries.forEach((e, index) => {
      if (e.type === 'section') {
        if (cur.items.length || cur.label) groups.push(cur);
        cur = { label: e.label, kind: 'section', items: [] };
      } else cur.items.push({ ev: e, index });
    });
    groups.push(cur);
    groups.forEach((g) => { g.items = sortEvents(g.items, sortMode); });
  } else {
    const all = sortEvents(card.entries.map((ev, index) => ({ ev, index })).filter((x) => x.ev.type === 'event'), sortMode);
    if (!settings.groupByYear) groups = [{ label: '', kind: 'none', items: all }];
    else {
      for (const it of all) {
        const label = it.year != null ? String(it.year) : 'Без даты';
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.items.push(it);
        else groups.push({ label, kind: 'year', items: [it] });
      }
    }
  }
  return groups.filter((g) => g.items.length || g.kind === 'section');
}

/** Последовательность строк с разрывами (в хронологическом/файловом порядке). */
function withBreaks(groups, settings) {
  let prev = null;
  for (const g of groups) {
    g.rows = [];
    for (const it of g.items) {
      const ev = it.ev;
      const s = ev.dateSpec;
      let gap = null;
      if (prev && s && s.valid) gap = s.startIdx - prev.endIdx;
      const auto = settings.autoBreakDays > 0 && gap != null && gap >= settings.autoBreakDays;
      if (ev.breakText != null || auto) g.rows.push({ kind: 'break', gap, text: ev.breakText, explicit: ev.breakText != null, at: s && s.valid ? s.startIdx : null });
      g.rows.push({ kind: 'event', ...it });
      if (s && s.valid) prev = s;
    }
  }
}

function renderBreak(list, row) {
  const el = list.createDiv({ cls: `tc-row tc-break${row.explicit ? '' : ' is-auto'}` });
  const rail = el.createDiv({ cls: 'tc-rail' });
  rail.createDiv({ cls: 'tc-break-dots' });
  const pill = el.createDiv({ cls: 'tc-break-pill' });
  setIcon(pill.createSpan({ cls: 'tc-break-pill-icon' }), 'history');
  const parts = [];
  const pause = row.gap != null && row.gap > 0 ? `пауза ${row.gap} ${plural(row.gap, ['день', 'дня', 'дней'])}` : '';
  parts.push(row.explicit ? `Разрыв линии${pause ? ` (${pause})` : ''}` : pause.replace(/^п/, 'П'));
  if (row.text) parts.push(row.text);
  else if (row.explicit && row.at != null && row.gap > 27) parts.push(monthLabel(row.at - Math.floor(row.gap / 2)));
  pill.createSpan({ text: parts.join(' — ') });
}

/**
 * @param parent  контейнер
 * @param card    модель карточки
 * @param ctx     { app, settings, sourcePath, component, block }
 */
function renderList(parent, card, ctx) {
  const { settings, block } = ctx;
  const sortMode = block.ui.sortMode;
  const query = block.ui.query.trim();
  const total = card.entries.filter((e) => e.type === 'event').length;

  const groups = buildGroups(card, settings, sortMode);
  withBreaks(groups, settings);
  if (sortMode === 'desc') {
    groups.reverse();
    groups.forEach((g) => g.rows.reverse());
  }

  const wrap = parent.createDiv({ cls: 'tc-feed' });
  let shown = 0;
  let firstHeader = true;

  if (!total) {
    const empty = wrap.createDiv({ cls: 'tc-empty' });
    empty.createDiv({ text: 'Событий пока нет' });
    const btn = empty.createEl('button', { cls: 'tc-btn tc-btn-primary', text: 'Добавить первое событие' });
    btn.addEventListener('click', () => block.openForm());
    return;
  }

  for (const g of groups) {
    const visibleRows = g.rows.filter((r) => r.kind === 'event' ? matches(r.ev, query) : !query);
    const count = visibleRows.filter((r) => r.kind === 'event').length;
    if (query && !count) continue;
    shown += count;

    const header = wrap.createDiv({ cls: `tc-group-head is-${g.kind}` });
    if (g.label) header.createDiv({ cls: 'tc-group-title', text: g.label });
    header.createDiv({ cls: 'tc-chip tc-mono', text: `${count} ${plural(count, RECORDS)}` });
    header.createDiv({ cls: 'tc-spacer' });
    if (firstHeader) {
      firstHeader = false;
      const sortBtn = header.createDiv({ cls: 'tc-sort-btn' });
      const labels = { file: 'Порядок как в заметке', asc: 'Хронологический порядок', desc: 'Сначала новые' };
      const icons = { file: 'list', asc: 'arrow-down-wide-narrow', desc: 'arrow-up-wide-narrow' };
      setIcon(sortBtn.createSpan({ cls: 'tc-sort-icon' }), icons[sortMode]);
      sortBtn.createSpan({ text: labels[sortMode] });
      sortBtn.setAttr('aria-label', 'Сменить порядок');
      sortBtn.addEventListener('click', () => {
        const order = ['file', 'asc', 'desc'];
        block.setSort(order[(order.indexOf(sortMode) + 1) % order.length]);
      });
    }

    const list = wrap.createDiv({ cls: 'tc-list' });
    for (const row of visibleRows) {
      if (row.kind === 'break') renderBreak(list, row);
      else renderEventCard(list, row.ev, row.index, ctx);
    }
  }

  const end = wrap.createDiv({ cls: 'tc-end' });
  end.createSpan({ cls: 'tc-end-dot' });
  end.createSpan({
    text: query
      ? `Найдено ${shown} из ${total} ${plural(total, ['события', 'событий', 'событий'])}`
      : `Конец списка • ${total} ${plural(total, ['событие', 'события', 'событий'])}`,
  });
  if (query) {
    const reset = end.createSpan({ cls: 'tc-end-reset', text: 'Сбросить поиск' });
    reset.addEventListener('click', () => block.setQuery(''));
  }
}

module.exports = { renderList, buildGroups, matches };
