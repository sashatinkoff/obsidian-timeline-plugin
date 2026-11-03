'use strict';

const { PluginSettingTab, Setting, Modal, MarkdownRenderer, Notice, normalizePath } = require('obsidian');
const { DEFAULT_SETTINGS, THEME_PRESETS } = require('./constants');

const LEGACY_PLUGIN_DIR = 'timeline-card';

/** Загрузка настроек; при первом запуске подхватывает data.json старого Timeline Card. */
async function loadSettings(plugin) {
  let data = await plugin.loadData();
  if (!data) {
    try {
      const path = normalizePath(`${plugin.app.vault.configDir}/plugins/${LEGACY_PLUGIN_DIR}/data.json`);
      if (await plugin.app.vault.adapter.exists(path)) {
        const legacy = JSON.parse(await plugin.app.vault.adapter.read(path));
        const keys = ['mediaSize', 'showMediaCaptions', 'autoDate', 'dateFormat', 'dateLocale', 'theme', 'customColor'];
        data = {};
        keys.forEach((k) => { if (legacy[k] !== undefined) data[k] = legacy[k]; });
        if (data.theme === 'purple' && !legacy.customColor) delete data.theme;
      }
    } catch (e) { /* нет старых настроек — не страшно */ }
  }
  plugin.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});
  // 1.3.0 хранил короткий фрагмент для ката — теперь текст показывается целиком под «Показать полностью»
  // 1.4: собственный текст события — как есть, текст из заметки — N строк + «Читать далее»
  if ((plugin.settings.settingsVersion || 0) < 140) {
    plugin.settings.collapseLongText = false;
    plugin.settings.excerptLength = DEFAULT_SETTINGS.excerptLength;
    plugin.settings.settingsVersion = 140;
    if (data) await plugin.saveData(plugin.settings);
  }
  if (!THEME_PRESETS[plugin.settings.theme] && plugin.settings.theme !== 'custom') plugin.settings.theme = 'purple';
}

class ReadmeModal extends Modal {
  constructor(app, plugin, content) {
    super(app);
    this.plugin = plugin;
    this.content = content;
  }
  async onOpen() {
    this.modalEl.addClass('tc-readme-modal-wrap');
    this.titleEl.setText('Event Timeline — README');
    this.contentEl.addClass('tc-readme-modal', 'markdown-rendered');
    if (MarkdownRenderer.render) await MarkdownRenderer.render(this.app, this.content, this.contentEl, '', this.plugin);
    else await MarkdownRenderer.renderMarkdown(this.content, this.contentEl, '', this.plugin);
  }
  onClose() { this.contentEl.empty(); }
}

class SettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async save(refresh = true) {
    await this.plugin.saveData(this.plugin.settings);
    if (refresh) this.plugin.refreshAll();
  }

  num(setting, key, { min = 0, max = 100000, placeholder }) {
    setting.addText((t) => {
      t.inputEl.type = 'number';
      t.setPlaceholder(placeholder || String(DEFAULT_SETTINGS[key]))
        .setValue(String(this.plugin.settings[key]))
        .onChange(async (v) => {
          const n = parseInt(v, 10);
          this.plugin.settings[key] = isNaN(n) ? DEFAULT_SETTINGS[key] : Math.max(min, Math.min(max, n));
          await this.save();
        });
    });
  }

  toggle(setting, key) {
    setting.addToggle((t) => t.setValue(!!this.plugin.settings[key]).onChange(async (v) => {
      this.plugin.settings[key] = v;
      await this.save();
    }));
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName('README')
      .setDesc('Формат блока ```timeline, совместимость с ```track, все возможности.')
      .addButton((b) => b.setButtonText('Открыть README').onClick(async () => {
        try {
          const content = await this.app.vault.adapter.read(normalizePath(`${this.plugin.manifest.dir}/README.md`));
          new ReadmeModal(this.app, this.plugin, content).open();
        } catch (e) {
          new Notice(`Не удалось прочитать README.md: ${e.message}`);
        }
      }));

    new Setting(containerEl).setName('Оформление').setHeading();
    new Setting(containerEl)
      .setName('Акцентный цвет')
      .setDesc('Кнопки, ссылки, акцентный буллет. Для отдельного таймлайна цвет меняется кружком в его шапке.')
      .addDropdown((dd) => {
        Object.entries(THEME_PRESETS).forEach(([k, p]) => dd.addOption(k, p.label));
        dd.addOption('custom', 'Свой…');
        dd.setValue(s.theme).onChange(async (v) => { s.theme = v; await this.save(); this.display(); });
      });
    if (s.theme === 'custom') {
      new Setting(containerEl).setName('Свой цвет').addColorPicker((cp) => cp.setValue(s.customColor).onChange(async (v) => {
        s.customColor = v;
        await this.save();
      }));
    }
    this.num(new Setting(containerEl).setName('Максимальная ширина (px)').setDesc('Ширина таймлайна в заметке.'), 'maxWidth', { min: 420, max: 2000 });
    this.toggle(new Setting(containerEl).setName('Показывать ID событий').setDesc('Строка «ID: #…» в углу карточки.'), 'showIds');
    this.toggle(new Setting(containerEl).setName('Теги из связанных заметок').setDesc('Если в тексте события есть [[ссылка]] на заметку, её теги показываются на карточке (пунктирной рамкой) и участвуют в поиске.'), 'linkedTags');
    this.toggle(new Setting(containerEl).setName('Медиа из связанных заметок').setDesc('Картинки и видео, встроенные в заметку по [[ссылке]] из события, показываются в медиа карточки.'), 'linkedMedia');
    this.toggle(new Setting(containerEl).setName('Текст связанной заметки').setDesc('Если текст события — только [[ссылка]], под ней показывается текст этой заметки; длинный сворачивается под «Показать полностью».'), 'linkedExcerpt');
    this.num(new Setting(containerEl).setName('Строк текста из заметки').setDesc('Сколько строк связанной заметки показывать в карточке; дальше — «Читать далее».'), 'excerptLines', { min: 1, max: 30 });
    this.num(new Setting(containerEl).setName('Максимум текста заметки (символов)').setDesc('Сколько текста связанной заметки читать для карточки (обрезается по абзацам). На экране видно только заданное число строк.'), 'excerptLength', { min: 200, max: 50000 });
    this.toggle(new Setting(containerEl).setName('Скобки [[ ]] у ссылок').setDesc('Показывать ссылки в тексте событий в стиле макета — со скобками и пунктиром. Выключено — ссылки выглядят как в обычной заметке.'), 'linkBrackets');
    this.toggle(new Setting(containerEl).setName('Поиск по событиям').setDesc('Поле поиска в шапке таймлайна.'), 'showSearch');

    new Setting(containerEl).setName('Лента').setHeading();
    new Setting(containerEl)
      .setName('Порядок по умолчанию')
      .setDesc('Меняется и прямо в таймлайне — кнопкой справа от заголовка группы. Порядок в самой заметке не трогается.')
      .addDropdown((dd) => dd
        .addOption('file', 'Как в заметке')
        .addOption('asc', 'Хронологический (старые сверху)')
        .addOption('desc', 'Сначала новые')
        .setValue(s.sortMode)
        .onChange(async (v) => { s.sortMode = v; this.plugin.resetUiSort(); await this.save(); }));
    this.toggle(new Setting(containerEl).setName('Группировать по годам').setDesc('Если в блоке нет секций ####. С секциями группами служат они.'), 'groupByYear');
    this.toggle(new Setting(containerEl).setName('Человекочитаемые даты').setDesc('«2026-01-03» показывается как «3 января 2026». В заметке остаётся как было.'), 'humanDates');
    this.num(new Setting(containerEl).setName('Авто-разрыв линии (дней)').setDesc('Показывать паузу, если между событиями прошло не меньше N дней. 0 — только явные break::.'), 'autoBreakDays', { min: 0, max: 36500 });

    new Setting(containerEl).setName('Добавление событий').setHeading();
    new Setting(containerEl)
      .setName('Куда вставлять новое событие')
      .addDropdown((dd) => dd
        .addOption('date', 'По дате (после последнего более раннего)')
        .addOption('end', 'В конец блока')
        .setValue(s.insertMode)
        .onChange(async (v) => { s.insertMode = v; await this.save(false); }));
    this.toggle(new Setting(containerEl).setName('Автоматически подставлять дату').setDesc('Поле даты в форме сразу заполняется текущими датой и временем.'), 'autoDate');
    new Setting(containerEl)
      .setName('Формат даты')
      .setDesc('Нотация moment.js: YYYY-MM-DD HH:mm, D MMMM YYYY и т. п.')
      .addText((t) => t.setPlaceholder('YYYY-MM-DD HH:mm').setValue(s.dateFormat).onChange(async (v) => {
        s.dateFormat = v.trim() || DEFAULT_SETTINGS.dateFormat;
        await this.save(false);
      }));
    new Setting(containerEl)
      .setName('Язык даты')
      .setDesc('Код локали moment.js: ru, en, de…')
      .addText((t) => t.setPlaceholder('ru').setValue(s.dateLocale).onChange(async (v) => {
        s.dateLocale = v.trim() || 'ru';
        await this.save(false);
      }));
    this.toggle(new Setting(containerEl).setName('Форма открыта по умолчанию').setDesc('Иначе форма свёрнута до клика по «+ Запись».'), 'formOpenByDefault');

    new Setting(containerEl).setName('Текст и медиа').setHeading();
    this.toggle(new Setting(containerEl).setName('Сворачивать длинный собственный текст события').setDesc('По умолчанию выключено — текст события показывается как есть. Включите, чтобы длинный текст обрезался с «Показать полностью».'), 'collapseLongText');
    this.num(new Setting(containerEl).setName('Строк до сворачивания'), 'collapseMaxLines', { min: 1, max: 100 });
    this.num(new Setting(containerEl).setName('Размер медиа-плитки (px)').setDesc('Ширина плитки фото и видео; высота — 3/4 от ширины.'), 'mediaSize', { min: 60, max: 600 });
    this.toggle(new Setting(containerEl).setName('Подписи под медиа').setDesc('Имя файла и размер под плиткой.'), 'showMediaCaptions');
  }
}

module.exports = { loadSettings, SettingsTab, ReadmeModal };
