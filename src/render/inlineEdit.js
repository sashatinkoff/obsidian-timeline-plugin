'use strict';

/* Быстрая правка прямо в карточке (как в v2): клик по полю -> input/textarea. */

const { autoResize } = require('../utils/dom');
const { attachLinkSuggest } = require('./linkSuggest');

/** Однострочное поле. onSave(value) вызывается только если значение изменилось. */
function makeInlineInput(el, { value, onSave, cls = '' }) {
  el.addClass('tc-editable');
  el.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    e.stopPropagation();
    const input = createEl('input', { cls: `tc-inline-input ${cls}`, attr: { type: 'text' } });
    input.value = value || '';
    el.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v !== (value || '').trim()) onSave(v);
      else input.replaceWith(el);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
  });
}

/** Многострочная правка текста события. Esc — отмена, Cmd/Ctrl+Enter или уход фокуса — сохранить. */
function openInlineTextarea(container, { value, app, sourcePath, component, onSave, onCancel }) {
  container.empty();
  const tabs = createMdTabs(container);
  const ta = container.createEl('textarea', { cls: 'tc-inline-textarea' });
  ta.value = value || '';
  const preview = attachPreview(container, ta, tabs, { app, sourcePath, component });
  const suggest = attachLinkSuggest(ta, app, sourcePath);
  const hint = container.createDiv({ cls: 'tc-inline-hint', text: 'Cmd/Ctrl+Enter — сохранить · Esc — отмена · [[ — ссылка' });
  const bar = container.createDiv({ cls: 'tc-inline-bar' });
  bar.appendChild(hint);
  bar.createDiv({ cls: 'tc-spacer' });
  const cancelBtn = bar.createEl('button', { cls: 'tc-btn', text: 'Отмена' });
  const saveBtn = bar.createEl('button', { cls: 'tc-btn tc-btn-primary', text: 'Сохранить' });
  cancelBtn.addEventListener('mousedown', (e) => { e.preventDefault(); finish(false); });
  saveBtn.addEventListener('mousedown', (e) => { e.preventDefault(); finish(true); });
  setTimeout(() => { autoResize(ta); ta.focus(); }, 0);
  ta.addEventListener('input', () => autoResize(ta));
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save && ta.value !== value) onSave(ta.value.replace(/\s+$/, ''));
    else onCancel();
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !suggest.isOpen()) { e.preventDefault(); finish(false); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(true); }
  });
  ta.addEventListener('blur', () => setTimeout(() => {
    // переключение на «Просмотр» или клик по вкладкам не сохраняет и не закрывает редактор
    if (suggest.isOpen() || document.activeElement === ta || preview.isActive() || container.contains(document.activeElement)) return;
    if (container.matches(':hover')) return;
    finish(true);
  }, 160));
  return { el: ta, hint };
}

/* ---------- вкладки «Текст / Просмотр» для полей с markdown ---------- */

function createMdTabs(parent) {
  const tabs = parent.createDiv({ cls: 'tc-md-tabs' });
  const write = tabs.createDiv({ cls: 'tc-md-tab is-active', text: 'Текст' });
  const view = tabs.createDiv({ cls: 'tc-md-tab', text: 'Просмотр' });
  return { el: tabs, write, view };
}

/**
 * Предпросмотр markdown под вкладкой «Просмотр»: рендерит текст textarea
 * штатным рендерером Obsidian (ссылки, выноски, списки, встраивания).
 */
function attachPreview(parent, ta, tabs, { app, sourcePath, component }) {
  const { MarkdownRenderer } = require('obsidian');
  const box = createDiv({ cls: 'tc-md-preview tc-event-body markdown-rendered' });
  ta.after(box);
  box.style.display = 'none';
  let active = false;
  const show = async (on) => {
    active = on;
    tabs.write.toggleClass('is-active', !on);
    tabs.view.toggleClass('is-active', on);
    ta.style.display = on ? 'none' : '';
    box.style.display = on ? '' : 'none';
    if (on) {
      box.empty();
      const md = ta.value.trim() ? ta.value : '*Пусто*';
      if (MarkdownRenderer.render) await MarkdownRenderer.render(app, md, box, sourcePath, component);
      else await MarkdownRenderer.renderMarkdown(md, box, sourcePath, component);
      box.style.minHeight = '';
    } else {
      ta.focus();
    }
  };
  tabs.write.addEventListener('mousedown', (e) => { e.preventDefault(); show(false); });
  tabs.view.addEventListener('mousedown', (e) => { e.preventDefault(); show(true); });
  return { isActive: () => active, show, el: box };
}

module.exports = { makeInlineInput, openInlineTextarea, createMdTabs, attachPreview };
