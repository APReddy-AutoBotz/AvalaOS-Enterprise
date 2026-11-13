// Work proposals derived by rule from the requirements, the automation units and the open questions
// (plan WP4.1). An epic per automation unit, a story per functional requirement, enabler tasks per
// application the solution uses, a decision or spike per gap that blocks a requirement, and a UAT or
// control task per exception path and human check. Owner, estimate and dates are left empty.
// The quality gate keeps out document headings, stories with fewer than two testable criteria and
// items with no requirement or step; a requirement that cannot be planned is listed with the reason.
import type { ProcessModel } from '../processModel/types.ts';
import { orderedSteps, periodOf, processMetric } from '../processModel/selectors.ts';
import { APPROACH_LABEL } from '../assess/scoring.ts';
import { criterionText, type Requirement } from '../requirements/register.ts';
import { automationUnits } from '../docs/sdd.ts';
import type { DocInput } from '../docs/common.ts';

export type ProposalType = 'epic' | 'story' | 'task' | 'spike' | 'decision';
export interface ProposalDraft {
  key: string;
  type: ProposalType;
  parentKey: string | null;
  title: string;
  description: string;
  acceptance: string[];
  stepIds: string[];
  /** Requirement codes (FR-001 …) the item delivers or unblocks. */
  requirements: string[];
}
export interface NotPlanned { code: string; title: string; reason: string }
export interface Derivation { proposals: ProposalDraft[]; notPlanned: NotPlanned[] }

