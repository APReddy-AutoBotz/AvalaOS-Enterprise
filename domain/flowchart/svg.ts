// The As-Is and To-Be maps drawn from the Process Model: one lane per role, steps left to right in
// flow order, events and gateways in BPMN shapes. The To-Be map colours each step by its delivery
// mode with a legend. Pure string output (SVG and Mermaid), so it renders on screen, in Word and in
// Markdown from the same model, and it never draws a flow the model does not have.
import type { ProcessModel } from '../processModel/types.ts';
import type { Approach, HumanPoint } from '../assess/scoring.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import { graphToBpmn, modelToGraph, type Box } from './bpmn.ts';
import type { FlowGraph, FlowNode } from './graph.ts';
import { laneColumns, type MapShape } from './shape.ts';

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
  /** Height of the pool's title band, and of each lane's name band below it (none in a simple flow). */
  titleH: number; headH: number;
  noFlows: boolean;
  centre: (n: FlowNode) => { x: number; y: number };
  half: (n: FlowNode) => { w: number; h: number };
  routes: Route[];
  order: ReturnType<typeof orderedSteps>;
  /** The shape drawn, and whether a simple flow runs across the page. */
  shape: MapShape;
  across: boolean;
  /** A step's box, which in a simple flow has room for its role under the name. */
  task: { w: number; h: number };
}

/** How the map is drawn: swimlanes (the default) or a simple flow, which may run across the page. */
export interface LayoutOptions { shape?: MapShape; across?: boolean }

// A simple flow has one column, and each step's box has a line for its role. Across the page, the
// same layout is turned on its side: rows become columns, so the gap along the flow is wider, for the
// labels on paths.
const SIMPLE_TASK_H = 70, SIMPLE_ROW = 104, ACROSS_STEP = 230, ACROSS_CROSS = 104;

/**
 * The layout shared by the maps and the BPMN editor: rows by the place in the flow and a route for
 * each flow (back flows run along the far edge). In swimlanes, one column per role, top to bottom. In
 * a simple flow, one column; `across` lays the same rows out left to right. Everything is worked out
 * along the flow (`a`) and across it (`c`), then placed on the page.
 */
