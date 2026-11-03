'use strict';

/*
 * Медиа события. Все встраивания файлов ![[файл.ext]] (не заметок) вынимаются
 * из текста и показываются отдельным блоком: плитки для фото/видео,
 * плеер для аудио, карточки-документы для PDF и прочего.
 * Картинки и видео рисуются напрямую через vault.getResourcePath() —
 * без асинхронного механизма эмбедов Obsidian (урок v2.2).
 */

const { setIcon, TFile } = require('obsidian');
const { IMAGE_EXT, VIDEO_EXT, AUDIO_EXT } = require('../constants');
const { formatSize, formatDuration } = require('../utils/text');
const { openLightbox } = require('../utils/dom');

function kindOf(ext) {
  const e = String(ext || '').toLowerCase();
  if (IMAGE_EXT.includes(e)) return 'image';
  if (VIDEO_EXT.includes(e)) return 'video';
  if (AUDIO_EXT.includes(e)) return 'audio';
  if (e === 'pdf') return 'pdf';
  return 'file';
}

/** Вынимает медиа-встраивания из markdown. */
function extractMedia(body, app, sourcePath) {
  const items = [];
  const text = String(body || '').replace(/!\[\[([^\]\n]+?)\]\]/g, (match, inner) => {
    const [linkRaw, ...altParts] = inner.split('|');
    const link = linkRaw.split('#')[0].trim();
    const file = app.metadataCache.getFirstLinkpathDest(link, sourcePath);
    if (!(file instanceof TFile) || file.extension === 'md' || file.extension === 'canvas') return match;
    const alt = altParts.join('|').trim();
    items.push({ file, link: linkRaw.trim(), alt: /^\d+(x\d+)?$/.test(alt) ? '' : alt, kind: kindOf(file.extension) });
    return '';
  });
  // убираем строки, от которых остались только пробелы
  const cleaned = text.split('\n').filter((l, i, arr) => !(l.trim() === '' && (arr[i - 1] || '').trim() === '')).join('\n').trim();
  return { text: cleaned, items };
}

/** Медиа, подтянутое из связанной заметки, — пометка и подсказка. */
function markLinked(tile, item) {
  if (!item.from) return;
  tile.addClass('is-linked');
  tile.setAttr('aria-label', `Из заметки «${item.from}»`);
  const chip = tile.createDiv({ cls: 'tc-media-from' });
  setIcon(chip.createSpan(), 'link');
  chip.createSpan({ text: item.from });
}

function caption(tile, item, settings, extra) {
  if (!settings.showMediaCaptions) return;
  const cap = tile.createDiv({ cls: 'tc-media-caption' });
  cap.createSpan({ cls: 'tc-media-name', text: item.alt || item.file.name });
  cap.createSpan({ cls: 'tc-media-size', text: extra || formatSize(item.file.stat.size) });
}

function renderImage(grid, item, ctx, gallery, index) {
  const tile = grid.createDiv({ cls: 'tc-media-tile is-image' });
  markLinked(tile, item);
  const thumb = tile.createDiv({ cls: 'tc-media-thumb' });
  const img = thumb.createEl('img', { attr: { src: ctx.app.vault.getResourcePath(item.file), alt: item.alt || item.file.name, loading: 'lazy' } });
  img.addEventListener('error', () => { img.remove(); setIcon(thumb.createDiv({ cls: 'tc-media-placeholder' }), 'image-off'); });
  thumb.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) ctx.app.workspace.openLinkText(item.file.path, ctx.sourcePath, true);
    else openLightbox(gallery, index);
  });
  caption(tile, item, ctx.settings);
}

function renderVideo(grid, item, ctx) {
  const tile = grid.createDiv({ cls: 'tc-media-tile is-video' });
  markLinked(tile, item);
  const thumb = tile.createDiv({ cls: 'tc-media-thumb' });
  const video = thumb.createEl('video', { attr: { src: ctx.app.vault.getResourcePath(item.file), preload: 'metadata', playsinline: '' } });
  const play = thumb.createDiv({ cls: 'tc-media-play' });
  setIcon(play, 'play');
  const badge = thumb.createDiv({ cls: 'tc-media-duration' });
  video.addEventListener('loadedmetadata', () => {
    if (isFinite(video.duration)) badge.setText(formatDuration(video.duration));
  });
  play.addEventListener('click', (e) => {
    e.stopPropagation();
    video.controls = true;
    tile.addClass('is-playing');
    video.play();
  });
  caption(tile, item, ctx.settings);
}

function renderAudio(list, item, ctx) {
  const row = list.createDiv({ cls: 'tc-media-doc is-audio' });
  const icon = row.createDiv({ cls: 'tc-media-doc-icon' });
  setIcon(icon, 'music');
  const info = row.createDiv({ cls: 'tc-media-doc-info' });
  info.createDiv({ cls: 'tc-media-doc-name', text: item.alt || item.file.name });
  info.createEl('audio', { attr: { src: ctx.app.vault.getResourcePath(item.file), controls: '', preload: 'none' } });
}

function renderDoc(list, item, ctx) {
  const row = list.createDiv({ cls: `tc-media-doc is-${item.kind}` });
  const icon = row.createDiv({ cls: 'tc-media-doc-icon' });
  setIcon(icon, item.kind === 'pdf' ? 'file-text' : 'file');
  const info = row.createDiv({ cls: 'tc-media-doc-info' });
  info.createDiv({ cls: 'tc-media-doc-name', text: item.file.name });
  const meta = [item.alt, item.file.extension.toUpperCase(), formatSize(item.file.stat.size)].filter(Boolean).join(' • ');
  info.createDiv({ cls: 'tc-media-doc-meta', text: meta });
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.app.workspace.openLinkText(item.file.path, ctx.sourcePath, e.ctrlKey || e.metaKey || 'tab');
  });
}

function renderMediaSection(parent, items, ctx) {
  if (!items.length) return;
  const section = parent.createDiv({ cls: 'tc-media' });
  const visual = items.filter((i) => i.kind === 'image' || i.kind === 'video');
  const docs = items.filter((i) => i.kind !== 'image' && i.kind !== 'video');



  if (visual.length) {
    const grid = section.createDiv({ cls: 'tc-media-grid' });
    grid.style.setProperty('--tc-media-min', `${Math.max(60, ctx.settings.mediaSize || 140)}px`);
    const gallery = visual.filter((i) => i.kind === 'image')
      .map((i) => ({ src: ctx.app.vault.getResourcePath(i.file), alt: i.alt || i.file.name }));
    let gi = 0;
    for (const item of visual) {
      if (item.kind === 'image') renderImage(grid, item, ctx, gallery, gi++);
      else renderVideo(grid, item, ctx);
    }
  }
  if (docs.length) {
    const list = section.createDiv({ cls: 'tc-media-docs' });
    for (const item of docs) {
      if (item.kind === 'audio') renderAudio(list, item, ctx);
      else renderDoc(list, item, ctx);
    }
  }
}

module.exports = { extractMedia, renderMediaSection, kindOf };
