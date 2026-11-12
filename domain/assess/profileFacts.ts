// Reading the process-level facts of the assessment from the sources: whether change to the process
// or to its applications is expected in the next six months, and which applications are reached
// through a remote desktop. Only passages that mention change or remote access are sent. Each fact
// needs a verbatim quote; a fact a person set is never changed.
import type { Segment, TaskDefinition } from '../ai/gateway.ts';
import { toGatewaySegments, type IngestSegment } from '../ingest/segment.ts';
import type { ChangeLevel, Fact, ProcessModel, SourceRef } from '../processModel/types.ts';
import { NON_INTEGRABLE } from './scoring.ts';

const str = { type: 'string' } as const;

export const profileFacts: TaskDefinition = {
  id: 'profileFacts',
  schemaName: 'profile_facts',
  reasoningEffort: 'medium',
  instructions: [
    'The segment "systems" lists the applications of the process with their ids. The other segments are passages from the sources.',
    'Report only facts the passages state or clearly imply, each with one short verbatim quote and the id of the passage. Never quote the "systems" segment. Report nothing a passage does not settle.',
    'certainty: "stated" when the passage says it outright, "inferred" when it follows clearly but is not said.',
    'Facts:',
    '- processChange: change expected to how the process is done in the next six months or so. "major" for a redesign, a new operating model, outsourcing, a move to another team or centre, or a new policy that changes the steps; "minor" for small adjustments; "none" only when a passage says no change is planned. Past changes and wishes without a plan do not count.',
    '- systemChange: change expected to the applications used in the next six months or so. "major" for a migration, replacement, new system or a large upgrade with a date or plan; "minor" for a small upgrade or patch; "none" only when a passage says no change is planned. A system that might be considered some day does not count.',
    '- remote: for one application (give its systemId), "true" when it is used through Citrix, a remote desktop, VDI or a terminal server, "false" when a passage says it is used directly. Leave systemId empty for the two change facts.',
  ].join('\n'),
  schema: {
    type: 'object', additionalProperties: false, required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['fact', 'systemId', 'value', 'certainty', 'segmentId', 'excerpt'],
          properties: {
            fact: { type: 'string', enum: ['processChange', 'systemChange', 'remote'] },
            systemId: str, value: str,
            certainty: { type: 'string', enum: ['stated', 'inferred'] },
            segmentId: str, excerpt: str,
          },
        },
      },
    },
  },
  maxOutputTokens: 6000,
  verifyArrays: ['findings'],
};

export interface ProfileFinding { fact: 'processChange' | 'systemChange' | 'remote'; systemId: string; value: string; certainty: 'stated' | 'inferred'; segmentId: string; excerpt: string }

/** Words that mark a passage as possibly about change or remote access. */
export const PROFILE_CUES = /\b(chang|upgrad|migrat|replac|implement|roll ?out|go[- ]live|transition|transform|moving to|move to|outsourc|centrali[sz]|new (system|tool|process|erp|platform|policy)|next (quarter|year|month)|plan(ned|s)? to|citrix|remote desktop|\bvdi\b|virtual desktop|terminal server|rdp\b|jump ?host)/i;

/** The passages to read (those with a cue, and their neighbours), at most `limit`. Empty when no passage has a cue. */
export function profileSegments(model: ProcessModel, sources: { key: string; segments: IngestSegment[] }[], limit = 80): { segments: Segment[]; ingest: Map<string, IngestSegment> } {
  const ingest = new Map<string, IngestSegment>();
  const picked: IngestSegment[] = [];
  for (const src of sources) {
    src.segments.forEach((seg, i) => {
      if (!PROFILE_CUES.test(seg.text)) return;
      for (const s of [src.segments[i - 1], seg, src.segments[i + 1]]) if (s && !ingest.has(s.id) && picked.length < limit) { ingest.set(s.id, s); picked.push(s); }
    });
  }
  if (!picked.length) return { segments: [], ingest };
  const systems = model.systems.filter(s => !NON_INTEGRABLE.includes(s.kind)).map(s => `${s.id}: ${s.name}`).join('\n') || 'none';
  return { segments: [{ id: 'systems', text: `Applications:\n${systems}` }, ...toGatewaySegments(picked)], ingest };
}

const CHANGE: ChangeLevel[] = ['none', 'minor', 'major'];
export interface ProfileChange { fact: string; from: unknown; to: unknown }

/** Writes verified findings into the model. Disagreeing findings leave a fact as it was; facts a person set never change. */
export function applyProfileFindings(model: ProcessModel, findings: ProfileFinding[], ingest: Map<string, IngestSegment>): { model: ProcessModel; changes: ProfileChange[] } {
  const next: ProcessModel = JSON.parse(JSON.stringify(model));
  const groups = new Map<string, { value: unknown; certainty: ProfileFinding['certainty']; ref: SourceRef }[]>();
  for (const f of findings) {
    const seg = ingest.get(f.segmentId);
    if (!seg) continue;
    const v = f.value.trim().toLowerCase();
    let value: unknown, key: string;
    if (f.fact === 'remote') {
      if (!next.systems.some(s => s.id === f.systemId && !NON_INTEGRABLE.includes(s.kind)) || !['true', 'false'].includes(v)) continue;
      value = v === 'true'; key = `remote|${f.systemId}`;
    } else if (f.fact === 'processChange' || f.fact === 'systemChange') {
      if (!CHANGE.includes(v as ChangeLevel)) continue;
      value = v; key = f.fact;
    } else continue;
    groups.set(key, [...(groups.get(key) ?? []), { value, certainty: f.certainty, ref: { sourceId: seg.sourceId, locator: seg.locator, excerpt: f.excerpt } }]);
  }
  const changes: ProfileChange[] = [];
  for (const [key, list] of groups) {
    if (new Set(list.map(x => JSON.stringify(x.value))).size !== 1) continue;
    const fact: Fact<unknown> = { value: list[0].value, status: list.some(x => x.certainty === 'stated') ? 'stated' : 'inferred', sources: list.map(x => x.ref).filter((r, i, all) => all.findIndex(y => y.excerpt === r.excerpt && y.sourceId === r.sourceId) === i) };
    if (key.startsWith('remote|')) {
      const sys = next.systems.find(s => s.id === key.slice(7))!;
      if (sys.remote?.status === 'user-confirmed') continue;
      if (sys.remote && JSON.stringify(sys.remote.value) === JSON.stringify(fact.value)) continue;
      changes.push({ fact: `Remote desktop for ${sys.name}`, from: sys.remote?.value ?? null, to: fact.value });
      sys.remote = fact as Fact<boolean>;
    } else {
      const k = key as 'processChange' | 'systemChange';
      const profile = next.meta.profile ?? {};
      const cur = profile[k];
      if (cur?.status === 'user-confirmed') continue;
      if (cur && cur.value === fact.value) continue;
      changes.push({ fact: k, from: cur?.value ?? null, to: fact.value });
      profile[k] = fact as Fact<ChangeLevel>;
      next.meta.profile = profile;
    }
  }
  return { model: next, changes };
}
