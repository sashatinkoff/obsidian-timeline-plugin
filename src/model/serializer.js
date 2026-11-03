'use strict';

/* Обратная сборка блока ```track из модели (см. parser.js). */

const { parseDate } = require('../utils/dates');

function serializeEvent(ev) {
  const lines = [`### ${ev.marker === 'accent' ? '!' : ''}${(ev.title || '').trim()}`];
  lines.push((ev.date || '').trim());
  if (ev.marker && ev.marker !== 'empty' && ev.marker !== 'accent') lines.push(`marker:: ${ev.marker}`);
  if (ev.label) lines.push(`label:: ${ev.label.trim()}`);
  if (ev.tags && ev.tags.length) lines.push(`tags:: ${ev.tags.map((t) => '#' + t).join(' ')}`);
  if (ev.id) lines.push(`id:: ${ev.id.trim()}`);
  if (ev.breakText != null) lines.push(`break:: ${ev.breakText.trim()}`.trimEnd());
  const body = (ev.body || '').replace(/\s+$/, '');
  if (body) lines.push(body);
  return lines.join('\n');
}

function serializeCard(card) {
  const head = [];
  if (card.title) head.push(`## ${card.title.trim()}`);
  if (card.color) head.push(`%% color: ${card.color} %%`);
  if (card.badge) head.push(`%% badge: ${card.badge} %%`);
  if (card.tags && card.tags.length) head.push(`%% tags: ${card.tags.map((t) => '#' + t).join(' ')} %%`);
  if (card.status) head.push(`%% status: ${card.status} %%`);
  if (card.description) head.push(card.description.replace(/\s+$/, ''));

  const parts = [];
  if (head.length) parts.push(head.join('\n'));
  for (const entry of card.entries) {
    parts.push(entry.type === 'section' ? `#### ${entry.label || ''}` : serializeEvent(entry));
  }
  return parts.join('\n\n');
}

/**
 * Позиция вставки нового события.
 * mode 'date': после последнего события с датой <= новой (секции не пересекаем вперёд);
 * нераспознанная дата или mode 'end' — в конец.
 */
function insertIndex(card, ev, mode) {
  const n = card.entries.length;
  if (mode !== 'date') return n;
  const spec = parseDate(ev.date);
  if (!spec.valid) return n;
  let lastLE = -1;
  let firstEvent = -1;
  card.entries.forEach((e, i) => {
    if (e.type !== 'event') return;
    if (firstEvent < 0) firstEvent = i;
    const s = e.dateSpec || parseDate(e.date);
    if (s.valid && s.sortKey <= spec.sortKey) lastLE = i;
  });
  if (lastLE >= 0) return lastLE + 1;
  if (firstEvent >= 0) {
    // все события позже нового — ставим перед первым событием (после ведущей секции, если есть)
    return firstEvent;
  }
  return n;
}

module.exports = { serializeCard, serializeEvent, insertIndex };
