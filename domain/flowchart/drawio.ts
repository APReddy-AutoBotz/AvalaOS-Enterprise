// draw.io / diagrams.net files: plain or compressed diagrams, swimlanes (including nested pools),
// shapes by style, and connectors with their own or child labels.
import { attr, xmlUnescape } from '../ingest/zip.ts';
import { classifyEvents, tidy, type FlowGraph, type FlowNode } from './graph.ts';

interface Cell { at: number; id: string; value: string; style: string; parent: string; vertex: boolean; edge: boolean; source?: string; target?: string }

/** Visible text of a draw.io label, which may be HTML. */
export function labelText(value: string): string {
  return xmlUnescape(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(div|p|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function inflateRaw(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/** The mxGraphModel of the first page; compressed pages are base64 + deflate + URI-encoded. */
async function firstModel(xml: string, warnings: string[]): Promise<string> {
  const diagrams = [...xml.matchAll(/<diagram\b[^>]*>([\s\S]*?)<\/diagram>/g)];
  if (diagrams.length > 1) warnings.push(`The file has ${diagrams.length} pages; only the first was read.`);
  const content = diagrams.length ? diagrams[0][1].trim() : xml;
  if (content.startsWith('<') || content.includes('<mxGraphModel')) return content;
  const bin = Uint8Array.from(atob(content), c => c.charCodeAt(0));
  return decodeURIComponent(await inflateRaw(bin));
}

export async function parseDrawio(xml: string): Promise<FlowGraph> {
  const warnings: string[] = [];
  const model = await firstModel(xml, warnings);
  const cells: Cell[] = [];
  for (const m of model.matchAll(/<mxCell\b([^>]*?)(\/>|>)/g)) {
    const tag = ` ${m[1]}`;
    const id = attr(tag, 'id');
    if (!id) continue;
    cells.push({
      at: m.index ?? 0, id, value: attr(tag, 'value') ?? '', style: attr(tag, 'style') ?? '', parent: attr(tag, 'parent') ?? '',
      vertex: attr(tag, 'vertex') === '1', edge: attr(tag, 'edge') === '1', source: attr(tag, 'source'), target: attr(tag, 'target'),
    });
  }
  // draw.io also saves cells as <UserObject label="..."><mxCell .../></UserObject>
  for (const m of model.matchAll(/<(?:UserObject|object)\b([^>]*)>\s*<mxCell\b([^>]*?)(\/>|>)/g)) {
    const outer = ` ${m[1]}`, inner = ` ${m[2]}`;
    const id = attr(outer, 'id');
    if (!id || cells.some(c => c.id === id)) continue;
    cells.push({
      at: m.index ?? 0, id, value: attr(outer, 'label') ?? '', style: attr(inner, 'style') ?? '', parent: attr(inner, 'parent') ?? '',
      vertex: attr(inner, 'vertex') === '1', edge: attr(inner, 'edge') === '1', source: attr(inner, 'source'), target: attr(inner, 'target'),
    });
  }
  cells.sort((a, b) => a.at - b.at);
  const byId = new Map(cells.map(c => [c.id, c]));
  const styleOf = (c: Cell) => c.style.split(';')[0];
  const has = (c: Cell, key: string) => new RegExp(`(^|;)${key}(=|;|$)`).test(c.style);
  const isLane = (c: Cell) => c.vertex && (has(c, 'swimlane') || styleOf(c) === 'swimlane' || has(c, 'shape=swimlane') || has(c, 'shape=pool'));
  const isText = (c: Cell) => styleOf(c) === 'text' || has(c, 'text') || has(c, 'edgeLabel') || has(c, 'shape=note') || has(c, 'shape=callout');

  const graph: FlowGraph = { lanes: [], nodes: [], edges: [], warnings };
  const title = cells.find(c => c.vertex && styleOf(c) === 'text' && c.parent === '1');
  if (title) graph.title = labelText(title.value);

  // Lanes: the innermost swimlane is the lane; a lane inside a pool keeps its own name.
  for (const c of cells) if (isLane(c)) graph.lanes.push({ id: c.id, name: labelText(c.value) || 'Lane' });
  const laneIds = new Set(graph.lanes.map(l => l.id));
  const laneOf = (c: Cell): string | undefined => {
    for (let p = byId.get(c.parent), guard = 0; p && guard < 20; p = byId.get(p.parent), guard++) if (laneIds.has(p.id)) return p.id;
    return undefined;
  };
  // A pool that only contains lanes is not a lane itself.
  for (const l of [...graph.lanes]) {
    const children = cells.filter(c => c.parent === l.id);
    if (children.length && children.every(c => laneIds.has(c.id))) graph.lanes = graph.lanes.filter(x => x.id !== l.id);
  }

  const circles = new Set<string>();
  for (const c of cells) {
    if (!c.vertex || isLane(c) || isText(c)) continue;
    const label = labelText(c.value);
    let kind: FlowNode['kind'] = 'task';
    if (has(c, 'rhombus') || has(c, 'shape=rhombus')) kind = 'gateway';
    else if (has(c, 'ellipse') || has(c, 'shape=ellipse') || has(c, 'shape=mxgraph.bpmn.event')) { kind = 'task'; circles.add(c.id); }
    else if (has(c, 'shape=process') || has(c, 'shape=mxgraph.flowchart.predefined_process')) kind = 'subprocess';
    const node: FlowNode = { id: c.id, kind, label };
    const lane = laneOf(c);
    if (lane) node.laneId = lane;
    graph.nodes.push(node);
  }
  for (const c of cells) {
    if (!c.edge || !c.source || !c.target) continue;
    const childLabel = cells.filter(x => x.parent === c.id && x.vertex).map(x => labelText(x.value)).filter(Boolean).join(' ');
    const label = labelText(c.value) || childLabel;
    graph.edges.push({ id: c.id, from: c.source, to: c.target, ...(label ? { label } : {}) });
  }
  tidy(graph);
  classifyEvents(graph, circles);
  return graph;
}
