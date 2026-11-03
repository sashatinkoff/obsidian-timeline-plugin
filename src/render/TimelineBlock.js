'use strict';

/*
 * Один отрисованный блок ```timeline / ```track.
 * Хранит состояние интерфейса (режим, поиск, сортировка) в плагине, чтобы оно
 * переживало перерисовку блока после каждого сохранения заметки.
 */

const { MarkdownRenderChild, Notice } = require('obsidian');
const { parseCard } = require('../model/parser');
const { insertIndex } = require('../model/serializer');
const { saveCard, saveRaw } = require('../model/store');
const { buildGraph } = require('../model/stats');
const { annotateLinkedTags } = require('../model/linkedTags');
const { resolveAccent, wireHoverPreview, autoResize } = require('../utils/dom');
const { renderHeader } = require('./header');
const { createEventForm } = require('./eventForm');
const { renderList } = require('./list');
const { renderGraph } = require('./graph');

class TimelineBlock extends MarkdownRenderChild {
  constructor(plugin, source, el, ctx, language) {
    super(el);
    this.plugin = plugin;
    this.app = plugin.app;
    this.source = source;
    this.ctx = ctx;
    this.language = language;
    this.sourcePath = ctx.sourcePath;
    this.form = null;
    this.searchInput = null;
  }

  onload() {
    this.plugin.blocks.add(this);
    this.ui = this.plugin.getUiState(this.uiKey());
    this.render();
  }

  onunload() {
    this.plugin.blocks.delete(this);
  }

  sectionInfo() {
    try { return this.ctx.getSectionInfo(this.containerEl); } catch (e) { return null; }
  }

