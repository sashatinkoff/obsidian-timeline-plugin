'use strict';

/** Русское склонение: plural(5, ['запись', 'записи', 'записей']) */
function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

function formatSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const num = i === 0 || v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${String(num).replace('.', ',')} ${units[i]}`;
}

function formatDuration(sec) {
  if (!isFinite(sec)) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Стабильный номер цвета (0..n-1) для тега. */
function hashIndex(str, n) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % n;
}

function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** «#a, #b c» -> ['a', 'b', 'c'] */
function parseTags(text) {
  return String(text || '')
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^#+/, '').trim())
    .filter(Boolean)
    .filter((t, i, arr) => arr.indexOf(t) === i);
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

module.exports = { plural, formatSize, formatDuration, hashIndex, debounce, parseTags, slugify };
