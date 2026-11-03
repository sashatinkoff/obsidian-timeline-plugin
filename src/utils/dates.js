'use strict';

/*
 * Разбор и форматирование дат событий.
 * Понимает: 2026-01-03, 2026-01, 2026, 03.01.2026, 01.2026,
 * «3 января 2026», «январь 2026», «янв 2026», а также периоды:
 * 2026-01-03..2026-01-10, «3–10 января 2026», «март — май 2026».
 */

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const MONTH_STEMS = [
  ['янв', 1], ['фев', 2], ['мар', 3], ['апр', 4], ['май', 5], ['мая', 5], ['мае', 5],
  ['июн', 6], ['июл', 7], ['авг', 8], ['сен', 9], ['окт', 10], ['ноя', 11], ['дек', 12],
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['may', 5], ['jun', 6], ['jul', 7],
  ['aug', 8], ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12],
];

function monthFromName(name) {
  const n = String(name || '').toLowerCase().replace(/\.$/, '');
  if (n.length < 3) return 0;
  for (const [stem, num] of MONTH_STEMS) if (n.startsWith(stem)) return num;
  return 0;
}

const pad = (n) => String(n).padStart(2, '0');

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function valid(p) {
  if (!p || !p.y || p.y < 1 || p.y > 9999) return false;
  if (p.m && (p.m < 1 || p.m > 12)) return false;
  if (p.d && (p.d < 1 || p.d > daysInMonth(p.y, p.m))) return false;
  return true;
}

