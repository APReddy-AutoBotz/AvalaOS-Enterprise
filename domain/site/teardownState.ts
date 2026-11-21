// A teardown's demo file, built from what its folder holds (teardowns/<slug>/): the committed copy of the
// published text, the process model the live reading wrote (taken out read-only), the reading's times and
// passage counts, and the words (./teardowns.ts). The source is parsed by the same parser the browser uses when a
// file is added, so its passages are those the live reading read; everything else is the in-browser store's own
// state shape (journey/store/memoryStore.ts), with the neutral teardown person, workspace and organisation.
// Ids are worked out from the slug, so building the file again gives the same file. Pure apart from the parser,
// which reads only the bytes it is given.
import { parseFile } from '../ingest/parsers/index.ts';
import { formatFromName, FORMAT_LABEL, sourceKey, titleFromFileName, type StoredFormat } from '../workspace/sources.ts';
import { fnv1a64, hashModel } from '../processModel/hash.ts';
import { validateModel } from '../processModel/validate.ts';
import type { ProcessModel } from '../processModel/types.ts';
import { TEARDOWN_ORGANISATION, TEARDOWN_PERSON, TEARDOWN_WORKSPACE, teardownDocumentSettings, teardownModel, type TeardownWords } from './teardowns.ts';

/** What the live reading said, kept beside the model in run.json. */
export interface TeardownRun {
  /** When the source was added and when the reading finished (the extraction run's created and last-updated times). */
  startedAt: string;
  finishedAt: string;
  /** Each source's passage count in the live database, by key. */
  liveSegments: Record<string, number>;
  /** Which committed file each source key is. */
  files: Record<string, string>;
}

export interface TeardownInput {
  words: TeardownWords;
  model: ProcessModel;
  run: TeardownRun;
  /** The committed files, by name. */
  files: Record<string, Uint8Array>;
}

/** A stable id in the form of a UUID, from the slug and what it is for. */
export function stableId(slug: string, what: string): string {
  const h = (fnv1a64(`${slug}:${what}`) + fnv1a64(`${what}:${slug}`)).slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Only text formats the parser reads without the browser's PDF library: Markdown, plain text and Word. */
const FORMATS: StoredFormat[] = ['md', 'txt', 'docx'];

export async function teardownState(input: TeardownInput) {
  const { words, run } = input;
  const slug = words.slug;
  const id = (what: string) => stableId(slug, what);
  const me = { id: id('person'), email: TEARDOWN_PERSON.email };
  const ws = id('workspace'), processId = id('process'), revisionId = id('revision');

  const taken: string[] = [];
  const sources = [];
  for (const [key, fileName] of Object.entries(run.files)) {
    const bytes = input.files[fileName];
    if (!bytes) throw new Error(`The file ${fileName} for source ${key} is not in the folder.`);
    const format = formatFromName(fileName);
    if (!FORMATS.includes(format)) throw new Error(`${fileName}: a teardown's source is Markdown, plain text or Word.`);
    const expected = sourceKey(format, taken);
    if (expected !== key) throw new Error(`Source ${fileName} would be added as ${expected}, not ${key}: list the files in the order they were added.`);
    taken.push(key);
    const r = await parseFile({ name: fileName, bytes, sourceId: key }, {});
    if (r.status !== 'ok') throw new Error(`${fileName} could not be read: ${r.status === 'error' ? r.message : r.status}.`);
    sources.push({
      id: id(`source:${key}`), key, title: titleFromFileName(fileName), fileName, format: r.format, kind: FORMAT_LABEL[r.format as StoredFormat],
      inferred: false, segmentCount: r.segments.length, warnings: r.warnings, createdAt: run.startedAt, archived: false, processId, segments: r.segments,
    });
  }

  const model = teardownModel(input.model, me.id, run.finishedAt);
  const check = validateModel(model);
  if (!check.valid) throw new Error(`The model is not valid: ${check.issues.filter(i => i.severity === 'error').map(i => `${i.path} ${i.message}`).join('; ')}`);
  const operations = model.steps.length + model.roles.length + model.systems.length + model.rules.length + model.exceptions.length;

  return {
    teardown: words,
    me,
    workspaces: [{ id: ws, name: TEARDOWN_WORKSPACE, organizationName: TEARDOWN_ORGANISATION, role: 'admin', canApprove: true, job: null, organizationId: id('organization'), modules: ['assess', 'documents'], canAddWorkspace: false }],
    processes: [{ id: processId, workspaceId: ws, name: model.meta.name, description: '', updatedAt: run.finishedAt, analystId: me.id, architectId: null, approverId: null }],
    revisions: [{ id: revisionId, processId, revNo: 1, state: 'working', seq: 1, model, modelHash: hashModel(model), basedOn: null, createdAt: run.startedAt, updatedAt: run.finishedAt, approvedAt: null, approvedBy: null }],
    // The reading, as the history records it: from the source's arrival to the draft, the real time it took.
    edits: [{ processId, revisionId, seq: 1, origin: 'extraction', summary: 'Model extracted from sources', createdAt: run.finishedAt, operations }],
    sources,
    people: { [ws]: { members: [{ userId: me.id, name: TEARDOWN_PERSON.name, email: TEARDOWN_PERSON.email, role: 'admin', job: null, canApprove: true, since: run.startedAt }], invites: [], audit: [] } },
    documentSettings: [{ workspaceId: ws, settings: teardownDocumentSettings(words) }],
  };
}
export type TeardownState = Awaited<ReturnType<typeof teardownState>>;