export const MIN_CRITERIA = 2;
const norm = (s: string) => s.toLowerCase().replace(/^[\d.\s]+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const sentence = (s: string) => { const t = s.trim(); return t && !/[.!?]$/.test(t) ? `${t}.` : t; };
const lowerFirst = (s: string) => (/^([A-Z][a-z]|A\s)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const article = (role: string) => (/^(the|a|an)\s/i.test(role) ? role : `the ${role}`);

/**
 * The user-story line, from the model only: "As the <role>, I want <goal>, so that <objective>".
 * No role recorded: no line (a reader would otherwise be told a role that was invented). No objective:
 * no "so that".
 */
export function storyLine(role: string | undefined, want: string, objective: string | null): string | null {
  if (!role) return null;
  // The objective as recorded can be a phrase or several sentences; this wording reads well for both.
  const why = objective?.trim() ? `, so that the process meets its objective (${objective.trim().replace(/\.$/, '')})` : '';
  return `As ${article(role)}, I want ${want}${why}.`;
}

/**
 * Proposals for a process. `headings` are every section title of its documents: no item may be
 * titled like one (a heading is never a work item).
 */
export function deriveProposals(input: DocInput, headings: string[]): Derivation {
  const m: ProcessModel = input.model;
  const reqs: Requirement[] = (input.requirements ?? []).filter(r => r.state === 'active');
  const steps = orderedSteps(m);
  const no = (id: string) => steps.findIndex(s => s.id === id) + 1;
  const step = (id: string) => m.steps.find(s => s.id === id);
  const sys = (id: string) => m.systems.find(s => s.id === id)?.name ?? id;
  const roles = (ids: string[]) => ids.map(id => m.roles.find(r => r.id === id)?.name).filter((x): x is string => Boolean(x));
  const banned = new Set(headings.map(norm));
  const proposals: ProposalDraft[] = [];
  const notPlanned: NotPlanned[] = [];
  const titled = (t: string) => (banned.has(norm(t)) ? `Deliver: ${t}` : t);

  const objective = m.meta.objective.status !== 'unknown' && m.meta.objective.value ? m.meta.objective.value : null;
  const vol = processMetric(m, 'volume');
  const volume = vol && (vol.value !== null || vol.range) ? `${vol.value ?? `${vol.range![0]} to ${vol.range![1]}`} ${vol.unit}${periodOf(vol) && !vol.unit.includes('/') && !/per |a /.test(vol.unit) && vol.period ? ` ${vol.period}` : ''}`.trim() : null;
  const roleOf = (stepId: string | undefined) => (stepId ? roles(step(stepId)?.roleIds ?? [])[0] : undefined);
  // Epics: one per automation unit.
  const units = automationUnits(input);
  const epicOf = new Map<string, string>();
  for (const u of units) {
    const key = `epic:${u.approach}:${u.systemIds[0] ?? 'none'}`;
    const where = u.systemIds[0] ? ` in ${sys(u.systemIds[0])}` : '';
    const span = u.steps.length === 1 ? u.steps[0].name : `${u.steps[0].name} to ${u.steps.at(-1)!.name}`;
    const frs = u.steps.map(s => reqs.find(r => r.key === `step:${s.id}`)?.code).filter((x): x is string => Boolean(x));
    proposals.push({
      key, type: 'epic', parentKey: null,
      title: titled(`${APPROACH_LABEL[u.approach]}${where}: ${span}`),
      description: [`Automates ${u.steps.length} ${u.steps.length === 1 ? 'step' : 'steps'}${where} (${APPROACH_LABEL[u.approach]}):`, ...u.steps.map(s => `- ${no(s.id)}. ${s.name}`)].join('\n'),
      acceptance: epicCriteria(u.steps.map(s => s.name), objective, volume),
      stepIds: u.steps.map(s => s.id), requirements: frs,
    });
    for (const s of u.steps) epicOf.set(s.id, key);
  }

  // Stories: one per functional requirement, with its criteria, rules and exception handling.
  for (const r of reqs.filter(x => x.kind === 'FR')) {
    const stepId = r.stepIds[0];
    const s = stepId ? step(stepId) : undefined;
    const criteria = r.acceptance.map(criterionText);
    // Criteria read straight from the model: where the step starts in the flow and where it is done,
    // and who an exception goes to. Nothing here is assumed.
    if (r.category === 'step' && s) {
      const before = m.flows.filter(f => f.to === s.id).map(f => step(f.from)?.name).filter((x): x is string => Boolean(x));
      if (s.systemIds.length) criteria.push(`Given ${before.length ? `"${before[0]}" is done` : 'a case reaches this step'}, when the solution carries out "${s.name}", then it is completed in ${s.systemIds.map(sys).join(' and ')} without a person doing it.`);
    }
    if (r.category === 'exception') {
      const e = m.exceptions.find(x => r.exceptionIds.includes(x.id));
      const to = e?.routedToRoleId ? m.roles.find(x => x.id === e.routedToRoleId)?.name : undefined;
      if (e && to) criteria.push(`Given ${lowerFirst((e.trigger || e.name).replace(/\.$/, ''))}, when the solution detects it, then the case is handed to ${article(to)} with the reason shown.`);
    }
    if (r.category === 'step' && s) {
      for (const eid of s.exceptionIds) {
        const e = m.exceptions.find(x => x.id === eid);
        if (e?.trigger.trim() && e.handling.trim()) criteria.push(`Given ${lowerFirst(e.trigger.replace(/\.$/, ''))}, when "${s.name}" is carried out, then ${e.handling.replace(/\.$/, '')}.`);
      }
    }
    const unique = [...new Set(criteria)];
    if (unique.length < MIN_CRITERIA) {
      const what = s && !s.outputs.length ? ' What the step produces is not recorded: add it in the Process stage, or write the criteria in the FRD.' : ` Add at least ${MIN_CRITERIA} in the FRD.`;
      notPlanned.push({ code: r.code, title: r.title, reason: `${unique.length ? `Only ${unique.length} acceptance criterion.` : 'No acceptance criteria.'}${what}` });
      continue;
    }
    const today = s ? [
      `Today: ${s.description.trim() ? sentence(s.description) : `"${s.name}"`}${roles(s.roleIds).length ? ` Done by ${roles(s.roleIds).join(', ')}.` : ''}${s.systemIds.length ? ` In ${s.systemIds.map(sys).join(', ')}.` : ''}`,
    ] : [];
    const rules = r.ruleIds.map(id => m.rules.find(x => x.id === id)).filter(Boolean).map(x => `- ${x!.name}: ${sentence(x!.condition ? `when ${x!.condition}, ${x!.action}` : x!.action)}`);
    const data = s && (s.inputs.length || s.outputs.length) ? [`Data: ${s.inputs.length ? `in ${s.inputs.join(', ')}` : ''}${s.inputs.length && s.outputs.length ? '; ' : ''}${s.outputs.length ? `out ${s.outputs.join(', ')}` : ''}.`] : [];
    const title = r.category === 'human' ? r.title : r.category === 'exception' ? `Handle "${r.title}"` : r.title;
    const exc = r.category === 'exception' ? m.exceptions.find(x => r.exceptionIds.includes(x.id)) : undefined;
    // The person who wants the story is the one doing the work today, not where an exception is sent.
    const doer = r.stepIds.map(roleOf).find(Boolean);
    const who = doer ?? (exc?.routedToRoleId && m.roles.find(x => x.id === exc.routedToRoleId)?.kind !== 'external' ? m.roles.find(x => x.id === exc.routedToRoleId)?.name : undefined);
    const want = r.category === 'human'
      ? `the solution to bring me "${s?.name ?? r.title}" to ${/decision/i.test(r.title) ? 'decide on' : /approval/i.test(r.title) ? 'approve' : 'review'} before the case continues`
      : r.category === 'exception'
        // The handling itself is in the target and the criteria; the story line stays one short sentence.
        ? doer ? `the solution to catch "${r.title}" and handle it as agreed` : `the solution to bring me each "${r.title}" case with the reason shown`
        : `the solution to ${lowerFirst(s?.name ?? r.title)}${s?.systemIds.length ? ` in ${s.systemIds.map(sys).join(' and ')}` : ''}`;
    const story = storyLine(who, want, objective);
    proposals.push({
      key: `story:${r.key}`, type: 'story', parentKey: r.stepIds.map(id => epicOf.get(id)).find((x): x is string => Boolean(x)) ?? null,
      title: titled(title),
      description: [...(story ? [story, ''] : []), ...today, `Target: ${r.statement}`, ...data, ...(rules.length ? ['Rules:', ...rules] : []), `Requirement: ${r.code}.`].join('\n'),
      acceptance: unique, stepIds: r.stepIds, requirements: [r.code],
    });
    // Control and UAT tasks for human checks and exception paths.
    if (r.category === 'human' || r.category === 'exception') {
      proposals.push({
        key: `uat:${r.key}`, type: 'task', parentKey: `story:${r.key}`,
        title: titled(r.category === 'human' ? `Control test: ${r.title}` : `UAT: exception path "${r.title}"`),
        description: `Test with the business that ${r.statement.replace(/\.$/, '').replace(/^The solution shall /, 'the solution will ')}.`,
        acceptance: [`A test case for each criterion of ${r.code} is written and signed off by the business.`, `Every test case passes in the test environment, with evidence attached.`],
        stepIds: r.stepIds, requirements: [r.code],
      });
    }
  }

  // Enabler tasks per application the automation units use, under the epic for that application.
  const epicForSystem = (id: string) => {
    const main = units.find(u => u.systemIds[0] === id) ?? units.find(u => u.systemIds.includes(id));
    return main ? `epic:${main.approach}:${main.systemIds[0] ?? 'none'}` : null;
  };
  for (const id of [...new Set(units.flatMap(u => u.systemIds))]) {
    const s = m.systems.find(x => x.id === id)!;
    const parent = epicForSystem(id);
    const frs = reqs.filter(r => r.kind === 'FR' && r.stepIds.some(st => step(st)?.systemIds.includes(id))).map(r => r.code);
    const unitSteps = units.filter(u => u.systemIds.includes(id)).flatMap(u => u.steps.map(x => x.id));
    proposals.push({
      key: `access:${id}`, type: 'task', parentKey: parent,
      title: titled(`Set up access to ${s.name} for the solution`),
      description: `The account and permissions the solution needs in ${s.name}, approved by its owner.${s.access.length ? ` Access recorded: ${s.access.map(a => `${a.method.toUpperCase()}${a.name ? ` ${a.name}` : ''} (${a.access.replace('_', ' ')})`).join('; ')}.` : ' No access method is recorded yet.'}`,
      acceptance: [`The ${s.name} owner approves the account and its permissions.`, `The solution signs in to ${s.name} in the test environment with that account.`],
      stepIds: unitSteps, requirements: frs,
    });
    proposals.push({
      key: `testenv:${id}`, type: 'task', parentKey: parent,
      title: titled(`Prepare a test environment and test data for ${s.name}`),
      description: `A test environment of ${s.name} and data covering the standard path and each exception path.`,
      acceptance: [`A test environment of ${s.name} is available to the delivery team.`, `Test data covers the standard path and each exception path listed in the FRD.`],
      stepIds: unitSteps, requirements: frs,
    });
    // An interface whose status is not confirmed blocks the requirements that use it: a spike.
    const unconfirmed = s.access.filter(a => a.access === 'unknown' || a.access === 'reported');
    if (unconfirmed.length || !s.access.length) {
      proposals.push({
        key: `spike:access:${id}`, type: 'spike', parentKey: parent,
        title: titled(`Confirm how the solution can use ${s.name}`),
        description: unconfirmed.length ? `Not yet confirmed: ${unconfirmed.map(a => `${a.method.toUpperCase()}${a.name ? ` ${a.name}` : ''}`).join(', ')}. Ask the ${s.name} owner which can be used for this work.` : `No access method is recorded for ${s.name}. Ask its owner which interfaces (API, screens, files) can be used.`,
        acceptance: [`The ${s.name} owner confirms in writing which interfaces may be used.`, `The process model records each interface as confirmed or not available.`],
        stepIds: unitSteps, requirements: frs,
      });
    }
  }

  /** The epic all these steps belong to, if they share one; otherwise the item stays at the top. */
  const oneEpic = (stepIds: string[]) => { const e = [...new Set(stepIds.map(id => epicOf.get(id)).filter(Boolean))]; return e.length === 1 && stepIds.every(id => epicOf.has(id)) ? e[0]! : null; };
  // Decisions for each gap that blocks a functional requirement. The same question about several
  // steps (what each produces, which application each uses) is one decision listing them.
  const grouped: { re: RegExp; key: string; title: string; ask: string }[] = [
    { re: /^What does step \d+ \("(.+)"\) produce\?$/, key: 'decision:outputs', title: 'Decide what each automated step produces', ask: 'What each of these steps produces (a document, a record, an update)' },
    { re: /^Which application does step \d+ \("(.+)"\) use\?$/, key: 'decision:applications', title: 'Decide which application each automated step uses', ask: 'Which application each of these steps uses' },
  ];
  for (const gr of grouped) {
    const hits = reqs.filter(x => x.kind === 'FR').flatMap(r => r.gaps.map(g => ({ r, m: gr.re.exec(g) })).filter(h => h.m));
    if (!hits.length) continue;
    proposals.push({
      key: gr.key, type: 'decision', parentKey: oneEpic([...new Set(hits.flatMap(h => h.r.stepIds))]), title: titled(gr.title),
      description: [`${gr.ask}:`, ...hits.map(h => `- ${h.m![1]} (${h.r.code})`)].join('\n'),
      acceptance: ['Each step listed has its answer recorded in the process model by someone accountable.', 'The requirements listed no longer show this question.'],
      stepIds: [...new Set(hits.flatMap(h => h.r.stepIds))], requirements: [...new Set(hits.map(h => h.r.code))],
    });
  }
  for (const r of reqs.filter(x => x.kind === 'FR')) {
    r.gaps.forEach((g, i) => {
      if (grouped.some(gr => gr.re.test(g))) return;
      proposals.push({
        key: `decision:${r.key}:${i}`, type: 'decision', parentKey: oneEpic(r.stepIds),
        title: titled(`Decide: ${g.replace(/\?$/, '')}`),
        description: `${r.code} (${r.title}) cannot be completed until this is answered: ${g}`,
        acceptance: [`The answer is recorded in the process model by someone accountable.`, `${r.code} is updated and no longer lists this question.`],
        stepIds: r.stepIds, requirements: [r.code],
      });
    });
  }
  // Stories that belong to no automation unit (exception paths and human checks on manual steps) go
  // under one epic of their own, so every story sits under an epic as in Jira and Azure DevOps.
  const loose = proposals.filter(p => p.type === 'story' && !p.parentKey);
  if (loose.length) {
    const key = 'epic:exceptions';
    proposals.unshift({
      key, type: 'epic', parentKey: null,
      title: titled(`Exception handling and human checks: ${m.meta.name}`),
      description: [`Exception paths and human checks around the steps that stay with people (${loose.length} ${loose.length === 1 ? 'story' : 'stories'}):`, ...loose.map(p => `- ${p.title}`)].join('\n'),
      acceptance: ['Every exception path in this epic is caught and handled as the FRD describes, with the case shown to the right person.', 'Every story in this epic meets its acceptance criteria.'],
      stepIds: [...new Set(loose.flatMap(p => p.stepIds))], requirements: [...new Set(loose.flatMap(p => p.requirements))],
    });
    for (const p of loose) p.parentKey = key;
  }
  return { proposals: gate(proposals, banned), notPlanned };
}

/** The quality gate: drops anything that slipped through without links or criteria, or titled like a heading. */
function gate(ps: ProposalDraft[], banned: Set<string>): ProposalDraft[] {
  const kept = ps.filter(p => !banned.has(norm(p.title)) && p.acceptance.length >= MIN_CRITERIA && (p.requirements.length || p.stepIds.length));
  const keys = new Set(kept.map(p => p.key));
  return kept.map(p => (p.parentKey && !keys.has(p.parentKey) ? { ...p, parentKey: null } : p));
}

/** Which functional requirements no story covers. */
export function coverage(d: Derivation, reqs: Requirement[]): { covered: string[]; notPlanned: NotPlanned[] } {
  const covered = new Set(d.proposals.filter(p => p.type === 'story').flatMap(p => p.requirements));
  return { covered: [...covered], notPlanned: d.notPlanned.filter(n => !covered.has(n.code) && reqs.some(r => r.code === n.code)) };
}

/**
 * An epic's acceptance: outcomes, not bookkeeping. The steps run end to end; the stories are done; and,
 * when the process records them, the objective and the volume it must handle.
 */
export function epicCriteria(steps: string[], objective: string | null, volume: string | null): string[] {
  const span = steps.length === 1 ? `"${steps[0]}"` : `"${steps[0]}" to "${steps.at(-1)}"`;
  return [
    `Given a case in the test environment, when it reaches ${span}, then ${steps.length === 1 ? 'the step completes' : 'every step completes in order'} without a person doing the automated work.`,
    'Every story in this epic meets its acceptance criteria.',
    ...(objective ? [`The business confirms the objective is served: ${sentence(objective)}`] : []),
    ...(volume ? [`It handles the recorded volume of ${volume} in a test run sized to that volume.`] : []),
  ];
}
