'use strict';

/*
 * Автокомплит `[[` для textarea (своя реализация: у Obsidian нет публичного
 * suggester'а для произвольного поля). Заметка вставляется как [[Имя]],
 * медиафайл — как встраивание ![[файл.ext]].
 */

const { autoResize } = require('../utils/dom');

function attachLinkSuggest(textarea, app, sourcePath) {
  let dropdown = null;
  let items = [];
  let selected = 0;
  let ctx = null;

  const close = () => {
    if (dropdown) dropdown.remove();
    dropdown = null;
  };

  const queryContext = () => {
    const pos = textarea.selectionStart;
    const m = /\[\[([^\][\n]*)$/.exec(textarea.value.slice(0, pos));
    return m ? { query: m[1], start: pos - m[1].length } : null;
  };

  const candidates = (query) => {
    const q = query.toLowerCase().split('|')[0];
    return app.vault.getFiles()
      .map((f) => {
        const base = f.basename.toLowerCase();
        const path = f.path.toLowerCase();
        let score = -1;
        if (!q) score = f.extension === 'md' ? 1 : 0;
        else if (base === q) score = 4;
        else if (base.startsWith(q)) score = 3;
        else if (base.includes(q)) score = 2;
        else if (path.includes(q)) score = 1;
        return { f, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || b.f.stat.mtime - a.f.stat.mtime)
      .slice(0, 12)
      .map((x) => x.f);
  };

  const choose = (file) => {
    const isMedia = file.extension !== 'md';
    const link = app.metadataCache.fileToLinktext(file, sourcePath, true);
    const insert = isMedia ? `![[${link}]]` : `[[${link}]]`;
    let before = textarea.value.slice(0, ctx.start - 2);
    if (isMedia && before.endsWith('!')) before = before.slice(0, -1);
    const after = textarea.value.slice(textarea.selectionStart).replace(/^\]\]/, '');
    textarea.value = before + insert + after;
    const caret = (before + insert).length;
    textarea.setSelectionRange(caret, caret);
    close();
    autoResize(textarea);
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
  };

  const highlight = () => {
    if (!dropdown) return;
    Array.from(dropdown.children).forEach((el, i) => el.toggleClass('is-selected', i === selected));
    const sel = dropdown.children[selected];
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  };

  const open = () => {
    close();
    if (!items.length) return;
    dropdown = document.body.createDiv({ cls: 'tc-suggest' });
    items.forEach((file, i) => {
      const row = dropdown.createDiv({ cls: 'tc-suggest-item' });
      row.createSpan({ cls: 'tc-suggest-name', text: file.extension === 'md' ? file.basename : file.name });
      if (file.parent && file.parent.path !== '/') row.createSpan({ cls: 'tc-suggest-path', text: file.parent.path });
      row.addEventListener('mousedown', (e) => { e.preventDefault(); choose(file); });
      row.addEventListener('mouseenter', () => { selected = i; highlight(); });
    });
    const r = textarea.getBoundingClientRect();
    dropdown.style.left = `${r.left}px`;
    dropdown.style.top = `${r.bottom + 4}px`;
    dropdown.style.width = `${Math.max(240, Math.min(r.width, 420))}px`;
    highlight();
  };

  textarea.addEventListener('input', () => {
    const c = queryContext();
    if (!c) { close(); return; }
    ctx = c;
    items = candidates(c.query);
    selected = 0;
    open();
  });

  textarea.addEventListener('keydown', (e) => {
    if (!dropdown) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = (selected + 1) % items.length; highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selected = (selected - 1 + items.length) % items.length; highlight(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); choose(items[selected]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  textarea.addEventListener('blur', () => setTimeout(close, 150));

  return { isOpen: () => !!dropdown, close };
}

module.exports = { attachLinkSuggest };
