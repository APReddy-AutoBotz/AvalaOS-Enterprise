// The As-Is and To-Be maps drawn from the Process Model: one lane per role, steps left to right in
// flow order, events and gateways in BPMN shapes. The To-Be map colours each step by its delivery
// mode with a legend. Pure string output (SVG and Mermaid), so it renders on screen, in Word and in
// Markdown from the same model, and it never draws a flow the model does not have.
import type { ProcessModel } from '../processModel/types.ts';
import type { Approach, HumanPoint } from '../assess/scoring.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import { graphToBpmn, modelToGraph, type Box } from './bpmn.ts';
import type { FlowGraph, FlowNode } from './graph.ts';

export type FlowMode = 'rpa' | 'api' | 'ai_assist' | 'agent' | 'human' | 'system';
export interface StepMode { mode: FlowMode; check: boolean }

export const MODE_STYLE: Record<FlowMode, { fill: string; stroke: string; label: string }> = {
  rpa: { fill: '#DBEAFE', stroke: '#1D4ED8', label: 'Rule-based RPA' },
  api: { fill: '#D1FAE5', stroke: '#047857', label: 'API integration' },
  ai_assist: { fill: '#EDE9FE', stroke: '#6D28D9', label: 'AI-assisted' },
  agent: { fill: '#FCE7F3', stroke: '#BE185D', label: 'Agent' },
  human: { fill: '#F1F5F9', stroke: '#475569', label: 'Kept with a person' },
  system: { fill: '#ECFEFF', stroke: '#0E7490', label: 'Already done by a system' },
};

