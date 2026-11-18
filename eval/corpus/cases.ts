// The extraction check's cases and the exact files each one reads (item 9 of package 13 B).
//
// The check no longer fetches its files from GitHub at a commit: whoever starts a check sends the files
// with the start request (the "Extraction check" workflow reads them from its checkout). The function
// takes them only when every file the case needs is there, nothing else is, and each file's SHA-256 is
// the one below, which is compiled into the function when it is deployed. So the files a check reads are
// exactly the files in this repository at the deployed commit, whoever sends them; a caller cannot put
// other content in front of the AI or the scorer. cases.test.ts keeps the hashes in step with the files:
// after editing a corpus file, run `node eval/corpus/hashes.ts` and paste its output below.

export interface EvalSource { sourceId: string; file: string; title: string; kind: string }
export interface EvalCase { dir: string; processName: string; sources: EvalSource[] }

const AP_CALLS_AND_SOP: EvalSource[] = [
  { sourceId: 'call-1', file: 'sources/01-discovery-call-2026-10-06.vtt', title: 'Discovery call, 6 October 2026', kind: 'meeting transcript' },
  { sourceId: 'call-2', file: 'sources/02-exceptions-deep-dive-2026-10-09.srt', title: 'Exceptions deep dive, 9 October 2026', kind: 'meeting transcript' },
  { sourceId: 'call-3', file: 'sources/03-sap-integration-call-2026-10-14.txt', title: 'SAP and integration review, 14 October 2026', kind: 'meeting transcript' },
  { sourceId: 'sop', file: 'sources/04-SOP-FIN-AP-004-vendor-invoice-processing.docx', title: 'SOP FIN-AP-004 Vendor invoice processing', kind: 'standard operating procedure' },
];

export const CASES: Record<string, EvalCase> = {
  'ap-invoice': {
    dir: 'ap-invoice',
    processName: 'Vendor invoice processing',
    sources: [...AP_CALLS_AND_SOP, { sourceId: 'flow', file: 'sources/05-AP-Invoice-AsIs.drawio', title: 'As-Is flowchart (Appendix A)', kind: 'flowchart' }],
  },
  // The same case with the flowchart as an image instead of a draw.io file.
  'ap-invoice-image': {
    dir: 'ap-invoice',
    processName: 'Vendor invoice processing',
    sources: [...AP_CALLS_AND_SOP, { sourceId: 'flow', file: 'sources/06-AP-Invoice-AsIs.png', title: 'As-Is flowchart (Appendix A), image', kind: 'flowchart image' }],
  },
  'ap-invoice-no-flow': { dir: 'ap-invoice', processName: 'Vendor invoice processing', sources: AP_CALLS_AND_SOP },
};

/** The gold the result is scored against, in the case's folder. */
export const GOLD = 'expected.model.json';

/** SHA-256 of every corpus file, by case folder. */
export const CORPUS_SHA256: Record<string, Record<string, string>> = {
  'ap-invoice': {
    'sources/01-discovery-call-2026-10-06.vtt': '84106126eea9ae66cb965038f86e5adbcadc0dd14f6468bcc3571198f061fcf5',
    'sources/02-exceptions-deep-dive-2026-10-09.srt': 'd5706b00c59e8b10e3319d4af070b1e99274978aac00aa637d8e9a938342e6cd',
    'sources/03-sap-integration-call-2026-10-14.txt': 'b3359a15496b5c59a2e5848c116763db4157b91647fdf5816981557ad2d96217',
    'sources/04-SOP-FIN-AP-004-vendor-invoice-processing.docx': '0606aceb5a7fe00c041284868837b895e1cd2965d5f61ca932a12c434fa26628',
    'sources/05-AP-Invoice-AsIs.drawio': '5eb5f06cfb36b8429ba71abd914ddf67b118a59ab6424749df7112f05dfc7818',
    'sources/06-AP-Invoice-AsIs.png': '2e1d306572579e89f49af99a7bfb382e5c30852ea2e85675105b1ee37647d918',
    'expected.model.json': 'ced5d2953859a8296ca234a7b68a24df51d0eb5717d14538a29c7a3393df1bc7',
  },
};

/** The files a case reads: its sources and its gold. */
export const filesOf = (c: EvalCase): string[] => [...c.sources.map(s => s.file), GOLD];

const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
export async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export type CheckedFiles = { ok: true; files: Map<string, Uint8Array> } | { ok: false; message: string };

/**
 * The files a caller sent for a case (path → base64), taken only when they are exactly the case's files
 * and each one's SHA-256 is the recorded one.
 */
export async function checkCaseFiles(caseId: string, given: unknown): Promise<CheckedFiles> {
  const c = Object.hasOwn(CASES, caseId) ? CASES[caseId] : null;
  if (!c) return { ok: false, message: 'Unknown case.' };
  if (!given || typeof given !== 'object' || Array.isArray(given)) return { ok: false, message: 'The case\'s files are required.' };
  const sent = given as Record<string, unknown>;
  const wanted = filesOf(c);
  const extra = Object.keys(sent).filter(k => !wanted.includes(k));
  if (extra.length) return { ok: false, message: `Not a file of this case: ${extra.slice(0, 3).join(', ')}.` };
  const files = new Map<string, Uint8Array>();
  for (const file of wanted) {
    const b64 = sent[file];
    if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return { ok: false, message: `Missing or unreadable: ${file}.` };
    const bytes = fromBase64(b64);
    if ((await sha256(bytes)) !== CORPUS_SHA256[c.dir]?.[file]) return { ok: false, message: `${file} is not the file recorded for this case.` };
    files.set(file, bytes);
  }
  return { ok: true, files };
}
