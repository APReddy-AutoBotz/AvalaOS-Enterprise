// The work a process calls for, as the Work items stage works it out (moved from that screen so Ask
// Avala's suggestions use the same rule): the requirements register reconciled with the stored one, the
// proposals derived from the four documents' requirements (document headings kept out), and which
// requirements no proposal plans yet, with why.
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import type { Decisions } from '../assess/decisions.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile, type StoredRequirement } from '../requirements/register.ts';
import { buildBrd } from '../docs/brd.ts';
import { buildPdd } from '../docs/pdd.ts';
import { buildFrd } from '../docs/frd.ts';
import { buildSdd } from '../docs/sdd.ts';
import { applyLayout } from '../docs/layout.ts';
import type { DocInput } from '../docs/common.ts';
import type { DocumentSettings } from '../docs/branding.ts';
import { coverage, deriveProposals } from './derive.ts';

export function planWork(model: ProcessModel, decisions: Decisions, stored: StoredRequirement[], layouts: DocumentSettings['layouts']) {
  const assessment = assessProcess(model, { decisions });
  const register = reconcile(deriveRequirements(model, assessment), stored);
  const i: DocInput = { model, assessment, decisions, sources: [], requirements: register.requirements, revision: { label: '', state: 'working', date: '' } };
  const headings = [buildBrd(i), buildPdd(i), buildFrd(i), buildSdd(i)].flatMap(d => applyLayout(d, layouts[d.type]).sections.map(s => s.title));
  const d = deriveProposals(i, headings);
  return { d, register, cov: coverage(d, register.requirements) };
}
