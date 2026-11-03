'use strict';

/* Сборка плагина: настройки, обработчики блоков, панель свойств, команды. */

const { Notice, MarkdownView } = require('obsidian');
const { BLOCK_LANGUAGE, LEGACY_LANGUAGE, PROPS_VIEW_TYPE, HOVER_SOURCE } = require('./constants');
const { loadSettings, SettingsTab } = require('./settings');
const { TimelineBlock } = require('./render/TimelineBlock');
const { PropertiesView } = require('./view/PropertiesView');
const { autoDateString } = require('./render/eventForm');
const { debounce } = require('./utils/text');

function template(settings) {
  const date = autoDateString(settings) || new Date().toISOString().slice(0, 10);
  return [
    `\`\`\`${BLOCK_LANGUAGE}`,
    '## Новый таймлайн',
    '%% tags: #хроника %%',
    'Краткое описание: о чём эта хроника.',
    '',
    '### Первое событие',
    date,
    'marker:: info',
    'Текст события — markdown и [[ссылки на заметки]].',
    '```',
    '',
  ].join('\n');
}

async function bootstrap(plugin) {
  const { app } = plugin;
  await loadSettings(plugin);

  plugin.blocks = new Set();
  plugin.uiStates = new Map();

  plugin.getUiState = (key) => {
    if (!plugin.uiStates.has(key)) {
      plugin.uiStates.set(key, {
        mode: 'timeline', query: '', sortMode: plugin.settings.sortMode,
        expanded: new Set(), formOpen: !!plugin.settings.formOpenByDefault,
      });
    }
    return plugin.uiStates.get(key);
  };
  plugin.resetUiSort = () => plugin.uiStates.forEach((s) => { s.sortMode = plugin.settings.sortMode; });
  plugin.refreshAll = () => plugin.blocks.forEach((b) => { if (b.containerEl.isConnected) b.render(); });

  /* ---- блоки ---- */
  const register = (language) => {
    try {
      plugin.registerMarkdownCodeBlockProcessor(language, (source, el, ctx) => {
        ctx.addChild(new TimelineBlock(plugin, source, el, ctx, language));
      });
      return true;
    } catch (err) {
      console.warn(`[Event Timeline] не удалось зарегистрировать блок ${language}`, err);
      return false;
    }
  };
  register(BLOCK_LANGUAGE);
  const legacyOk = register(LEGACY_LANGUAGE);
  const legacyEnabled = app.plugins && app.plugins.enabledPlugins && app.plugins.enabledPlugins.has('timeline-card');
  if (!legacyOk || legacyEnabled) {
    new Notice('Event Timeline: включён старый плагин Timeline Card. Отключите его, чтобы блоки ```track показывались в новом виде.', 12000);
  }

  // теги связанных заметок поменялись — перерисовать таймлайны, которые на них ссылаются
  const changed = new Set();
  const flush = debounce(() => {
    plugin.blocks.forEach((b) => {
      if (b.containerEl.isConnected && b.linkedPaths && [...changed].some((p) => b.linkedPaths.has(p))) b.render();
    });
    changed.clear();
  }, 800);
  plugin.registerEvent(app.metadataCache.on('changed', (file) => {
    if (!plugin.settings.linkedTags) return;
    changed.add(file.path);
    flush();
  }));

  plugin.registerHoverLinkSource(HOVER_SOURCE, { display: 'Event Timeline', defaultMod: true });
  plugin.addSettingTab(new SettingsTab(app, plugin));

  /* ---- панель свойств ---- */
  plugin.registerView(PROPS_VIEW_TYPE, (leaf) => new PropertiesView(leaf, plugin));
  const openProps = async () => {
    let leaf = app.workspace.getLeavesOfType(PROPS_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: PROPS_VIEW_TYPE, active: true });
    }
    app.workspace.revealLeaf(leaf);
  };
  plugin.addRibbonIcon('calendar-range', 'Свойства таймлайна', openProps);

  /* ---- помощники для команд и панели ---- */
  const blocksInActive = () => {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    const file = app.workspace.getActiveFile();
    const list = [...plugin.blocks].filter((b) => b.containerEl.isConnected && (
      view ? view.containerEl.contains(b.containerEl) : (file && b.sourcePath === file.path)));
    if (list.length || !file) return list;
    return [...plugin.blocks].filter((b) => b.containerEl.isConnected && b.sourcePath === file.path);
  };
  const firstBlock = () => {
    const list = blocksInActive();
    if (!list.length) new Notice('В активной заметке нет видимого таймлайна (```timeline или ```track)');
    // ближайший к видимой области
    return list.sort((a, b) => Math.abs(a.containerEl.getBoundingClientRect().top) - Math.abs(b.containerEl.getBoundingClientRect().top))[0];
  };
  plugin.focusQueryInActive = (q) => { const b = firstBlock(); if (b) { b.setQuery(q); b.containerEl.scrollIntoView({ block: 'start', behavior: 'smooth' }); } };
  plugin.setModeInActive = (m) => { const b = firstBlock(); if (b) { b.setMode(m); b.containerEl.scrollIntoView({ block: 'start', behavior: 'smooth' }); } };
  plugin.insertTemplateIntoActive = () => {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) { new Notice('Откройте заметку в режиме редактирования'); return; }
    view.editor.replaceSelection(template(plugin.settings));
  };

  /* ---- команды ---- */
  plugin.addCommand({
    id: 'insert-timeline',
    name: 'Вставить таймлайн',
    editorCallback: (editor) => editor.replaceSelection(template(plugin.settings)),
  });
  plugin.addCommand({
    id: 'add-event',
    name: 'Добавить событие в таймлайн',
    hotkeys: [{ modifiers: ['Alt'], key: 'n' }],
    checkCallback: (checking) => {
      const has = blocksInActive().length > 0;
      if (checking) return has;
      const b = firstBlock();
      if (b) b.openForm();
      return true;
    },
  });
  plugin.addCommand({
    id: 'open-properties',
    name: 'Открыть панель свойств таймлайна',
    callback: openProps,
  });
  plugin.addCommand({
    id: 'show-graph',
    name: 'Показать граф связей таймлайна',
    checkCallback: (checking) => {
      if (checking) return blocksInActive().length > 0;
      plugin.setModeInActive('graph');
      return true;
    },
  });
  plugin.addCommand({
    id: 'search-events',
    name: 'Поиск по событиям таймлайна',
    checkCallback: (checking) => {
      if (checking) return blocksInActive().length > 0;
      const b = firstBlock();
      if (b) { b.setMode('timeline'); setTimeout(() => b.searchInput && b.searchInput.focus(), 30); }
      return true;
    },
  });
  plugin.addCommand({
    id: 'convert-track-to-timeline',
    name: 'Перевести блоки ```track в ```timeline в текущей заметке',
    editorCallback: (editor) => {
      const text = editor.getValue();
      const next = text.replace(/^(\s*(?:`{3,}|~{3,}))\s*track\s*$/gm, `$1${BLOCK_LANGUAGE}`);
      if (next === text) { new Notice('Блоков ```track нет'); return; }
      editor.setValue(next);
      new Notice('Блоки ```track переведены в ```timeline');
    },
  });

  plugin.teardown = () => {
    app.workspace.detachLeavesOfType(PROPS_VIEW_TYPE);
    document.querySelectorAll('.tc-popover, .tc-suggest, .tc-lightbox').forEach((n) => n.remove());
  };
}

module.exports = { bootstrap };