export function verticalLayout(model: ProcessModel, opts: LayoutOptions = {}): VerticalLayout {
  const shape: MapShape = opts.shape ?? 'swimlanes';
  const simple = shape === 'simple';
  const across = simple && Boolean(opts.across);
  const taskH = simple ? SIMPLE_TASK_H : TASK_H;
  // Sizes along the flow and across it.
  const STEP = across ? ACROSS_STEP : simple ? SIMPLE_ROW : ROW_H;
  const CROSS = across ? ACROSS_CROSS : COL_W;
  const headH = simple ? 0 : HEAD_H;
  const graph = modelToGraph(model);
  const noFlows = graph.edges.length === 0;
  const order = orderedSteps(model);
  const forLayout: FlowGraph = noFlows ? { ...graph, edges: order.slice(1).map((s, i) => ({ id: `order-${i}`, from: order[i].id, to: s.id })) } : graph;
  const { rank, back } = ranks(forLayout);

  // Columns: roles that have something in the map, in the model's order, then "No role recorded". A simple flow has one.
  const laneIds = simple ? [''] : laneColumns(graph);
  const laneOf = (n: FlowNode) => (!simple && n.laneId && laneIds.includes(n.laneId) ? n.laneId : '');
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
  const widthOf = (lane: string) => Math.max(1, ...[...perCell.entries()].filter(([k]) => k.startsWith(`${lane}|`)).map(([, v]) => v)) * CROSS;
  const laneC = new Map<string, number>();
  let c0 = 0;
  for (const id of laneIds) { laneC.set(id, c0); c0 += widthOf(id); }
  const backCount = graph.edges.filter(e => back.has(e.id)).length;
  const crossLen = c0 + Math.min(backCount, 6) * 8 + (backCount ? 12 : 0);
  const rows = Math.max(1, ...[...rank.values()].map(r => r + 1));
  const top = TITLE_H + headH;
  const alongLen = headH + rows * STEP;
  // Where a node sits along the flow and across it, and half its size in the same terms.
  const flowCentre = (n: FlowNode) => ({ c: laneC.get(laneOf(n))! + slot.get(n.id)! * CROSS + CROSS / 2, a: rank.get(n.id)! * STEP + STEP / 2 });
  const flowHalf = (n: FlowNode) => (n.kind === 'start' || n.kind === 'end' ? { c: EVENT / 2, a: EVENT / 2 } : n.kind === 'gateway' ? { c: GATE / 2, a: GATE / 2 } : across ? { c: taskH / 2, a: TASK_W / 2 } : { c: TASK_W / 2, a: taskH / 2 });
  const place = (c: number, a: number): [number, number] => (across ? [SIDE + a, top + c] : [SIDE + c, top + a]);
  const routes: Route[] = [];
  let lane = 0;
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const far = crossLen - 6;
  const crossHalf = across ? taskH / 2 : TASK_W / 2;
  for (const e of graph.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const ca = flowCentre(a), cb = flowCentre(b), ha = flowHalf(a), hb = flowHalf(b);
    let pts: [number, number][], label: [number, number];
    if (!back.has(e.id) && cb.a > ca.a) {
      const a1 = ca.a + ha.a, a2 = cb.a - hb.a;
      // Each source's turn is at its own place, so flows from neighbouring shapes do not share a line.
      const am = a1 + 8 + (slot.get(a.id)! % 3) * 6;
      const skips = rank.get(b.id)! - rank.get(a.id)! > 1;
      const blocked = skips && graph.nodes.some(n => n.id !== a.id && n.id !== b.id && Math.abs(flowCentre(n).c - cb.c) < crossHalf && flowCentre(n).a > ca.a && flowCentre(n).a < cb.a);
      if (blocked) {
        // A flow that skips rows would cross the shapes between: it goes along the column's near gutter.
        const gc = (ca.c === cb.c ? cb.c : Math.min(ca.c, cb.c)) - crossHalf - 5;
        pts = [[ca.c, a1], [ca.c, am], [gc, am], [gc, a2 - 12], [cb.c, a2 - 12], [cb.c, a2]];
        label = across ? [gc - 5, am + 6] : [gc + 4, am + 12];
      } else {
        pts = ca.c === cb.c ? [[ca.c, a1], [cb.c, a2]] : [[ca.c, a1], [ca.c, am], [cb.c, am], [cb.c, a2]];
        // The label sits on the last leg, beside the shape it leads to, so two labels from one decision never meet.
        label = across ? [cb.c - 5, (ca.c === cb.c ? a1 : am) + 6] : [cb.c + 5, ca.c === cb.c ? a1 + 12 : am + 12];
      }
    } else {
      const gc = far - (lane++ % 6) * 8;
      pts = [[ca.c + ha.c, ca.a], [gc, ca.a], [gc, cb.a], [cb.c + hb.c, cb.a]];
      label = across ? [ca.c + ha.c + 12, ca.a + 6] : [ca.c + ha.c + 4, ca.a - 4];
    }
    const [lx, ly] = place(label[0], label[1]);
    routes.push({ id: e.id, points: pts.map(([c, a]) => place(c, a)), label: e.label ? { x: lx, y: ly } : null });
  }
  const centre = (n: FlowNode) => { const f = flowCentre(n); const [x, y] = place(f.c, f.a); return { x, y }; };
  const half = (n: FlowNode) => { const h = flowHalf(n); return across ? { w: h.a, h: h.c } : { w: h.c, h: h.a }; };
  const poolW = across ? alongLen : crossLen;
  const poolH = TITLE_H + (across ? crossLen : alongLen);
  return {
    graph, laneIds, lanes: laneIds.map(id => ({ id, name: graph.lanes.find(l => l.id === id)?.name ?? '', x: SIDE + laneC.get(id)!, w: widthOf(id) })),
    pool: { x: SIDE, y: 0, w: poolW, h: poolH }, titleH: TITLE_H, headH, noFlows, centre, half, routes, order, shape, across, task: across ? { w: TASK_W, h: taskH } : { w: TASK_W, h: taskH },
  };
}

const ROLE_H = 18;

/**
 * Each step's role, for a simple flow: its names (all of them on hover), and whether it differs from
 * the role of the step before, so a hand-over can be seen without columns. "Before" follows the flow
 * back through decision points and events; with no flows recorded, it is the step before in order.
 */
