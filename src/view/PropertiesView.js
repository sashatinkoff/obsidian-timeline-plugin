'use strict';

/*
 * Панель «Свойства таймлайна» в правом сайдбаре: период записей, стили буллетов,
 * связанные wiki-ссылки, статус и превью графа — для активной заметки.
 */

const { ItemView, TFile, setIcon } = require('obsidian');
const { PROPS_VIEW_TYPE, BLOCK_LANGUAGES, MARKERS, MARKER_ORDER } = require('../constants');
const { findTrackBlocks, parseCard } = require('../model/parser');
const { cardStats, buildGraph } = require('../model/stats');
const { annotateLinkedTags } = require('../model/linkedTags');
const { formatShort } = require('../utils/dates');
const { plural, debounce } = require('../utils/text');
const { renderGraph } = require('../render/graph');
const { wireHoverPreview } = require('../utils/dom');

class PropertiesView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.file = null;
    this.refresh = debounce(() => this.update(), 250);
  }

  getViewType() { return PROPS_VIEW_TYPE; }
  getDisplayText() { return 'Свойства таймлайна'; }
  getIcon() { return 'calendar-range'; }

  async onOpen() {
    this.contentEl.addClass('tc-props');
    wireHoverPreview(this.contentEl, this.app, '', this.contentEl);
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refresh()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.refresh()));
    this.registerEvent(this.app.vault.on('modify', (f) => { if (this.file && f.path === this.file.path) this.refresh(); }));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.refresh()));
    await this.update();
  }

  async onClose() {
    this.refresh.cancel();
  }

  currentFile() {
    const f = this.app.workspace.getActiveFile();
    if (f instanceof TFile && f.extension === 'md') return f;
    return this.file && this.app.vault.getAbstractFileByPath(this.file.path) ? this.file : null;
  }

  async update() {
    const file = this.currentFile();
    this.file = file;
    const el = this.contentEl;
    el.empty();
    const head = el.createDiv({ cls: 'tc-props-head' });
    head.createDiv({ cls: 'tc-props-title', text: 'Свойства заметки' });

    if (!file) { el.createDiv({ cls: 'tc-props-empty', text: 'Откройте заметку с таймлайном' }); return; }
    const content = await this.app.vault.cachedRead(file);
    const blocks = findTrackBlocks(content, BLOCK_LANGUAGES);
    if (!blocks.length) {
      el.createDiv({ cls: 'tc-props-empty', text: 'В этой заметке нет блоков ```timeline' });
      const btn = el.createEl('button', { cls: 'tc-btn', text: 'Вставить таймлайн' });
      btn.addEventListener('click', () => this.plugin.insertTemplateIntoActive());
      return;
    }
    const cards = blocks.map((b) => annotateLinkedTags(this.app, parseCard(b.source), file.path, { tags: this.plugin.settings.linkedTags, media: false }));
    const st = cardStats(cards);

    /* период */
    const period = this.box(el, 'Период записей');
    period.createDiv({ cls: 'tc-props-value', text: st.min != null ? `${formatShort(st.min)} — ${formatShort(st.max)}` : 'даты не распознаны' });
    period.createDiv({ cls: 'tc-props-sub', text: `${st.total} ${plural(st.total, ['событие', 'события', 'событий'])}${cards.length > 1 ? ` в ${cards.length} блоках` : ''}` });

    /* стили буллетов */
    const legend = this.box(el, 'Стили буллетов');
    for (const key of MARKER_ORDER) {
      if (key === 'empty' && !st.counts.empty) continue;
      const row = legend.createDiv({ cls: `tc-props-legend is-${key}` });
      row.createSpan({ cls: 'tc-props-dot' });
      row.createSpan({ cls: 'tc-props-legend-label', text: MARKERS[key].legend });
      row.createSpan({ cls: 'tc-props-count', text: String(st.counts[key] || 0) });
      row.addEventListener('click', () => this.plugin.focusQueryInActive(`marker:${key}`));
    }

    /* ссылки */
    if (st.links.size) {
      const links = this.box(el, 'Связанные wiki-ссылки');
      const sorted = [...st.links.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      for (const [target, n] of sorted.slice(0, 30)) {
        const resolved = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
        const a = links.createEl('a', { cls: `tc-link tc-props-link${resolved ? '' : ' is-unresolved'}`, text: `[[${target}]]`, attr: { 'data-href': target } });
        if (n > 1) a.createSpan({ cls: 'tc-props-count', text: ` ×${n}` });
        a.addEventListener('click', (e) => { e.preventDefault(); this.app.workspace.openLinkText(target, file.path, e.ctrlKey || e.metaKey); });
      }
      if (sorted.length > 30) links.createDiv({ cls: 'tc-props-sub', text: `и ещё ${sorted.length - 30}` });
    }

    /* статус */
    if (st.statuses.length) {
      const status = this.box(el, 'Статус верификации');
      for (const s of st.statuses) {
        const row = status.createDiv({ cls: 'tc-props-status' });
        row.createSpan({ cls: 'tc-props-dot is-done' });
        row.createSpan({ text: s });
      }
    }

    /* теги */
    if (st.tags.length) {
      const tags = this.box(el, 'Теги');
      const wrap = tags.createDiv({ cls: 'tc-tags' });
      st.tags.slice(0, 24).forEach((t) => {
        const pill = wrap.createSpan({ cls: 'tc-tag', text: `#${t}` });
        pill.addEventListener('click', () => this.plugin.focusQueryInActive(`#${t}`));
      });
    }

    /* граф */
    el.createDiv({ cls: 'tc-props-sep' });
    const gbox = this.box(el, 'Граф связей (превью)', 'tc-props-graph');
    const graph = buildGraph(cards);
    renderGraph(gbox, graph, {
      compact: true, width: 240, height: 140,
      resolved: (l) => !!this.app.metadataCache.getFirstLinkpathDest(l, file.path),
      onPage: (n, ev) => this.app.workspace.openLinkText(n.label, file.path, ev.ctrlKey || ev.metaKey),
      onEvent: () => this.plugin.setModeInActive('graph'),
    });
    const foot = gbox.createDiv({ cls: 'tc-props-graph-foot' });
    const open = foot.createSpan({ cls: 'tc-props-open', text: 'Открыть граф' });
    setIcon(open.createSpan({ cls: 'tc-props-open-icon' }), 'maximize-2');
    open.addEventListener('click', () => this.plugin.setModeInActive('graph'));
    foot.createSpan({ text: `${graph.nodes.length} ${plural(graph.nodes.length, ['узел', 'узла', 'узлов'])}` });
  }

  box(parent, label, cls = '') {
    const box = parent.createDiv({ cls: `tc-props-box ${cls}` });
    box.createDiv({ cls: 'tc-props-label', text: label });
    return box;
  }
}

module.exports = { PropertiesView };