export const modeFromScore = (approach: Approach | null, alreadyAutomated: boolean, human: HumanPoint | undefined): StepMode =>
  ({ mode: alreadyAutomated ? 'system' : (approach ?? 'human') as FlowMode, check: !alreadyAutomated && approach !== 'human' && (human === 'review' || human === 'approve' || human === 'decide') });

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function wrap(text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur ? `${cur} ${w}` : w).length <= width) cur = cur ? `${cur} ${w}` : w;
    else { if (cur) lines.push(cur); cur = w.length > width ? `${w.slice(0, width - 1)}…` : w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…$/, '').slice(0, width - 1)}…`; }
  return lines;
}

export interface FlowPicture { svg: string; width: number; height: number; drawnFlows: number; steps: number }

// Top-to-bottom layout: one column per role, steps in rows by their place in the flow. It fits a
// portrait page and a normal screen width, however long the process is.
const TASK_W = 150, TASK_H = 56, GATE = 44, EVENT = 30, COL_W = 176, ROW_H = 92, HEAD_H = 44, TITLE_H = 30, SIDE = 10;

/** Each node's row: back flows found depth-first are set aside, then the longest path from a start. */
function ranks(graph: FlowGraph): { rank: Map<string, number>; back: Set<string> } {
  const starts = graph.nodes.filter(n => n.kind === 'start' || !graph.edges.some(e => e.to === n.id)).map(n => n.id);
  const state = new Map<string, number>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of graph.edges.filter(x => x.from === id)) {
      if (state.get(e.to) === 1) back.add(e.id);
      else if (!state.has(e.to)) visit(e.to);
    }
    state.set(id, 2);
  };
  for (const id of starts) if (!state.has(id)) visit(id);
  for (const n of graph.nodes) if (!state.has(n.id)) visit(n.id);
  const rank = new Map(graph.nodes.map(n => [n.id, 0]));
  const forward = graph.edges.filter(e => !back.has(e.id));
  for (let i = 0; i < graph.nodes.length; i++) {
    let changed = false;
    for (const e of forward) {
      const r = (rank.get(e.from) ?? 0) + 1;
      if (r > (rank.get(e.to) ?? 0)) { rank.set(e.to, r); changed = true; }
    }
    if (!changed) break;
  }
  return { rank, back };
}

/**
 * The map of a model. With modes, the To-Be map: each step filled by its delivery mode, a dot where a
 * person checks the result, and a legend. Without recorded flows, the steps are placed in their order
 * with no arrows, and the picture says the flow is not recorded. Roles with no step get no column.
 */
export interface Route { id: string; points: [number, number][]; label: { x: number; y: number } | null }
export interface VerticalLayout {
  graph: FlowGraph;
  laneIds: string[];
  lanes: { id: string; name: string; x: number; w: number }[];
  pool: { x: number; y: number; w: number; h: number };
  /** Height of the pool's title band, and of each lane's name band below it. */
  titleH: number; headH: number;
  noFlows: boolean;
  centre: (n: FlowNode) => { x: number; y: number };
  half: (n: FlowNode) => { w: number; h: number };
  routes: Route[];
  order: ReturnType<typeof orderedSteps>;
}

/**
 * The top-to-bottom layout shared by the maps and the BPMN editor: one column per role, rows by the
 * place in the flow, and a route for each flow (back flows run up the right edge).
 */
export function verticalLayout(model: ProcessModel): VerticalLayout {
  const graph = modelToGraph(model);
  const noFlows = graph.edges.length === 0;
  const order = orderedSteps(model);
  const forLayout: FlowGraph = noFlows ? { ...graph, edges: order.slice(1).map((s, i) => ({ id: `order-${i}`, from: order[i].id, to: s.id })) } : graph;
  const { rank, back } = ranks(forLayout);

  // Columns: roles that have something in the map, in the model's order, then "No role recorded".
  const laneIds = [...graph.lanes.map(l => l.id).filter(id => graph.nodes.some(n => n.laneId === id)), ...(graph.nodes.some(n => !n.laneId || !graph.lanes.some(l => l.id === n.laneId)) ? [''] : [])];
  const laneOf = (n: FlowNode) => (n.laneId && laneIds.includes(n.laneId) ? n.laneId : '');
  // Several nodes in one role and row sit side by side; the column widens to hold them.
  const slot = new Map<string, number>();
  const perCell = new Map<string, number>();
  // Row by row; within a cell, nodes are ordered by where their incoming flows come from, so lines cross less.
  const pos = (id: string) => laneIds.indexOf(laneOf(graph.nodes.find(n => n.id === id)!)) * 100 + (slot.get(id) ?? 0);
  const maxRank = Math.max(0, ...rank.values());
  for (let r = 0; r <= maxRank; r++) {
    const row = graph.nodes.filter(n => rank.get(n.id) === r);
    const key = (n: FlowNode) => {
      const parents = forLayout.edges.filter(e => e.to === n.id && !back.has(e.id) && slot.has(e.from)).map(e => pos(e.from));
      return parents.length ? parents.reduce((x, y) => x + y, 0) / parents.length : order.findIndex(s => s.id === n.id);
    };
    for (const n of row.sort((a, b) => key(a) - key(b))) {
      const cell = `${laneOf(n)}|${r}`;
      slot.set(n.id, perCell.get(cell) ?? 0);
      perCell.set(cell, (perCell.get(cell) ?? 0) + 1);
    }
  }
  const widthOf = (lane: string) => Math.max(1, ...[...perCell.entries()].filter(([k]) => k.startsWith(`${lane}|`)).map(([, v]) => v)) * COL_W;
  const laneX = new Map<string, number>();
  let x = SIDE;
  for (const id of laneIds) { laneX.set(id, x); x += widthOf(id); }
  const backCount = graph.edges.filter(e => back.has(e.id)).length;
  const poolW = x - SIDE + Math.min(backCount, 6) * 8 + (backCount ? 12 : 0);
  const rows = Math.max(1, ...[...rank.values()].map(r => r + 1));
  const top = TITLE_H + HEAD_H;
  const poolH = HEAD_H + rows * ROW_H;
  const centre = (n: FlowNode) => ({ x: laneX.get(laneOf(n))! + slot.get(n.id)! * COL_W + COL_W / 2, y: top + rank.get(n.id)! * ROW_H + ROW_H / 2 });
  const half = (n: FlowNode) => (n.kind === 'start' || n.kind === 'end' ? { w: EVENT / 2, h: EVENT / 2 } : n.kind === 'gateway' ? { w: GATE / 2, h: GATE / 2 } : { w: TASK_W / 2, h: TASK_H / 2 });
  const routes: Route[] = [];
  let lane = 0;
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const right = SIDE + poolW - 6;
  for (const e of graph.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const ca = centre(a), cb = centre(b), ha = half(a), hb = half(b);
    let points: [number, number][], lx: number, ly: number;
    if (!back.has(e.id) && cb.y > ca.y) {
      const y1 = ca.y + ha.h, y2 = cb.y - hb.h;
      // Each source's turn is at its own height, so flows from neighbouring shapes do not share a line.
      const ym = y1 + 8 + (slot.get(a.id)! % 3) * 6;
      const skips = rank.get(b.id)! - rank.get(a.id)! > 1;
      const blocked = skips && graph.nodes.some(n => n.id !== a.id && n.id !== b.id && Math.abs(centre(n).x - cb.x) < TASK_W / 2 && centre(n).y > ca.y && centre(n).y < cb.y);
      if (blocked) {
        // A flow that skips rows would cross the shapes between: it goes down the column's left gutter.
        const gx = (ca.x === cb.x ? cb.x : Math.min(ca.x, cb.x)) - TASK_W / 2 - 5;
        points = [[ca.x, y1], [ca.x, ym], [gx, ym], [gx, y2 - 12], [cb.x, y2 - 12], [cb.x, y2]];
        lx = gx + 4; ly = ym + 12;
      } else {
        points = ca.x === cb.x ? [[ca.x, y1], [cb.x, y2]] : [[ca.x, y1], [ca.x, ym], [cb.x, ym], [cb.x, y2]];
        // The label sits on the last leg, beside the shape it leads to, so two labels from one decision never meet.
        lx = cb.x + 5; ly = ca.x === cb.x ? y1 + 12 : ym + 12;
      }
    } else {
      const gx = right - (lane++ % 6) * 8;
      points = [[ca.x + ha.w, ca.y], [gx, ca.y], [gx, cb.y], [cb.x + hb.w, cb.y]];
      lx = ca.x + ha.w + 4; ly = ca.y - 4;
    }
    routes.push({ id: e.id, points, label: e.label ? { x: lx, y: ly } : null });
  }
  return {
    graph, laneIds, lanes: laneIds.map(id => ({ id, name: graph.lanes.find(l => l.id === id)?.name ?? '', x: laneX.get(id)!, w: widthOf(id) })),
    pool: { x: SIDE, y: 0, w: poolW, h: TITLE_H + poolH }, titleH: TITLE_H, headH: HEAD_H, noFlows, centre, half, routes, order,
  };
}

export function flowPicture(model: ProcessModel, opts: { modes?: Map<string, StepMode>; title?: string } = {}): FlowPicture {
  const L = verticalLayout(model);
  const { graph, laneIds, centre, half, noFlows, order } = L;
  const poolW = L.pool.w, poolH = L.pool.h - TITLE_H, top = TITLE_H + HEAD_H;
  const laneX = new Map(L.lanes.map(l => [l.id, l.x]));
  const widthOf = (id: string) => L.lanes.find(l => l.id === id)!.w;
  void top;
  const legendH = opts.modes ? 52 : 0;
  const noteH = noFlows && graph.nodes.length ? 22 : 0;
  // Room on the right for labels beside shapes in the last column.
  const width = Math.max(SIDE * 2 + poolW + 60, opts.modes ? 520 : 0);
  const height = TITLE_H + poolH + 14 + noteH + legendH;

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Segoe UI, Calibri, Arial, sans-serif" role="img" aria-label="${esc(opts.title ?? model.meta.name)}">`);
  out.push('<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#334155"/></marker></defs>');
  out.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  // Pool title, then one column per role with its name at the top.
  out.push(`<rect x="${SIDE + 0.5}" y="0.5" width="${poolW - 1}" height="${TITLE_H + poolH - 1}" fill="none" stroke="#94A3B8"/>`);
  out.push(`<rect x="${SIDE + 0.5}" y="0.5" width="${poolW - 1}" height="${TITLE_H}" fill="#F8FAFC" stroke="#94A3B8"/>`);
  out.push(`<text x="${SIDE + poolW / 2}" y="${TITLE_H / 2 + 5}" text-anchor="middle" font-size="13" font-weight="600" fill="#0F172A">${esc(wrap(model.meta.name, 70, 1)[0] ?? '')}</text>`);
  for (const id of laneIds) {
    const lx = laneX.get(id)!, lw = widthOf(id);
    const name = graph.lanes.find(l => l.id === id)?.name ?? 'No role recorded';
    out.push(`<rect x="${lx + 0.5}" y="${TITLE_H + 0.5}" width="${lw - 1}" height="${poolH - 1}" fill="${id ? '#ffffff' : '#FFFBEB'}" stroke="#CBD5E1"/>`);
    out.push(`<rect x="${lx + 0.5}" y="${TITLE_H + 0.5}" width="${lw - 1}" height="${HEAD_H - 1}" fill="#F1F5F9" stroke="#CBD5E1"/>`);
    const ls = wrap(name, Math.floor(lw / 7), 2);
    ls.forEach((l, i) => out.push(`<text x="${lx + lw / 2}" y="${TITLE_H + HEAD_H / 2 + 4 - (ls.length - 1) * 6.5 + i * 13}" text-anchor="middle" font-size="11" font-weight="600" fill="#334155">${esc(l)}</text>`));
  }
  // Flows: down from the bottom of one shape to the top of the next; flows going back run up the right edge.
  let drawn = 0;
  for (const r of L.routes) {
    const e = graph.edges.find(x => x.id === r.id)!;
    drawn++;
    const dash = model.flows.find(f => f.id === e.id)?.isException ? ' stroke-dasharray="5 4"' : '';
    const d = r.points.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join(' ');
    out.push(`<path d="${d}" fill="none" stroke="#334155" stroke-width="1.3"${dash} marker-end="url(#arrow)"/>`);
    if (e.label && r.label) out.push(`<text x="${r.label.x}" y="${r.label.y}" font-size="10" font-weight="600" fill="#334155">${esc(wrap(e.label, 18, 1)[0])}</text>`);
  }
  // Shapes.
  for (const n of graph.nodes) {
    const c = centre(n);
    if (n.kind === 'start' || n.kind === 'end') {
      out.push(`<circle cx="${c.x}" cy="${c.y}" r="${EVENT / 2}" fill="#ffffff" stroke="#0F172A" stroke-width="${n.kind === 'end' ? 3.5 : 1.5}"/>`);
      wrap(n.label, 20, 2).forEach((l, i) => out.push(`<text x="${c.x + EVENT / 2 + 6}" y="${c.y + 4 + i * 11}" font-size="10" fill="#334155">${esc(l)}</text>`));
    } else if (n.kind === 'gateway') {
      const g = GATE / 2;
      out.push(`<path d="M${c.x},${c.y - g} L${c.x + g},${c.y} L${c.x},${c.y + g} L${c.x - g},${c.y} Z" fill="#FFFBEB" stroke="#B45309" stroke-width="1.5"/>`);
      out.push(n.gatewayType === 'parallel'
        ? `<path d="M${c.x - 9},${c.y} H${c.x + 9} M${c.x},${c.y - 9} V${c.y + 9}" stroke="#B45309" stroke-width="3"/>`
        : `<path d="M${c.x - 7},${c.y - 7} L${c.x + 7},${c.y + 7} M${c.x + 7},${c.y - 7} L${c.x - 7},${c.y + 7}" stroke="#B45309" stroke-width="3"/>`);
      const gl = wrap(n.label, 18, 3);
      gl.forEach((l, i) => out.push(`<text x="${c.x + g + 6}" y="${c.y - 4 - (gl.length - 1) * 5.5 + i * 11}" font-size="10" fill="#92400E">${esc(l)}</text>`));
    } else {
      const m = opts.modes?.get(n.id);
      const st = m ? MODE_STYLE[m.mode] : { fill: '#ffffff', stroke: '#334155' };
      const bx = c.x - TASK_W / 2, by = c.y - TASK_H / 2;
      out.push(`<rect x="${bx}" y="${by}" width="${TASK_W}" height="${TASK_H}" rx="9" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5"/>`);
      const lines = wrap(n.label, 22, 3);
      lines.forEach((l, i) => out.push(`<text x="${c.x}" y="${c.y - (lines.length - 1) * 6.5 + i * 13 + 4}" text-anchor="middle" font-size="11" fill="#0F172A">${esc(l)}</text>`));
      const no = order.findIndex(s => s.id === n.id) + 1;
      if (no) out.push(`<text x="${bx + 6}" y="${by + 12}" font-size="9" font-weight="700" fill="${st.stroke}">${no}</text>`);
      if (m?.check) out.push(`<circle cx="${bx + TASK_W - 8}" cy="${by + 8}" r="5" fill="#F59E0B" stroke="#ffffff"><title>A person checks the result</title></circle>`);
    }
  }
  let y = TITLE_H + poolH + 18;
  if (noteH) { out.push(`<text x="${SIDE}" y="${y}" font-size="11" fill="#92400E">The flow between steps is not recorded yet: steps are shown in order, without arrows.</text>`); y += noteH; }
  if (opts.modes) {
    // Legend in rows that fit the picture's width.
    let lx = SIDE;
    const items: [string, string, string][] = [];
    const used = new Set([...opts.modes.values()].map(m => m.mode));
    for (const [mode, st] of Object.entries(MODE_STYLE) as [FlowMode, typeof MODE_STYLE[FlowMode]][]) if (used.has(mode)) items.push([st.fill, st.stroke, st.label]);
    const check = [...opts.modes.values()].some(m => m.check);
    for (const [fill, stroke, label] of items) {
      const w = 30 + label.length * 6.2;
      if (lx + w > width - SIDE) { lx = SIDE; y += 20; }
      out.push(`<rect x="${lx}" y="${y - 2}" width="14" height="14" rx="3" fill="${fill}" stroke="${stroke}"/><text x="${lx + 19}" y="${y + 9}" font-size="11" fill="#334155">${esc(label)}</text>`);
      lx += w;
    }
    if (check) {
      if (lx + 190 > width - SIDE) { lx = SIDE; y += 20; }
      out.push(`<circle cx="${lx + 7}" cy="${y + 5}" r="5" fill="#F59E0B"/><text x="${lx + 17}" y="${y + 9}" font-size="11" fill="#334155">A person checks the result</text>`);
    }
  }
  out.push('</svg>');
  return { svg: out.join(''), width, height, drawnFlows: drawn, steps: model.steps.length };
}

