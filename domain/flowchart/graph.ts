// A flowchart read from a file or an image: lanes, nodes and edges, with the shape ids of the
// source so every element can be cited. It becomes a source for extraction through
// graphToSegments, so flowcharts, transcripts and procedures go through the same pipeline.
import { SegmentBuilder, type IngestSegment } from '../ingest/segment.ts';

export type FlowNodeKind = 'start' | 'end' | 'task' | 'gateway' | 'subprocess';

export interface FlowLane { id: string; name: string }
export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  laneId?: string;
  /** For gateways read from BPMN: exclusive or parallel. */
  gatewayType?: 'exclusive' | 'parallel';
  /** For tasks read from BPMN: the task type. */
  taskType?: 'user' | 'manual' | 'service' | 'business_rule' | 'send' | 'receive';
}
export interface FlowEdge { id: string; from: string; to: string; label?: string }

export interface FlowGraph {
  title?: string;
  lanes: FlowLane[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** True when the graph was read from an image: every element is a reading, not a stated fact. */
  inferred?: boolean;
  warnings: string[];
}

/** Start and end are decided by the edges when the shape does not say (draw.io ellipses). */
export function classifyEvents(graph: FlowGraph, ids: Set<string>): void {
  const incoming = new Set(graph.edges.map(e => e.to));
  const outgoing = new Set(graph.edges.map(e => e.from));
  for (const n of graph.nodes) {
    if (!ids.has(n.id)) continue;
    if (!incoming.has(n.id) && outgoing.has(n.id)) n.kind = 'start';
    else if (incoming.has(n.id) && !outgoing.has(n.id)) n.kind = 'end';
    else { n.kind = 'task'; graph.warnings.push(`Circle "${n.label}" has both incoming and outgoing flows; read as a task.`); }
  }
}

/** Drops edges that point at unknown nodes and nodes that are neither labelled nor connected. */
export function tidy(graph: FlowGraph): FlowGraph {
  const ids = new Set(graph.nodes.map(n => n.id));
  const before = graph.edges.length;
  graph.edges = graph.edges.filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  if (graph.edges.length < before) graph.warnings.push(`${before - graph.edges.length} connector(s) without a shape at both ends were ignored.`);
  const linked = new Set(graph.edges.flatMap(e => [e.from, e.to]));
  graph.nodes = graph.nodes.filter(n => n.label.trim() || linked.has(n.id));
  const laneIds = new Set(graph.lanes.map(l => l.id));
  for (const n of graph.nodes) if (n.laneId && !laneIds.has(n.laneId)) delete n.laneId;
  return graph;
}

const KIND_LABEL: Record<FlowNodeKind, string> = { start: 'Start event', end: 'End event', task: 'Task', gateway: 'Decision', subprocess: 'Subprocess' };

/**
 * One segment per lane, then one per shape. The label is the first line, so it can be quoted on its
 * own; the lane and the connections follow, so extraction sees the structure. The locator carries
 * the shape id and, as the speaker, the lane.
 */
export function graphToSegments(graph: FlowGraph, sourceId: string): IngestSegment[] {
  const b = new SegmentBuilder(sourceId);
  if (graph.title) b.add('heading', graph.title, {}, 1);
  for (const l of graph.lanes) {
    const count = graph.nodes.filter(n => n.laneId === l.id && n.kind !== 'start' && n.kind !== 'end').length;
    b.add('paragraph', `${l.name}\nSwimlane with ${count} task${count === 1 ? '' : 's'} and decision${count === 1 ? '' : 's'}.`, { shapeId: l.id });
  }
  const node = new Map(graph.nodes.map(n => [n.id, n]));
  const lane = new Map(graph.lanes.map(l => [l.id, l.name]));
  const name = (id: string) => node.get(id)?.label.trim() || KIND_LABEL[node.get(id)?.kind ?? 'task'];
  for (const n of orderNodes(graph)) {
    const lines = [n.label.trim() || KIND_LABEL[n.kind]];
    lines.push(`${KIND_LABEL[n.kind]}${n.laneId ? ` in lane ${lane.get(n.laneId)}` : ''}.`);
    const outs = graph.edges.filter(e => e.from === n.id);
    if (outs.length) lines.push(`Next: ${outs.map(e => `${e.label ? `${e.label.trim()} → ` : ''}${name(e.to)}`).join('; ')}.`);
    const loc: { shapeId: string; speaker?: string } = { shapeId: n.id };
    if (n.laneId && lane.get(n.laneId)) loc.speaker = lane.get(n.laneId)!;
    b.add(n.kind === 'gateway' ? 'heading' : 'paragraph', lines.join('\n'), loc);
  }
  return b.segments;
}

/** Nodes in reading order: breadth-first from the start events, then anything not reached. */
export function orderNodes(graph: FlowGraph): FlowNode[] {
  const out: FlowNode[] = [];
  const seen = new Set<string>();
  const queue = graph.nodes.filter(n => n.kind === 'start').map(n => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = graph.nodes.find(x => x.id === id);
    if (n) out.push(n);
    queue.push(...graph.edges.filter(e => e.from === id).map(e => e.to));
  }
  for (const n of graph.nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}

/** A comparable form of a graph: labels, kinds, lanes by name, and edges by labels. */
export function graphSignature(graph: FlowGraph) {
  const lane = new Map(graph.lanes.map(l => [l.id, l.name]));
  const label = new Map(graph.nodes.map(n => [n.id, `${n.kind}:${n.label.trim()}`]));
  return {
    nodes: graph.nodes.map(n => `${n.kind}:${n.label.trim()}@${n.laneId ? lane.get(n.laneId) : ''}`).sort(),
    edges: graph.edges.map(e => `${label.get(e.from)} -> ${label.get(e.to)}${e.label ? ` [${e.label.trim()}]` : ''}`).sort(),
  };
}
