'use strict';

/** Основной язык блока и устаревший (Timeline Card v2) — оба рендерятся одинаково. */
const BLOCK_LANGUAGE = 'timeline';
const LEGACY_LANGUAGE = 'track';
const BLOCK_LANGUAGES = [BLOCK_LANGUAGE, LEGACY_LANGUAGE];
const PROPS_VIEW_TYPE = 'event-timeline-properties';
const HOVER_SOURCE = 'event-timeline';

/** Типы буллетов (маркеров на линии времени). */
const MARKERS = {
  done:    { key: 'done',    label: 'Готово',   legend: 'Выполнено',  icon: 'check' },
  warning: { key: 'warning', label: 'Внимание', legend: 'Тревога',    icon: 'alert-triangle' },
  info:    { key: 'info',    label: 'Инфо',     legend: 'Инфо',       icon: 'clock-3' },
  accent:  { key: 'accent',  label: 'Акцент',   legend: 'Акцент',     icon: null },
  empty:   { key: 'empty',   label: 'Пустой',   legend: 'Без статуса', icon: null },
};
const MARKER_ORDER = ['done', 'warning', 'info', 'accent', 'empty'];

/** Синонимы, которые понимает парсер в поле marker:: */
const MARKER_ALIASES = {
  done: 'done', ok: 'done', check: 'done', готово: 'done', выполнено: 'done', завершено: 'done',
  warning: 'warning', warn: 'warning', alert: 'warning', внимание: 'warning', тревога: 'warning',
  info: 'info', инфо: 'info', информация: 'info',
  accent: 'accent', active: 'accent', star: 'accent', акцент: 'accent', важно: 'accent',
  empty: 'empty', none: 'empty', пустой: 'empty',
};

/** Поля события: строки `key:: value` сразу под строкой даты. */
const EVENT_FIELDS = ['marker', 'label', 'tags', 'id', 'break'];
/** Служебные строки шапки карточки: %% key: value %% */
const CARD_META = ['color', 'badge', 'tags', 'status'];

const THEME_PRESETS = {
  purple:   { label: 'Фиолетовая (по умолчанию)', color: '#8b5cf6' },
  indigo:   { label: 'Индиго (как в Timeline Card)', color: '#6366b0' },
  blue:     { label: 'Синяя', color: '#3b82f6' },
  green:    { label: 'Зелёная', color: '#16a34a' },
  red:      { label: 'Красная', color: '#e11d48' },
  orange:   { label: 'Оранжевая', color: '#f97316' },
  teal:     { label: 'Бирюзовая', color: '#0d9488' },
  graphite: { label: 'Графитовая', color: '#6b7280' },
};

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'flac', 'opus', 'aac'];

const DEFAULT_SETTINGS = {
  // ключи совпадают с Timeline Card — при первом запуске его настройки переносятся
  mediaSize: 140,
  showMediaCaptions: true,
  autoDate: true,
  dateFormat: 'YYYY-MM-DD HH:mm',
  dateLocale: 'ru',
  theme: 'purple',
  customColor: '#8b5cf6',
  collapseLongText: false,  // собственный текст события показывается как есть
  collapseMaxLines: 3,
  // новое в v3
  sortMode: 'file',          // file | asc | desc
  groupByYear: true,
  insertMode: 'date',        // date | end
  autoBreakDays: 0,          // 0 — выкл
  humanDates: true,          // показывать «3 января 2026» вместо исходной строки
  showIds: true,
  linkedTags: true,         // теги из заметок, на которые ссылается событие
  linkedMedia: true,        // картинки и видео из этих заметок
  linkedExcerpt: true,      // текст заметки в карточке, если в тексте события только ссылка
  excerptLines: 4,          // сколько строк текста заметки показывать
  excerptLength: 1200,      // сколько текста заметки читать, символов
  linkBrackets: false,      // показывать [[ ]] вокруг ссылок в тексте
  showSearch: true,
  formOpenByDefault: false,
  maxWidth: 720,
};

module.exports = {
  BLOCK_LANGUAGE, LEGACY_LANGUAGE, BLOCK_LANGUAGES, PROPS_VIEW_TYPE, HOVER_SOURCE, MARKERS, MARKER_ORDER, MARKER_ALIASES,
  EVENT_FIELDS, CARD_META, THEME_PRESETS, IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, DEFAULT_SETTINGS,
};
