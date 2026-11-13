// Requirements derived by rule from the Process Model and the assessment (plan WP3.1). Each record
// has a derivation key, so it keeps its ID across regenerations and a person's edits win. Wording
// comes only from the model's own text; anything the model does not say is a gap, never filler.
import type { ProcessModel } from '../processModel/types.ts';
import type { ProcessAssessment } from '../assess/process.ts';
import { APPROACH_LABEL } from '../assess/scoring.ts';
import { orderedSteps } from '../processModel/selectors.ts';

export type ReqKind = 'BR' | 'FR' | 'NFR';
export type ReqCategory = 'objective' | 'rule' | 'step' | 'human' | 'exception' | 'control';
export type Priority = 'must' | 'should' | 'could' | 'wont';
export interface Acceptance { given: string; when: string; then: string }

export interface DerivedRequirement {
  key: string;
  kind: ReqKind;
  category: ReqCategory;
  title: string;
  statement: string;
  rationale: string;
  acceptance: Acceptance[];
  stepIds: string[];
  ruleIds: string[];
  exceptionIds: string[];
  /** Derivation keys of the business requirements this one serves. */
  traces: string[];
  /** What the model does not say yet; shown as open items. */
  gaps: string[];
}

/** Lower-cases a capitalised first word ("Check", "A"), never an acronym or a name like "SAP". */
const lowerFirst = (s: string) => (/^([A-Z][a-z]|A\s)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const sentence = (s: string) => { const t = s.trim(); return t && !/[.!?]$/.test(t) ? `${t}.` : t; };
const known = <T>(f: { status: string; value: T | null } | undefined) => (f && f.status !== 'unknown' && f.value !== null ? f.value : null);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const HUMAN_VERB = { review: 'review', approve: 'approve', decide: 'decide on' } as const;

export function deriveRequirements(m: ProcessModel, a: ProcessAssessment): DerivedRequirement[] {
  const out: DerivedRequirement[] = [];
  const steps = orderedSteps(m);
  const no = (id: string) => steps.findIndex(s => s.id === id) + 1;
  const stepName = (id: string) => m.steps.find(s => s.id === id)?.name ?? id;
  const roleNames = (ids: string[]) => ids.map(id => m.roles.find(r => r.id === id)?.name).filter((x): x is string => Boolean(x));
  const systemNames = (ids: string[]) => ids.map(id => m.systems.find(s => s.id === id)?.name).filter((x): x is string => Boolean(x));
  const score = (id: string) => a.steps.find(s => s.stepId === id);
  const automated = (id: string) => { const s = score(id); return Boolean(s && !s.alreadyAutomated && s.winner !== 'human'); };
  const anyAutomated = steps.some(s => automated(s.id));

  // ---- Business requirements: the objective and each business rule.
  const objective = known(m.meta.objective);
  if (objective) out.push({ key: 'objective', kind: 'BR', category: 'objective', title: 'Business objective', statement: sentence(objective), rationale: 'The objective stated for the process.', acceptance: [], stepIds: [], ruleIds: [], exceptionIds: [], traces: [], gaps: ['Which measure shows this objective is met, with its baseline and target?'] });
  const top = objective ? ['objective'] : [];
  for (const r of m.rules) {
    const used = steps.filter(s => s.ruleIds.includes(r.id)).map(s => s.id);
    const gaps: string[] = [];
    if (!r.action.trim()) gaps.push(`What happens when rule "${r.name}" applies?`);
    out.push({
      key: `rule:${r.id}`, kind: 'BR', category: 'rule', title: r.name,
      statement: sentence(r.condition.trim() ? `When ${lowerFirst(r.condition.trim())}, ${lowerFirst(r.action.trim() || 'the action is not stated')}` : r.action.trim() || r.name),
      rationale: 'A business rule of the process.',
      acceptance: r.condition.trim() && r.action.trim() ? [{ given: sentence(r.condition), when: used.length ? `step ${used.map(no).join(', ')} is carried out` : 'the rule is applied', then: sentence(r.action) }] : [],
      stepIds: used, ruleIds: [r.id], exceptionIds: [], traces: top, gaps,
    });
  }

  // ---- Functional requirements: each step the solution takes on, its human checks, each exception.
  for (const s of steps) {
    const sc = score(s.id);
    const systems = systemNames(s.systemIds);
    const roles = roleNames(s.roleIds);
    if (automated(s.id)) {
      const gaps: string[] = [];
      if (!systems.length) gaps.push(`Which application does step ${no(s.id)} ("${s.name}") use?`);
      if (!s.outputs.length) gaps.push(`What does step ${no(s.id)} ("${s.name}") produce?`);
      const acceptance: Acceptance[] = [];
      if (s.outputs.length) acceptance.push({ given: s.inputs.length ? `${list(s.inputs)} ${s.inputs.length === 1 ? 'is' : 'are'} available` : `step ${no(s.id)} is reached`, when: `the solution carries out "${s.name}"`, then: `${list(s.outputs)} ${s.outputs.length === 1 ? 'is' : 'are'} produced` });
      for (const rid of s.ruleIds) {
        const r = m.rules.find(x => x.id === rid);
        if (r?.condition.trim() && r.action.trim()) acceptance.push({ given: sentence(r.condition), when: `the solution carries out "${s.name}"`, then: sentence(r.action) });
      }
      out.push({
        key: `step:${s.id}`, kind: 'FR', category: 'step', title: s.name,
        statement: sentence(`The solution shall ${lowerFirst(s.name)}${systems.length ? ` in ${list(systems)}` : ''}`),
        rationale: `${sentence(s.description) ? `${sentence(s.description)} ` : ''}Recommended approach: ${APPROACH_LABEL[sc!.winner]}.`,
        acceptance, stepIds: [s.id], ruleIds: s.ruleIds, exceptionIds: s.exceptionIds,
        traces: [...top, ...s.ruleIds.map(r => `rule:${r}`)], gaps,
      });
    }
    const point = sc?.human;
    if (anyAutomated && (point === 'review' || point === 'approve' || point === 'decide')) {
      const who = roles.length ? list(roles) : 'a person';
      out.push({
        key: `human:${s.id}`, kind: 'FR', category: 'human', title: `Human ${point === 'decide' ? 'decision' : point} at "${s.name}"`,
        statement: sentence(`The solution shall pass "${s.name}" to ${who} to ${HUMAN_VERB[point]} before the case continues`),
        rationale: point === 'decide' ? 'The step needs judgment, so a person decides.' : point === 'approve' ? 'The step makes a change that needs a person\'s approval.' : 'The step\'s result is checked by a person.',
        acceptance: [{ given: `the solution reaches "${s.name}"`, when: `${who} ${point === 'decide' ? 'decides' : point === 'approve' ? 'approves or rejects' : 'reviews'} it`, then: 'the case continues only with that recorded outcome' }],
        stepIds: [s.id], ruleIds: [], exceptionIds: [], traces: [...top, ...s.ruleIds.map(r => `rule:${r}`)],
        gaps: roles.length ? [] : [`Who ${HUMAN_VERB[point]}s step ${no(s.id)} ("${s.name}")?`],
      });
    }
  }
  for (const e of m.exceptions) {
    const where = e.stepIds.filter(id => m.steps.some(s => s.id === id));
    const routed = e.routedToRoleId ? roleNames([e.routedToRoleId])[0] : undefined;
    const gaps: string[] = [];
    if (!e.handling.trim()) gaps.push(`How is "${e.name}" handled?`);
    if (!e.routedToRoleId) gaps.push(`Who handles "${e.name}"?`);
    const handling = e.handling.trim().replace(/\.$/, '');
    const the = (role: string) => (/^(the|a|an)\s/i.test(role) ? role : `the ${role}`);
    const then = handling ? `apply the stated handling: ${lowerFirst(handling)}${routed ? `; and route the case to ${the(routed)}` : ''}` : routed ? `route the case to ${the(routed)}` : '';
    // The criterion says what the solution does, as a full sentence ("then the solution applies…").
    const outcome = handling ? `the solution applies the stated handling: ${lowerFirst(handling)}${routed ? `; and routes the case to ${the(routed)}` : ''}` : routed ? `the solution routes the case to ${the(routed)}` : '';
    out.push({
      key: `exception:${e.id}`, kind: 'FR', category: 'exception', title: e.name,
      statement: sentence(`When ${lowerFirst((e.trigger || e.name).trim().replace(/\.$/, ''))}, the solution shall ${then || 'handle it as described in the open items'}`),
      rationale: `${e.kind === 'business' ? 'A business' : 'An application'} exception${where.length ? ` at step ${where.map(no).join(', ')}` : ''}.`,
      acceptance: then ? [{ given: sentence(e.trigger || e.name), when: where.length ? `step ${where.map(no).join(', ')} is carried out` : 'the solution processes the case', then: sentence(outcome) }] : [],
      stepIds: where, ruleIds: [], exceptionIds: [e.id],
      traces: [...top, ...[...new Set(where.flatMap(id => m.steps.find(s => s.id === id)?.ruleIds ?? []))].map(r => `rule:${r}`)], gaps,
    });
  }

  // ---- Non-functional requirements: only stated controls.
  for (const c of m.controls) {
    out.push({
      key: `control:${c.id}`, kind: 'NFR', category: 'control', title: 'Audit and control',
      statement: sentence(c.text), rationale: 'A control stated in the sources.',
      acceptance: [], stepIds: c.stepIds, ruleIds: c.ruleIds, exceptionIds: [], traces: [...top, ...c.ruleIds.map(r => `rule:${r}`)], gaps: [],
    });
  }
  return out;
}

/** Categories of non-functional requirement the sources must state; each one missing is an open question. */
export const NFR_TOPICS: { topic: string; question: string; cue: RegExp }[] = [
  { topic: 'Volume and performance', question: 'How many cases must the solution handle, and how quickly?', cue: /\b(volume|per (day|hour|month)|within|seconds?|minutes?|throughput|peak)\b/i },
  { topic: 'Availability and schedule', question: 'When must the solution run, and what happens if it is down?', cue: /\b(availab|schedule|business hours|24\/7|downtime|cut-?off)\b/i },
  { topic: 'Security and access', question: 'Which accounts and permissions may the solution use, and who approves them?', cue: /\b(access|permission|credential|account|segregation|least privilege)\b/i },
  { topic: 'Data retention and privacy', question: 'How long are records kept, and is any personal or confidential data involved?', cue: /\b(retain|retention|privacy|personal data|gdpr|confidential)\b/i },
];

export const REQ_ORDER: Record<ReqKind, number> = { BR: 0, FR: 1, NFR: 2 };
export const nameOfStep = (m: ProcessModel, id: string) => m.steps.find(s => s.id === id)?.name ?? id;
