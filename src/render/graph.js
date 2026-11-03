'use strict';

/*
 * Граф связей: события и заметки, на которые они ссылаются.
 * Простая детерминированная силовая раскладка без внешних библиотек.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  if (parent) parent.appendChild(el);
  return el;
}

function layout(nodes, edges, { width, height, iterations = 300, padX = 90, padY = 30 }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cx = width / 2;
  const cy = height / 2;
  // детерминированная стартовая раскладка по спирали
  nodes.forEach((n, i) => {
    const a = i * 2.39996;
    const r = 18 * Math.sqrt(i + 1);
    n.x = cx + r * Math.cos(a) * (width / height);
    n.y = cy + r * Math.sin(a);
  });
  const area = (width - 2 * padX) * (height - 2 * padY);
  const k = Math.sqrt(area / Math.max(1, nodes.length)) * 0.9;
  let temp = width / 8;
  for (let it = 0; it < iterations; it++) {
    for (const n of nodes) { n.dx = 0; n.dy = 0; }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]; const b = nodes[j];
        const dx = a.x - b.x; const dy = a.y - b.y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const f = (k * k) / d;
        a.dx += (dx / d) * f; a.dy += (dy / d) * f;
        b.dx -= (dx / d) * f; b.dy -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const a = byId.get(e.from); const b = byId.get(e.to);
      if (!a || !b) continue;
      const dx = a.x - b.x; const dy = a.y - b.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = ((d * d) / k) * (e.weak ? 0.35 : 1);
      a.dx -= (dx / d) * f; a.dy -= (dy / d) * f;
      b.dx += (dx / d) * f; b.dy += (dy / d) * f;
    }
    for (const n of nodes) {
      // гравитация к центру держит несвязанные части вместе
      n.dx += (cx - n.x) * 0.08 * (k / 40);
      n.dy += (cy - n.y) * 0.08 * (k / 40) * (width / height);
      const d = Math.max(0.01, Math.hypot(n.dx, n.dy));
      const step = Math.min(d, temp);
      n.x = Math.max(padX, Math.min(width - padX, n.x + (n.dx / d) * step));
      n.y = Math.max(padY, Math.min(height - padY, n.y + (n.dy / d) * step));
    }
    temp = Math.max(0.5, temp * 0.97);
  }
}

/**
 * @param parent
 * @param graph   { nodes, edges } из stats.buildGraph
 * @param opts    { height, compact, onEvent(node), onPage(node), resolved(label)->bool }
 */
function renderGraph(parent, graph, opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 420;
  const nodes = graph.nodes.map((n) => ({ ...n }));
  const edges = graph.edges;
  const wrap = parent.createDiv({ cls: `tc-graph${opts.compact ? ' is-compact' : ''}` });
  if (!nodes.length) {
    wrap.createDiv({ cls: 'tc-graph-empty', text: 'Нет связей: добавьте [[ссылки]] в текст событий' });
    return wrap;
  }
  layout(nodes, edges, { width, height, iterations: opts.compact ? 160 : 320, padX: opts.compact ? 14 : 90, padY: opts.compact ? 14 : 30 });
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'tc-graph-svg', preserveAspectRatio: 'xMidYMid meet' });
  wrap.appendChild(root);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const gEdges = svg('g', { class: 'tc-graph-edges' }, root);
  const edgeEls = edges.map((e) => {
    const a = byId.get(e.from); const b = byId.get(e.to);
    return { e, el: svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: e.weak ? 'is-seq' : '' }, gEdges) };
  });
  const gNodes = svg('g', { class: 'tc-graph-nodes' }, root);
  for (const n of nodes) {
    const kindCls = n.kind === 'page' ? `is-page${opts.resolved && !opts.resolved(n.label) ? ' is-unresolved' : ''}` : `is-${n.kind} is-${n.marker || 'empty'}`;
    const g = svg('g', { class: `tc-graph-node ${kindCls}`, transform: `translate(${n.x},${n.y})` }, gNodes);
    const r = n.kind === 'center' ? 9 : n.kind === 'page' ? 5 + Math.min(6, (n.degree || 1)) : 6;
    svg('circle', { r }, g);
    if (!opts.compact) {
      const label = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
      const t = svg('text', { y: r + 13, 'text-anchor': 'middle' }, g);
      t.textContent = label;
    }
    const title = svg('title', {}, g);
    title.textContent = n.label;
    g.addEventListener('mouseenter', () => {
      wrap.addClass('is-hovering');
      g.classList.add('is-hover');
      edgeEls.forEach(({ e, el }) => { if (e.from === n.id || e.to === n.id) el.classList.add('is-hover'); });
    });
    g.addEventListener('mouseleave', () => {
      wrap.removeClass('is-hovering');
      g.classList.remove('is-hover');
      edgeEls.forEach(({ el }) => el.classList.remove('is-hover'));
    });
    g.addEventListener('click', (ev) => {
      if (n.kind === 'page' && opts.onPage) opts.onPage(n, ev);
      else if (n.kind === 'event' && opts.onEvent) opts.onEvent(n, ev);
    });
  }
  return wrap;
}

module.exports = { renderGraph };
