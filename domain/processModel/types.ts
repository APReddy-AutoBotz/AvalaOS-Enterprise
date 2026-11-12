// The Process Model: the single, editable representation of one business process.
// Assessment, documents, flows and work proposals are all derived from it.
//
// Rules this shape enforces by construction:
// - Every extracted element carries the sources it came from.
// - Unknown is explicit (status 'unknown' or value null), never a default.
// - Access to a system is a list of methods, each with its own confirmation status,
//   so "API-first" never rests on an assumed API.

export const PROCESS_MODEL_SCHEMA_VERSION = 1 as const;

/** How a value came to be in the model. */
export type FactStatus =
  | 'stated' // said or written in a source
  | 'inferred' // derived from sources, not said outright
  | 'user-confirmed' // set or confirmed by a person in the product
  | 'assumed' // a working assumption someone recorded; must be confirmed later
  | 'unknown'; // known to be missing

/** Where in a source a fact was found. Only the fields that apply to the source type are set. */
export interface SourceLocator {
  page?: number;
  section?: string; // e.g. "6.4" in an SOP
  heading?: string;
  lineStart?: number;
  lineEnd?: number;
  timestamp?: string; // "00:12:41" in a transcript
  speaker?: string;
  cell?: string; // "Sheet1!B12"
  shapeId?: string; // a flowchart shape or edge id
}

export interface SourceRef {
  sourceId: string;
  locator: SourceLocator;
  /** Verbatim text from the source. Verified against the source before it is stored. */
  excerpt: string;
}

/** Common to every element in the model. */
export interface Provenance {
  status: FactStatus;
  sources: SourceRef[];
}

/** A single value with its provenance. `value` is null when status is 'unknown'. */
export interface Fact<T> extends Provenance {
  value: T | null;
  note?: string;
}

export interface ScopeItem extends Provenance {
  id: string;
  text: string;
}

export type MetricKind =
  | 'volume'
  | 'handling_time'
  | 'cycle_time'
  | 'fte'
  | 'exception_rate'
  | 'share'
  | 'other';

export interface Metric extends Provenance {
  id: string;
  kind: MetricKind;
  label: string;
  value: number | null;
  /** A range when the source gave one ("10 to 12 minutes"). */
  range?: [number, number];
  unit: string; // "invoices/month", "minutes", "%", "FTE", "working days"
  /** What the metric applies to: the whole process, a step id or a case type. */
  appliesTo?: string;
  period?: string;
}

/** How much change is expected in the next six months. */
export type ChangeLevel = 'none' | 'minor' | 'major';

/**
 * What the assessment needs to know about the process as a whole, beyond its metrics. Each is a
 * Fact: read from the sources where they say it, entered by a person where they do not.
 */
/** The step facts that can be answered once for the whole process. */
export type TypicalTraits = Pick<StepTraits, 'rulesComplete' | 'input' | 'judgment' | 'physical' | 'language' | 'write'>;

export interface ProcessProfile {
  /** Answers given for the process as a whole. A step uses one where it has no fact of its own. */
  typical?: TypicalTraits;
  /** Change expected to the way the process is done in the next six months. */
  processChange?: Fact<ChangeLevel>;
  /** Change expected to the applications it uses in the next six months. */
  systemChange?: Fact<ChangeLevel>;
}

export interface ProcessMeta {
  name: string;
  objective: Fact<string>;
  owner: Fact<string>;
  scopeIn: ScopeItem[];
  scopeOut: ScopeItem[];
  metrics: Metric[];
  profile?: ProcessProfile;
}

export type RoleKind = 'person_role' | 'team' | 'external' | 'system_actor';

export interface Role extends Provenance {
  id: string;
  name: string;
  kind: RoleKind;
  inScope: boolean;
}

export type AccessMethodKind = 'api' | 'ui' | 'file' | 'database' | 'event' | 'email';

export type AccessStatus =
  | 'confirmed' // someone accountable confirmed it exists and can be used
  | 'reported' // mentioned as existing, not confirmed for use
  | 'unknown' // nobody has said
  | 'confirmed_absent'; // confirmed not available

export interface AccessMethod extends Provenance {
  method: AccessMethodKind;
  /** A named interface where one was given, e.g. an OData service name. */
  name?: string;
  operations: string[];
  access: AccessStatus;
  note?: string;
}

export type SystemKind =
  | 'erp'
  | 'email'
  | 'document_store'
  | 'spreadsheet'
  | 'workflow'
  | 'portal'
  | 'scanner'
  | 'other';

