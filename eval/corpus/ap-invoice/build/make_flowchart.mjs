// Builds the As-Is swimlane flowchart for the AP invoice eval case from one graph definition:
//   AP-Invoice-AsIs.drawio  (editable in draw.io / diagrams.net, importable into Visio via draw.io)
//   AP-Invoice-AsIs.png     (the same picture as an image, for image-based ingestion)
//
// Run: node make_flowchart.mjs <outDir>   (PNG output needs the `sharp` package)
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] ?? '.';
const LABEL_W = 40, X0 = 70, COL = 140, TASK_W = 118, TASK_H = 58, GW = 78, EV = 30;

const lanes = [
  { id: 'lane-vendor', name: 'Vendor', h: 120 },
  { id: 'lane-clerk', name: 'AP Clerk', h: 240 },
  { id: 'lane-lead', name: 'AP Team Lead', h: 120 },
  { id: 'lane-sap', name: 'SAP S/4HANA', h: 120 },
  { id: 'lane-stores', name: 'Requester / Stores', h: 120 },
  { id: 'lane-buyer', name: 'Buyer (Procurement)', h: 230 },
  { id: 'lane-approver', name: 'Cost Centre Owner / DoA approver', h: 120 },
];
let y = 50;
for (const l of lanes) { l.y = y; y += l.h; }
const laneById = Object.fromEntries(lanes.map(l => [l.id, l]));

// kind: start | end | task | gw ; row: 0 or 1 inside two-row lanes
const N = (id, lane, col, kind, label, row = 0) => ({ id, lane, col, kind, label, row });
const nodes = [
  N('e-start', 'lane-vendor', 0, 'start', 'Invoice sent'),
  N('g-paper', 'lane-clerk', 1, 'gw', 'Paper invoice?'),
  N('t-scan', 'lane-clerk', 1, 'task', 'Scan paper invoice to mailbox', 1),
  N('t-log', 'lane-clerk', 2, 'task', 'Save PDF to SharePoint and log in AP tracker'),
  N('t-check', 'lane-clerk', 3, 'task', 'Check mandatory fields'),
  N('g-complete', 'lane-clerk', 4, 'gw', 'Complete and correct?'),
  N('t-return', 'lane-clerk', 4, 'task', 'Return invoice to vendor (AP-T01)', 1),
  N('e-returned', 'lane-vendor', 4, 'end', 'Invoice returned'),
  N('t-vendor', 'lane-clerk', 5, 'task', 'Validate vendor and GSTIN in SAP'),
  N('g-bank', 'lane-clerk', 6, 'gw', 'Bank details match master?'),
  N('t-ticket', 'lane-clerk', 6, 'task', 'Raise ServiceNow request and hold invoice', 1),
  N('e-hold', 'lane-clerk', 7, 'end', 'On hold: vendor master', 1),
  N('t-dup', 'lane-clerk', 7, 'task', 'Search SAP and tracker for duplicates'),
  N('g-dup', 'lane-clerk', 8, 'gw', 'Duplicate?'),
  N('e-dup', 'lane-clerk', 8, 'end', 'Not posted: duplicate', 1),
  N('g-po', 'lane-clerk', 9, 'gw', 'PO invoice?'),
  N('t-approval-request', 'lane-clerk', 9, 'task', 'Email invoice to approver(s) per DoA', 1),
  N('t-approve', 'lane-approver', 9, 'task', 'Review and approve invoice'),
  N('g-approved', 'lane-approver', 10, 'gw', 'Approved?'),
  N('e-rejected', 'lane-approver', 11, 'end', 'Rejected'),
  N('t-fb60', 'lane-clerk', 10, 'task', 'Enter non-PO invoice in FB60', 1),
  N('t-miro', 'lane-clerk', 10, 'task', 'Enter invoice against PO (MIRO)'),
  N('g-gr', 'lane-sap', 11, 'gw', 'GR posted?'),
  N('t-park-gr', 'lane-clerk', 11, 'task', 'Park invoice (MIR7) and request GR', 1),
  N('t-gr', 'lane-stores', 11, 'task', 'Post goods receipt (MIGO)'),
  N('t-match', 'lane-sap', 12, 'task', 'Three-way match: PO, GR, invoice'),
  N('g-tolerance', 'lane-sap', 13, 'gw', 'Within tolerance?'),
  N('t-park-var', 'lane-clerk', 13, 'task', 'Park invoice and refer variance to buyer', 1),
  N('t-investigate', 'lane-buyer', 13, 'task', 'Investigate price or quantity variance'),
  N('g-po-wrong', 'lane-buyer', 14, 'gw', 'PO price wrong?'),
  N('t-amend', 'lane-buyer', 15, 'task', 'Amend PO (ME22N)'),
  N('t-credit', 'lane-buyer', 14, 'task', 'Request credit note or revised invoice', 1),
  N('e-credit', 'lane-buyer', 15, 'end', 'On hold: awaiting credit note', 1),
  N('g-amount', 'lane-clerk', 14, 'gw', 'Amount >= INR 5,00,000?'),
  N('t-review', 'lane-lead', 14, 'task', 'Review invoice before posting (four-eyes)'),
  N('t-post', 'lane-clerk', 15, 'task', 'Post invoice and attach PDF in SAP'),
  N('t-close', 'lane-clerk', 16, 'task', 'Update AP tracker to Posted'),
  N('e-posted', 'lane-clerk', 17, 'end', 'Invoice posted'),
];
const byId = Object.fromEntries(nodes.map(n => [n.id, n]));

