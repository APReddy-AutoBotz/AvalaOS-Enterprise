// The two made-up drafts the call replay's set M briefs from (package C, C2; plan `claude/package-c-plan-26-nov.md`,
// section 8.2). Each is what a first reading of a short description might have given before the call: a few steps,
// some with no role or no application, and one stored question, so the briefing has a real list to ask. They are
// built with the product's own operations, so they are valid models; nothing here is from a real company.
import type { ProcessModel } from '../../../domain/processModel/types.ts';
import { emptyModel } from '../../../domain/processModel/empty.ts';
import { addFlow, addQuestion, addRole, addStep, addSystem } from '../../../domain/processModel/patch.ts';

type Build = { m: ProcessModel };
const role = (b: Build, name: string) => { const r = addRole(b.m, { name, kind: 'person_role' }); b.m = r.model; return r.roleId; };
const system = (b: Build, name: string, kind: Parameters<typeof addSystem>[1]['kind']) => { const r = addSystem(b.m, { name, kind }); b.m = r.model; return r.systemId; };
const step = (b: Build, id: string, name: string, roleIds: string[], systemIds: string[]) => { b.m = addStep(b.m, { step: { id, name, taskType: 'user', roleIds, systemIds } }).model; };
const flow = (b: Build, ids: string[]) => { for (let i = 1; i < ids.length; i++) b.m = addFlow(b.m, { from: ids[i - 1]!, to: ids[i]! }).model; };

/** D1, expense claims at a made-up freight company. */
export function d1Draft(): ProcessModel {
  const b: Build = { m: emptyModel('Expense claims') };
  const clerk = role(b, 'Expense clerk'), manager = role(b, 'Line manager');
  role(b, 'Finance controller');
  const inbox = system(b, 'Finance inbox', 'email'), payroll = system(b, 'Payroll system', 'erp');
  system(b, 'Bank portal', 'portal');
  step(b, 's-receive', 'Receive the claim form', [clerk], [inbox]);
  step(b, 's-check', 'Check receipts and amounts', [clerk], []);
  step(b, 's-approve', 'Approve the claim', [manager], []);
  step(b, 's-payroll', 'Enter the claim into the payroll export', [], [payroll]);
  step(b, 's-reconcile', 'Reconcile the payroll export with the bank statement', [clerk], []);
  flow(b, ['s-receive', 's-check', 's-approve', 's-payroll', 's-reconcile']);
  b.m = addQuestion(b.m, { target: { kind: 'meta', field: 'flow' }, question: 'Above what amount does a claim also need the finance controller\'s approval?', whyItMatters: 'It decides which claims take the longer route.' }).model;
  return b.m;
}

/** D2, contractor access to a made-up building site. */
export function d2Draft(): ProcessModel {
  const b: Build = { m: emptyModel('Contractor site access') };
  const pm = role(b, 'Project manager'), coordinator = role(b, 'Site coordinator'), security = role(b, 'Security');
  const gate = system(b, 'Gatekeeper', 'other');
  system(b, 'Training provider website', 'portal');
  step(b, 's-request', 'Raise the access request', [pm], []);
  step(b, 's-induction', 'Check the induction certificate', [coordinator], []);
  step(b, 's-book', 'Book a new induction', [], []);
  step(b, 's-badge', 'Print the badge and load it into the gate system', [security], [gate]);
  step(b, 's-report', 'Build the weekly on-site report', [], [gate]);
  flow(b, ['s-request', 's-induction', 's-book', 's-badge', 's-report']);
  b.m = addQuestion(b.m, { target: { kind: 'meta', field: 'flow' }, question: 'How long is a contractor badge valid?', whyItMatters: 'It decides when access must be checked again.' }).model;
  return b.m;
}

export const DRAFTS: Record<string, () => ProcessModel> = { D1: d1Draft, D2: d2Draft };
