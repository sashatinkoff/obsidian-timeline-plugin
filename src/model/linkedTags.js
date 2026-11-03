'use strict';

/*
 * Данные из заметок, на которые ссылается событие ([[Николас Мадуро]]):
 *   - теги заметки (свойство tags и #теги в тексте);
 *   - картинки и видео, встроенные в заметку (![[фото.jpg]]);
 *   - список связанных заметок — для фрагмента текста «под катом».
 */

const { getAllTags, TFile } = require('obsidian');
const { extractWikiLinks } = require('./parser');
const { IMAGE_EXT, VIDEO_EXT } = require('../constants');

const MAX_LINKED_MEDIA = 12;

function tagsOfFile(app, file) {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];
  const raw = (getAllTags ? getAllTags(cache) : (cache.tags || []).map((t) => t.tag)) || [];
  return raw.map((t) => t.replace(/^#/, '')).filter(Boolean);
}

/** Картинки и видео, встроенные в заметку (по кэшу метаданных, без чтения файла). */
function mediaOfFile(app, file) {
  const cache = app.metadataCache.getFileCache(file);
  const out = [];
  for (const embed of (cache && cache.embeds) || []) {
    const link = embed.link.split('#')[0];
    const target = app.metadataCache.getFirstLinkpathDest(link, file.path);
    if (!(target instanceof TFile)) continue;
    const ext = target.extension.toLowerCase();
    const kind = IMAGE_EXT.includes(ext) ? 'image' : VIDEO_EXT.includes(ext) ? 'video' : null;
    if (!kind) continue;
    const alt = embed.displayText && embed.displayText !== embed.link && !/^\d+(x\d+)?$/.test(embed.displayText) ? embed.displayText : '';
    out.push({ file: target, link: embed.link, alt, kind, from: file.basename });
  }
  return out;
}

/**
 * Проставляет событиям карточки:
 *   ev.linkedNotes  — TFile заметок, на которые ссылается событие
 *   ev.linkedPaths  — их пути (для обновления при изменении)
 *   ev.linkedTags   — [{ tag, from: ['Заметка'] }] без тегов, уже указанных у события
 *   ev.linkedMedia  — картинки и видео из этих заметок
 * opts: { tags: bool, media: bool }
 */
function annotateLinkedTags(app, card, sourcePath, opts) {
  const o = typeof opts === 'object' && opts ? opts : { tags: !!opts, media: false };
  for (const ev of card.entries) {
    if (ev.type !== 'event') continue;
    ev.linkedNotes = [];
    ev.linkedPaths = [];
    ev.linkedTags = [];
    ev.linkedMedia = [];
    const own = new Set(ev.tags.map((t) => t.toLowerCase()));
    const byTag = new Map();
    const seenMedia = new Set();
    for (const target of extractWikiLinks(`${ev.title}\n${ev.body}`)) {
      const file = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
      if (!(file instanceof TFile) || file.extension !== 'md' || file.path === sourcePath) continue;
      if (ev.linkedPaths.includes(file.path)) continue;
      ev.linkedNotes.push(file);
      ev.linkedPaths.push(file.path);
      if (o.tags) {
        for (const tag of tagsOfFile(app, file)) {
          const key = tag.toLowerCase();
          if (own.has(key)) continue;
          if (!byTag.has(key)) byTag.set(key, { tag, from: [] });
          const entry = byTag.get(key);
          if (!entry.from.includes(file.basename)) entry.from.push(file.basename);
        }
      }
      if (o.media) {
        for (const m of mediaOfFile(app, file)) {
          if (seenMedia.has(m.file.path) || ev.linkedMedia.length >= MAX_LINKED_MEDIA) continue;
          seenMedia.add(m.file.path);
          ev.linkedMedia.push(m);
        }
      }
    }
    ev.linkedTags = [...byTag.values()];
  }
  return card;
}

/** Все теги события: собственные + из связанных заметок. */
function allTags(ev) {
  return [...ev.tags, ...((ev.linkedTags || []).map((t) => t.tag))];
}

/**
 * Текст события состоит только из ссылок на заметки (знаки препинания не в счёт)?
 * Тогда под ним показывается фрагмент связанной заметки.
 */
function isLinkOnly(text) {
  const t = String(text || '');
  if (!/\[\[[^\]]+\]\]/.test(t)) return false;
  return t.replace(/!?\[\[[^\]]+\]\]/g, '').replace(/[\s.,;:!?—–\-•*_>()]/g, '') === '';
}

