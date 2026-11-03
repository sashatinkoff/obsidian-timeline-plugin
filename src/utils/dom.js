'use strict';

const { THEME_PRESETS, HOVER_SOURCE } = require('../constants');

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight + 2}px`;
}

/** Акцентный цвет: значение из %% color %% (пресет или hex) или глобальная тема. */
function resolveAccent(value, settings) {
  const global = settings.theme === 'custom'
    ? settings.customColor
    : (THEME_PRESETS[settings.theme] || THEME_PRESETS.purple).color;
  if (!value) return global;
  if (value.startsWith('#')) return value;
  const preset = THEME_PRESETS[value.toLowerCase()];
  return preset ? preset.color : global;
}

/**
 * Наведение на ссылку -> нативное превью Page Preview. Источник HOVER_SOURCE
 * регистрируется в plugin.js с defaultMod: true — нужен Cmd/Ctrl,
 * а поведение можно поменять в настройках Page preview.
 */
function wireHoverPreview(container, app, sourcePath, hoverParent) {
  container.addEventListener('mouseover', (event) => {
    const linkEl = event.target.closest && event.target.closest('a.internal-link, .tc-link');
    if (!linkEl || !container.contains(linkEl)) return;
    const linktext = linkEl.getAttribute('data-href') || linkEl.getAttribute('href') || '';
    if (!linktext) return;
    app.workspace.trigger('hover-link', {
      event, source: HOVER_SOURCE, hoverParent: hoverParent || container, targetEl: linkEl, linktext, sourcePath,
    });
  });
}

/** Клик по внутренним ссылкам там, где Obsidian сам их не обрабатывает (боковая панель, граф). */
function wireLinkClicks(container, app, sourcePath) {
  container.addEventListener('click', (event) => {
    const linkEl = event.target.closest && event.target.closest('a.internal-link, .tc-link');
    if (!linkEl || !container.contains(linkEl)) return;
    event.preventDefault();
    const linktext = linkEl.getAttribute('data-href') || linkEl.getAttribute('href');
    if (linktext) app.workspace.openLinkText(linktext, sourcePath, event.ctrlKey || event.metaKey);
  });
}

/* ---------- Полноэкранный просмотр изображений с листанием ---------- */
let activeLightbox = null;

function openLightbox(items, startIndex = 0) {
  if (activeLightbox) activeLightbox.close();
  let index = startIndex;
  const overlay = document.body.createDiv({ cls: 'tc-lightbox' });
  const img = overlay.createEl('img', { cls: 'tc-lightbox-img' });
  const caption = overlay.createDiv({ cls: 'tc-lightbox-caption' });
  const prev = items.length > 1 ? overlay.createDiv({ cls: 'tc-lightbox-nav is-prev', text: '‹' }) : null;
  const next = items.length > 1 ? overlay.createDiv({ cls: 'tc-lightbox-nav is-next', text: '›' }) : null;

  const show = () => {
    const it = items[index];
    img.src = it.src;
    img.alt = it.alt || '';
    caption.setText(items.length > 1 ? `${it.alt || ''}  ·  ${index + 1} / ${items.length}` : (it.alt || ''));
  };
  const step = (d) => { index = (index + d + items.length) % items.length; show(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if (activeLightbox && activeLightbox.overlay === overlay) activeLightbox = null;
  };
  if (prev) prev.addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
  if (next) next.addEventListener('click', (e) => { e.stopPropagation(); step(1); });
  img.addEventListener('click', (e) => { e.stopPropagation(); if (items.length > 1) step(1); else close(); });
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  show();
  activeLightbox = { overlay, close };
}

/** Поповер, закрывающийся по клику мимо. */
function openPopover(anchor, build, cls = '') {
  document.querySelectorAll('.tc-popover').forEach((p) => p.remove());
  const pop = document.body.createDiv({ cls: `tc-popover ${cls}` });
  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', onDown, true);
  };
  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  build(pop, close);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth || 220;
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
  return close;
}

module.exports = { autoResize, resolveAccent, wireHoverPreview, wireLinkClicks, openLightbox, openPopover };
