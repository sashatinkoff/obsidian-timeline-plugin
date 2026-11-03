'use strict';

/* Карточка одного события: буллет на линии, шапка, текст, медиа, теги, ID. */

const { setIcon, Menu, MarkdownRenderer, Notice } = require('obsidian');
const { MARKERS, MARKER_ORDER } = require('../constants');
const { formatDate } = require('../utils/dates');
const { hashIndex } = require('../utils/text');
const { extractMedia, renderMediaSection } = require('./media');
const { isLinkOnly, noteExcerpt, markdownToPlain } = require('../model/linkedTags');
const { setupCollapse } = require('./collapse');
const { makeInlineInput, openInlineTextarea } = require('./inlineEdit');
const { confirm } = require('../modals/ConfirmModal');

const TAG_COLORS = 6;

async function renderMarkdown(app, md, el, sourcePath, component) {
  if (MarkdownRenderer.render) await MarkdownRenderer.render(app, md, el, sourcePath, component);
  else await MarkdownRenderer.renderMarkdown(md, el, sourcePath, component);
}

function renderBullet(parent, marker) {
  const b = parent.createDiv({ cls: `tc-bullet is-${marker}` });
  const m = MARKERS[marker] || MARKERS.empty;
  if (m.icon) setIcon(b, m.icon);
  return b;
}

function tagPill(parent, tag, onClick) {
  const pill = parent.createSpan({ cls: `tc-tag tc-tag-c${hashIndex(tag, TAG_COLORS)}`, text: `#${tag}` });
  if (onClick) pill.addEventListener('click', (e) => { e.stopPropagation(); onClick(tag); });
  return pill;
}

/**
 * @param list     контейнер строк таймлайна
 * @param ev       событие (из parser)
 * @param index    индекс в card.entries
 * @param ctx      { app, settings, sourcePath, component, block }
 */
