// The shape of a process's maps on screen (docs/next-plan.md, package 1; the rule is
// domain/flowchart/shape.ts). An editor's choice is kept with the process's decisions, so everyone and
// every document sees it. A viewer may switch too, for their own visit only (this browser tab), and
// which way a simple flow runs on screen is a reading preference kept in this browser: documents always
// run down the page.
import type { Decisions } from '../../domain/assess/decisions.ts';
import type { MapShape } from '../../domain/flowchart/shape.ts';

const visitKey = (processId: string) => `avala:map-shape:${processId}`;
const ACROSS_KEY = 'avala:map-across';

export function visitShape(processId: string): MapShape | null {
  try { const v = sessionStorage.getItem(visitKey(processId)); return v === 'simple' || v === 'swimlanes' ? v : null; } catch { return null; }
}
export function setVisitShape(processId: string, shape: MapShape | null): void {
  try { if (shape) sessionStorage.setItem(visitKey(processId), shape); else sessionStorage.removeItem(visitKey(processId)); } catch { /* storage unavailable: the choice lasts for this screen */ }
}

/** The decisions as this person sees them: for a viewer, their own switch for this visit stands in for the shape. */
export function viewDecisions(processId: string, decisions: Decisions, canEdit: boolean): Decisions {
  const visit = canEdit ? null : visitShape(processId);
  return visit ? { ...decisions, map: { shape: visit, by: '', at: '' } } : decisions;
}

export function readAcross(): boolean {
  try { return localStorage.getItem(ACROSS_KEY) === 'across'; } catch { return false; }
}
export function writeAcross(across: boolean): void {
  try { if (across) localStorage.setItem(ACROSS_KEY, 'across'); else localStorage.removeItem(ACROSS_KEY); } catch { /* storage unavailable */ }
}
