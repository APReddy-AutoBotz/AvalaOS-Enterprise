// The As-Is and To-Be maps drawn from the Process Model: one lane per role, steps left to right in
// flow order, events and gateways in BPMN shapes. The To-Be map colours each step by its delivery
// mode with a legend. Pure string output (SVG and Mermaid), so it renders on screen, in Word and in
// Markdown from the same model, and it never draws a flow the model does not have.
import type { ProcessModel } from '../processModel/types.ts';
import type { Approach, HumanPoint } from '../assess/scoring.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import { layout, modelToGraph } from './bpmn.ts';
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

/**
 * The map of a model. With modes, the To-Be map: each step filled by its delivery mode, a dot where a
 * person checks the result, and a legend. Without recorded flows, the steps are placed in their order
 * with no arrows, and the picture says the flow is not recorded.
 */
export function flowPicture(model: ProcessModel, opts: { modes?: Map<string, StepMode>; title?: string } = {}): FlowPicture {
  const graph = modelToGraph(model);
  const noFlows = graph.edges.length === 0;
  // Layout only: with no flows, columns follow the step order; nothing is drawn for these.
  const forLayout: FlowGraph = noFlows ? { ...graph, edges: orderedSteps(model).slice(1).map((s, i, all) => ({ id: `order-${i}`, from: (i === 0 ? orderedSteps(model)[0] : all[i - 1]).id, to: s.id })) } : graph;
  const { boxes, lanes, width: w0, height: h0 } = layout(forLayout);
  const legendH = opts.modes ? 34 : 0;
  const noteH = noFlows && graph.nodes.length ? 22 : 0;
  const width = Math.max(w0 + 20, opts.modes ? 760 : 0), height = h0 + legendH + noteH + 20;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Segoe UI, Calibri, Arial, sans-serif" role="img" aria-label="${esc(opts.title ?? model.meta.name)}">`);
  out.push('<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#334155"/></marker></defs>');
  out.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  // Pool and lanes.
  out.push(`<rect x="0.5" y="0.5" width="${w0 - 0.5}" height="${h0}" fill="none" stroke="#94A3B8"/>`);
  out.push(`<text transform="translate(18 ${h0 / 2}) rotate(-90)" text-anchor="middle" font-size="12" font-weight="600" fill="#0F172A">${esc(wrap(model.meta.name, 40, 1)[0] ?? '')}</text>`);
  for (const [id, b] of lanes) {
    const name = graph.lanes.find(l => l.id === id)?.name ?? 'No role recorded';
    out.push(`<rect x="${b.x + 0.5}" y="${b.y + 0.5}" width="${b.w - 1}" height="${b.h}" fill="${id ? '#ffffff' : '#FFFBEB'}" stroke="#CBD5E1"/>`);
    out.push(`<line x1="${b.x + 30}" y1="${b.y}" x2="${b.x + 30}" y2="${b.y + b.h}" stroke="#CBD5E1"/>`);
    out.push(`<text transform="translate(${b.x + 19} ${b.y + b.h / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="#334155">${esc(wrap(name, Math.max(8, Math.floor(b.h / 7)), 1)[0] ?? '')}</text>`);
  }
  // Flows.
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  let drawn = 0;
  for (const e of graph.edges) {
    const a = boxes.get(e.from), b = boxes.get(e.to);
    if (!a || !b) continue;
    drawn++;
    const flow = model.flows.find(f => f.id === e.id);
    const dash = flow?.isException ? ' stroke-dasharray="5 4"' : '';
    let d: string, lx: number, ly: number;
    if (b.x > a.x + a.w / 2) {
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = Math.round((x1 + x2) / 2);
      d = y1 === y2 ? `M${x1},${y1} H${x2}` : `M${x1},${y1} H${mx} V${y2} H${x2}`;
      lx = mx + 4; ly = (y1 === y2 ? y1 : Math.min(y1, y2) + Math.abs(y2 - y1) / 2) - 4;
    } else {
      // Back or vertical flow: down from the source, across below, up into the target.
      const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y + b.h, low = Math.max(y1, y2) + 14;
      d = `M${x1},${y1} V${low} H${x2} V${y2}`;
      lx = (x1 + x2) / 2; ly = low - 3;
    }
    out.push(`<path d="${d}" fill="none" stroke="#334155" stroke-width="1.3"${dash} marker-end="url(#arrow)"/>`);
    if (e.label) out.push(`<text x="${lx}" y="${ly}" font-size="10" fill="#334155">${esc(wrap(e.label, 18, 1)[0])}</text>`);
  }
  // Shapes.
  for (const n of graph.nodes) {
    const b = boxes.get(n.id)!;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (n.kind === 'start' || n.kind === 'end') {
      out.push(`<circle cx="${cx}" cy="${cy}" r="${b.w / 2}" fill="#ffffff" stroke="#0F172A" stroke-width="${n.kind === 'end' ? 3.5 : 1.5}"/>`);
      wrap(n.label, 16, 2).forEach((l, i) => out.push(`<text x="${cx}" y="${b.y + b.h + 12 + i * 11}" text-anchor="middle" font-size="10" fill="#334155">${esc(l)}</text>`));
    } else if (n.kind === 'gateway') {
      out.push(`<path d="M${cx},${b.y} L${b.x + b.w},${cy} L${cx},${b.y + b.h} L${b.x},${cy} Z" fill="#FFFBEB" stroke="#B45309" stroke-width="1.5"/>`);
      out.push(n.gatewayType === 'parallel'
        ? `<path d="M${cx - 9},${cy} H${cx + 9} M${cx},${cy - 9} V${cy + 9}" stroke="#B45309" stroke-width="3"/>`
        : `<path d="M${cx - 7},${cy - 7} L${cx + 7},${cy + 7} M${cx + 7},${cy - 7} L${cx - 7},${cy + 7}" stroke="#B45309" stroke-width="3"/>`);
      wrap(n.label, 22, 2).forEach((l, i) => out.push(`<text x="${cx}" y="${b.y - 6 - (wrap(n.label, 22, 2).length - 1 - i) * 11}" text-anchor="middle" font-size="10" fill="#334155">${esc(l)}</text>`));
    } else {
      const m = opts.modes?.get(n.id);
      const st = m ? MODE_STYLE[m.mode] : { fill: '#ffffff', stroke: '#334155' };
      out.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5"/>`);
      const lines = wrap(n.label, 17, 4);
      lines.forEach((l, i) => out.push(`<text x="${cx}" y="${cy - (lines.length - 1) * 6.5 + i * 13 + 4}" text-anchor="middle" font-size="11" fill="#0F172A">${esc(l)}</text>`));
      const no = orderedSteps(model).findIndex(s => s.id === n.id) + 1;
      if (no) out.push(`<text x="${b.x + 7}" y="${b.y + 13}" font-size="9" font-weight="700" fill="${st.stroke}">${no}</text>`);
      if (m?.check) out.push(`<circle cx="${b.x + b.w - 9}" cy="${b.y + 9}" r="5" fill="#F59E0B" stroke="#ffffff"><title>A person checks the result</title></circle>`);
    }
  }
  let y = h0 + 16;
  if (noteH) { out.push(`<text x="4" y="${y}" font-size="11" fill="#92400E">The flow between steps is not recorded yet: steps are shown in order, without arrows.</text>`); y += noteH; }
  if (opts.modes) {
    let x = 4;
    const used = new Set([...opts.modes.values()].map(m => m.mode));
    for (const [mode, st] of Object.entries(MODE_STYLE) as [FlowMode, typeof MODE_STYLE[FlowMode]][]) {
      if (!used.has(mode)) continue;
      out.push(`<rect x="${x}" y="${y}" width="14" height="14" rx="3" fill="${st.fill}" stroke="${st.stroke}"/><text x="${x + 19}" y="${y + 11}" font-size="11" fill="#334155">${esc(st.label)}</text>`);
      x += 30 + st.label.length * 6.2;
    }
    if ([...opts.modes.values()].some(m => m.check)) out.push(`<circle cx="${x + 7}" cy="${y + 7}" r="5" fill="#F59E0B"/><text x="${x + 17}" y="${y + 11}" font-size="11" fill="#334155">A person checks the result</text>`);
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
  const lines = ['flowchart LR'];
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