function stepRoles(model: ProcessModel, L: VerticalLayout): Map<string, { name: string; title: string; handover: boolean }> {
  const roleName = new Map(model.roles.map(r => [r.id, r.name]));
  const byId = new Map(L.graph.nodes.map(n => [n.id, n]));
  const edges = L.noFlows ? L.order.slice(1).map((s, i) => ({ from: L.order[i].id, to: s.id })) : L.graph.edges;
  const tasksBefore = (id: string): FlowNode[] => {
    const seen = new Set<string>([id]);
    const out: FlowNode[] = [];
    let frontier = [id];
    while (frontier.length) {
      const next: string[] = [];
      for (const to of frontier) for (const e of edges.filter(x => x.to === to)) {
        if (seen.has(e.from)) continue;
        seen.add(e.from);
        const n = byId.get(e.from);
        if (!n) continue;
        if (n.kind === 'task' || n.kind === 'subprocess') out.push(n); else next.push(n.id);
      }
      frontier = next;
    }
    return out;
  };
  const lane = (n: FlowNode) => (n.laneId && roleName.has(n.laneId) ? n.laneId : '');
  const out = new Map<string, { name: string; title: string; handover: boolean }>();
  for (const step of model.steps) {
    const n = byId.get(step.id);
    if (!n) continue;
    const names = step.roleIds.map(id => roleName.get(id)).filter((x): x is string => Boolean(x));
    const name = names.length ? names.join(', ') : 'No role recorded';
    out.set(step.id, { name, title: names.length ? `Role: ${name}` : 'No role recorded', handover: tasksBefore(step.id).some(p => lane(p) !== lane(n)) });
  }
  return out;
}

