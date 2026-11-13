// Editing the flow on the BPMN canvas. The canvas saves BPMN; this reads it back, compares it with
// the model and lists the changes in words for a person to confirm. The confirmed changes are applied
// in one model edit (`setFlowStructure`), so the model stays the only source of the process.
import type { ProcessModel } from '../processModel/types.ts';
import { setFlowStructure, type FlowStructure, type OpResult } from '../processModel/patch.ts';
import type { FlowGraph } from './graph.ts';

const xmlId = (s: string) => (/^[A-Za-z_]/.test(s) ? s : `_${s}`).replace(/[^\w.-]/g, '_');

export interface FlowPlan { spec: FlowStructure; changes: string[]; warnings: string[] }

export function planFlowEdits(model: ProcessModel, drawn: FlowGraph): FlowPlan {
  const back = new Map<string, string>();
  for (const x of [...model.steps, ...model.gateways, ...model.events, ...model.flows, ...model.roles]) back.set(xmlId(x.id), x.id);
  const modelId = (id: string) => back.get(id);
  const changes: string[] = [];
  const warnings: string[] = [];
  const name = (s: string) => `"${s}"`;

  // Lanes: an existing role, a role with the same name, or a new role.
  const roles: FlowStructure['roles'] = [];
  for (const l of drawn.lanes) {
    if (l.id === 'Lane_unassigned' || !l.name.trim()) continue;
    const id = modelId(l.id);
    const role = id ? model.roles.find(r => r.id === id) : model.roles.find(r => r.name.toLowerCase() === l.name.trim().toLowerCase());
    if (role) {
      if (id && role.name !== l.name.trim()) changes.push(`Rename the role ${name(role.name)} to ${name(l.name.trim())}`);
      roles.push({ ref: l.id, id: role.id, name: l.name });
    } else {
      changes.push(`Add the role ${name(l.name.trim())}`);
      roles.push({ ref: l.id, name: l.name });
    }
  }
  const laneRole = (laneId: string | undefined) => (!laneId || laneId === 'Lane_unassigned' || !roles.some(r => r.ref === laneId) ? null : laneId);
  const roleName = (ref: string | null) => (ref ? roles.find(r => r.ref === ref)!.name.trim() : 'no role');

  const nodes: FlowStructure['nodes'] = [];
  const kept = new Set<string>();
  for (const n of drawn.nodes) {
    const kind = n.kind === 'subprocess' ? 'task' : n.kind;
    const id = modelId(n.id);
    const step = id && model.steps.find(s => s.id === id);
    const gate = id && model.gateways.find(g => g.id === id);
    const event = id && model.events.find(e => e.id === id);
    const label = n.label.trim();
    if (step || gate || event) {
      kept.add(id!);
      if (step) {
        if (label && label !== step.name) changes.push(`Rename the step ${name(step.name)} to ${name(label)}`);
        const lane = laneRole(n.laneId);
        const laneRoleId = lane ? roles.find(r => r.ref === lane)!.id : null;
        // A lane with a new role is always a move; otherwise compare with the step's first role.
        const moved = lane ? (laneRoleId ?? `new:${lane}`) !== (step.roleIds[0] ?? null) : Boolean(step.roleIds[0]);
        if (moved) changes.push(`Move ${name(label || step.name)} to ${roleName(lane)}`);
        nodes.push({ ref: n.id, id: step.id, kind: 'task', name: label, roleRef: lane });
      } else if (gate) {
        if (label && label !== gate.question) changes.push(`Change the decision ${name(gate.question)} to ${name(label)}`);
        nodes.push({ ref: n.id, id: gate.id, kind: 'gateway', name: label });
      } else if (event) {
        if (label && label !== event.name) changes.push(`Rename ${event.kind === 'start' ? 'the start' : 'the end'} ${name(event.name)} to ${name(label)}`);
        nodes.push({ ref: n.id, id: event.id, kind: event.kind, name: label });
      }
      continue;
    }
    if (!label) { warnings.push(`A new ${kind === 'task' ? 'step' : kind === 'gateway' ? 'decision' : `${kind} event`} has no name; name it on the canvas, or it is left out.`); continue; }
    if (kind === 'task') changes.push(`Add the step ${name(label)}${laneRole(n.laneId) ? ` for ${roleName(laneRole(n.laneId))}` : ''}`);
    else if (kind === 'gateway') changes.push(`Add the decision ${name(label)}`);
    else changes.push(`Add the ${kind} event ${name(label)}`);
    nodes.push({ ref: n.id, kind, name: label, roleRef: laneRole(n.laneId), ...(n.gatewayType ? { gatewayType: n.gatewayType } : {}) });
  }
  for (const s of model.steps) if (!kept.has(s.id)) changes.push(`Remove the step ${name(s.name)}`);
  for (const g of model.gateways) if (!kept.has(g.id)) changes.push(`Remove the decision ${name(g.question)}`);
  for (const e of model.events) if (!kept.has(e.id)) changes.push(`Remove the ${e.kind} event ${name(e.name)}`);

  // Flows between nodes that are kept or added.
  const included = new Set(nodes.map(n => n.ref));
  const labelOf = (ref: string) => { const n = nodes.find(x => x.ref === ref)!; return n.id ? (model.steps.find(s => s.id === n.id)?.name ?? model.gateways.find(g => g.id === n.id)?.question ?? model.events.find(e => e.id === n.id)?.name ?? n.name) : n.name; };
  const flows: FlowStructure['flows'] = [];
  for (const e of drawn.edges) {
    if (e.id.endsWith('__attached')) continue;
    if (!included.has(e.from) || !included.has(e.to)) { if (drawn.nodes.some(n => n.id === e.from) && drawn.nodes.some(n => n.id === e.to)) warnings.push('A flow to an unnamed element is left out.'); continue; }
    const from = nodes.find(n => n.ref === e.from)!, to = nodes.find(n => n.ref === e.to)!;
    const id = modelId(e.id);
    flows.push({ ...(id ? { id } : {}), from: from.id ?? from.ref, to: to.id ?? to.ref, ...(e.label ? { label: e.label } : {}) });
    const prev = (id && model.flows.find(f => f.id === id)) || (from.id && to.id ? model.flows.find(f => f.from === from.id && f.to === to.id) : undefined);
    if (!prev) changes.push(`Connect ${name(labelOf(e.from))} to ${name(labelOf(e.to))}${e.label ? ` (${e.label})` : ''}`);
    else if ((prev.label ?? '') !== (e.label ?? '')) changes.push(`Label the flow from ${name(labelOf(e.from))} to ${name(labelOf(e.to))} ${e.label ? name(e.label) : 'with nothing'}`);
  }
  const drawnPairs = new Set(flows.map(f => `${f.from}>${f.to}`));
  const nameOfId = (id: string) => model.steps.find(s => s.id === id)?.name ?? model.gateways.find(g => g.id === id)?.question ?? model.events.find(e => e.id === id)?.name ?? id;
  for (const f of model.flows) {
    if (!kept.has(f.from) || !kept.has(f.to)) continue;
    if (!drawnPairs.has(`${f.from}>${f.to}`) && !flows.some(x => x.id === f.id)) changes.push(`Disconnect ${name(nameOfId(f.from))} from ${name(nameOfId(f.to))}`);
  }
  return { spec: { roles, nodes, flows }, changes, warnings: [...new Set(warnings)] };
}

