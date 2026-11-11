// Source files become ordered segments: the unit that extraction cites. Every segment carries a
// locator that points back to where it came from (page and line, timestamp and speaker, section,
// sheet and cell), so an excerpt can be shown in context and checked.
import type { SourceLocator } from '../processModel/types.ts';
import type { Segment as GatewaySegment } from '../ai/gateway.ts';

export type SourceFormat = 'txt' | 'md' | 'vtt' | 'srt' | 'transcript_txt' | 'docx' | 'xlsx' | 'pdf' | 'drawio' | 'bpmn';

export type SegmentKind = 'heading' | 'paragraph' | 'list_item' | 'table_row' | 'cue';

export interface IngestSegment {
  id: string;
  sourceId: string;
  kind: SegmentKind;
  text: string;
  locator: SourceLocator;
  /** Heading level (1 = top) or list nesting level (0 = top). */
  level?: number;
}

export type ParseResult =
  | { status: 'ok'; format: SourceFormat; segments: IngestSegment[]; warnings: string[] }
  | { status: 'needs_ocr' | 'needs_vision' | 'unsupported' | 'empty' | 'error'; format: SourceFormat | 'image' | 'unknown'; message: string };

/** Longest segment kept whole. Longer text is split at sentence ends, keeping the same locator. */
export const MAX_SEGMENT_CHARS = 6000;

const SOURCE_ID = /^[A-Za-z0-9._-]{1,24}$/;

export function assertSourceId(sourceId: string): void {
  if (!SOURCE_ID.test(sourceId)) throw new Error('sourceId must be 1 to 24 letters, digits, dot, underscore or hyphen.');
}

/** Collects segments with stable ids `${sourceId}:${n}` and splits overlong text. */
export class SegmentBuilder {
  readonly segments: IngestSegment[] = [];
  private readonly sourceId: string;
  constructor(sourceId: string) {
    assertSourceId(sourceId);
    this.sourceId = sourceId;
  }
  add(kind: SegmentKind, text: string, locator: SourceLocator, level?: number): void {
    const clean = text.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
    if (!clean) return;
    for (const part of splitLong(clean)) {
      const seg: IngestSegment = { id: `${this.sourceId}:${this.segments.length + 1}`, sourceId: this.sourceId, kind, text: part, locator: { ...locator } };
      if (level !== undefined) seg.level = level;
      this.segments.push(seg);
    }
  }
}

function splitLong(text: string): string[] {
  if (text.length <= MAX_SEGMENT_CHARS) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_SEGMENT_CHARS) {
    const window = rest.slice(0, MAX_SEGMENT_CHARS);
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'));
    const at = cut > MAX_SEGMENT_CHARS / 2 ? cut + 1 : MAX_SEGMENT_CHARS;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** A section number at the start of a heading or paragraph: "6.3 Check ..." -> "6.3", "5. Policy" -> "5". */
export function leadingSection(text: string): string | undefined {
  const m = /^(\d{1,3}(?:\.\d{1,3}){0,4})(?:[.)])?\s+\S/.exec(text.trim());
  return m ? m[1] : undefined;
}

/** A short human label for a locator, e.g. "p. 3, lines 4-6", "00:04:34, Meera Iyer", "section 6.3". */
export function locatorLabel(l: SourceLocator): string {
  const parts: string[] = [];
  if (l.timestamp) parts.push(l.timestamp);
  if (l.speaker) parts.push(l.speaker);
  if (l.page !== undefined) parts.push(`p. ${l.page}`);
  if (l.section) parts.push(`section ${l.section}`);
  else if (l.heading) parts.push(l.heading);
  if (l.cell) parts.push(l.cell);
  if (l.lineStart !== undefined && l.timestamp === undefined) {
    parts.push(l.lineEnd !== undefined && l.lineEnd !== l.lineStart ? `lines ${l.lineStart}-${l.lineEnd}` : `line ${l.lineStart}`);
  }
  return parts.join(', ');
}

/** The form the AI gateway takes. */
export function toGatewaySegments(segments: IngestSegment[]): GatewaySegment[] {
  return segments.map(s => ({ id: s.id, text: s.text, sourceId: s.sourceId, locator: locatorLabel(s.locator) }));
}