function renderEventCard(list, ev, index, ctx) {
  const { app, settings, sourcePath, component, block } = ctx;
  const row = list.createDiv({ cls: `tc-row tc-event is-${ev.marker}` });
  row.dataset.index = String(index);

  /* --- буллет --- */
  const rail = row.createDiv({ cls: 'tc-rail' });
  const bullet = renderBullet(rail, ev.marker);
  bullet.setAttr('aria-label', 'Тип буллета');
  bullet.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = new Menu();
    for (const key of MARKER_ORDER) {
      menu.addItem((it) => it.setTitle(MARKERS[key].label).setIcon(MARKERS[key].icon || 'circle')
        .setChecked(ev.marker === key)
        .onClick(() => block.mutate((card) => { card.entries[index].marker = key; })));
    }
    menu.showAtMouseEvent(e);
  });

  const card = row.createDiv({ cls: 'tc-event-card' });

  /* --- шапка --- */
  const head = card.createDiv({ cls: 'tc-event-head' });
  const titleEl = head.createDiv({ cls: 'tc-event-title' });
  // заголовок может содержать [[ссылки]] — рендерим как markdown-строку
  renderMarkdown(app, ev.title || '(без названия)', titleEl, sourcePath, component).then(() => {
    const p = titleEl.querySelector('p');
    if (p && titleEl.childElementCount === 1) p.replaceWith(...Array.from(p.childNodes));
  });
  makeInlineInput(titleEl, {
    value: ev.title,
    onSave: (v) => v && block.mutate((c) => { c.entries[index].title = v; }),
  });

  const meta = head.createDiv({ cls: 'tc-event-meta' });
  if (ev.label) meta.createSpan({ cls: `tc-badge is-${ev.marker}`, text: ev.label });
  const dateEl = meta.createDiv({ cls: 'tc-event-date' });
  setIcon(dateEl.createSpan({ cls: 'tc-date-icon' }), 'calendar');
  const dateText = dateEl.createSpan({ cls: 'tc-date-text' });
  const human = settings.humanDates && ev.dateSpec && ev.dateSpec.valid;
  dateText.setText(human ? formatDate(ev.dateSpec) : (ev.date || 'без даты'));
  if (human && ev.date) dateEl.setAttr('aria-label', ev.date);
  if (!ev.date) dateEl.addClass('is-empty');
  makeInlineInput(dateEl, {
    value: ev.date, cls: 'tc-mono',
    onSave: (v) => block.mutate((c) => { c.entries[index].date = v; }),
  });

  /* --- текст --- */
  const { text, items } = extractMedia(ev.body, app, sourcePath);
  const bodyWrap = card.createDiv({ cls: 'tc-event-body-wrap' });
  const showBody = () => {
    bodyWrap.empty();
    if (!text) {
      const add = bodyWrap.createDiv({ cls: 'tc-body-add', text: '+ Добавить описание' });
      add.addEventListener('click', (e) => { e.stopPropagation(); editBody(); });
      return;
    }
    const bodyEl = bodyWrap.createDiv({ cls: 'tc-event-body markdown-rendered' });
    const onlyLink = settings.linkedExcerpt && isLinkOnly(text) && (ev.linkedNotes || []).length > 0;
    const collapse = () => setupCollapse(bodyEl, settings, {
      expanded: block.ui.expanded.has(index),
      onToggle: (open) => (open ? block.ui.expanded.add(index) : block.ui.expanded.delete(index)),
    });
    if (onlyLink) {
      // в тексте только [[ссылка]] — вместо неё несколько строк из заметки и «Читать далее»;
      // если у заметки нет текста, показываем саму ссылку
      appendLinkedText(bodyEl, ev.linkedNotes.slice(0, 3), ctx).then((shown) => {
        if (!shown) renderMarkdown(app, text, bodyEl, sourcePath, component);
      });
    } else {
      // собственный текст события показывается как есть (сворачивание — только если включено в настройках)
      renderMarkdown(app, text, bodyEl, sourcePath, component).then(collapse);
    }
    // текст — всегда предпросмотр; правка по двойному клику, карандашу или из меню
    bodyEl.addEventListener('dblclick', (e) => {
      if (e.target.closest('a, .tc-toggle, img, video, audio, input, .callout-fold, .internal-embed')) return;
      if (window.getSelection) window.getSelection().removeAllRanges();
      editBody();
    });
  };
  const editBody = () => openInlineTextarea(bodyWrap, {
    value: ev.body, app, sourcePath, component,
    onSave: (v) => block.mutate((c) => { c.entries[index].body = v; }),
    onCancel: showBody,
  });
  showBody();

  /* --- медиа --- */
  const own = new Set(items.map((i) => i.file.path));
  const linkedMedia = (ev.linkedMedia || []).filter((m) => !own.has(m.file.path));
  renderMediaSection(card, items.concat(linkedMedia), { app, settings, sourcePath });

  /* --- низ: теги, ID и кнопки (кнопки внизу, чтобы не сдвигать дату в шапке) --- */
  const foot = card.createDiv({ cls: 'tc-event-foot' });
  const linked = ev.linkedTags || [];
  if (!ev.tags.length && !linked.length && !(settings.showIds && ev.id)) foot.addClass('is-bare');
  const tags = foot.createDiv({ cls: 'tc-tags' });
  ev.tags.forEach((t) => tagPill(tags, t, (tag) => block.setQuery(`#${tag}`)));
  linked.forEach(({ tag, from }) => {
    const pill = tagPill(tags, tag, (t) => block.setQuery(`#${t}`));
    pill.addClass('is-linked');
    pill.setAttr('aria-label', `Из заметки: ${from.join(', ')}`);
  });
  if (settings.showIds && ev.id) foot.createDiv({ cls: 'tc-event-id', text: `ID: #${ev.id}` });
  const actions = foot.createDiv({ cls: 'tc-event-actions' });
  const editBtn = actions.createDiv({ cls: 'tc-icon-btn', attr: { 'aria-label': 'Редактировать в форме' } });
  setIcon(editBtn, 'pencil');
  editBtn.addEventListener('click', (e) => { e.stopPropagation(); block.openForm(ev, index); });
  const moreBtn = actions.createDiv({ cls: 'tc-icon-btn', attr: { 'aria-label': 'Действия' } });
  setIcon(moreBtn, 'more-horizontal');
  const showMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    eventMenu(ev, index, ctx, editBody).showAtMouseEvent(e);
  };
  moreBtn.addEventListener('click', showMenu);
  card.addEventListener('contextmenu', (e) => {
    if (e.target.closest('textarea, input')) return;
    showMenu(e);
  });
  return row;
}

