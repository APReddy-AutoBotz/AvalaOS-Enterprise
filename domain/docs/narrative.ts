// Narrative text checks and AI drafting (plan WP3.3). Whatever writes a section's narrative (a
// person in the editor, or the AI on request), the text is checked before it is saved: names and
// numbers that are not in the process model, and filler, are flagged. The AI drafts only from the
// model's facts given as segments, and every sentence must quote the fact it states; a sentence
// whose quote is not found is dropped by the gateway.
import type { ProcessModel } from '../processModel/types.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import type { TaskDefinition } from '../ai/gateway.ts';
import type { DocTree, DocType } from './tree.ts';
import { sectionLines } from './changes.ts';

// ---- Grounding --------------------------------------------------------------------------------

/** Words that are never a fact to check: document and method names, and common capitalised words. */
const ALLOWED = new Set(['i', 'the', 'a', 'an', 'this', 'these', 'that', 'it', 'each', 'every', 'when', 'if', 'then', 'once', 'after', 'before', 'today', 'brd', 'pdd', 'frd', 'sdd', 'rpa', 'api', 'apis', 'ai', 'bpmn', 'ui', 'as-is', 'to-be', 'uat', 'kpi', 'kpis', 'sla', 'fte', 'id', 'pdf', 'ocr', 'excel', 'email', 'yes', 'no', 'not', 'provided', 'step', 'steps', 'section', 'appendix', 'figure', 'table', 'note', 'open', 'all', 'some', 'most', 'one', 'two', 'three', 'four', 'five']);
export const FILLER: RegExp[] = [
  /\bTBD\b/i, /\bTBC\b/, /\bplaceholder\b/i, /\blorem\b/i, /\bto be (decided|determined|confirmed later)\b/i, /\betc\.?(?=\s|$)/i,
  /\b(seamless(ly)?|best[- ]in[- ]class|world[- ]class|cutting[- ]edge|state[- ]of[- ]the[- ]art|synerg(y|ies)|game[- ]chang(er|ing)|robust and scalable|leverag(e|ing) (AI|automation))\b/i,
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function corpus(m: ProcessModel, extra = ''): { text: string; numbers: Set<string>; parts: string[] } {
  const parts: string[] = [m.meta.name, String(m.meta.objective.value ?? ''), String(m.meta.owner.value ?? '')];
  for (const r of m.roles) parts.push(r.name);
  for (const s of m.systems) parts.push(s.name, s.version ?? '', ...s.access.flatMap(a => [a.name ?? '', ...a.operations, a.note ?? '']));
  for (const s of m.steps) parts.push(s.name, s.description, ...s.inputs, ...s.outputs);
  for (const g of m.gateways) parts.push(g.question);
  for (const f of m.flows) parts.push(f.label ?? '');
  for (const r of m.rules) parts.push(r.name, r.condition, r.action);
  for (const e of m.exceptions) parts.push(e.name, e.trigger, e.handling);
  for (const d of m.dataObjects) parts.push(d.name, d.format ?? '');
  for (const x of [...m.painPoints, ...m.controls, ...m.risks]) parts.push((x as { text: string }).text);
  for (const x of m.meta.scopeIn.concat(m.meta.scopeOut)) parts.push((x as { text: string }).text);
  for (const x of m.meta.metrics) parts.push(x.label, String(x.value ?? ''), x.unit ?? '', ...(x.range ? [String(x.range[0]), String(x.range[1])] : []));
  const text = `${parts.join(' \n ')} \n ${extra}`;
  const numbers = new Set((text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(n => n.replace(/,/g, '')));
  return { text: ` ${norm(text)} `, numbers, parts: parts.filter(p => p.trim().length > 30) };
}

export interface GroundingIssue { kind: 'name' | 'number' | 'filler'; text: string }

/**
 * What a narrative says that the model does not: capitalised names and acronyms not found in the
 * model's text, numbers not found in it, and filler. Step numbers ("step 3") within the step count
 * are allowed. `known` is text that is already grounded, such as the generated documents (their
 * counts, hours and labels are worked out from the model).
 */
export function groundingIssues(text: string, m: ProcessModel, known = ''): GroundingIssue[] {
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  if (!plain) return [];
  const { text: corpusText, numbers } = corpus(m, known);
  const issues: GroundingIssue[] = [];
  const seen = new Set<string>();
  const add = (kind: GroundingIssue['kind'], t: string) => { const k = `${kind}:${t.toLowerCase()}`; if (!seen.has(k)) { seen.add(k); issues.push({ kind, text: t }); } };
  for (const re of FILLER) { const hit = plain.match(re); if (hit) add('filler', hit[0]); }
  const steps = orderedSteps(m).length;
  for (const hit of plain.matchAll(/(step\s+)?(\d[\d,]*(?:\.\d+)?)/gi)) {
    const n = hit[2].replace(/,/g, '');
    if (hit[1] && Number(n) >= 1 && Number(n) <= steps) continue;
    if (!numbers.has(n)) add('number', hit[0].trim());
  }
  // Names: runs of capitalised words (not at a sentence start) and acronyms.
  const sentences = plain.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const words = s.split(/\s+/);
    let run: string[] = [];
    const flush = () => {
      if (!run.length) return;
      const name = run.join(' ').replace(/[^\w\s/&.-]+$/, '').replace(/^[^\w]+/, '');
      run = [];
      if (!name || ALLOWED.has(name.toLowerCase())) return;
      const n = norm(name);
      if (n && !corpusText.includes(` ${n} `) && !n.split(' ').every(w => ALLOWED.has(w) || corpusText.includes(` ${w} `))) add('name', name);
    };
    words.forEach((w, i) => {
      const clean = w.replace(/^[("'“]+|[)"'”,;:.!?]+$/g, '');
      const isName = /^[A-Z][A-Za-z0-9&/-]*$/.test(clean) && !(i === 0 && /^[A-Z][a-z]+$/.test(clean) && ALLOWED.has(clean.toLowerCase()));
      if (isName && !(i === 0 && /^[A-Z][a-z]+$/.test(clean) && !run.length && words[1] && !/^[A-Z]/.test(words[1]))) run.push(clean); else flush();
      if (/[,;:.!?)]$/.test(w)) flush();
    });
    flush();
  }
  return issues;
}

// ---- Overlap between documents ----------------------------------------------------------------

export interface Overlap { a: { doc: DocType; section: string }; b: { doc: DocType; section: string }; similarity: number }
const tokens = (s: string) => new Set(norm(s).split(' ').filter(w => w.length > 3));
/**
 * Paragraphs repeated across documents ("one home per fact"): narrative of one document's section that
 * is mostly the same words as another document's. Tables are not compared: they summarise on purpose,
 * and nor is a paragraph that is mostly one fact of the model quoted (an objective, a step's description).
 */
export function overlaps(docs: DocTree[], m?: ProcessModel, threshold = 0.7): Overlap[] {
  const facts = m ? corpus(m).parts.map(norm) : [];
  const isFact = (t: string) => { const n = norm(t); return facts.some(f => n.includes(f) && f.length / Math.max(1, n.length) > 0.6); };
  const items = docs.flatMap(d => d.sections.flatMap(s => s.blocks.filter(b => b.kind === 'paragraph' || b.kind === 'rich').map(b => (b.kind === 'rich' ? b.html.replace(/<[^>]+>/g, ' ') : (b as { text: string }).text)).filter(t => !isFact(t)).map(t => ({ doc: d.type, section: `${s.number} ${s.title}`, words: tokens(t) })))).filter(x => x.words.size >= 8);
  const out: Overlap[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const x = items[i], y = items[j];
    if (x.doc === y.doc) continue;
    let both = 0; for (const w of x.words) if (y.words.has(w)) both++;
    const sim = both / (x.words.size + y.words.size - both);
    if (sim >= threshold) out.push({ a: { doc: x.doc, section: x.section }, b: { doc: y.doc, section: y.section }, similarity: Math.round(sim * 100) / 100 });
  }
  return out;
}

// ---- Pre-handoff checklist (plan 4.6) ----------------------------------------------------------

export interface CheckFailure { text: string; target?: { kind: 'step' | 'gateway' | 'rule' | 'exception'; id: string } }
export interface Check { id: string; label: string; ok: boolean; failures: CheckFailure[] }

export function handoffChecklist(m: ProcessModel, docs: DocTree[]): Check[] {
  const steps = orderedSteps(m);
  const no = (id: string) => steps.findIndex(s => s.id === id) + 1;
  const check = (id: string, label: string, failures: CheckFailure[]): Check => ({ id, label, ok: failures.length === 0, failures });
  const filler = docs.flatMap(d => d.sections.flatMap(s => s.blocks.flatMap(b => {
    const t = b.kind === 'paragraph' || b.kind === 'callout' ? b.text : b.kind === 'rich' ? b.html.replace(/<[^>]+>/g, ' ') : b.kind === 'list' ? b.items.join(' ') : '';
    const hit = FILLER.slice(0, 6).map(re => t.match(re)?.[0]).find(Boolean);
    return hit ? [{ text: `${d.title}, ${s.number} ${s.title}: "${hit}"` }] : [];
  })));
  const connected = new Set(m.flows.flatMap(f => [f.from, f.to]));
  return [
    check('roles-systems', 'Every step names a role and, where a system is used, the specific system',
      steps.flatMap(s => [
        ...(s.roleIds.length ? [] : [{ text: `Step ${no(s.id)} "${s.name}" has no role.`, target: { kind: 'step' as const, id: s.id } }]),
        ...(s.taskType !== 'manual' && !s.systemIds.length ? [{ text: `Step ${no(s.id)} "${s.name}" names no system.`, target: { kind: 'step' as const, id: s.id } }] : []),
      ])),
    check('decisions', 'Every decision has at least two named paths',
      m.gateways.filter(g => { const outs = m.flows.filter(f => f.from === g.id); return outs.length < 2 || (g.type === 'exclusive' && outs.some(f => !f.label?.trim())); })
        .map(g => ({ text: `"${g.question}" ${m.flows.filter(f => f.from === g.id).length < 2 ? 'has fewer than two paths' : 'has a path without a name'}.`, target: { kind: 'gateway' as const, id: g.id } }))),
    check('rules', 'Every business rule has a condition and an action',
      m.rules.filter(r => !r.condition.trim() || !r.action.trim()).map(r => ({ text: `"${r.name}" has no ${!r.condition.trim() ? 'condition' : 'action'}.`, target: { kind: 'rule' as const, id: r.id } }))),
    check('exceptions', 'Every exception says who it goes to',
      m.exceptions.filter(e => !e.routedToRoleId).map(e => ({ text: `"${e.name}" is not routed to anyone.`, target: { kind: 'exception' as const, id: e.id } }))),
    check('map', 'The map matches the step table',
      m.flows.length === 0 ? (steps.length ? [{ text: 'The flow between steps is not recorded, so the map shows steps without arrows.' }] : [])
        : steps.filter(s => !connected.has(s.id)).map(s => ({ text: `Step ${no(s.id)} "${s.name}" is not connected in the flow.`, target: { kind: 'step' as const, id: s.id } }))),
    check('filler', 'No section contains "TBD", "placeholder" or similar', filler),
    check('sources', 'Key facts carry a source or are confirmed by a person',
      [...steps.map(s => ({ x: s, kind: 'step' as const, label: `Step ${no(s.id)} "${s.name}"` })), ...m.rules.map(r => ({ x: r, kind: 'rule' as const, label: `Rule "${r.name}"` })), ...m.exceptions.map(e => ({ x: e, kind: 'exception' as const, label: `Exception "${e.name}"` }))]
        .filter(({ x }) => !x.sources.length && x.status !== 'user-confirmed').map(({ x, kind, label }) => ({ text: `${label} has no source and is not confirmed.`, target: { kind, id: x.id } }))),
  ];
}

// ---- AI drafting ------------------------------------------------------------------------------

export interface FactSegment { id: string; text: string }
/** The model's facts as numbered segments: the only thing the AI may write from. */
export function modelFacts(m: ProcessModel): FactSegment[] {
  const out: FactSegment[] = [];
  const role = (id: string) => m.roles.find(r => r.id === id)?.name;
  const sys = (id: string) => m.systems.find(s => s.id === id)?.name;
  out.push({ id: 'f:process', text: `The process is "${m.meta.name}".` });
  if (m.meta.objective.value) out.push({ id: 'f:objective', text: `Objective: ${m.meta.objective.value}` });
  if (m.meta.owner.value) out.push({ id: 'f:owner', text: `Process owner: ${m.meta.owner.value}` });
  for (const s of orderedSteps(m)) {
    out.push({ id: `f:step:${s.id}`, text: `Step ${out.filter(x => x.id.startsWith('f:step:')).length + 1}: ${s.name}.${s.roleIds.length ? ` Done by ${s.roleIds.map(role).filter(Boolean).join(', ')}.` : ''}${s.systemIds.length ? ` In ${s.systemIds.map(sys).filter(Boolean).join(', ')}.` : ''}${s.description ? ` ${s.description}` : ''}` });
  }
  for (const r of m.roles) out.push({ id: `f:role:${r.id}`, text: `Role: ${r.name}${r.inScope ? '' : ' (outside the scope)'}.` });
  for (const s of m.systems) out.push({ id: `f:system:${s.id}`, text: `Application: ${s.name}.` });
  for (const r of m.rules) out.push({ id: `f:rule:${r.id}`, text: `Rule "${r.name}": ${r.condition ? `when ${r.condition}, ` : ''}${r.action}` });
  for (const e of m.exceptions) out.push({ id: `f:exception:${e.id}`, text: `Exception "${e.name}": ${e.trigger}${e.handling ? ` Handling: ${e.handling}` : ''}` });
  for (const x of m.meta.metrics) out.push({ id: `f:metric:${x.id}`, text: `${x.label}: ${x.value ?? (x.range ? `${x.range[0]} to ${x.range[1]}` : 'not known')}${x.unit ? ` ${x.unit}` : ''}.` });
  for (const p of m.painPoints) out.push({ id: `f:pain:${p.id}`, text: `Pain point: ${p.text}` });
  return out.slice(0, 200);
}

export const draftNarrative: TaskDefinition = {
  id: 'draftNarrative',
  schemaName: 'section_narrative',
  instructions: [
    'Write the narrative for one section of a process document. The segment with id "brief" says which document and section, and what it is for; never quote it.',
    'Every other segment is one fact about the process. Write 2 to 6 short, plain sentences that say only what these facts say, in the order a reader needs them. Each sentence states one or two facts.',
    'Name roles, applications, numbers and rules only as the facts give them. Do not add numbers, names, dates, causes, benefits or recommendations that are not in the facts. No filler and no marketing words.',
    'If the facts do not cover what the section is for, write fewer sentences; an empty list is a correct answer.',
    'For each sentence give the id of the fact segment it relies on most and an excerpt copied from that segment.',
  ].join('\n'),
  schema: {
    type: 'object', additionalProperties: false, required: ['sentences'],
    properties: { sentences: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'segmentId', 'excerpt'], properties: { text: { type: 'string' }, segmentId: { type: 'string' }, excerpt: { type: 'string' } } } } },
  },
  maxOutputTokens: 4000,
  verifyArrays: ['sentences'],
};

export const SECTION_BRIEF = (doc: string, section: string, purpose: string) => ({ id: 'brief', text: `Document: ${doc}. Section: ${section}. ${purpose}` });

/** The gateway's verified sentences as editor HTML, each checked once more against the model. */
export function draftToHtml(data: unknown, m: ProcessModel): { html: string; sentences: number; issues: GroundingIssue[] } {
  const items = (data as { sentences?: { text?: unknown; segmentId?: unknown }[] })?.sentences ?? [];
  // The gateway has already dropped sentences whose quote is not in the fact they cite.
  const texts = items.filter(i => i.segmentId !== 'brief').map(i => String(i.text ?? '').trim()).filter(t => t && t.length < 600);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = texts.length ? `<p>${texts.map(esc).join(' ')}</p>` : '';
  return { html, sentences: texts.length, issues: groundingIssues(texts.join(' '), m) };
}

/** All text the generated documents already say, which counts as grounded for the checks above. */
export const generatedText = (docs: DocTree[]): string => docs.map(d => [d.title, ...d.sections.flatMap(sectionLines)].join('\n')).join('\n');