/**
 * Фрагмент текста заметки: без свойств, встраиваний медиа и пустых строк,
 * по целым абзацам до ~limit символов. { text, truncated, words }
 */
async function noteExcerpt(app, file, limit) {
  let content = await app.vault.cachedRead(file);
  const cache = app.metadataCache.getFileCache(file);
  if (cache && cache.frontmatterPosition) content = content.slice(cache.frontmatterPosition.end.offset);
  else content = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  content = content
    .replace(/!\[\[[^\]]+\]\]/g, (m) => {
      const ext = m.slice(3, -2).split('|')[0].split('.').pop().toLowerCase();
      return IMAGE_EXT.includes(ext) || VIDEO_EXT.includes(ext) ? '' : m;
    })
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // заголовок, повторяющий имя заметки, не нужен — оно уже в шапке ката
  const h1 = content.match(/^#\s+(.+)\n*/);
  if (h1 && h1[1].trim().toLowerCase() === file.basename.toLowerCase()) content = content.slice(h1[0].length).trim();
  const words = content ? content.split(/\s+/).length : 0;
  if (content.length <= limit) return { text: content, truncated: false, words };
  const paras = content.split(/\n{2,}/);
  let out = '';
  for (const p of paras) {
    const sep = out ? '\n\n' : '';
    if (out.length + sep.length + p.length <= limit) { out += sep + p; continue; }
    const room = limit - out.length - sep.length;
    if (room > limit * 0.3 || !out) {
      // абзац не влезает целиком — режем по предложению, иначе по слову
      const cut = p.slice(0, Math.max(room, 1));
      const dot = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
      const space = cut.lastIndexOf(' ');
      const end = dot > room * 0.5 ? dot + 1 : space > room * 0.5 ? space : cut.length;
      const piece = cut.slice(0, end).trimEnd();
      out += `${sep}${piece}${/[.!?]$/.test(piece) ? '' : '…'}`;
    }
    break;
  }
  // не заканчиваем фрагмент «висящим» заголовком
  out = out.replace(/(\n\n#{1,6}\s[^\n]*)+$/, '');
  return { text: out, truncated: true, words };
}

/**
 * Markdown -> простой текст с сохранением переносов строк:
 * без разметки выносок/цитат, заголовков, выделения, ссылок (остаётся их текст),
 * встраиваний, комментариев, HTML и ограждений кода.
 */
function markdownToPlain(md) {
  // [ \t] вместо \s в якорях ^ — чтобы не «съедать» пустые строки между абзацами
  return String(md || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*(```|~~~).*$/gm, '')                         // ограждения кода
    .replace(/%%[\s\S]*?%%/g, '')                                 // комментарии Obsidian
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*>[ \t]*\[![^\]]+\][+-]?[ \t]*(.*)$/gm, '$1')  // заголовок выноски: только его текст
    .replace(/^([ \t]*>)+[ \t]?/gm, '')                           // маркеры цитат
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')                     // заголовки
    .replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/gm, '• ')         // задачи
    .replace(/^([ \t]*)[-*+][ \t]+/gm, '$1• ')                    // маркированные списки
    .replace(/^[ \t]*(-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')          // горизонтальные линии
    .replace(/!\[\[[^\]]*\]\]/g, '')                              // встраивания
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                         // картинки markdown
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')                // [[цель|текст]]
    .replace(/\[\[([^\]]+)\]\]/g, (m, t) => t.split('#').pop().replace(/^\^/, ''))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                      // [текст](url)
    .replace(/<[^>]+>/g, '')                                      // HTML
    .replace(/(\*\*|__)(.+?)\1/g, '$2')                           // жирный
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/gm, '$1$2') // курсив
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|[ \t])#[\p{L}\p{N}_/-]+/gmu, '$1')               // #теги
    .replace(/(\S)[ \t]{2,}/g, '$1 ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


module.exports = { markdownToPlain, annotateLinkedTags, allTags, tagsOfFile, mediaOfFile, isLinkOnly, noteExcerpt };
