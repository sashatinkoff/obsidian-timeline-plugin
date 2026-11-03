'use strict';

/*
 * Сворачивание длинного текста события по числу строк.
 * Порог считается от line-height, а не сравнением scrollHeight/clientHeight
 * неограниченного блока (ошибка, исправленная в v2.4.1).
 */

function setupCollapse(bodyEl, settings, { expanded, onToggle }) {
  if (!settings.collapseLongText) return;
  const measure = () => {
    if (!bodyEl.isConnected) return;
    const cs = window.getComputedStyle(bodyEl);
    let lh = parseFloat(cs.lineHeight);
    if (!lh || isNaN(lh)) lh = (parseFloat(cs.fontSize) || 15) * 1.6;
    const threshold = Math.round(lh * Math.max(1, settings.collapseMaxLines || 4));
    if (bodyEl.scrollHeight <= threshold + lh * 0.6) return;

    bodyEl.style.setProperty('--tc-collapse-height', `${threshold}px`);
    bodyEl.toggleClass('tc-clamped', !expanded);
    const toggle = createDiv({ cls: 'tc-toggle' });
    const label = toggle.createSpan();
    const icon = toggle.createSpan({ cls: 'tc-toggle-icon' });
    const sync = () => {
      const clamped = bodyEl.hasClass('tc-clamped');
      label.setText(clamped ? 'Показать полностью' : 'Свернуть');
      icon.setText(clamped ? '⌄' : '⌃');
    };
    sync();
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const clamped = bodyEl.toggleClass('tc-clamped', !bodyEl.hasClass('tc-clamped'));
      sync();
      if (onToggle) onToggle(!bodyEl.hasClass('tc-clamped'));
      return clamped;
    });
    bodyEl.after(toggle);
  };
  // ждём раскладку (в Live Preview блок может быть ещё не в DOM)
  requestAnimationFrame(() => requestAnimationFrame(measure));
}

module.exports = { setupCollapse };
