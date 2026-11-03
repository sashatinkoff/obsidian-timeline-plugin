'use strict';

/* Запись изменённой карточки обратно в заметку. */

const { TFile, Notice } = require('obsidian');
const { BLOCK_LANGUAGES } = require('../constants');
const { findTrackBlocks } = require('./parser');
const { serializeCard } = require('./serializer');

const norm = (s) => String(s || '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');

/**
 * Находит блок в тексте заметки: сначала по номеру строки из getSectionInfo,
 * затем по совпадению исходного текста, затем по порядковому номеру.
 */
function locateBlock(content, hint) {
  const blocks = findTrackBlocks(content, BLOCK_LANGUAGES);
  if (!blocks.length) return null;
  if (hint.lineStart != null) {
    const byLine = blocks.find((b) => b.lineStart === hint.lineStart);
    if (byLine && (hint.source == null || norm(byLine.source) === norm(hint.source))) return byLine;
  }
  if (hint.source != null) {
    const bySource = blocks.find((b) => norm(b.source) === norm(hint.source));
    if (bySource) return bySource;
  }
  if (hint.index != null && blocks[hint.index]) return blocks[hint.index];
  if (hint.lineStart != null) return blocks.find((b) => b.lineStart === hint.lineStart) || null;
  return null;
}

/**
 * @param app
 * @param {string} path      путь заметки
 * @param {object} hint      { lineStart?, source?, index? }
 * @param {object} card      модель карточки
 * @returns {Promise<string>} новый исходный текст блока
 */
async function saveCard(app, path, hint, card) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    new Notice('Event Timeline: заметка не найдена');
    return null;
  }
  const inner = serializeCard(card);
  let ok = false;
  await app.vault.process(file, (data) => {
    const block = locateBlock(data, hint);
    if (!block) return data;
    ok = true;
    const lines = data.split('\n');
    return [...lines.slice(0, block.lineStart + 1), inner, ...lines.slice(block.lineEnd)].join('\n');
  });
  if (!ok) new Notice('Event Timeline: не удалось найти блок в заметке — изменения не сохранены');
  return ok ? inner : null;
}

/** Сохранить «сырой» текст блока (режим «Исходный код»). */
async function saveRaw(app, path, hint, text) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  let ok = false;
  await app.vault.process(file, (data) => {
    const block = locateBlock(data, hint);
    if (!block) return data;
    ok = true;
    const lines = data.split('\n');
    return [...lines.slice(0, block.lineStart + 1), norm(text), ...lines.slice(block.lineEnd)].join('\n');
  });
  if (!ok) new Notice('Event Timeline: не удалось найти блок в заметке');
  return ok;
}

module.exports = { saveCard, saveRaw, locateBlock };