// exit/entry sides: r l t b ; pts: explicit absolute waypoints for the SVG renderer
const E = (id, from, to, label = '', opt = {}) => ({ id, from, to, label, ...opt });
const edges = [
  E('f-01', 'e-start', 'g-paper', '', { exit: 'r', entry: 't' }),
  E('f-02', 'g-paper', 't-log', 'No'),
  E('f-03', 'g-paper', 't-scan', 'Yes', { exit: 'b', entry: 't' }),
  E('f-04', 't-scan', 't-log', '', { exit: 'r', entry: 'b' }),
  E('f-05', 't-log', 't-check'),
  E('f-06', 't-check', 'g-complete'),
  E('f-07', 'g-complete', 't-vendor', 'Yes'),
  E('f-08', 'g-complete', 't-return', 'No', { exit: 'b', entry: 't' }),
  E('f-09', 't-return', 'e-returned', '', { exit: 'l', entry: 'l', pts: 'returned' }),
  E('f-10', 't-vendor', 'g-bank'),
  E('f-11', 'g-bank', 't-dup', 'Yes'),
  E('f-12', 'g-bank', 't-ticket', 'No', { exit: 'b', entry: 't' }),
  E('f-13', 't-ticket', 'e-hold'),
  E('f-14', 't-dup', 'g-dup'),
  E('f-15', 'g-dup', 'e-dup', 'Yes', { exit: 'b', entry: 't' }),
  E('f-16', 'g-dup', 'g-po', 'No'),
  E('f-17', 'g-po', 't-miro', 'Yes'),
  E('f-18', 'g-po', 't-approval-request', 'No', { exit: 'b', entry: 't' }),
  E('f-19', 't-approval-request', 't-approve', '', { exit: 'b', entry: 't' }),
  E('f-20', 't-approve', 'g-approved'),
  E('f-21', 'g-approved', 'e-rejected', 'No'),
  E('f-22', 'g-approved', 't-fb60', 'Yes', { exit: 't', entry: 'b' }),
  E('f-23', 't-fb60', 'g-amount', '', { exit: 'r', entry: 'l', pts: 'fb60' }),
  E('f-24', 't-miro', 'g-gr', '', { exit: 'r', entry: 'l', pts: 'miro' }),
  E('f-25', 'g-gr', 't-match', 'Yes'),
  E('f-26', 'g-gr', 't-park-gr', 'No', { exit: 't', entry: 'b' }),
  E('f-27', 't-park-gr', 't-gr', '', { exit: 'r', entry: 't', pts: 'parkgr' }),
  E('f-28', 't-gr', 't-match', '', { exit: 'r', entry: 'b' }),
  E('f-29', 't-match', 'g-tolerance'),
  E('f-30', 'g-tolerance', 'g-amount', 'Yes', { exit: 'r', entry: 'l', pts: 'tolyes' }),
  E('f-31', 'g-tolerance', 't-park-var', 'No', { exit: 't', entry: 'b' }),
  E('f-32', 't-park-var', 't-investigate', '', { exit: 'r', entry: 't', pts: 'parkvar' }),
  E('f-33', 't-investigate', 'g-po-wrong'),
  E('f-34', 'g-po-wrong', 't-amend', 'Yes'),
  E('f-35', 't-amend', 't-match', '', { exit: 't', entry: 't', pts: 'amend' }),
  E('f-36', 'g-po-wrong', 't-credit', 'No', { exit: 'b', entry: 't' }),
  E('f-37', 't-credit', 'e-credit'),
  E('f-38', 'g-amount', 't-post', 'No'),
  E('f-39', 'g-amount', 't-review', 'Yes', { exit: 'b', entry: 't', pts: 'review' }),
  E('f-40', 't-review', 't-post', '', { exit: 'r', entry: 'b', pts: 'reviewpost' }),
  E('f-41', 't-post', 't-close'),
  E('f-42', 't-close', 'e-posted'),
];

