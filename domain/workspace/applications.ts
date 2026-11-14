// The workspace's applications list: each application's name, other names it goes by in sources,
// kind, how it can be reached with what is confirmed, and two screen facts (may robots drive its
// screens; is it reached through a remote desktop). People enter it; extraction never writes it.
// A process takes these facts only when a person accepts them (see `applicationOffer`).
import type { AccessMethodKind, AccessStatus, SystemKind, SystemRef } from '../processModel/types.ts';

export interface AppAccess { method: AccessMethodKind; name?: string; operations: string[]; access: AccessStatus; note?: string }
export interface Application {
  id: string;
  name: string;
  aliases: string[];
  kind: SystemKind;
  access: AppAccess[];
  uiAllowed: boolean | null;
  remote: boolean | null;
  notes: string;
  updatedAt?: string;
  updatedBy?: string | null;
}
export type ApplicationInput = Omit<Application, 'id' | 'updatedAt' | 'updatedBy'>;

export const APP_LIMITS = { name: 120, aliases: 20, access: 30, operations: 30, text: 200, notes: 4000 } as const;
export const ACCESS_METHODS: { value: AccessMethodKind; label: string }[] = [
  { value: 'api', label: 'API' }, { value: 'ui', label: 'Screens' }, { value: 'file', label: 'File' },
  { value: 'database', label: 'Database' }, { value: 'event', label: 'Events' }, { value: 'email', label: 'Email' },
];
export const ACCESS_STATUSES: { value: AccessStatus; label: string }[] = [
  { value: 'confirmed', label: 'Confirmed available' }, { value: 'reported', label: 'Reported, not confirmed' },
  { value: 'confirmed_absent', label: 'Not available' }, { value: 'unknown', label: 'Unknown' },
];
const KINDS: SystemKind[] = ['erp', 'email', 'document_store', 'spreadsheet', 'workflow', 'portal', 'scanner', 'other'];

export class ApplicationError extends Error {}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
/** A name as compared: lower case, letters and digits only ("SAP S/4HANA" and "sap s4hana" are one). */
export const nameKey = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');

/** Checks and tidies an application before it is saved; throws ApplicationError with a plain message. */
export function validateApplication(input: ApplicationInput, others: Pick<Application, 'id' | 'name' | 'aliases'>[] = [], selfId?: string): ApplicationInput {
  const name = clean(input.name);
  if (!name) throw new ApplicationError('Give the application a name.');
  if (name.length > APP_LIMITS.name) throw new ApplicationError(`Keep the name under ${APP_LIMITS.name} characters.`);
  if (!KINDS.includes(input.kind)) throw new ApplicationError('Choose what kind of application it is.');
  const aliases: string[] = [];
  for (const a of input.aliases.map(clean).filter(Boolean)) {
    if (a.length > APP_LIMITS.name) throw new ApplicationError(`Keep each other name under ${APP_LIMITS.name} characters.`);
    if (nameKey(a) !== nameKey(name) && !aliases.some(x => nameKey(x) === nameKey(a))) aliases.push(a);
  }
  if (aliases.length > APP_LIMITS.aliases) throw new ApplicationError(`At most ${APP_LIMITS.aliases} other names.`);
  const mine = new Set([name, ...aliases].map(nameKey));
  for (const o of others) {
    if (o.id === selfId) continue;
    const clash = [o.name, ...o.aliases].find(n => mine.has(nameKey(n)));
    if (clash) throw new ApplicationError(`"${clash}" is already on the list${clash === o.name ? '' : ` as another name of ${o.name}`}.`);
  }
  if (input.access.length > APP_LIMITS.access) throw new ApplicationError(`At most ${APP_LIMITS.access} ways in.`);
  const access = input.access.map(a => {
    if (!ACCESS_METHODS.some(m => m.value === a.method)) throw new ApplicationError('Choose how the application is reached.');
    if (!ACCESS_STATUSES.some(s => s.value === a.access)) throw new ApplicationError('Choose whether that way in is available.');
    const operations = [...new Set(a.operations.map(clean).filter(Boolean))];
    if (operations.length > APP_LIMITS.operations || operations.some(o => o.length > APP_LIMITS.text)) throw new ApplicationError(`At most ${APP_LIMITS.operations} operations, each under ${APP_LIMITS.text} characters.`);
    const nm = clean(a.name ?? ''), note = clean(a.note ?? '');
    if (nm.length > APP_LIMITS.text || note.length > APP_LIMITS.text * 2) throw new ApplicationError('Keep the interface name and note short.');
    return { method: a.method, ...(nm ? { name: nm } : {}), operations, access: a.access, ...(note ? { note } : {}) };
  });
  const notes = input.notes.trim();
  if (notes.length > APP_LIMITS.notes) throw new ApplicationError(`Keep the notes under ${APP_LIMITS.notes} characters.`);
  return { name, aliases, kind: input.kind, access, uiAllowed: input.uiAllowed, remote: input.remote, notes };
}

/** Other names typed as one line, separated by commas or semicolons. */
export const parseAliases = (text: string) => text.split(/[,;\n]/).map(clean).filter(Boolean);
export const parseOperations = parseAliases;

/**
 * The application on the list a process's system is, by name: its name or one of its other names,
 * compared without case, spaces or punctuation; a name in brackets after the system's name is ignored
 * ("AP shared mailbox (Microsoft 365)" matches "AP shared mailbox"). Never by a partial name: a wrong
 * match would bring another application's facts.
 */
export function matchApplication(system: Pick<SystemRef, 'name'>, apps: Application[]): Application | null {
  const keys = new Set([nameKey(system.name), nameKey(system.name.replace(/\s*\([^)]*\)\s*$/, ''))].filter(Boolean));
  return apps.find(a => [a.name, ...a.aliases].some(n => keys.has(nameKey(n)))) ?? null;
}

const statusWord = (s: AccessStatus) => ACCESS_STATUSES.find(x => x.value === s)!.label.toLowerCase();
const methodWord = (m: AccessMethodKind) => ACCESS_METHODS.find(x => x.value === m)!.label;
/** One way in, in words: "API API_SUPPLIER_INVOICE: confirmed available". */
export const accessText = (a: AppAccess) => `${methodWord(a.method)}${a.name ? ` ${a.name}` : ''}: ${statusWord(a.access)}`;

/** A short line for the list: what is confirmed, and the screen facts that are known. */
export function applicationSummary(a: Application): string {
  const parts = a.access.map(accessText);
  if (a.uiAllowed !== null) parts.push(a.uiAllowed ? 'robots may use its screens' : 'robots may not use its screens');
  if (a.remote !== null) parts.push(a.remote ? 'reached through a remote desktop' : 'not through a remote desktop');
  return parts.length ? parts.join('; ') : 'Nothing recorded yet about how it is reached';
}