/**
 * «Кат» с фрагментом связанной заметки. Текст читается и рисуется только
 * при первом раскрытии, ссылки внутри работают относительно самой заметки.
 */
/**
 * Текст связанных заметок прямо в теле карточки (без свойств, медиа и
 * заголовка с именем заметки). Ссылки внутри работают относительно самой заметки.
 */
async function appendLinkedText(bodyEl, files, ctx) {
  const { app, settings } = ctx;
  const lines = Math.max(1, settings.excerptLines || 4);
  let shown = 0;
  for (const file of files) {
    try {
      const ex = await noteExcerpt(app, file, settings.excerptLength || 1200);
      if (!markdownToPlain(ex.text)) continue;
      const box = bodyEl.createDiv({ cls: 'tc-linked-text' });
      shown++;
      const clip = box.createDiv({ cls: 'tc-linked-clip' });
      // только текст, без разметки; переносы строк сохраняются (white-space: pre-line)
      clip.setText(markdownToPlain(ex.text));
      const more = box.createDiv({ cls: 'tc-linked-more', text: 'Читать далее →' });
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        app.workspace.openLinkText(file.path, ctx.sourcePath, e.ctrlKey || e.metaKey || 'tab');
      });
      // обрезка ровно по N строкам: высоту считаем от line-height после раскладки
      requestAnimationFrame(() => {
        if (!clip.isConnected) return;
        const cs = window.getComputedStyle(clip);
        let lh = parseFloat(cs.lineHeight);
        if (!lh || isNaN(lh)) lh = (parseFloat(cs.fontSize) || 15) * 1.6;
        const max = Math.round(lh * lines);
        const overflow = clip.scrollHeight > max + 2;
        if (overflow) {
          clip.style.maxHeight = `${max}px`;
          clip.addClass('is-clipped');
        }
        if (!overflow && !ex.truncated) more.remove();
      });
    } catch (err) {
      console.warn('[Event Timeline] не удалось прочитать', file.path, err);
    }
  }
  return shown;
}

function eventMenu(ev, index, ctx, editBody) {
  const { app, block, sourcePath } = ctx;
  const menu = new Menu();
  menu.addItem((it) => it.setTitle('Редактировать в форме').setIcon('pencil').onClick(() => block.openForm(ev, index)));
  menu.addItem((it) => it.setTitle('Изменить текст на месте').setIcon('text-cursor-input').onClick(() => editBody()));
  menu.addItem((it) => it.setTitle(ev.breakText != null ? 'Убрать разрыв линии' : 'Разрыв линии перед событием')
    .setIcon('unfold-horizontal')
    .onClick(() => block.mutate((c) => { c.entries[index].breakText = ev.breakText != null ? null : ''; })));
  menu.addSeparator();
  menu.addItem((it) => it.setTitle('Переместить выше').setIcon('arrow-up').onClick(() => block.move(index, -1)));
  menu.addItem((it) => it.setTitle('Переместить ниже').setIcon('arrow-down').onClick(() => block.move(index, 1)));
  menu.addItem((it) => it.setTitle('Дублировать').setIcon('copy').onClick(() => block.mutate((c) => {
    const copy = { ...c.entries[index], tags: [...c.entries[index].tags], title: `${c.entries[index].title} (копия)` };
    c.entries.splice(index + 1, 0, copy);
  })));
  menu.addItem((it) => it.setTitle('Скопировать ссылку на заметку').setIcon('link').onClick(async () => {
    const file = app.vault.getAbstractFileByPath(sourcePath);
    const link = file ? app.fileManager.generateMarkdownLink(file, '') : sourcePath;
    await navigator.clipboard.writeText(`${link} — ${ev.title}`);
    new Notice('Ссылка скопирована');
  }));
  menu.addSeparator();
  menu.addItem((it) => {
    it.setTitle('Удалить событие').setIcon('trash-2').onClick(async () => {
      const ok = await confirm(app, { title: 'Удалить событие?', message: `«${ev.title}» будет удалено из таймлайна.` });
      if (ok) block.mutate((c) => { c.entries.splice(index, 1); });
    });
    if (it.setWarning) it.setWarning(true);
  });
  return menu;
}

module.exports = { renderEventCard, renderBullet, tagPill, renderMarkdown };