// ---- geometry -------------------------------------------------------------
const size = n => n.kind === 'task' ? [TASK_W, TASK_H] : n.kind === 'gw' ? [GW, GW] : [EV, EV];
function center(n) {
  const l = laneById[n.lane];
  const cx = X0 + LABEL_W + n.col * COL + COL / 2;
  const twoRow = l.h > 200;
  const cy = l.y + (twoRow ? (n.row === 0 ? 62 : 172) : l.h / 2);
  return [cx, cy];
}
function port(n, side) {
  const [cx, cy] = center(n), [w, h] = size(n);
  return { r: [cx + w / 2, cy], l: [cx - w / 2, cy], t: [cx, cy - h / 2], b: [cx, cy + h / 2] }[side];
}
const laneOf = id => laneById[byId[id].lane];
// Hand-set routes for edges that would otherwise cross shapes.
function route(e) {
  const a = byId[e.from], b = byId[e.to];
  const exit = e.exit ?? 'r', entry = e.entry ?? 'l';
  const p0 = port(a, exit), p1 = port(b, entry);
  const clerk = laneById['lane-clerk'];
  switch (e.pts) {
    case 'miro': return [p0, [p1[0] - 31, p0[1]], [p1[0] - 31, p1[1]], p1];
    case 'returned': return [p0, [p0[0] - 11, p0[1]], [p0[0] - 11, p1[1]], p1];
    case 'fb60': return [p0, [p0[0] + 12, p0[1]], [p0[0] + 12, clerk.y + 222], [p1[0] - 22, clerk.y + 222], [p1[0] - 22, p1[1]], p1];
    case 'parkgr': return [p0, [p1[0] + 52, p0[1]], [p1[0] + 52, laneOf('t-gr').y + 18], [p1[0], laneOf('t-gr').y + 18], p1];
    case 'tolyes': return [p0, [p0[0] + 22, p0[1]], [p0[0] + 22, p1[1]], p1];
    case 'parkvar': return [p0, [p0[0] + 10, p0[1]], [p0[0] + 10, laneOf('t-investigate').y + 14], [p1[0], laneOf('t-investigate').y + 14], p1];
    case 'amend': { const yy = laneOf('t-amend').y + 12; const x = port(b, 'b'); return [p0, [p0[0], yy], [x[0] + 30, yy], [x[0] + 30, x[1] + 8], [x[0] + 30, x[1]]]; }
    case 'review': return [p0, port(byId['t-review'], 't')];
    case 'reviewpost': { const x = port(b, 'b'); return [p0, [p0[0] + 26, p0[1]], [p0[0] + 26, clerk.y + 130], [x[0], clerk.y + 130], x]; }
  }
  if (exit === 'r' && entry === 'l') {
    if (p0[1] === p1[1]) return [p0, p1];
    const mx = (p0[0] + p1[0]) / 2; return [p0, [mx, p0[1]], [mx, p1[1]], p1];
  }
  if ((exit === 'b' || exit === 't') && (entry === 't' || entry === 'b')) {
    if (p0[0] === p1[0]) return [p0, p1];
    const my = (p0[1] + p1[1]) / 2; return [p0, [p0[0], my], [p1[0], my], p1];
  }
  if (exit === 'r' && (entry === 't' || entry === 'b')) return [p0, [p1[0], p0[1]], p1];
  if ((exit === 't' || exit === 'b') && entry === 'l') return [p0, [p0[0], p1[1]], p1];
  return [p0, p1];
}

