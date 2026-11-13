// BPMN 2.0: export a Process Model (or any flow graph) with a simple lane layout, and import
// BPMN from any modeller. The importer reads elements by local name, so prefixes (bpmn:, bpmn2:,
// semantic:, none) do not matter.
import type { ProcessModel } from '../processModel/types.ts';
import { attr, xmlUnescape } from '../ingest/zip.ts';
import { tidy, type FlowGraph, type FlowNode } from './graph.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlId = (s: string) => (/^[A-Za-z_]/.test(s) ? s : `_${s}`).replace(/[^\w.-]/g, '_');

/** The Process Model as a flow graph: one lane per role that performs a step. */
export function modelToGraph(model: ProcessModel): FlowGraph {
  const graph: FlowGraph = { title: model.meta.name, lanes: [], nodes: [], edges: [], warnings: [] };
  const used = new Set(model.steps.map(s => s.roleIds[0]).filter(Boolean));
  graph.lanes = model.roles.filter(r => used.has(r.id)).map(r => ({ id: r.id, name: r.name }));
  for (const e of model.events) graph.nodes.push({ id: e.id, kind: e.kind, label: e.name });
  for (const s of model.steps) {
    const n: FlowNode = { id: s.id, kind: 'task', label: s.name, taskType: s.taskType };
    if (s.roleIds[0]) n.laneId = s.roleIds[0];
    graph.nodes.push(n);
  }
  for (const g of model.gateways) graph.nodes.push({ id: g.id, kind: 'gateway', label: g.question, gatewayType: g.type });
  graph.edges = model.flows.map(f => ({ id: f.id, from: f.from, to: f.to, ...(f.label ? { label: f.label } : {}) }));
  placeUnlaned(graph);
  return graph;
}

/** Events and gateways sit in the lane of the step before them, or after them. */
function placeUnlaned(graph: FlowGraph): void {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  for (let pass = 0; pass < 3; pass++) {
    for (const n of graph.nodes) {
      // A step's lane is its role: a step with no role is not put in someone else's lane.
      if (n.laneId || n.kind === 'task' || n.kind === 'subprocess') continue;
      const prev = graph.edges.filter(e => e.to === n.id).map(e => byId.get(e.from)?.laneId).find(Boolean);
      const next = graph.edges.filter(e => e.from === n.id).map(e => byId.get(e.to)?.laneId).find(Boolean);
      const lane = n.kind === 'start' ? next ?? prev : prev ?? next;
      if (lane) n.laneId = lane;
    }
  }
}

const SIZE: Record<FlowNode['kind'], [number, number]> = { start: [36, 36], end: [36, 36], gateway: [50, 50], task: [120, 80], subprocess: [120, 80] };
const COL = 170, ROW = 110, LANE_HEADER = 30, POOL_HEADER = 30, PAD = 20;

export interface Box { x: number; y: number; w: number; h: number }

/** Columns by longest path from the start (back edges ignored), rows inside each lane. */
export function layout(graph: FlowGraph): { boxes: Map<string, Box>; lanes: Map<string, Box>; width: number; height: number } {
  const col = new Map<string, number>();
  const starts = graph.nodes.filter(n => n.kind === 'start' || !graph.edges.some(e => e.to === n.id)).map(n => n.id);
  // Depth-first to find back edges, then longest path over the remaining DAG.
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
  for (const s of starts) if (!state.has(s)) visit(s);
  for (const n of graph.nodes) if (!state.has(n.id)) visit(n.id);
  const forward = graph.edges.filter(e => !back.has(e.id));
  for (const n of graph.nodes) col.set(n.id, 0);
  for (let i = 0; i < graph.nodes.length; i++) {
    let changed = false;
    for (const e of forward) {
      const c = (col.get(e.from) ?? 0) + 1;
      if (c > (col.get(e.to) ?? 0)) { col.set(e.to, c); changed = true; }
    }
    if (!changed) break;
  }
  const laneOrder = [...graph.lanes.map(l => l.id), ''];
  const rowsInLane = new Map<string, Map<number, number>>();
  const row = new Map<string, number>();
  for (const n of graph.nodes) {
    const lane = n.laneId ?? '';
    const cols = rowsInLane.get(lane) ?? new Map<number, number>();
    const c = col.get(n.id)!;
    row.set(n.id, cols.get(c) ?? 0);
    cols.set(c, (cols.get(c) ?? 0) + 1);
    rowsInLane.set(lane, cols);
  }
  const lanes = new Map<string, Box>();
  const maxCol = Math.max(0, ...col.values());
  const width = POOL_HEADER + LANE_HEADER + PAD * 2 + (maxCol + 1) * COL;
  let y = 0;
  const laneTop = new Map<string, number>();
  for (const id of laneOrder) {
    const rows = rowsInLane.get(id);
    if (!rows && id === '') continue;
    const h = Math.max(1, ...(rows ? rows.values() : [1])) * ROW + PAD;
    laneTop.set(id, y);
    if (id) lanes.set(id, { x: POOL_HEADER, y, w: width - POOL_HEADER, h });
    else lanes.set('', { x: POOL_HEADER, y, w: width - POOL_HEADER, h });
    y += h;
  }
  const boxes = new Map<string, Box>();
  for (const n of graph.nodes) {
    const [w, h] = SIZE[n.kind];
    const cx = POOL_HEADER + LANE_HEADER + PAD + col.get(n.id)! * COL + COL / 2;
    const cy = laneTop.get(n.laneId ?? '')! + PAD / 2 + row.get(n.id)! * ROW + ROW / 2;
    boxes.set(n.id, { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h });
  }
  return { boxes, lanes, width, height: y };
}

