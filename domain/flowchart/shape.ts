// The shape of a process map (docs/next-plan.md, package 1). A swimlane earns its width when work
// passes between a few roles. It does not when one role does everything, or when there are so many
// roles that a page cannot hold their columns side by side: then the map is a simple flow, one column
// with each step's role written in its box. A person may choose the other shape; their choice is kept
// with the process's other decisions (`Decisions.map`), so every screen and document draws the same.
import type { ProcessModel } from '../processModel/types.ts';
import type { Decisions } from '../assess/decisions.ts';
import { modelToGraph } from './bpmn.ts';
import type { FlowGraph } from './graph.ts';

export type MapShape = 'swimlanes' | 'simple';

/**
 * The rule's numbers, in one place. `maxColumns` is a working default the owner may change: more
 * columns than this and the map is drawn as a simple flow. The sample (five roles) stays in swimlanes.
 */
export const MAP_SHAPE = { maxColumns: 6 } as const;

/** The columns a swimlane map draws: roles that have something in the map, in the model's order, then "No role recorded" when it is used. */
export function laneColumns(graph: FlowGraph): string[] {
  return [
    ...graph.lanes.map(l => l.id).filter(id => graph.nodes.some(n => n.laneId === id)),
    ...(graph.nodes.some(n => !n.laneId || !graph.lanes.some(l => l.id === n.laneId)) ? [''] : []),
  ];
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const count = (n: number) => WORDS[n] ?? String(n);

export interface ShapeAdvice {
  shape: MapShape;
  /** Roles that have steps, and the columns a swimlane map would draw. */
  roles: number;
  columns: number;
  /** Why, in words, as the Flows stage says it. */
  reason: string;
}

/** The shape Avala OS suggests for a model, with its reason. */
export function mapShape(model: ProcessModel, limits: { maxColumns: number } = MAP_SHAPE): ShapeAdvice {
  const known = new Set(model.roles.map(r => r.id));
  const roles = new Set(model.steps.map(s => s.roleIds.find(id => known.has(id))).filter((id): id is string => Boolean(id))).size;
  const columns = laneColumns(modelToGraph(model)).length;
  const unassigned = columns > roles;
  if (roles === 0) return { shape: 'simple', roles, columns, reason: 'Drawn as a simple flow: no step has a role recorded yet, so there are no columns to draw.' };
  if (roles === 1) return { shape: 'simple', roles, columns, reason: `Drawn as a simple flow: one role does ${unassigned ? 'every step that has a role' : 'every step'}, so no work passes between columns. Switch to swimlanes to see it in a column of its own.` };
  if (columns > limits.maxColumns) {
    const what = unassigned ? `${count(columns)} columns (${count(roles)} roles, and steps with no role recorded)` : `${count(roles)} roles`;
    return { shape: 'simple', roles, columns, reason: `Drawn as a simple flow: this process has ${what}, more than a page can hold side by side. Switch to swimlanes to see each role's column.` };
  }
  return { shape: 'swimlanes', roles, columns, reason: `Drawn in swimlanes: the work passes between ${count(roles)} roles, one column each${unassigned ? ', and a column for steps with no role recorded' : ''}.` };
}

export interface ShapeInEffect extends ShapeAdvice {
  /** The shape the suggestion gives, kept when a person chose otherwise. */
  suggested: MapShape;
  /** Set when a person chose the shape. */
  chosen: boolean;
}

/** The shape every map of the process is drawn in: a person's choice, else the suggestion. */
export function shapeInEffect(model: ProcessModel, decisions: Pick<Decisions, 'map'> | null | undefined, limits?: { maxColumns: number }): ShapeInEffect {
  const advice = mapShape(model, limits);
  const choice = decisions?.map?.shape;
  return { ...advice, shape: choice ?? advice.shape, suggested: advice.shape, chosen: Boolean(choice) && choice !== advice.shape };
}