const width = X0 + LABEL_W + 18 * COL + 30;
const height = y + 30;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- draw.io --------------------------------------------------------------
const LANE_STYLE = 'swimlane;horizontal=0;whiteSpace=wrap;html=1;startSize=40;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;swimlaneFillColor=#ffffff;';
const STYLE = {
  task: 'rounded=1;whiteSpace=wrap;html=1;arcSize=14;fillColor=#ffffff;strokeColor=#333333;fontSize=11;',
  gw: 'rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=10;',
  start: 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#d5e8d4;strokeColor=#82b366;verticalLabelPosition=bottom;verticalAlign=top;fontSize=10;',
  end: 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#f8cecc;strokeColor=#b85450;strokeWidth=3;verticalLabelPosition=bottom;verticalAlign=top;fontSize=10;',
};
const SIDE = { r: [1, 0.5], l: [0, 0.5], t: [0.5, 0], b: [0.5, 1] };
let cells = ['<mxCell id="0" />', '<mxCell id="1" parent="0" />',
  `<mxCell id="title" value="AP Invoice Processing - As-Is (India, company code 1000) - Appendix A to SOP-FIN-AP-004 v3.2" style="text;html=1;fontSize=16;fontStyle=1;align=left;verticalAlign=middle;" vertex="1" parent="1"><mxGeometry x="${X0}" y="8" width="1200" height="30" as="geometry" /></mxCell>`];
for (const l of lanes) cells.push(`<mxCell id="${l.id}" value="${esc(l.name)}" style="${LANE_STYLE}" vertex="1" parent="1"><mxGeometry x="${X0}" y="${l.y}" width="${width - X0 - 30}" height="${l.h}" as="geometry" /></mxCell>`);
for (const n of nodes) {
  const [cx, cy] = center(n), [w, h] = size(n), l = laneById[n.lane];
  cells.push(`<mxCell id="${n.id}" value="${esc(n.label)}" style="${STYLE[n.kind]}" vertex="1" parent="${l.id}"><mxGeometry x="${cx - w / 2 - X0}" y="${cy - h / 2 - l.y}" width="${w}" height="${h}" as="geometry" /></mxCell>`);
}
for (const e of edges) {
  const [ex, ey] = SIDE[e.exit ?? 'r'], [nx, ny] = SIDE[e.entry ?? 'l'];
  const pts = route(e).slice(1, -1);
  const geo = pts.length ? `<mxGeometry relative="1" as="geometry"><Array as="points">${pts.map(([px, py]) => `<mxPoint x="${px}" y="${py}" />`).join('')}</Array></mxGeometry>` : '<mxGeometry relative="1" as="geometry" />';
  cells.push(`<mxCell id="${e.id}" value="${esc(e.label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;fontSize=10;exitX=${ex};exitY=${ey};entryX=${nx};entryY=${ny};" edge="1" parent="1" source="${e.from}" target="${e.to}">${geo}</mxCell>`);
}
const drawio = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" agent="AvalaOS eval corpus" version="24.7.17">
  <diagram id="ap-invoice-as-is" name="As-Is">
    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${width}" pageHeight="${height}" math="0" shadow="0">
      <root>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