  uiKey() {
    const info = this.sectionInfo();
    if (info) return `${this.sourcePath}::${info.lineStart}`;
    const m = this.source.match(/^##\s+(.+)$/m);
    return `${this.sourcePath}::${m ? m[1] : this.source.length}`;
  }

  hint() {
    const info = this.sectionInfo();
    return { lineStart: info ? info.lineStart : null, source: this.source };
  }

  get settings() {
    return this.plugin.settings;
  }

  renderCtx() {
    return { app: this.app, settings: this.settings, sourcePath: this.sourcePath, component: this, block: this };
  }

  /* ---------------- отрисовка ---------------- */

  render() {
    const el = this.containerEl;
    el.empty();
    el.addClass('tc-block-host');
    this.card = annotateLinkedTags(this.app, parseCard(this.source), this.sourcePath, { tags: this.settings.linkedTags, media: this.settings.linkedMedia });
    this.linkedPaths = new Set(this.card.entries.flatMap((e) => e.linkedPaths || []));
    const root = el.createDiv({ cls: `tc-root is-mode-${this.ui.mode}` });
    root.style.setProperty('--tc-accent', resolveAccent(this.card.color, this.settings));
    root.style.setProperty('--tc-max-width', `${this.settings.maxWidth || 720}px`);
    root.toggleClass('tc-link-brackets', !!this.settings.linkBrackets);
    this.root = root;
    wireHoverPreview(root, this.app, this.sourcePath);

    renderHeader(root, this.card, this.renderCtx());

    if (this.ui.mode === 'source') return this.renderSource(root);
    if (this.ui.mode === 'graph') return this.renderGraphMode(root);

    this.form = createEventForm(root, this.renderCtx(), {
      collapsed: !this.ui.formOpen,
      onSubmit: (data, index) => this.submitEvent(data, index),
    });
    this.form.el.addEventListener('click', () => { this.ui.formOpen = !this.form.el.hasClass('is-collapsed'); });
    this.feedHost = root.createDiv({ cls: 'tc-feed-host' });
    this.renderFeed();
  }

  renderFeed() {
    if (!this.feedHost) return;
    this.feedHost.empty();
    renderList(this.feedHost, this.card, this.renderCtx());
  }

  renderSource(root) {
    const box = root.createDiv({ cls: 'tc-source' });
    const note = box.createDiv({ cls: 'tc-source-note' });
    note.setText(`Содержимое блока \`\`\`${this.language}. Формат описан в README (Настройки → Event Timeline).`);
    const ta = box.createEl('textarea', { cls: 'tc-input tc-source-text', attr: { spellcheck: 'false' } });
    ta.value = this.source;
    setTimeout(() => autoResize(ta), 0);
    ta.addEventListener('input', () => autoResize(ta));
    const foot = box.createDiv({ cls: 'tc-form-foot' });
    foot.createDiv({ cls: 'tc-field-hint', text: 'Cmd/Ctrl+Enter — сохранить' });
    foot.createDiv({ cls: 'tc-spacer' });
    const cancel = foot.createEl('button', { cls: 'tc-btn', text: 'К таймлайну' });
    const save = foot.createEl('button', { cls: 'tc-btn tc-btn-primary', text: 'Сохранить' });
    cancel.addEventListener('click', () => this.setMode('timeline'));
    const doSave = async () => {
      if (ta.value === this.source) { this.setMode('timeline'); return; }
      this.ui.mode = 'timeline';
      const ok = await saveRaw(this.app, this.sourcePath, this.hint(), ta.value);
      if (!ok) this.ui.mode = 'source';
    };
    save.addEventListener('click', doSave);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doSave(); } });
  }

  renderGraphMode(root) {
    const graph = buildGraph([this.card]);
    const resolved = (label) => !!this.app.metadataCache.getFirstLinkpathDest(label, this.sourcePath);
    const box = root.createDiv({ cls: 'tc-graph-box' });
    renderGraph(box, graph, {
      width: 720, height: 460, resolved,
      onPage: (n, ev) => this.app.workspace.openLinkText(n.label, this.sourcePath, ev.ctrlKey || ev.metaKey),
      onEvent: (n) => this.revealEvent(n.entry),
    });
    const legend = box.createDiv({ cls: 'tc-graph-legend' });
    legend.createSpan({ text: `${graph.nodes.filter((n) => n.kind === 'event').length} событий · ${graph.nodes.filter((n) => n.kind === 'page').length} заметок · ${graph.edges.filter((e) => !e.weak).length} связей` });
    legend.createSpan({ cls: 'tc-field-hint', text: 'Клик по заметке — открыть, по событию — показать в таймлайне' });
  }

  /** Прокрутить к событию и подсветить его. */
  revealEvent(index) {
    if (this.ui.mode !== 'timeline' || this.ui.query) {
      this.ui.mode = 'timeline';
      this.ui.query = '';
      this.render();
    }
    const row = this.root.querySelector(`.tc-event[data-index="${index}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.addClass('is-flash');
    setTimeout(() => row.removeClass('is-flash'), 1600);
  }

  /* ---------------- действия ---------------- */

  setMode(mode) {
    this.ui.mode = mode;
    this.render();
  }

  setQuery(query, fromInput) {
    this.ui.query = query || '';
    if (!fromInput && this.searchInput) this.searchInput.value = this.ui.query;
    if (this.ui.mode !== 'timeline') { this.ui.mode = 'timeline'; this.render(); return; }
    this.renderFeed();
  }

  setSort(mode) {
    this.ui.sortMode = mode;
    this.renderFeed();
  }

  openForm(ev, index) {
    if (this.ui.mode !== 'timeline') { this.ui.mode = 'timeline'; this.render(); }
    this.ui.formOpen = true;
    this.form.open(ev, index);
  }

  /** Применить изменение к свежей модели и записать в заметку. */
  async mutate(fn) {
    const card = parseCard(this.source);
    fn(card);
    const saved = await saveCard(this.app, this.sourcePath, this.hint(), card);
    return saved != null;
  }

  async submitEvent(data, index) {
    const ok = await this.mutate((card) => {
      if (index != null && card.entries[index] && card.entries[index].type === 'event') {
        card.entries[index] = data;
      } else {
        card.entries.splice(insertIndex(card, data, this.settings.insertMode), 0, data);
      }
    });
    if (!ok) throw new Error('not saved');
    this.ui.formOpen = false;
    new Notice(index != null ? 'Событие обновлено' : 'Событие добавлено в таймлайн');
  }

  move(index, dir) {
    return this.mutate((card) => {
      const target = index + dir;
      if (target < 0 || target >= card.entries.length) return;
      const [item] = card.entries.splice(index, 1);
      card.entries.splice(target, 0, item);
    });
  }
}

module.exports = { TimelineBlock };
