import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDrawio, labelText } from './drawio.ts';
import { modelToBpmn, modelToGraph, parseBpmn, graphToBpmn } from './bpmn.ts';
import { graphSignature, graphToSegments, type FlowGraph } from './graph.ts';
import { readingToGraph, readFlowchart } from './vision.ts';
import { parseFile } from '../ingest/parsers/index.ts';
import { downgradeInferred } from '../extract/assemble.ts';
import { validateRequest } from '../ai/gateway.ts';
import { TASKS } from '../ai/tasks.ts';
import type { ProcessModel } from '../processModel/types.ts';

const corpusDir = new URL('../../eval/corpus/ap-invoice/', import.meta.url);
const drawioXml = readFileSync(new URL('sources/05-AP-Invoice-AsIs.drawio', corpusDir), 'utf8');
const gold: ProcessModel = JSON.parse(readFileSync(new URL('expected.model.json', corpusDir), 'utf8'));

const laneName = (g: FlowGraph, id: string) => g.lanes.find(l => l.id === g.nodes.find(n => n.id === id)?.laneId)?.name;

test('the draw.io As-Is flowchart imports with its lanes, shapes and connectors', async () => {
  const g = await parseDrawio(drawioXml);
  assert.deepEqual(g.lanes.map(l => l.name), ['Vendor', 'AP Clerk', 'AP Team Lead', 'SAP S/4HANA', 'Requester / Stores', 'Buyer (Procurement)', 'Cost Centre Owner / DoA approver']);
  assert.equal(g.nodes.length, 38);
  assert.equal(g.edges.length, 42);
  assert.deepEqual(g.warnings, []);
  assert.match(g.title ?? '', /^AP Invoice Processing - As-Is/);
  const kind = (id: string) => g.nodes.find(n => n.id === id)?.kind;
  assert.equal(kind('e-start'), 'start');
  assert.equal(kind('e-posted'), 'end');
  assert.equal(kind('g-paper'), 'gateway');
  assert.equal(kind('t-scan'), 'task');
  assert.equal(laneName(g, 't-scan'), 'AP Clerk');
  assert.equal(laneName(g, 't-gr'), 'Requester / Stores');
  assert.equal(laneName(g, 't-review'), 'AP Team Lead');
  const yes = g.edges.find(e => e.from === 'g-paper' && e.to === 't-scan');
  assert.equal(yes?.label, 'Yes');
});

test('every flowchart quote in the gold is the first line of the segment for its shape', async () => {
  const segs = graphToSegments(await parseDrawio(drawioXml), 'flow');
  const byShape = new Map(segs.map(s => [s.locator.shapeId, s]));
  const refs = [...gold.steps, ...gold.gateways, ...gold.events, ...gold.roles].flatMap(e => e.sources).filter(r => r.sourceId === 'flow');
  assert.ok(refs.length > 30);
  for (const r of refs) {
    const seg = byShape.get(r.locator.shapeId);
    assert.ok(seg, `no segment for ${r.locator.shapeId}`);
    assert.ok(seg.text.includes(r.excerpt), `${r.locator.shapeId}: "${r.excerpt}" not in "${seg.text}"`);
  }
  // Lanes are speakers, so a step's role can be cited from the flowchart.
  assert.equal(byShape.get('t-scan')?.locator.speaker, 'AP Clerk');
  assert.match(byShape.get('g-paper')!.text, /^Paper invoice\?\nDecision in lane AP Clerk\.\nNext: .*Yes → Scan paper invoice to mailbox/);
});