fs.writeFileSync(path.join(outDir, '05-AP-Invoice-AsIs.drawio'), drawio);

// ---- SVG / PNG ------------------------------------------------------------
function wrap(text, max) {
  const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}
const textBlock = (x, yc, lines, size = 11, weight = 400, anchor = 'middle') =>
  `<text x="${x}" y="${yc - ((lines.length - 1) * (size + 2)) / 2 + size / 3}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="#111">${lines.map((t, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : size + 2}">${esc(t)}</tspan>`).join('')}</text>`;
let svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  `<rect width="100%" height="100%" fill="#ffffff"/>`,
  `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#333"/></marker></defs>`,
  textBlock(X0, 26, ['AP Invoice Processing - As-Is (India, company code 1000) - Appendix A to SOP-FIN-AP-004 v3.2'], 16, 700, 'start')];
for (const l of lanes) {
  svg.push(`<rect x="${X0}" y="${l.y}" width="${width - X0 - 30}" height="${l.h}" fill="#ffffff" stroke="#6c8ebf"/>`);
  svg.push(`<rect x="${X0}" y="${l.y}" width="${LABEL_W}" height="${l.h}" fill="#dae8fc" stroke="#6c8ebf"/>`);
  const lines = wrap(l.name, l.h > 150 ? 30 : 16);
  svg.push(`<g transform="translate(${X0 + LABEL_W / 2},${l.y + l.h / 2}) rotate(-90)">${textBlock(0, 0, lines, 11, 700)}</g>`);
}
for (const e of edges) {
  const pts = route(e);
  svg.push(`<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#333" stroke-width="1.2" marker-end="url(#arr)"/>`);
  if (e.label) {
    const [a, b] = pts; const horiz = a[1] === b[1];
    svg.push(textBlock(horiz ? a[0] + 14 : a[0] + 14, horiz ? a[1] - 9 : a[1] + 14, [e.label], 10, 400, 'start'));
  }
}
for (const n of nodes) {
  const [cx, cy] = center(n), [w, h] = size(n);
  if (n.kind === 'task') { svg.push(`<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="8" fill="#ffffff" stroke="#333"/>`); svg.push(textBlock(cx, cy, wrap(n.label, 19), 11)); }
  if (n.kind === 'gw') { svg.push(`<polygon points="${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}" fill="#fff2cc" stroke="#d6b656"/>`); svg.push(textBlock(cx, cy, wrap(n.label, 11), 9.5)); }
  if (n.kind === 'start' || n.kind === 'end') {
    svg.push(`<circle cx="${cx}" cy="${cy}" r="${EV / 2}" fill="${n.kind === 'start' ? '#d5e8d4' : '#f8cecc'}" stroke="${n.kind === 'start' ? '#82b366' : '#b85450'}" stroke-width="${n.kind === 'end' ? 3 : 1.5}"/>`);
    svg.push(textBlock(cx, cy + EV / 2 + 14, wrap(n.label, 18), 10));
  }
}
svg.push('</svg>');
const svgText = svg.join('\n');
fs.writeFileSync(path.join('/tmp', 'ap-asis.svg'), svgText);
try {
  const sharp = (await import(process.env.SHARP_PATH ?? 'sharp')).default;
  await sharp(Buffer.from(svgText), { density: 110 }).png().toFile(path.join(outDir, '06-AP-Invoice-AsIs.png'));
  console.log('wrote drawio and png', width, 'x', height);
} catch (err) {
  console.log('wrote drawio; PNG skipped:', err.message);
}