/** A read-only Mermaid text of the same map, for Markdown and wikis. */
export function flowMermaid(model: ProcessModel, modes?: Map<string, StepMode>): string {
  const g = modelToGraph(model);
  const id = (s: string) => `n_${s.replace(/[^\w]/g, '_')}`;
  const label = (s: string) => s.replace(/["\n]/g, ' ').trim();
  const shape = (n: FlowNode) => n.kind === 'start' || n.kind === 'end' ? `((${JSON.stringify(label(n.label))}))` : n.kind === 'gateway' ? `{${JSON.stringify(label(n.label))}}` : `[${JSON.stringify(label(n.label))}]`;
  const lines = ['flowchart TB'];
  for (const lane of g.lanes) {
    lines.push(`  subgraph ${id(lane.id)}[${JSON.stringify(label(lane.name))}]`);
    for (const n of g.nodes.filter(x => x.laneId === lane.id)) lines.push(`    ${id(n.id)}${shape(n)}`);
    lines.push('  end');
  }
  for (const n of g.nodes.filter(x => !x.laneId)) lines.push(`  ${id(n.id)}${shape(n)}`);
  for (const e of g.edges) lines.push(`  ${id(e.from)} -->${e.label ? `|${label(e.label)}|` : ''} ${id(e.to)}`);
  if (modes) {
    for (const [mode, st] of Object.entries(MODE_STYLE)) lines.push(`  classDef ${mode} fill:${st.fill},stroke:${st.stroke}`);
    for (const [stepId, m] of modes) lines.push(`  class ${id(stepId)} ${m.mode}`);
  }
  return lines.join('\n');
}

/**
 * The model as BPMN drawn top to bottom, one column per role, the same layout as the maps: used by the
 * editor, so the flow looks the same where it is read and where it is changed.
 */
export function modelToBpmnVertical(model: ProcessModel): string {
  const L = verticalLayout(model);
  const boxes = new Map<string, Box>();
  for (const n of L.graph.nodes) {
    const c = L.centre(n), h = L.half(n);
    boxes.set(n.id, { x: Math.round(c.x - h.w), y: Math.round(c.y - h.h), w: h.w * 2, h: h.h * 2 });
  }
  const lanes = new Map<string, Box>(L.lanes.map(l => [l.id, { x: l.x, y: L.titleH, w: l.w, h: L.pool.h - L.titleH }]));
  return graphToBpmn(L.graph, {
    boxes, lanes, width: L.pool.w + L.pool.x, height: L.pool.h, horizontal: false,
    waypoints: new Map(L.routes.map(r => [r.id, r.points])),
  });
}
