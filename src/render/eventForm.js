'use strict';

/*
 * Форма «Добавить событие в таймлайн» (по макету). Та же форма используется
 * для редактирования: open(event, index) заполняет поля и меняет подписи.
 */

const { setIcon, Notice, TFile } = require('obsidian');
const { MARKERS, MARKER_ORDER } = require('../constants');
const { parseTags } = require('../utils/text');
const { autoResize } = require('../utils/dom');
const { attachLinkSuggest } = require('./linkSuggest');
const { createMdTabs, attachPreview } = require('./inlineEdit');
const { extractMedia, kindOf } = require('./media');
const { VaultFileModal } = require('../modals/VaultFileModal');

function autoDateString(settings) {
  if (!settings.autoDate) return '';
  const m = window.moment;
  if (typeof m === 'function') {
    try { return m().locale(settings.dateLocale || 'ru').format(settings.dateFormat || 'YYYY-MM-DD HH:mm'); } catch (e) { /* ниже */ }
  }
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function field(parent, label, hint) {
  const wrap = parent.createDiv({ cls: 'tc-field' });
  const lab = wrap.createDiv({ cls: 'tc-field-label' });
  lab.createSpan({ text: label });
  if (hint) lab.createSpan({ cls: 'tc-field-hint', text: hint });
  return wrap;
}

/**
 * @param parent  контейнер
 * @param ctx     { app, settings, sourcePath }
 * @param opts    { onSubmit(eventData, index|null): Promise, collapsed: bool }
 */
function createEventForm(parent, ctx, opts) {
  const { app, settings, sourcePath } = ctx;
  const state = { index: null, marker: 'empty', attachments: [], breakOn: false };

  const root = parent.createDiv({ cls: 'tc-form' });
  root.toggleClass('is-collapsed', !!opts.collapsed);

  /* ---- шапка ---- */
  const head = root.createDiv({ cls: 'tc-form-head' });
  const plus = head.createDiv({ cls: 'tc-form-plus' });
  setIcon(plus, 'plus');
  const headTitle = head.createDiv({ cls: 'tc-form-title', text: 'Добавить событие в таймлайн' });
  head.createEl('kbd', { cls: 'tc-kbd', text: 'Alt + N' });
  head.createDiv({ cls: 'tc-spacer' });
  const modeChip = head.createDiv({ cls: 'tc-chip', text: 'форма создания' });
  const chevron = head.createDiv({ cls: 'tc-form-chevron' });
  setIcon(chevron, 'chevron-down');
  head.addEventListener('click', () => (root.hasClass('is-collapsed') ? open() : collapse()));

  const body = root.createDiv({ cls: 'tc-form-body' });

  /* ---- заголовок + дата ---- */
  const row1 = body.createDiv({ cls: 'tc-form-row tc-row-title' });
  const titleInput = field(row1, 'Заголовок события *').createEl('input', {
    cls: 'tc-input', attr: { type: 'text', placeholder: 'Например: Саммит БРИКС или Подписание соглашения…' },
  });
  const dateInput = field(row1, 'Дата / период *').createEl('input', {
    cls: 'tc-input tc-mono', attr: { type: 'text', placeholder: '12 мая 2026 или Май 2026' },
  });

  /* ---- тип буллета + разрыв ---- */
  const row2 = body.createDiv({ cls: 'tc-form-row tc-row-marker' });
  const markerWrap = field(row2, 'Тип буллета (timeline marker)').createDiv({ cls: 'tc-marker-picker' });
  const markerBtns = {};
  for (const key of MARKER_ORDER) {
    const m = MARKERS[key];
    const btn = markerWrap.createDiv({ cls: `tc-marker-option is-${key}`, attr: { 'aria-label': m.label } });
    const icon = btn.createDiv({ cls: `tc-bullet is-${key}` });
    if (m.icon) setIcon(icon, m.icon);
    btn.createDiv({ cls: 'tc-marker-option-label', text: m.label });
    btn.addEventListener('click', () => setMarker(key));
    markerBtns[key] = btn;
  }

  const breakField = field(row2, 'Разрыв временной линии');
  const breakCard = breakField.createDiv({ cls: 'tc-break-card' });
  const breakIcon = breakCard.createDiv({ cls: 'tc-break-icon' });
  setIcon(breakIcon, 'unfold-horizontal');
  const breakInfo = breakCard.createDiv({ cls: 'tc-break-info' });
  breakInfo.createDiv({ cls: 'tc-break-title', text: 'Разрыв линии перед событием' });
  breakInfo.createDiv({ cls: 'tc-break-desc', text: 'Индикатор паузы между событиями' });
  const toggle = breakCard.createDiv({ cls: 'checkbox-container' });
  toggle.createEl('input', { attr: { type: 'checkbox', tabindex: '-1' } });
  const breakText = breakField.createEl('input', {
    cls: 'tc-input tc-break-text', attr: { type: 'text', placeholder: 'Подпись разрыва, например: Период консультаций' },
  });
  breakCard.addEventListener('click', () => setBreak(!state.breakOn));

  /* ---- текст ---- */
  const textField = field(body, 'Текст заметки (Markdown и [[wiki-ссылки]])', 'Поддерживается [[Wiki-link]]');
  const mdTabs = createMdTabs(textField);
  const textarea = textField.createEl('textarea', {
    cls: 'tc-input tc-textarea',
    attr: { rows: '4', placeholder: 'Краткое описание события… Используйте [[Имя страницы]] для связи с заметками.' },
  });
  textarea.addEventListener('input', () => autoResize(textarea));
  const suggest = attachLinkSuggest(textarea, app, sourcePath);
  const preview = attachPreview(textField, textarea, mdTabs, { app, sourcePath, component: ctx.component });

  /* ---- метка, id ---- */
  const row3 = body.createDiv({ cls: 'tc-form-row tc-row-meta' });
  const labelInput = field(row3, 'Метка на карточке').createEl('input', {
    cls: 'tc-input', attr: { type: 'text', placeholder: 'Тревога / Финансы' },
  });
  const idInput = field(row3, 'ID').createEl('input', {
    cls: 'tc-input tc-mono', attr: { type: 'text', placeholder: 'fin-2026-02' },
  });

  /* ---- медиа ---- */
  const drop = body.createDiv({ cls: 'tc-dropzone' });
  const dropText = drop.createDiv({ cls: 'tc-dropzone-text' });
  setIcon(dropText.createSpan({ cls: 'tc-dropzone-icon' }), 'image');
  dropText.createSpan({ text: 'Прикрепить медиафайлы (изображения, видео, документы) — кнопкой или перетаскиванием' });
  const dropBtns = drop.createDiv({ cls: 'tc-dropzone-btns' });
  const fileInput = drop.createEl('input', { attr: { type: 'file', multiple: '' } });
  fileInput.style.display = 'none';
  const pickBtn = (icon, text, handler) => {
    const b = dropBtns.createEl('button', { cls: 'tc-btn tc-btn-ghost' });
    setIcon(b.createSpan({ cls: 'tc-btn-icon' }), icon);
    b.createSpan({ text });
    b.addEventListener('click', (e) => { e.preventDefault(); handler(); });
  };
  const pickLocal = (accept) => { fileInput.accept = accept; fileInput.value = ''; fileInput.click(); };
  pickBtn('video', 'Видео', () => pickLocal('video/*'));
  pickBtn('image', 'Фото', () => pickLocal('image/*'));
  pickBtn('paperclip', 'Файл', () => pickLocal(''));
  pickBtn('vault', 'Из хранилища', () => new VaultFileModal(app, (f) => addAttachment(f)).open());
  const chips = body.createDiv({ cls: 'tc-attach-chips' });

  fileInput.addEventListener('change', () => importFiles(Array.from(fileInput.files || [])));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.addClass('is-over'); });
  drop.addEventListener('dragleave', () => drop.removeClass('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.removeClass('is-over');
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (files.length) { importFiles(files); return; }
    // перетаскивание из файлового проводника Obsidian
    const text = e.dataTransfer && e.dataTransfer.getData('text/plain');
    const m = text && text.match(/\[\[([^\]]+)\]\]/);
    const f = m && app.metadataCache.getFirstLinkpathDest(m[1], sourcePath);
    if (f instanceof TFile) addAttachment(f);
  });

  /* ---- низ ---- */
  const foot = body.createDiv({ cls: 'tc-form-foot' });
  foot.createSpan({ cls: 'tc-field-label tc-inline-label', text: 'Теги:' });
  const tagsInput = foot.createEl('input', { cls: 'tc-input tc-mono tc-tags-input', attr: { type: 'text', placeholder: '#геополитика, #хроника' } });
  foot.createDiv({ cls: 'tc-spacer' });
  const cancelBtn = foot.createEl('button', { cls: 'tc-btn', text: 'Отмена' });
  const submitBtn = foot.createEl('button', { cls: 'tc-btn tc-btn-primary' });
  setIcon(submitBtn.createSpan({ cls: 'tc-btn-icon' }), 'check');
  const submitLabel = submitBtn.createSpan({ text: 'Добавить в таймлайн' });

  cancelBtn.addEventListener('click', (e) => { e.preventDefault(); reset(); collapse(); });
  submitBtn.addEventListener('click', (e) => { e.preventDefault(); submit(); });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    else if (e.key === 'Escape' && !suggest.isOpen()) { e.preventDefault(); reset(); collapse(); }
  });

  /* ---- логика ---- */
  function setMarker(key) {
    state.marker = key;
    for (const k of MARKER_ORDER) markerBtns[k].toggleClass('is-selected', k === key);
  }
  function setBreak(on) {
    state.breakOn = on;
    toggle.toggleClass('is-enabled', on);
    breakText.toggleClass('is-hidden', !on);
  }
  function renderChips() {
    chips.empty();
    state.attachments.forEach((link, i) => {
      const chip = chips.createDiv({ cls: 'tc-attach-chip' });
      const ext = link.split('.').pop();
      const kind = kindOf(ext);
      setIcon(chip.createSpan({ cls: 'tc-attach-icon' }), kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'audio' ? 'music' : 'file');
      chip.createSpan({ text: link.split('/').pop() });
      const x = chip.createSpan({ cls: 'tc-attach-remove' });
      setIcon(x, 'x');
      x.addEventListener('click', () => { state.attachments.splice(i, 1); renderChips(); });
    });
  }
  function addAttachment(file) {
    const link = app.metadataCache.fileToLinktext(file, sourcePath, false);
    if (!state.attachments.includes(link)) state.attachments.push(link);
    renderChips();
  }
  async function importFiles(files) {
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer();
        const path = await app.fileManager.getAvailablePathForAttachment(f.name, sourcePath);
        const created = await app.vault.createBinary(path, buf);
        addAttachment(created);
      } catch (err) {
        console.error('[Event Timeline] не удалось сохранить вложение', err);
        new Notice(`Не удалось сохранить ${f.name}: ${err.message}`);
      }
    }
  }

  function reset() {
    state.index = null;
    state.attachments = [];
    titleInput.value = '';
    dateInput.value = autoDateString(settings);
    textarea.value = '';
    labelInput.value = '';
    idInput.value = '';
    tagsInput.value = '';
    breakText.value = '';
    setMarker('empty');
    setBreak(false);
    renderChips();
    headTitle.setText('Добавить событие в таймлайн');
    modeChip.setText('форма создания');
    submitLabel.setText('Добавить в таймлайн');
    root.removeClass('is-editing');
    if (preview.isActive()) preview.show(false);
    autoResize(textarea);
  }

  function fill(ev, index) {
    reset();
    state.index = index;
    const { text, items } = extractMedia(ev.body, app, sourcePath);
    titleInput.value = ev.title || '';
    dateInput.value = ev.date || '';
    textarea.value = text;
    labelInput.value = ev.label || '';
    idInput.value = ev.id || '';
    tagsInput.value = (ev.tags || []).map((t) => '#' + t).join(', ');
    breakText.value = ev.breakText || '';
    state.attachments = items.map((i) => i.link);
    setMarker(ev.marker || 'empty');
    setBreak(ev.breakText != null);
    renderChips();
    headTitle.setText('Редактирование события');
    modeChip.setText('правка');
    submitLabel.setText('Сохранить изменения');
    root.addClass('is-editing');
    setTimeout(() => autoResize(textarea), 0);
  }

  async function submit() {
    const title = titleInput.value.trim();
    const date = dateInput.value.trim();
    if (!title) { titleInput.addClass('is-invalid'); titleInput.focus(); return; }
    if (!date) { dateInput.addClass('is-invalid'); dateInput.focus(); return; }
    titleInput.removeClass('is-invalid');
    dateInput.removeClass('is-invalid');
    const media = state.attachments.map((l) => `![[${l}]]`).join('\n');
    const text = textarea.value.replace(/\s+$/, '');
    const eventData = {
      type: 'event',
      title,
      date,
      marker: state.marker,
      label: labelInput.value.trim(),
      tags: parseTags(tagsInput.value),
      id: idInput.value.trim(),
      breakText: state.breakOn ? breakText.value.trim() : null,
      body: [text, media].filter(Boolean).join('\n\n'),
    };
    submitBtn.disabled = true;
    try {
      await opts.onSubmit(eventData, state.index);
      reset();
      collapse();
    } catch (err) {
      console.warn('[Event Timeline] событие не сохранено', err);
    } finally {
      submitBtn.disabled = false;
    }
  }

  function open(ev, index) {
    if (ev) fill(ev, index);
    else if (root.hasClass('is-editing')) reset();
    else if (!dateInput.value) dateInput.value = autoDateString(settings);
    root.removeClass('is-collapsed');
    root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(() => titleInput.focus(), 50);
  }
  function collapse() {
    root.addClass('is-collapsed');
  }

  reset();
  return { el: root, open, collapse, reset, isDirty: () => !!(titleInput.value || textarea.value) };
}

module.exports = { createEventForm, autoDateString };
