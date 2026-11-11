// The model of a process before anything is known: every part empty, every fact unknown.
import type { ProcessModel } from './types.ts';
import { PROCESS_MODEL_SCHEMA_VERSION } from './types.ts';

export function emptyModel(name: string): ProcessModel {
  return {
    schemaVersion: PROCESS_MODEL_SCHEMA_VERSION,
    meta: { name, objective: { value: null, status: 'unknown', sources: [] }, owner: { value: null, status: 'unknown', sources: [] }, scopeIn: [], scopeOut: [], metrics: [] },
    roles: [], systems: [], events: [], steps: [], gateways: [], flows: [], rules: [], exceptions: [],
    dataObjects: [], painPoints: [], controls: [], risks: [], openQuestions: [], conflicts: [],
  };
}
