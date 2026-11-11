// PDF with a text layer, through pdf.js. The caller passes the pdf.js module so the same code runs
// in the browser (with its worker) and in Node tests (the legacy build).
// Text is grouped into lines by baseline, and lines into paragraphs by spacing. A document with
// little or no text is reported as needing OCR rather than returning nothing.
import { leadingSection, SegmentBuilder, type IngestSegment } from '../segment.ts';
import type { SourceLocator } from '../../processModel/types.ts';

/** The part of pdf.js this parser uses. */
export interface PdfJs {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; disableFontFace?: boolean; useSystemFonts?: boolean; verbosity?: number }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup?(): void }>;
    }>;
    destroy(): Promise<void>;
  };
}

interface TextItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }

/** Fewer characters than this per page on average means the pages are images. */
export const MIN_CHARS_PER_PAGE = 40;

export async function parsePdf(bytes: Uint8Array, sourceId: string, pdfjs: PdfJs): Promise<{ segments: IngestSegment[]; needsOcr: boolean; pages: number }> {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const b = new SegmentBuilder(sourceId);
  let chars = 0;
  let section: string | undefined;
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const items = (content.items as TextItem[]).filter(i => typeof i.str === 'string' && Array.isArray(i.transform));

      // Lines: items whose baselines are within half a glyph height belong together.
      const lines: { y: number; h: number; parts: { x: number; end: number; str: string }[] }[] = [];
      for (const it of items) {
        if (!it.str.trim()) continue;
        const x = it.transform[4];
        const y = it.transform[5];
        const h = Math.abs(it.height || it.transform[3] || 10);
        let line = lines.find(l => Math.abs(l.y - y) < Math.max(l.h, h) * 0.5);
        if (!line) { line = { y, h, parts: [] }; lines.push(line); }
        line.parts.push({ x, end: x + (it.width || 0), str: it.str });
        line.h = Math.max(line.h, h);
      }
      lines.sort((a, b2) => b2.y - a.y);
      const texts = lines.map(l => {
        l.parts.sort((a, b2) => a.x - b2.x);
        let s = '';
        let prevEnd = -Infinity;
        for (const p of l.parts) {
          const gap = p.x - prevEnd;
          if (s && gap > l.h * 0.15 && !s.endsWith(' ') && !p.str.startsWith(' ')) s += ' ';
          s += p.str;
          prevEnd = p.end;
        }
        return s.replace(/\s+/g, ' ').trim();
      });
      chars += texts.join('').length;

      // Paragraphs: a larger gap, a numbered or bulleted line, or a short line ending a sentence starts a new one.
      let para: { text: string; start: number; end: number } | null = null;
      const flush = () => {
        if (!para) return;
        const s = leadingSection(para.text);
        if (s) section = s;
        const l: SourceLocator = { page: pageNo, lineStart: para.start, lineEnd: para.end };
        if (section) l.section = section;
        b.add(/^(\d+[.)]|[-•*])\s/.test(para.text) ? 'list_item' : 'paragraph', para.text, l);
        para = null;
      };
      texts.forEach((t, i) => {
        const n = i + 1;
        const gap = i > 0 ? lines[i - 1].y - lines[i].y : 0;
        const startsNew = i === 0 || gap > lines[i].h * 1.8 || /^(\d+(\.\d+)*[.)]?|[-•*])\s/.test(t);
        if (startsNew) flush();
        if (!para) para = { text: t, start: n, end: n };
        else { para.text = para.text.endsWith('-') ? para.text.slice(0, -1) + t : `${para.text} ${t}`; para.end = n; }
      });
      flush();
      page.cleanup?.();
    }
    const pages = doc.numPages;
    return { segments: b.segments, needsOcr: pages > 0 && chars / pages < MIN_CHARS_PER_PAGE, pages };
  } finally {
    await task.destroy();
  }
}
