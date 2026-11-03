'use strict';

/* Сводка по карточкам: период, счётчики маркеров, wiki-ссылки — для панели свойств и графа. */

const { MARKER_ORDER } = require('../constants');
const { eventsOf, extractWikiLinks } = require('./parser');

function cardStats(cards) {
  const counts = Object.fromEntries(MARKER_ORDER.map((k) => [k, 0]));
  const links = new Map(); // цель -> число упоминаний
  let min = null;
  let max = null;
  let total = 0;
  const statuses = [];
  const tags = new Set();

  for (const card of cards) {
    if (card.status) statuses.push(card.status);
    card.tags.forEach((t) => tags.add(t));
    for (const ev of eventsOf(card)) {
      total++;
      counts[ev.marker] = (counts[ev.marker] || 0) + 1;
      ev.tags.forEach((t) => tags.add(t));
      (ev.linkedTags || []).forEach((t) => tags.add(t.tag));
      const s = ev.dateSpec;
      if (s && s.valid) {
        if (min == null || s.startIdx < min) min = s.startIdx;
        if (max == null || s.endIdx > max) max = s.endIdx;
      }
      for (const l of extractWikiLinks(`${ev.title}\n${ev.body}`)) links.set(l, (links.get(l) || 0) + 1);
    }
  }
  return { counts, links, min, max, total, statuses, tags: [...tags] };
}

/** Граф: узлы событий и страниц, рёбра событие -> страница. */
function buildGraph(cards) {
  const nodes = [];
  const edges = [];
  const pageIndex = new Map();
  cards.forEach((card, ci) => {
    let prevEvent = null;
    card.entries.forEach((ev, ei) => {
      if (ev.type !== 'event') return;
      const evNode = { id: `e${ci}-${ei}`, kind: 'event', label: ev.title || '(без названия)', marker: ev.marker, card: ci, entry: ei };
      nodes.push(evNode);
      // слабая связь соседних событий — граф не распадается на острова
      if (prevEvent) edges.push({ from: prevEvent.id, to: evNode.id, weak: true });
      prevEvent = evNode;
      for (const target of extractWikiLinks(`${ev.title}\n${ev.body}`)) {
        let pn = pageIndex.get(target);
        if (!pn) {
          pn = { id: `p${pageIndex.size}`, kind: 'page', label: target, degree: 0 };
          pageIndex.set(target, pn);
          nodes.push(pn);
        }
        pn.degree++;
        edges.push({ from: evNode.id, to: pn.id });
      }
    });
  });
  return { nodes, edges };
}

module.exports = { cardStats, buildGraph };
