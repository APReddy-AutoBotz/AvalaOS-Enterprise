// Plain text, Markdown and transcripts (WebVTT, SRT, and text exports with "[hh:mm:ss] Name: text").
import { leadingSection, SegmentBuilder, type IngestSegment } from '../segment.ts';
import type { SourceLocator } from '../../processModel/types.ts';

const lines = (text: string) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');

/** "00:04:34.120" or "04:34,120" -> "00:04:34". */
function clock(t: string): string {
  const parts = t.trim().split(/[.,]/)[0].split(':');
  while (parts.length < 3) parts.unshift('00');
  return parts.map(p => p.padStart(2, '0')).join(':');
}

const TIMING = /^((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

/** "Name: text" at the start of a cue. Kept short so ordinary sentences with a colon are not mistaken for it. */
const SPEAKER_PREFIX = /^([\p{Lu}][\p{L}.'-]*(?: [\p{Lu}][\p{L}.'-]*){0,3}):\s+([\s\S]+)$/u;

function splitSpeaker(text: string): { speaker?: string; text: string } {
  const m = SPEAKER_PREFIX.exec(text);
  return m ? { speaker: m[1], text: m[2] } : { text };
}

export function parseVtt(text: string, sourceId: string): IngestSegment[] {
  const b = new SegmentBuilder(sourceId);
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const ls = block.split('\n').filter(l => l.trim() !== '');
    const t = ls.findIndex(l => TIMING.test(l));
    if (t < 0) continue; // header, NOTE, STYLE and REGION blocks
    const start = clock(TIMING.exec(ls[t])![1]);
    let body = ls.slice(t + 1).join('\n');
    let speaker: string | undefined;
    const voice = /<v(?:\.[\w.]+)?\s+([^>]+)>/.exec(body);
    if (voice) speaker = voice[1].trim();
    body = body.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n/g, ' ');
    if (!speaker) ({ speaker, text: body } = splitSpeaker(body));
    const locator: SourceLocator = { timestamp: start };
    if (speaker) locator.speaker = speaker;
    b.add('cue', body, locator);
  }
  return b.segments;
}

export function parseSrt(text: string, sourceId: string): IngestSegment[] {
  const b = new SegmentBuilder(sourceId);
  for (const block of text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const ls = block.split('\n').filter(l => l.trim() !== '');
    const t = ls.findIndex(l => TIMING.test(l));
    if (t < 0) continue;
    const start = clock(TIMING.exec(ls[t])![1]);
    const body = ls.slice(t + 1).join(' ').replace(/<[^>]+>/g, '');
    const { speaker, text: said } = splitSpeaker(body);
    const locator: SourceLocator = { timestamp: start };
    if (speaker) locator.speaker = speaker;
    b.add('cue', said, locator);
  }
  return b.segments;
}

const STAMPED = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s+(.+)$/;

/** True when at least three lines look like "[00:01:02] Name: text". */
export function looksLikeTranscript(text: string): boolean {
  return lines(text).filter(l => STAMPED.test(l.trim()) && SPEAKER_PREFIX.test(STAMPED.exec(l.trim())![2])).length >= 3;
}

/** A text export of a meeting. Lines before the first stamped line (title, attendees) are kept as paragraphs. */
export function parseTranscriptText(text: string, sourceId: string): IngestSegment[] {
  const b = new SegmentBuilder(sourceId);
  let cue: { text: string; locator: SourceLocator } | null = null;
  const flush = () => { if (cue) b.add('cue', cue.text, cue.locator); cue = null; };
  lines(text).forEach((raw, i) => {
    const line = raw.trim();
    const m = STAMPED.exec(line);
    if (m) {
      flush();
      const { speaker, text: said } = splitSpeaker(m[2]);
      const locator: SourceLocator = { timestamp: clock(m[1]), lineStart: i + 1 };
      if (speaker) locator.speaker = speaker;
      cue = { text: said, locator };
    } else if (!line) {
      flush();
    } else if (cue) {
      (cue as { text: string }).text += `\n${line}`;
    } else {
      b.add('paragraph', line, { lineStart: i + 1, lineEnd: i + 1 });
    }
  });
  flush();
  return b.segments;
}

/** Plain text and Markdown: headings, list items and paragraphs, with line numbers and sections. */
export function parsePlainText(text: string, sourceId: string, markdown: boolean): IngestSegment[] {
  const b = new SegmentBuilder(sourceId);
  let section: string | undefined;
  let heading: string | undefined;
  let para: { text: string[]; start: number; end: number } | null = null;
  const loc = (start: number, end: number): SourceLocator => {
    const l: SourceLocator = { lineStart: start, lineEnd: end };
    if (section) l.section = section;
    if (heading) l.heading = heading;
    return l;
  };
  const flush = () => {
    if (!para) return;
    const t = para.text.join(markdown ? ' ' : '\n');
    const s = leadingSection(t);
    if (s) section = s;
    b.add('paragraph', t, loc(para.start, para.end));
    para = null;
  };
  let fenced = false;
  lines(text).forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trimEnd();
    if (markdown && /^\s*(```|~~~)/.test(line)) { flush(); fenced = !fenced; return; }
    if (markdown && fenced) { para ??= { text: [], start: n, end: n }; para.text.push(line); para.end = n; return; }
    if (!line.trim()) { flush(); return; }
    const h = markdown ? /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line) : null;
    if (h) {
      flush();
      heading = h[2];
      section = leadingSection(h[2]) ?? section;
      b.add('heading', h[2], loc(n, n), h[1].length);
      return;
    }
    const li = /^(\s*)([-*+•]|\d{1,3}[.)]|[a-z][.)])\s+(.*)$/.exec(line);
    if (li && (markdown || /^[-*•]|\d/.test(li[2]))) {
      flush();
      const numbered = /\d/.test(li[2]);
      const itemText = numbered ? `${li[2]} ${li[3]}` : li[3];
      const s = leadingSection(itemText);
      if (s && s.includes('.')) section = s;
      b.add('list_item', itemText, loc(n, n), Math.floor(li[1].replace(/\t/g, '  ').length / 2));
      return;
    }
    para ??= { text: [], start: n, end: n };
    para.text.push(line.trim());
    para.end = n;
  });
  flush();
  return b.segments;
}
