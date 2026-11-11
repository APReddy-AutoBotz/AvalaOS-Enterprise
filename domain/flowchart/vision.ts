// Reading a flowchart from an image. The AI reports the shapes, lanes and connectors it sees; the
// result becomes a FlowGraph marked inferred, so every element it supports is "inferred", never
// "stated", until someone confirms it.
import type { TaskDefinition } from '../ai/gateway.ts';
import { tidy, type FlowGraph, type FlowNode } from './graph.ts';

const str = { type: 'string' } as const;
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const readFlowchart: TaskDefinition = {
  id: 'readFlowchart',
  input: 'image',
  schemaName: 'flowchart_reading',
  instructions: [
    'Give the diagram title if one is written, else an empty string.',
    'List the swimlanes (pools or lanes) with the name written on each, top to bottom or left to right. No lanes: an empty list.',
    'List every shape: start and end events (circles), tasks (boxes), decisions (diamonds) and subprocesses. Give each a short id of your own (n1, n2, ...), its kind, its label exactly as written, and the name of the lane it sits in ("" if none).',
    'Read a circle as "start" when it only has outgoing arrows and "end" when it only has incoming arrows.',
    'List every arrow with the ids of the shapes it connects, in the direction of the arrowhead, and its label exactly as written ("" if none).',
    'List anything you could not read in "unreadable".',
  ].join('\n'),
  schema: obj({
    title: str,
    lanes: { type: 'array', items: str },
    nodes: { type: 'array', items: obj({ id: str, kind: { type: 'string', enum: ['start', 'end', 'task', 'gateway', 'subprocess'] }, label: str, lane: str }) },
    edges: { type: 'array', items: obj({ from: str, to: str, label: str }) },
    unreadable: { type: 'array', items: str },
  }),
  maxOutputTokens: 12000,
  verifyArrays: [],
  reasoningEffort: 'low',
};

export interface FlowchartReading {
  title: string;
  lanes: string[];
  nodes: { id: string; kind: FlowNode['kind']; label: string; lane: string }[];
  edges: { from: string; to: string; label: string }[];
  unreadable: string[];
}

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const safeId = (s: string) => s.replace(/[^\w.-]/g, '_').slice(0, 40) || 'x';

/** The AI's reading as a flow graph. Lanes are matched by name; unknown kinds read as tasks. */
export function readingToGraph(data: unknown): FlowGraph {
  const r = (data ?? {}) as Partial<FlowchartReading>;
  const graph: FlowGraph = { lanes: [], nodes: [], edges: [], warnings: [], inferred: true };
  if (clean(r.title)) graph.title = clean(r.title);
  const laneByName = new Map<string, string>();
  for (const name of r.lanes ?? []) {
    const n = clean(name);
    if (!n || laneByName.has(n.toLowerCase())) continue;
    const id = `lane-${graph.lanes.length + 1}`;
    laneByName.set(n.toLowerCase(), id);
    graph.lanes.push({ id, name: n });
  }
  const ids = new Map<string, string>();
  for (const raw of r.nodes ?? []) {
    const key = clean(raw.id);
    if (!key || ids.has(key)) continue;
    const id = `img-${safeId(key)}`;
    ids.set(key, id);
    const kind: FlowNode['kind'] = ['start', 'end', 'task', 'gateway', 'subprocess'].includes(raw.kind) ? raw.kind : 'task';
    const node: FlowNode = { id, kind, label: clean(raw.label) };
    const lane = laneByName.get(clean(raw.lane).toLowerCase());
    if (lane) node.laneId = lane;
    graph.nodes.push(node);
  }
  (r.edges ?? []).forEach((e, i) => {
    const from = ids.get(clean(e.from)), to = ids.get(clean(e.to));
    if (!from || !to) { graph.warnings.push(`An arrow between unknown shapes (${clean(e.from)} → ${clean(e.to)}) was ignored.`); return; }
    graph.edges.push({ id: `img-e${i + 1}`, from, to, ...(clean(e.label) ? { label: clean(e.label) } : {}) });
  });
  for (const u of r.unreadable ?? []) if (clean(u)) graph.warnings.push(`Could not be read: ${clean(u)}`);
  return tidy(graph);
}