const TASK_TAG: Record<NonNullable<FlowNode['taskType']>, string> = {
  user: 'userTask', manual: 'manualTask', service: 'serviceTask', business_rule: 'businessRuleTask', send: 'sendTask', receive: 'receiveTask',
};

function tagOf(n: FlowNode): string {
  if (n.kind === 'start') return 'startEvent';
  if (n.kind === 'end') return 'endEvent';
  if (n.kind === 'gateway') return n.gatewayType === 'parallel' ? 'parallelGateway' : 'exclusiveGateway';
  if (n.kind === 'subprocess') return 'subProcess';
  return n.taskType ? TASK_TAG[n.taskType] : 'task';
}

/** BPMN 2.0 XML with one pool, a lane per role and a diagram, so modellers open it laid out. */
/** Where things are drawn: shapes, lanes and the pool, with flows' waypoints when known. */
export interface Diagram {
  boxes: Map<string, Box>;
  lanes: Map<string, Box>;
  width: number;
  height: number;
  /** False draws the pool and lanes as columns (top to bottom). */
  horizontal: boolean;
  waypoints?: Map<string, [number, number][]>;
}

export function graphToBpmn(graph: FlowGraph, diagram?: Diagram): string {
  const { boxes, lanes, width, height, horizontal, waypoints } = diagram ?? { ...layout(graph), horizontal: true, waypoints: undefined };
  const id = (s: string) => xmlId(s);
  const proc = 'Process_1';
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">');
  out.push(`  <bpmn:collaboration id="Collaboration_1"><bpmn:participant id="Participant_1" name="${esc(graph.title ?? 'Process')}" processRef="${proc}" /></bpmn:collaboration>`);
  out.push(`  <bpmn:process id="${proc}" isExecutable="false">`);
  const unlaned = graph.nodes.filter(n => !n.laneId);
  if (graph.lanes.length) {
    out.push('    <bpmn:laneSet id="LaneSet_1">');
    for (const l of graph.lanes) {
      const refs = graph.nodes.filter(n => n.laneId === l.id).map(n => `<bpmn:flowNodeRef>${id(n.id)}</bpmn:flowNodeRef>`).join('');
      out.push(`      <bpmn:lane id="${id(l.id)}" name="${esc(l.name)}">${refs}</bpmn:lane>`);
    }
    if (unlaned.length) out.push(`      <bpmn:lane id="Lane_unassigned" name="">${unlaned.map(n => `<bpmn:flowNodeRef>${id(n.id)}</bpmn:flowNodeRef>`).join('')}</bpmn:lane>`);
    out.push('    </bpmn:laneSet>');
  }
  for (const n of graph.nodes) {
    const ins = graph.edges.filter(e => e.to === n.id).map(e => `<bpmn:incoming>${id(e.id)}</bpmn:incoming>`);
    const outs = graph.edges.filter(e => e.from === n.id).map(e => `<bpmn:outgoing>${id(e.id)}</bpmn:outgoing>`);
    out.push(`    <bpmn:${tagOf(n)} id="${id(n.id)}" name="${esc(n.label)}">${[...ins, ...outs].join('')}</bpmn:${tagOf(n)}>`);
  }
  for (const e of graph.edges) {
    out.push(`    <bpmn:sequenceFlow id="${id(e.id)}" sourceRef="${id(e.from)}" targetRef="${id(e.to)}"${e.label ? ` name="${esc(e.label)}"` : ''} />`);
  }
  out.push('  </bpmn:process>');
  out.push('  <bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">');
  out.push(`    <bpmndi:BPMNShape id="Participant_1_di" bpmnElement="Participant_1" isHorizontal="${horizontal}"><dc:Bounds x="0" y="0" width="${width}" height="${height}" /></bpmndi:BPMNShape>`);
  for (const [laneId, b] of lanes) {
    if (!graph.lanes.length) break;
    const lid = laneId ? id(laneId) : 'Lane_unassigned';
    out.push(`    <bpmndi:BPMNShape id="${lid}_di" bpmnElement="${lid}" isHorizontal="${horizontal}"><dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" /></bpmndi:BPMNShape>`);
  }
  for (const n of graph.nodes) {
    const b = boxes.get(n.id)!;
    out.push(`    <bpmndi:BPMNShape id="${id(n.id)}_di" bpmnElement="${id(n.id)}"${n.kind === 'gateway' ? ' isMarkerVisible="true"' : ''}><dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" /></bpmndi:BPMNShape>`);
  }
  for (const e of graph.edges) {
    const a = boxes.get(e.from)!, b = boxes.get(e.to)!;
    const pts = (waypoints?.get(e.id) ?? edgePoints(a, b)).map(([x, y]) => `<di:waypoint x="${Math.round(x)}" y="${Math.round(y)}" />`).join('');
    out.push(`    <bpmndi:BPMNEdge id="${id(e.id)}_di" bpmnElement="${id(e.id)}">${pts}</bpmndi:BPMNEdge>`);
  }
  out.push('  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>');
  out.push('</bpmn:definitions>');
  return out.join('\n');
}

