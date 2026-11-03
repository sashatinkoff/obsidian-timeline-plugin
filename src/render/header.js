'use strict';

/* Шапка карточки: режимы, теги, заголовок, бейдж, поиск, кнопка «Запись», описание. */

const { setIcon } = require('obsidian');
const { THEME_PRESETS } = require('../constants');
const { resolveAccent, openPopover } = require('../utils/dom');
const { debounce } = require('../utils/text');
const { makeInlineInput } = require('./inlineEdit');
const { tagPill, renderMarkdown } = require('./eventCard');

const MODES = [
  { key: 'timeline', label: 'Таймлайн', icon: 'list' },
  { key: 'source', label: 'Исходный код', icon: 'code' },
  { key: 'graph', label: 'Граф', icon: 'share-2' },
];

function renderColorPicker(parent, card, ctx) {
  const { settings, block } = ctx;
  const swatch = parent.createDiv({ cls: 'tc-color-swatch', attr: { 'aria-label': 'Цвет карточки' } });
  swatch.style.background = resolveAccent(card.color, settings);
  swatch.addEventListener('click', (e) => {
    e.stopPropagation();
    openPopover(swatch, (pop, close) => {
      const grid = pop.createDiv({ cls: 'tc-color-grid' });
      for (const [key, preset] of Object.entries(THEME_PRESETS)) {
        const opt = grid.createDiv({ cls: 'tc-color-option', attr: { 'aria-label': preset.label } });
        opt.style.background = preset.color;
        if (card.color === key) opt.addClass('is-active');
        opt.addEventListener('click', () => { close(); block.mutate((c) => { c.color = key; }); });
      }
      const custom = grid.createEl('label', { cls: 'tc-color-option tc-color-custom', attr: { 'aria-label': 'Свой цвет' }, text: '⋯' });
      const input = custom.createEl('input', { attr: { type: 'color' } });
      input.value = resolveAccent(card.color, settings);
      input.addEventListener('change', () => { close(); block.mutate((c) => { c.color = input.value; }); });
      const reset = pop.createDiv({ cls: 'tc-color-reset', text: 'Сбросить (тема по умолчанию)' });
      reset.addEventListener('click', () => { close(); block.mutate((c) => { c.color = ''; }); });
    }, 'tc-color-popover');
  });
}

function renderHeader(parent, card, ctx) {
  const { app, settings, sourcePath, component, block } = ctx;
  const head = parent.createDiv({ cls: 'tc-header' });

  /* --- верхняя полоса: теги слева, режимы справа --- */
  const top = head.createDiv({ cls: 'tc-header-top' });
  const tags = top.createDiv({ cls: 'tc-tags tc-header-tags' });
  card.tags.forEach((t) => tagPill(tags, t, (tag) => block.setQuery(`#${tag}`)));
  top.createDiv({ cls: 'tc-spacer' });
  const modes = top.createDiv({ cls: 'tc-modes' });
  for (const m of MODES) {
    const btn = modes.createDiv({ cls: `tc-mode${block.ui.mode === m.key ? ' is-active' : ''}` });
    setIcon(btn.createSpan({ cls: 'tc-mode-icon' }), m.icon);
    btn.createSpan({ cls: 'tc-mode-label', text: m.label });
    btn.addEventListener('click', () => block.setMode(m.key));
  }
  renderColorPicker(top, card, ctx);

  /* --- заголовок + поиск --- */
  const row = head.createDiv({ cls: 'tc-header-main' });
  const left = row.createDiv({ cls: 'tc-header-left' });
  const titleLine = left.createDiv({ cls: 'tc-title-line' });
  const title = titleLine.createDiv({ cls: `tc-card-title${card.title ? '' : ' is-placeholder'}`, text: card.title || 'Заголовок таймлайна' });
  makeInlineInput(title, { value: card.title, onSave: (v) => block.mutate((c) => { c.title = v; }) });
  if (card.badge) titleLine.createSpan({ cls: 'tc-card-badge', text: card.badge });

  if (card.description) {
    const desc = left.createDiv({ cls: 'tc-card-desc markdown-rendered' });
    renderMarkdown(app, card.description, desc, sourcePath, component);
  }

  if (block.ui.mode === 'timeline') {
    const tools = row.createDiv({ cls: 'tc-header-tools' });
    if (settings.showSearch) {
      const search = tools.createDiv({ cls: 'tc-search' });
      setIcon(search.createSpan({ cls: 'tc-search-icon' }), 'search');
      const input = search.createEl('input', { attr: { type: 'search', placeholder: 'Поиск по событиям…' } });
      input.value = block.ui.query;
      const apply = debounce(() => block.setQuery(input.value, true), 200);
      input.addEventListener('input', apply);
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; block.setQuery('', true); } });
      block.searchInput = input;
    }
    const add = tools.createEl('button', { cls: 'tc-btn tc-btn-primary tc-add-btn' });
    setIcon(add.createSpan({ cls: 'tc-btn-icon' }), 'plus');
    add.createSpan({ text: 'Запись' });
    add.addEventListener('click', () => block.openForm());
  }
  head.createDiv({ cls: 'tc-divider' });
  return head;
}

module.exports = { renderHeader };