export interface SystemRef extends Provenance {
  id: string;
  name: string;
  kind: SystemKind;
  version?: string;
  inScope: boolean;
  access: AccessMethod[];
  /** Whether the screens are stable enough for UI automation; absent means unknown. */
  uiStable?: Fact<boolean>;
  /** Whether robots may drive its screens. False when policy or security forbids UI automation (for example SAP GUI scripting disabled). */
  uiAllowed?: Fact<boolean>;
  /** Reached through a remote desktop (Citrix or similar), where a robot sees only an image of the screen. */
  remote?: Fact<boolean>;
}

export type TaskType = 'user' | 'manual' | 'service' | 'business_rule' | 'send' | 'receive';

export type InputForm = 'structured' | 'semi_structured' | 'unstructured' | 'paper';
export type WriteImpact = 'none' | 'record' | 'financial' | 'irreversible';

/**
 * What the assessment needs to know about a step. Every trait is a Fact: absent or unknown means
 * nobody has said, and the assessment reports it as something that could change the result.
 */
export interface StepTraits {
  /** Rework, duplicate entry, or work with no output of its own. */
  rework?: Fact<boolean>;
  /** A physical action: handling paper, signing, scanning, moving goods. */
  physical?: Fact<boolean>;
  /** Policy or legal judgment, or a decision someone is accountable for. */
  judgment?: Fact<boolean>;
  /** The form of the step's main input. */
  input?: Fact<InputForm>;
  /** The rules the step follows are stated in full and stable. */
  rulesComplete?: Fact<boolean>;
  /** The step drafts, summarises or classifies free text. */
  language?: Fact<boolean>;
  /** The most serious thing the step changes. */
  write?: Fact<WriteImpact>;
  /** Hands-on effort per case, in minutes. */
  effortMinutes?: Fact<number>;
  /** Share of cases that pass through the step, 0 to 100. */
  sharePercent?: Fact<number>;
  /** The five conditions that all have to hold before an agent is worth considering. */
  agent?: {
    /** The right next action cannot be written down as rules in advance. */
    ambiguity?: Fact<boolean>;
    /** The next step depends on what the previous one found. */
    adaptive?: Fact<boolean>;
    /** The work needs a choice between tools or lines of investigation. */
    toolChoice?: Fact<boolean>;
    /** An agent adds value over rules plus a person. */
    value?: Fact<boolean>;
    /** Its actions can be bounded, logged and reversed. */
    controllable?: Fact<boolean>;
  };
}

export interface Step extends Provenance {
  id: string;
  name: string; // verb + object
  description: string;
  roleIds: string[];
  systemIds: string[];
  taskType: TaskType;
  inputs: string[];
  outputs: string[];
  ruleIds: string[];
  exceptionIds: string[];
  traits?: StepTraits;
}

export interface ProcessEvent extends Provenance {
  id: string;
  kind: 'start' | 'end';
  name: string;
}

export interface Gateway extends Provenance {
  id: string;
  type: 'exclusive' | 'parallel';
  question: string;
}

export interface Flow {
  id: string;
  from: string;
  to: string;
  label?: string;
  isException?: boolean;
}

export interface BusinessRule extends Provenance {
  id: string;
  name: string;
  condition: string;
  action: string;
}

export interface ExceptionPath extends Provenance {
  id: string;
  kind: 'business' | 'application';
  name: string;
  trigger: string;
  stepIds: string[];
  handling: string;
  routedToRoleId?: string;
}

export interface DataObject extends Provenance {
  id: string;
  name: string;
  format: string;
  structured: boolean | null;
  classification?: string;
}

export interface Note extends Provenance {
  id: string;
  text: string;
  stepIds: string[];
}

export interface Control extends Note {
  ruleIds: string[];
}

export interface ElementTarget {
  kind: 'meta' | 'role' | 'system' | 'step' | 'gateway' | 'rule' | 'exception' | 'metric' | 'data';
  id?: string;
  field?: string;
}

export interface OpenQuestion {
  id: string;
  target: ElementTarget;
  question: string;
  whyItMatters: string;
  owner: string | null;
  status: 'open' | 'answered' | 'deferred';
  answer?: string;
}

export interface Conflict {
  id: string;
  target: ElementTarget;
  summary: string;
  values: { value: string; sources: SourceRef[] }[];
  resolution: { chosen: string; by: string; reason: string } | null;
}

export interface ProcessModel {
  schemaVersion: typeof PROCESS_MODEL_SCHEMA_VERSION;
  meta: ProcessMeta;
  roles: Role[];
  systems: SystemRef[];
  events: ProcessEvent[];
  steps: Step[];
  gateways: Gateway[];
  flows: Flow[];
  rules: BusinessRule[];
  exceptions: ExceptionPath[];
  dataObjects: DataObject[];
  painPoints: Note[];
  controls: Control[];
  risks: Note[];
  openQuestions: OpenQuestion[];
  conflicts: Conflict[];
}