function edgePoints(a: Box, b: Box): [number, number][] {
  const ay = a.y + a.h / 2, by = b.y + b.h / 2;
  if (b.x > a.x + a.w) {
    const sx = a.x + a.w, tx = b.x;
    if (Math.abs(ay - by) < 1) return [[sx, ay], [tx, by]];
    const mx = Math.round((sx + tx) / 2);
    return [[sx, ay], [mx, ay], [mx, by], [tx, by]];
  }
  // Backwards or same column: leave from the bottom, return into the bottom.
  const sx = a.x + a.w / 2, tx = b.x + b.w / 2;
  const low = Math.max(a.y + a.h, b.y + b.h) + 15;
  return [[sx, a.y + a.h], [sx, low], [tx, low], [tx, b.y + b.h]];
}

export function modelToBpmn(model: ProcessModel): string {
  return graphToBpmn(modelToGraph(model));
}

// ---------- import ----------

const NODE_TAGS: Record<string, (n: FlowNode) => void> = {
  startEvent: n => { n.kind = 'start'; },
  endEvent: n => { n.kind = 'end'; },
  task: () => {},
  userTask: n => { n.taskType = 'user'; },
  manualTask: n => { n.taskType = 'manual'; },
  serviceTask: n => { n.taskType = 'service'; },
  scriptTask: n => { n.taskType = 'service'; },
  businessRuleTask: n => { n.taskType = 'business_rule'; },
  sendTask: n => { n.taskType = 'send'; },
  receiveTask: n => { n.taskType = 'receive'; },
  subProcess: n => { n.kind = 'subprocess'; },
  callActivity: n => { n.kind = 'subprocess'; },
  exclusiveGateway: n => { n.kind = 'gateway'; n.gatewayType = 'exclusive'; },
  inclusiveGateway: n => { n.kind = 'gateway'; n.gatewayType = 'exclusive'; },
  eventBasedGateway: n => { n.kind = 'gateway'; n.gatewayType = 'exclusive'; },
  complexGateway: n => { n.kind = 'gateway'; n.gatewayType = 'exclusive'; },
  parallelGateway: n => { n.kind = 'gateway'; n.gatewayType = 'parallel'; },
  intermediateCatchEvent: () => {},
  intermediateThrowEvent: () => {},
  boundaryEvent: () => {},
};

const nameOf = (tag: string) => xmlUnescape(attr(tag, 'name') ?? '').replace(/\s+/g, ' ').trim();