async function compress(model: string): Promise<string> {
  const stream = new Blob([encodeURIComponent(model)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return btoa(String.fromCharCode(...bytes));
}

test('a compressed draw.io page reads the same as the plain one', async () => {
  const model = /<mxGraphModel[\s\S]*<\/mxGraphModel>/.exec(drawioXml)![0];
  const packed = `<mxfile><diagram id="p1" name="Page-1">${await compress(model)}</diagram></mxfile>`;
  assert.deepEqual(graphSignature(await parseDrawio(packed)), graphSignature(await parseDrawio(drawioXml)));
});

test('draw.io HTML labels, UserObject cells, pools and dangling connectors', async () => {
  const xml = `<mxfile><diagram id="d"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="pool" value="Company" style="swimlane;html=1;" vertex="1" parent="1"/>
    <mxCell id="lane" value="&lt;b&gt;Clerk&lt;/b&gt;" style="swimlane;html=1;" vertex="1" parent="pool"/>
    <mxCell id="s" value="" style="ellipse;" vertex="1" parent="lane"/>
    <UserObject label="Check &lt;br&gt;invoice" id="t"><mxCell style="rounded=1;html=1;" vertex="1" parent="lane"/></UserObject>
    <mxCell id="e" value="Done" style="ellipse;" vertex="1" parent="lane"/>
    <mxCell id="a" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="s" target="t"/>
    <mxCell id="b" value="" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="t" target="e"/>
    <mxCell id="bl" value="ok" style="edgeLabel;" vertex="1" parent="b"/>
    <mxCell id="c" style="" edge="1" parent="1" source="t"/>
    <mxCell id="d2" style="" edge="1" parent="1" source="t" target="missing"/>
  </root></mxGraphModel></diagram></mxfile>`;
  const g = await parseDrawio(xml);
  assert.deepEqual(g.lanes.map(l => l.name), ['Clerk']);
  assert.deepEqual(g.nodes.map(n => [n.id, n.kind, n.label, n.laneId]), [['s', 'start', '', 'lane'], ['t', 'task', 'Check invoice', 'lane'], ['e', 'end', 'Done', 'lane']]);
  assert.deepEqual(g.edges.map(e => [e.from, e.to, e.label]), [['s', 't', undefined], ['t', 'e', 'ok']]);
  assert.equal(g.warnings.length, 1);
  assert.equal(labelText('A&amp;nbsp;&lt;i&gt;b&lt;/i&gt;'), 'A b');
});

test('a Process Model exports to BPMN and imports back to the same graph', () => {
  const xml = modelToBpmn(gold);
  assert.match(xml, /<bpmndi:BPMNDiagram/);
  assert.equal((xml.match(/<bpmndi:BPMNShape /g) ?? []).length, 1 + new Set(modelToGraph(gold).nodes.map(n => n.laneId).filter(Boolean)).size + gold.steps.length + gold.gateways.length + gold.events.length);
  assert.equal((xml.match(/<bpmndi:BPMNEdge /g) ?? []).length, gold.flows.length);
  const back = parseBpmn(xml);
  assert.deepEqual(graphSignature(back), graphSignature(modelToGraph(gold)));
  assert.deepEqual(back.warnings, []);
  // Task types survive.
  const scan = gold.steps.find(s => s.taskType === 'service');
  if (scan) assert.equal(back.nodes.find(n => n.label === scan.name)?.taskType, 'service');
});

test('the draw.io flowchart round-trips through BPMN', async () => {
  const g = await parseDrawio(drawioXml);
  assert.deepEqual(graphSignature(parseBpmn(graphToBpmn(g))), graphSignature(g));
});

test('BPMN import ignores prefixes and reads nested lanes, pools and boundary events', () => {
  const xml = `<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
    <collaboration><participant id="P1" name="Buyer" processRef="p1"/><participant id="P2" name="Supplier" processRef="p2"/>
      <messageFlow id="m1" sourceRef="send" targetRef="recv" name="Order"/></collaboration>
    <process id="p1"><laneSet><lane id="outer" name="Company"><flowNodeRef>s</flowNodeRef><flowNodeRef>send</flowNodeRef>
      <childLaneSet><lane id="inner" name="Purchasing"><flowNodeRef>s</flowNodeRef><flowNodeRef>send</flowNodeRef></lane></childLaneSet></lane></laneSet>
      <startEvent id="s" name="Need"/><sendTask id="send" name="Send order"/><sequenceFlow id="f1" sourceRef="s" targetRef="send"/>
      <boundaryEvent id="late" name="3 days" attachedToRef="send"/></process>
    <process id="p2"><receiveTask id="recv" name="Receive order"/><endEvent id="end"/><sequenceFlow id="f2" sourceRef="recv" targetRef="end"/></process>
  </definitions>`;
  const g = parseBpmn(xml);
  assert.deepEqual(g.lanes.map(l => l.name), ['Purchasing', 'Supplier']);
  assert.equal(laneName(g, 'send'), 'Purchasing');
  assert.equal(laneName(g, 'recv'), 'Supplier');
  assert.equal(g.nodes.find(n => n.id === 'send')?.taskType, 'send');
  assert.deepEqual(g.edges.map(e => `${e.from}>${e.to}`).sort(), ['recv>end', 's>send', 'send>late', 'send>recv'].sort());
  const prefixed = parseBpmn(xml.replace(/<(\/?)(?!\?)/g, '<$1semantic:').replace('<semantic:definitions xmlns=', '<semantic:definitions xmlns:semantic='));
  assert.deepEqual(graphSignature(prefixed), graphSignature(g));
  assert.deepEqual(parseBpmn('<html/>').warnings, ['Not a BPMN file.']);
});

test('a flowchart read from an image is a graph marked inferred', () => {
  const g = readingToGraph({
    title: 'AP',
    lanes: ['AP Clerk', 'ap clerk', 'SAP'],
    nodes: [
      { id: 'n1', kind: 'start', label: 'Invoice sent', lane: 'AP Clerk' },
      { id: 'n2', kind: 'task', label: ' Check  fields ', lane: 'AP CLERK' },
      { id: 'n3', kind: 'weird', label: 'Match', lane: 'Nowhere' },
    ],
    edges: [{ from: 'n1', to: 'n2', label: '' }, { from: 'n2', to: 'n3', label: 'ok' }, { from: 'n3', to: 'n9', label: '' }],
    unreadable: ['bottom right corner'],
  });
  assert.equal(g.inferred, true);
  assert.deepEqual(g.lanes.map(l => l.name), ['AP Clerk', 'SAP']);
  assert.deepEqual(g.nodes.map(n => [n.kind, n.label, n.laneId]), [['start', 'Invoice sent', 'lane-1'], ['task', 'Check fields', 'lane-1'], ['task', 'Match', undefined]]);
  assert.equal(g.edges.length, 2);
  assert.equal(g.warnings.length, 2);
  assert.equal(readFlowchart.input, 'image');
});

test('elements supported only by image sources are downgraded to inferred', () => {
  const m = structuredClone(gold);
  const step = m.steps[0];
  step.status = 'stated';
  step.sources = [{ sourceId: 'img', locator: {}, excerpt: 'x' }];
  const other = m.steps[1];
  other.status = 'stated';
  other.sources = [{ sourceId: 'img', locator: {}, excerpt: 'x' }, { sourceId: 'sop', locator: {}, excerpt: 'y' }];
  downgradeInferred(m, new Set(['img']));
  assert.equal(step.status, 'inferred');
  assert.equal(other.status, 'stated');
});

test('parseFile reads draw.io and BPMN files and routes images to the vision task', async () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const d = await parseFile({ name: 'as-is.drawio', bytes: enc(drawioXml), sourceId: 'flow' });
  assert.equal(d.status, 'ok');
  if (d.status === 'ok') { assert.equal(d.format, 'drawio'); assert.equal(d.segments.length, 1 + 7 + 38); }
  const b = await parseFile({ name: 'export.xml', bytes: enc(modelToBpmn(gold)), sourceId: 'bpmn' });
  assert.equal(b.status, 'ok');
  if (b.status === 'ok') assert.equal(b.format, 'bpmn');
  const png = new Uint8Array(readFileSync(new URL('sources/06-AP-Invoice-AsIs.png', corpusDir)));
  assert.equal((await parseFile({ name: 'flow.png', bytes: png, sourceId: 'img' })).status, 'needs_vision');
});

test('the gateway accepts an image only for image tasks', () => {
  const ws = '00000000-0000-4000-8000-000000000000';
  const img = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(validateRequest({ workspaceId: ws, task: 'readFlowchart', image: img }, TASKS).ok, true);
  assert.equal(validateRequest({ workspaceId: ws, task: 'readFlowchart', image: 'http://x/y.png' }, TASKS).code, 'INVALID_REQUEST');
  assert.equal(validateRequest({ workspaceId: ws, task: 'readFlowchart', image: `data:image/png;base64,${'A'.repeat(10_000_001)}` }, TASKS).code, 'TOO_LARGE');
  assert.equal(validateRequest({ workspaceId: ws, task: 'participants', image: img }, TASKS).code, 'INVALID_REQUEST');
});