/** Одна точка: { y, m, d, h, min } (m/d могут быть 0 — точность месяц/год; h=null — без времени). */
function parsePoint(text) {
  let s = String(text || '').trim().replace(/\s+/g, ' ');
  let time = null;
  const t = s.match(/^(.*?)(?:,|\s|T)\s*(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (t && +t[2] < 24 && +t[3] < 60) { s = t[1].trim(); time = { h: +t[2], min: +t[3] }; }
  const p = parseDay(s.replace(/\s*г(од)?\.?$/i, ''));
  if (!p) return null;
  if (time && p.d) Object.assign(p, time);
  else if (time) return null;
  return p;
}

function parseDay(s) {
  let r;
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return { y: +r[1], m: +r[2], d: +r[3] };
  if ((r = s.match(/^(\d{4})-(\d{1,2})$/))) return { y: +r[1], m: +r[2], d: 0 };
  if ((r = s.match(/^(\d{4})$/))) return { y: +r[1], m: 0, d: 0 };
  if ((r = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/))) return { y: +r[3], m: +r[2], d: +r[1] };
  if ((r = s.match(/^(\d{1,2})[./](\d{4})$/))) return { y: +r[2], m: +r[1], d: 0 };
  if ((r = s.match(/^(\d{1,2}) ([a-zа-яё]+\.?),? (\d{4})$/i))) {
    const m = monthFromName(r[2]);
    if (m) return { y: +r[3], m, d: +r[1] };
  }
  if ((r = s.match(/^([a-zа-яё]+\.?),? (\d{4})$/i))) {
    const m = monthFromName(r[1]);
    if (m) return { y: +r[2], m, d: 0 };
  }
  return null;
}

/** Левая часть периода может быть неполной: «3», «3 января», «март». */
function parseLeft(text, right) {
  const s = String(text || '').trim();
  const full = parsePoint(s);
  if (full) return full;
  let r;
  if ((r = s.match(/^(\d{1,2})$/)) && right.m) return { y: right.y, m: right.m, d: +r[1] };
  if ((r = s.match(/^(\d{1,2}) ([a-zа-яё]+\.?)$/i))) {
    const m = monthFromName(r[2]);
    if (m) return { y: right.y, m, d: +r[1] };
  }
  if ((r = s.match(/^([a-zа-яё]+\.?)$/i))) {
    const m = monthFromName(r[1]);
    if (m) return { y: right.y, m, d: 0 };
  }
  if ((r = s.match(/^(\d{1,2})[./](\d{1,2})$/))) return { y: right.y, m: +r[2], d: +r[1] };
  return null;
}

const RANGE_SPLIT = /\s*(?:\.\.|—|–|\s-\s|\s+по\s+)\s*/;

function dayIndexStart(p) {
  return Math.floor(Date.UTC(p.y, (p.m || 1) - 1, p.d || 1) / 86400000);
}
function dayIndexEnd(p) {
  const m = p.m || 12;
  const d = p.d || daysInMonth(p.y, m);
  return Math.floor(Date.UTC(p.y, m - 1, d) / 86400000);
}

function isoPoint(p) {
  if (p.d && p.h != null) return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.min)}`;
  if (p.d) return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  if (p.m) return `${p.y}-${pad(p.m)}`;
  return String(p.y);
}


/* ---------- приблизительные даты: «начало октября», «конец 2025», «осень 2024», «2 квартал» ---------- */

const PREFIX_RE = /^(?:(?:примерно|около|ориентировочно|приблизительно|ок\.|где-то|в|во|на|с)\s+|[~≈]\s*)/;
const PART_RE = /^(начал|середин|кон[еця]|перв\S*\s+половин|втор\S*\s+половин)\S*(?:\s+(.*))?$/;
const SEASONS = [['зим', 'winter'], ['весн', 'spring'], ['лет', 'summer'], ['осен', 'autumn']];
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4 };

function partKey(word) {
  if (word.startsWith('начал')) return 'start';
  if (word.startsWith('середин')) return 'mid';
  if (word.startsWith('кон')) return 'end';
  if (word.startsWith('перв')) return 'h1';
  return 'h2';
}

/** Диапазон месяцев/дней для части периода. */
function monthPart(m, part) {
  return (y) => {
    const last = daysInMonth(y, m);
    const span = { start: [1, 10], mid: [11, 20], end: [21, last], h1: [1, 15], h2: [16, last] }[part] || [1, last];
    return { start: { y, m, d: span[0] }, end: { y, m, d: span[1] } };
  };
}
function yearPart(part) {
  const months = { start: [1, 3], mid: [6, 7], end: [10, 12], h1: [1, 6], h2: [7, 12] }[part];
  return (y) => ({ start: { y, m: months[0], d: 1 }, end: { y, m: months[1], d: daysInMonth(y, months[1]) } });
}
function monthsRange(m1, m2) {
  return (y) => {
    const y1 = m1 > m2 ? y - 1 : y; // зима: декабрь прошлого года — февраль
    return { start: { y: y1, m: m1, d: 1 }, end: { y, m: m2, d: daysInMonth(y, m2) } };
  };
}

/**
 * Разбор «человеческих» дат. Возвращает { build(year) -> {start, end}, year|null, approx }
 * или null. year = null — год не указан, его подставит parseDate по соседним событиям.
 */
function parseFuzzy(text) {
  let s = String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  let prev;
  do { prev = s; s = s.replace(PREFIX_RE, ''); } while (s !== prev);
  s = s.replace(/\s*(?:г\.?|год[ауе]?)$/, '').trim();

  let year = null;
  const ym = s.match(/^(.*?)[\s,]*(\d{4})$/);
  if (ym) { year = +ym[2]; s = ym[1].trim(); }

  let part = null;
  const pm = s.match(PART_RE);
  if (pm) { part = partKey(pm[1]); s = (pm[2] || '').trim(); }

  let build = null;
  let approx = !!part;
  let r;
  if (!s && part && year) build = yearPart(part);
  else if (!s) return null;
  else if (!part && (r = s.match(/^(\d{1,2}) ([a-zа-я]+\.?)$/)) && monthFromName(r[2])) {
    const m = monthFromName(r[2]); const d = +r[1];
    build = (y) => ({ start: { y, m, d }, end: null });
  } else if (!part && (r = s.match(/^(\d{1,2})[./](\d{1,2})$/)) && +r[2] >= 1 && +r[2] <= 12) {
    const m = +r[2]; const d = +r[1];
    build = (y) => ({ start: { y, m, d }, end: null });
  } else if (monthFromName(s) && /^[a-zа-я]+\.?$/.test(s)) {
    const m = monthFromName(s);
    build = part ? monthPart(m, part) : (y) => ({ start: { y, m, d: 0 }, end: null });
  } else if ((r = SEASONS.find(([stem]) => s.startsWith(stem))) && /^[а-я]+$/.test(s)) {
    build = { winter: monthsRange(12, 2), spring: monthsRange(3, 5), summer: monthsRange(6, 8), autumn: monthsRange(9, 11) }[r[1]];
    approx = true;
  } else if ((r = s.match(/^(\d|i{1,3}|iv)\s*-?(?:й|ый)?\s*кв\S*$/) || s.match(/^q([1-4])$/))) {
    const q = ROMAN[r[1]] || +r[1];
    if (q < 1 || q > 4) return null;
    build = monthsRange(q * 3 - 2, q * 3);
    approx = true;
  } else return null;

  if (part && !approx) approx = true;
  return { build, year, approx };
}

function yearOf(idx) {
  return new Date(idx * 86400000).getUTCFullYear();
}

/** Год для даты без года — по соседним событиям (prev/next — разобранные даты). */
function inferYear(fz, opts) {
  const { prev, next } = opts || {};
  if (prev && prev.valid) {
    let y = yearOf(prev.endIdx);
    const b = fz.build(y);
    if (dayIndexEnd(b.end || b.start) < prev.startIdx - 60) y += 1;
    return y;
  }
  if (next && next.valid) {
    let y = yearOf(next.startIdx);
    const b = fz.build(y);
    if (dayIndexStart(b.start) > next.endIdx + 60) y -= 1;
    return y;
  }
  return opts && opts.fallbackYear ? opts.fallbackYear : null;
}

/**
 * Разбирает строку даты/периода.
 * opts: { prev, next, fallbackYear } — соседние даты для подстановки года
 * в «начало октября», «12 октября» и т. п.
 * @returns {{raw, valid, approx, yearInferred, needsYear, start, end, iso, startIdx, endIdx, sortKey, year}}
 */
function parseDate(raw, opts) {
  const text = String(raw || '').trim();
  const out = {
    raw: text, valid: false, approx: false, yearInferred: false, needsYear: false,
    start: null, end: null, iso: text, startIdx: null, endIdx: null, sortKey: null, year: null,
  };
  if (!text) return out;

  let start = null;
  let end = null;
  const pieces = text.split(RANGE_SPLIT);
  if (pieces.length === 2) {
    end = parsePoint(pieces[1]);
    if (end) start = parseLeft(pieces[0], end);
    if (!start) { start = null; end = null; }
  }
  if (!start) {
    // «3-10 января 2026» без пробелов вокруг дефиса
    const m = text.match(/^(\d{1,2})-(\d{1,2}) (.+)$/);
    if (m) {
      end = parsePoint(`${m[2]} ${m[3]}`);
      if (end) start = { y: end.y, m: end.m, d: +m[1] };
    }
  }
  if (!start) {
    start = parsePoint(text);
    end = null;
  }
  if (!start) {
    // «~ 2025-05», «примерно 3 января 2026» — точная дата с пометкой «≈»
    const stripped = text.replace(/^(?:~|≈|примерно|около|ориентировочно|приблизительно|ок\.)\s*/i, '');
    if (stripped !== text) {
      const inner = parseDate(stripped, opts);
      if (inner.valid && !inner.approx) return Object.assign(inner, { raw: text, roughly: true });
    }
    const fz = parseFuzzy(text);
    if (!fz) return out;
    let y = fz.year;
    if (y == null) {
      y = inferYear(fz, opts);
      if (y == null) { out.needsYear = true; return out; }
      out.yearInferred = true;
    }
    const b = fz.build(y);
    start = b.start;
    end = b.end;
    out.approx = fz.approx;
    out.fuzzyYear = y;
  }
  if (!start || !valid(start) || (end && !valid(end))) return out;
  if (end && dayIndexStart(end) < dayIndexStart(start)) [start, end] = [end, start];

  out.valid = true;
  out.start = start;
  out.end = end;
  out.year = out.fuzzyYear || start.y;
  delete out.fuzzyYear;
  out.iso = end ? `${isoPoint(start)}..${isoPoint(end)}` : isoPoint(start);
  out.startIdx = dayIndexStart(start);
  out.endIdx = dayIndexEnd(end || start);
  out.sortKey = out.startIdx * 1440 + (start.h != null ? start.h * 60 + start.min : 0);
  return out;
}

function formatPoint(p, withYear = true) {
  const y = withYear ? ` ${p.y}` : '';
  const tm = p.h != null ? `, ${pad(p.h)}:${pad(p.min)}` : '';
  if (p.d) return `${p.d} ${MONTHS_GEN[p.m - 1]}${y}${tm}`;
  if (p.m) return `${MONTHS_NOM[p.m - 1]}${y}`;
  return String(p.y);
}

/** Человекочитаемая дата: «3 января 2026», «3–10 января 2026», «Март — Май 2026». */
function formatDate(spec) {
  if (!spec || !spec.valid) return spec ? spec.raw : '';
  if (spec.roughly) return `≈ ${formatDate({ ...spec, roughly: false })}`;
  if (spec.approx) {
    const label = spec.raw.charAt(0).toUpperCase() + spec.raw.slice(1);
    return spec.yearInferred ? `${label} ${spec.year}` : label;
  }
  const { start: a, end: b } = spec;
  if (!b) return formatPoint(a);
  if (a.y === b.y) {
    if (a.d && b.d && a.m === b.m && a.h == null && b.h == null) return `${a.d}–${b.d} ${MONTHS_GEN[a.m - 1]} ${a.y}`;
    return `${formatPoint(a, false)} — ${formatPoint(b)}`;
  }
  return `${formatPoint(a)} — ${formatPoint(b)}`;
}

/** Короткая дата для правой панели: 03.01.2026 */
function formatShort(idx) {
  if (idx == null) return '—';
  const d = new Date(idx * 86400000);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** Название месяца по индексу дня — для подписей разрывов. */
function monthLabel(idx) {
  const d = new Date(idx * 86400000);
  return `${MONTHS_NOM[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = { parseDate, parseFuzzy, formatDate, formatShort, monthLabel, todayIso, MONTHS_GEN, MONTHS_NOM };