export function parseBpmn(xml: string): FlowGraph {
  const graph: FlowGraph = { lanes: [], nodes: [], edges: [], warnings: [] };
  if (!/<(?:\w+:)?definitions\b/.test(xml)) { graph.warnings.push('Not a BPMN file.'); return graph; }
  const body = xml.replace(/<(?:\w+:)?BPMNDiagram\b[\s\S]*?<\/(?:\w+:)?BPMNDiagram>/g, '');
  const participants = [...body.matchAll(/<(?:\w+:)?participant\b([^>]*)>/g)].map(m => ({ name: nameOf(` ${m[1]}`), process: attr(` ${m[1]}`, 'processRef') ?? '' }));
  if (participants.length === 1 && participants[0].name) graph.title = participants[0].name;
  const processes = [...body.matchAll(/<(?:\w+:)?process\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?process>/g)];
  if (processes.length === 0) graph.warnings.push('The file has no process.');
  for (const [, ptag, content] of processes) {
    const pid = attr(` ${ptag}`, 'id') ?? '';
    // Nodes: any element whose local name is a node type. Its text and children are not needed.
    for (const m of content.matchAll(/<(?:\w+:)?(\w+)\b([^>]*?)\/?>/g)) {
      const local = m[1];
      if (!(local in NODE_TAGS)) continue;
      const tag = ` ${m[2]}`;
      const nid = attr(tag, 'id');
      if (!nid) continue;
      const n: FlowNode = { id: nid, kind: 'task', label: nameOf(tag) };
      NODE_TAGS[local](n);
      graph.nodes.push(n);
      if (local === 'boundaryEvent') {
        const host = attr(tag, 'attachedToRef');
        if (host) graph.edges.push({ id: `${nid}__attached`, from: host, to: nid, ...(n.label ? { label: n.label } : {}) });
      }
    }
    for (const m of content.matchAll(/<(?:\w+:)?sequenceFlow\b([^>]*?)\/?>/g)) {
      const tag = ` ${m[1]}`;
      const eid = attr(tag, 'id'), from = attr(tag, 'sourceRef'), to = attr(tag, 'targetRef');
      if (!eid || !from || !to) continue;
      const label = nameOf(tag);
      graph.edges.push({ id: eid, from, to, ...(label ? { label } : {}) });
    }
    readLanes(content, graph);
    // A pool with no lanes is one lane, so several pools keep their parties apart.
    const pool = participants.find(p => p.process === pid);
    if (!/<(?:\w+:)?lane\b/.test(content) && pool?.name && participants.length > 1) {
      const lid = `pool:${pid}`;
      graph.lanes.push({ id: lid, name: pool.name });
      const ids = new Set([...content.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
      for (const n of graph.nodes) if (ids.has(n.id) && !n.laneId) n.laneId = lid;
    }
  }
  for (const m of body.matchAll(/<(?:\w+:)?messageFlow\b([^>]*?)\/?>/g)) {
    const tag = ` ${m[1]}`;
    const eid = attr(tag, 'id'), from = attr(tag, 'sourceRef'), to = attr(tag, 'targetRef');
    if (eid && from && to) graph.edges.push({ id: eid, from, to, ...(nameOf(tag) ? { label: nameOf(tag) } : {}) });
  }
  return tidy(graph);
}

/** Lanes may nest; a node belongs to its innermost lane, and a lane that only holds lanes is dropped. */
function readLanes(content: string, graph: FlowGraph): void {
  const stack: { id: string; depth: number }[] = [];
  const depthOf = new Map<string, number>();
  const parents = new Set<string>();
  const assigned = new Map<string, { lane: string; depth: number }>();
  for (const m of content.matchAll(/<(\/?)(?:\w+:)?(lane|flowNodeRef)\b([^>]*?)(\/?)>([^<]*)/g)) {
    const [, close, local, rest, selfClose, text] = m;
    if (local === 'lane' && !close) {
      const tag = ` ${rest}`;
      const lid = attr(tag, 'id') ?? `lane${graph.lanes.length}`;
      if (stack.length) parents.add(stack[stack.length - 1].id);
      graph.lanes.push({ id: lid, name: nameOf(tag) });
      depthOf.set(lid, stack.length);
      if (!selfClose) stack.push({ id: lid, depth: stack.length });
    } else if (local === 'lane' && close) {
      stack.pop();
    } else if (local === 'flowNodeRef' && !close && stack.length) {
      const top = stack[stack.length - 1];
      const ref = text.trim();
      const prev = assigned.get(ref);
      if (!prev || top.depth > prev.depth) assigned.set(ref, { lane: top.id, depth: top.depth });
    }
  }
  graph.lanes = graph.lanes.filter(l => !parents.has(l.id) && (l.name || [...assigned.values()].some(a => a.lane === l.id)));
  const keep = new Set(graph.lanes.map(l => l.id));
  for (const n of graph.nodes) {
    const a = assigned.get(n.id);
    if (a && keep.has(a.lane)) n.laneId = a.lane;
  }
  // An unnamed lane we wrote for unassigned nodes is not a lane.
  graph.lanes = graph.lanes.filter(l => l.name || l.id !== 'Lane_unassigned');
  for (const n of graph.nodes) if (n.laneId === 'Lane_unassigned') delete n.laneId;
}