export const applyFlowPlan = (model: ProcessModel, plan: FlowPlan): OpResult => setFlowStructure(model, plan.spec);

/** Checks a person would want before saving a drawn flow. Advice, not errors: saving is still allowed. */
export function lintFlow(g: FlowGraph): string[] {
  const out: string[] = [];
  const ins = (id: string) => g.edges.filter(e => e.to === id).length;
  const outs = (id: string) => g.edges.filter(e => e.from === id);
  if (!g.nodes.some(n => n.kind === 'start')) out.push('The flow has no start event.');
  if (!g.nodes.some(n => n.kind === 'end')) out.push('The flow has no end event.');
  for (const n of g.nodes) {
    const label = n.label.trim() || (n.kind === 'task' ? 'An unnamed step' : 'An unnamed element');
    if (n.kind !== 'start' && ins(n.id) === 0) out.push(`${label} has no flow into it.`);
    if (n.kind !== 'end' && outs(n.id).length === 0) out.push(`${label} has no flow out of it.`);
    if (n.kind === 'gateway' && outs(n.id).length === 1 && ins(n.id) <= 1) out.push(`The decision "${label}" has only one way out.`);
    if (n.kind === 'gateway' && n.gatewayType !== 'parallel' && outs(n.id).length > 1 && outs(n.id).some(e => !e.label)) out.push(`Label each way out of the decision "${label}" (for example Yes and No).`);
  }
  return out;
}