export function flowPicture(model: ProcessModel, opts: { modes?: Map<string, StepMode>; title?: string } & LayoutOptions = {}): FlowPicture {
  const L = verticalLayout(model, opts);
  const { graph, laneIds, centre, half, noFlows, order } = L;
  const simple = L.shape === 'simple';
  const poolW = L.pool.w, poolH = L.pool.h - TITLE_H, top = TITLE_H + L.headH;
  const laneX = new Map(L.lanes.map(l => [l.id, l.x]));
  const widthOf = (id: string) => L.lanes.find(l => l.id === id)!.w;
  void top;
  const legendH = opts.modes ? 52 : 0;
  const noteH = noFlows && graph.nodes.length ? 22 : 0;
  // Room on the right for labels beside shapes in the last column.
  const mapW = SIDE * 2 + poolW + 60;
  const width = Math.max(mapW, opts.modes ? 520 : 0);
  const height = TITLE_H + poolH + 14 + noteH + legendH;
  // A narrow simple flow sits in the middle of a picture made wide by its legend.
  const shift = simple && width > mapW ? Math.round((width - mapW) / 2) : 0;

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Segoe UI, Calibri, Arial, sans-serif" role="img" aria-label="${esc(opts.title ?? model.meta.name)}">`);
  out.push('<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#334155"/></marker></defs>');
  out.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  if (shift) out.push(`<g transform="translate(${shift},0)">`);
  // Pool title, then one column per role with its name at the top (a simple flow has no columns).
  out.push(`<rect x="${SIDE + 0.5}" y="0.5" width="${poolW - 1}" height="${TITLE_H + poolH - 1}" fill="none" stroke="#94A3B8"/>`);
  out.push(`<rect x="${SIDE + 0.5}" y="0.5" width="${poolW - 1}" height="${TITLE_H}" fill="#F8FAFC" stroke="#94A3B8"/>`);
  // Across the page the map is long, so its title starts at the left where reading starts.
  out.push(L.across
    ? `<text x="${SIDE + 12}" y="${TITLE_H / 2 + 5}" font-size="13" font-weight="600" fill="#0F172A">${esc(wrap(model.meta.name, 120, 1)[0] ?? '')}</text>`
    : `<text x="${SIDE + poolW / 2}" y="${TITLE_H / 2 + 5}" text-anchor="middle" font-size="13" font-weight="600" fill="#0F172A">${esc(wrap(model.meta.name, simple ? Math.max(20, Math.floor(poolW / 7.5)) : 70, 1)[0] ?? '')}</text>`);
  if (!simple) for (const id of laneIds) {
    const lx = laneX.get(id)!, lw = widthOf(id);
    const name = graph.lanes.find(l => l.id === id)?.name ?? 'No role recorded';
    out.push(`<rect x="${lx + 0.5}" y="${TITLE_H + 0.5}" width="${lw - 1}" height="${poolH - 1}" fill="${id ? '#ffffff' : '#FFFBEB'}" stroke="#CBD5E1"/>`);
    out.push(`<rect x="${lx + 0.5}" y="${TITLE_H + 0.5}" width="${lw - 1}" height="${HEAD_H - 1}" fill="#F1F5F9" stroke="#CBD5E1"/>`);
    const ls = wrap(name, Math.floor(lw / 7), 2);
    ls.forEach((l, i) => out.push(`<text x="${lx + lw / 2}" y="${TITLE_H + HEAD_H / 2 + 4 - (ls.length - 1) * 6.5 + i * 13}" text-anchor="middle" font-size="11" font-weight="600" fill="#334155">${esc(l)}</text>`));
  }
  const roles = simple ? stepRoles(model, L) : null;
  // Flows: down from the bottom of one shape to the top of the next; flows going back run up the right edge.
  let drawn = 0;
  for (const r of L.routes) {
    const e = graph.edges.find(x => x.id === r.id)!;
    drawn++;
    const dash = model.flows.find(f => f.id === e.id)?.isException ? ' stroke-dasharray="5 4"' : '';
    const d = r.points.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join(' ');
    out.push(`<path d="${d}" fill="none" stroke="#334155" stroke-width="1.3"${dash} marker-end="url(#arrow)"/>`);
    // A path's label in full, on up to three lines (owner's process, 16 November 2026: one line cut 15 labels).
    if (e.label && r.label) {
      const ll = wrap(e.label, 20, 3);
      const ly = L.across ? r.label.y - (ll.length - 1) * 11 : r.label.y;
      out.push(`<text x="${r.label.x}" y="${ly}" font-size="10" font-weight="600" fill="#334155"><title>${esc(e.label)}</title>${ll.map((l, i) => `<tspan x="${r.label!.x}" dy="${i ? 11 : 0}">${esc(l)}</tspan>`).join('')}</text>`);
    }
  }
  // Shapes.
  for (const n of graph.nodes) {
    const c = centre(n);
    if (n.kind === 'start' || n.kind === 'end') {
      out.push(`<circle cx="${c.x}" cy="${c.y}" r="${EVENT / 2}" fill="#ffffff" stroke="#0F172A" stroke-width="${n.kind === 'end' ? 3.5 : 1.5}"/>`);
      out.push(`<g><title>${esc(n.label)}</title>`);
      // Beside the circle; across the page, under it, where no flow runs.
      wrap(n.label, 20, 2).forEach((l, i) => out.push(L.across
        ? `<text x="${c.x}" y="${c.y + EVENT / 2 + 12 + i * 11}" text-anchor="middle" font-size="10" fill="#334155">${esc(l)}</text>`
        : `<text x="${c.x + EVENT / 2 + 6}" y="${c.y + 4 + i * 11}" font-size="10" fill="#334155">${esc(l)}</text>`));
      out.push('</g>');
    } else if (n.kind === 'gateway') {
      const g = GATE / 2;
      out.push(`<path d="M${c.x},${c.y - g} L${c.x + g},${c.y} L${c.x},${c.y + g} L${c.x - g},${c.y} Z" fill="#FFFBEB" stroke="#B45309" stroke-width="1.5"/>`);
      out.push(n.gatewayType === 'parallel'
        ? `<path d="M${c.x - 9},${c.y} H${c.x + 9} M${c.x},${c.y - 9} V${c.y + 9}" stroke="#B45309" stroke-width="3"/>`
        : `<path d="M${c.x - 7},${c.y - 7} L${c.x + 7},${c.y + 7} M${c.x + 7},${c.y - 7} L${c.x - 7},${c.y + 7}" stroke="#B45309" stroke-width="3"/>`);
      const gl = wrap(n.label, 18, 3);
      out.push(`<g><title>${esc(n.label)}</title>`);
      // Beside the diamond; across the page, above and before it, clear of the ways out.
      gl.forEach((l, i) => out.push(L.across
        ? `<text x="${c.x - 4}" y="${c.y - g - 6 - (gl.length - 1 - i) * 11}" text-anchor="end" font-size="10" fill="#92400E">${esc(l)}</text>`
        : `<text x="${c.x + g + 6}" y="${c.y - 4 - (gl.length - 1) * 5.5 + i * 11}" font-size="10" fill="#92400E">${esc(l)}</text>`));
      out.push('</g>');
    } else {
      const m = opts.modes?.get(n.id);
      const st = m ? MODE_STYLE[m.mode] : { fill: '#ffffff', stroke: '#334155' };
      const th = L.task.h;
      const bx = c.x - TASK_W / 2, by = c.y - th / 2;
      out.push(`<rect x="${bx}" y="${by}" width="${TASK_W}" height="${th}" rx="9" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5"/>`);
      const lines = wrap(n.label, 22, 3);
      // In a simple flow the name sits above a line for the role.
      const mid = roles ? by + (th - ROLE_H) / 2 : c.y;
      out.push(`<g><title>${esc(n.label)}</title>`);
      lines.forEach((l, i) => out.push(`<text x="${c.x}" y="${mid - (lines.length - 1) * 6.5 + i * 13 + 4}" text-anchor="middle" font-size="11" fill="#0F172A">${esc(l)}</text>`));
      out.push('</g>');
      const role = roles?.get(n.id);
      if (role) {
        // The role on a small line of its own; darker where the work changes hands.
        const ry = by + th - ROLE_H;
        out.push(`<path d="M${bx + 8},${ry} H${bx + TASK_W - 8}" stroke="${st.stroke}" stroke-opacity="0.35"/>`);
        out.push(`<g data-role="${role.handover ? 'handover' : 'same'}"><title>${esc(role.title)}</title><text x="${c.x}" y="${ry + 12}" text-anchor="middle" font-size="9" font-weight="${role.handover ? 700 : 400}" fill="${role.handover ? '#0F172A' : '#475569'}">${esc(wrap(role.name, 28, 1)[0] ?? '')}</text></g>`);
      }
      const no = order.findIndex(s => s.id === n.id) + 1;
      if (no) out.push(`<text x="${bx + 6}" y="${by + 12}" font-size="9" font-weight="700" fill="${st.stroke}">${no}</text>`);
      if (m?.check) out.push(`<circle cx="${bx + TASK_W - 8}" cy="${by + 8}" r="5" fill="#F59E0B" stroke="#ffffff"><title>A person checks the result</title></circle>`);
    }
  }
  if (shift) out.push('</g>');
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

/** A read-only Mermaid text of the same map, for Markdown and wikis. A simple flow has no lanes; each step names its role. */
export function flowMermaid(model: ProcessModel, modes?: Map<string, StepMode>, shape: MapShape = 'swimlanes'): string {
  const g = modelToGraph(model);
  const id = (s: string) => `n_${s.replace(/[^\w]/g, '_')}`;
  const label = (s: string) => s.replace(/["\n]/g, ' ').trim();
  const roleName = new Map(model.roles.map(r => [r.id, r.name]));
  const withRole = (n: FlowNode) => {
    const step = shape === 'simple' && (n.kind === 'task' || n.kind === 'subprocess') ? model.steps.find(s => s.id === n.id) : undefined;
    if (!step) return n.label;
    const names = step.roleIds.map(r => roleName.get(r)).filter(Boolean);
    return `${n.label} (${names.length ? names.join(', ') : 'no role recorded'})`;
  };
  const shapeOf = (n: FlowNode) => n.kind === 'start' || n.kind === 'end' ? `((${JSON.stringify(label(n.label))}))` : n.kind === 'gateway' ? `{${JSON.stringify(label(n.label))}}` : `[${JSON.stringify(label(withRole(n)))}]`;
  const lines = ['flowchart TB'];
  if (shape === 'simple') for (const n of g.nodes) lines.push(`  ${id(n.id)}${shapeOf(n)}`);
  else {
    for (const lane of g.lanes) {
      lines.push(`  subgraph ${id(lane.id)}[${JSON.stringify(label(lane.name))}]`);
      for (const n of g.nodes.filter(x => x.laneId === lane.id)) lines.push(`    ${id(n.id)}${shapeOf(n)}`);
      lines.push('  end');
    }
    for (const n of g.nodes.filter(x => !x.laneId)) lines.push(`  ${id(n.id)}${shapeOf(n)}`);
  }
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
