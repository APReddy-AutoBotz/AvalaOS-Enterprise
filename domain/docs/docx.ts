// A document tree as a Word file: cover with document control, a contents field Word fills in on
// opening, numbered headings, captioned tables with a repeating header row, header and footer with
// page numbers, and a draft marking until the revision is approved. The look (font, accent colour,
// organisation name) comes from a style, so a company's own branding can be applied.
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, LevelFormat, PageBreak, PageNumber, Packer, Paragraph,
  ShadingType, Table, TableCell, TableOfContents, TableRow, TextRun, WidthType, type IStylesOptions,
} from 'docx';
import type { Block, Cell, DocTree } from './tree.ts';

export interface DocxStyle {
  /** Body and heading font. */
  font: string;
  /** Hex colour without # for headings, rules and table headers. */
  accent: string;
  /** Shown in the header before the document type, for example the organisation name. */
  organisation?: string;
}
export const DEFAULT_DOCX_STYLE: DocxStyle = { font: 'Calibri', accent: '002C4B' };

const PT = (n: number) => n * 2; // docx sizes are half-points
const AMBER = 'B45309';
const GREY = '64748B';
const STATUS_NOTE: Record<string, string> = { inferred: 'inferred', assumed: 'assumed', unknown: 'unknown' };

function cellRuns(c: Cell, size: number, bold = false, color?: string): TextRun[] {
  if (c.missing) return [new TextRun({ text: c.text, italics: true, color: AMBER, size })];
  const runs = [new TextRun({ text: c.text, bold, color, size })];
  if (c.status && STATUS_NOTE[c.status]) runs.push(new TextRun({ text: ` (${STATUS_NOTE[c.status]})`, italics: true, color: GREY, size: size - 2 }));
  return runs;
}

const thin = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
const borders = { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin };

function table(columns: string[], rows: Cell[][], s: DocxStyle): Table {
  const size = PT(columns.length > 6 ? 8 : 9);
  const header = new TableRow({
    tableHeader: true,
    children: columns.map(c => new TableCell({ shading: { type: ShadingType.CLEAR, fill: s.accent, color: 'auto' }, children: [new Paragraph({ children: [new TextRun({ text: c, bold: true, color: 'FFFFFF', size })] })] })),
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders,
    rows: [header, ...rows.map(r => new TableRow({ cantSplit: true, children: r.map(c => new TableCell({ children: [new Paragraph({ children: cellRuns(c, size) })] })) }))],
  });
}

function caption(text: string, s: DocxStyle) {
  return new Paragraph({ keepNext: true, spacing: { before: 160, after: 60 }, children: [new TextRun({ text, bold: true, color: s.accent, size: PT(9), allCaps: true })] });
}

function block(b: Block, s: DocxStyle): (Paragraph | Table)[] {
  switch (b.kind) {
    case 'paragraph': return [new Paragraph({ text: b.text, spacing: { after: 120 } })];
    case 'list': return b.items.map(i => new Paragraph({ text: i, numbering: { reference: 'bullets', level: 0 } }));
    case 'callout': return [new Paragraph({ spacing: { before: 80, after: 120 }, shading: { type: ShadingType.CLEAR, fill: b.tone === 'warning' ? 'FEF3C7' : 'F1F5F9', color: 'auto' },
      children: [new TextRun({ text: b.tone === 'warning' ? 'Caution. ' : '', bold: true }), new TextRun(b.text)] })];
    case 'openItem': return [new Paragraph({ spacing: { before: 80, after: 120 }, shading: { type: ShadingType.CLEAR, fill: 'FEF3C7', color: 'auto' },
      children: [new TextRun({ text: 'Open: ', bold: true, color: AMBER }), new TextRun(b.item.text)] })];
    case 'keyValue': return [caption(b.caption, s), new Table({
      width: { size: 100, type: WidthType.PERCENTAGE }, borders,
      rows: b.rows.map(r => new TableRow({ cantSplit: true, children: [
        new TableCell({ width: { size: 32, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' }, children: [new Paragraph({ children: [new TextRun({ text: r.key, bold: true, size: PT(9) })] })] }),
        new TableCell({ children: [new Paragraph({ children: cellRuns(r.value, PT(9)) })] }),
      ] })),
    }), new Paragraph({ text: '' })];
    case 'table': return b.rows.length
      ? [caption(b.caption, s), table(b.columns, b.rows, s), new Paragraph({ text: '' })]
      : [new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: `${b.caption}: `, bold: true, size: PT(9) }), new TextRun({ text: b.empty, italics: true, color: GREY, size: PT(9) })] })];
  }
}

export function docxDocument(doc: DocTree, opts: { draft: boolean; style?: DocxStyle }): Document {
  const s = opts.style ?? DEFAULT_DOCX_STYLE;
  const kind = doc.type.toUpperCase();
  const styles: IStylesOptions = {
    default: { document: { run: { font: s.font, size: PT(10) }, paragraph: { spacing: { line: 276 } } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: s.font, size: PT(16), bold: true, color: s.accent }, paragraph: { spacing: { before: 360, after: 160 }, keepNext: true } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: s.font, size: PT(12.5), bold: true, color: '0F172A' }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true } },
      { id: 'Title', name: 'Title', basedOn: 'Normal', run: { font: s.font, size: PT(30), bold: true, color: s.accent } },
    ],
  };
  const cover = [
    new Paragraph({ spacing: { before: 2400 }, children: [new TextRun({ text: (s.organisation ?? '').toUpperCase(), bold: true, color: GREY, size: PT(10) })] }),
    new Paragraph({ style: 'Title', spacing: { before: 120, after: 120 }, children: [new TextRun(doc.title)] }),
    new Paragraph({ spacing: { after: 480 }, border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: s.accent, space: 8 } }, children: [new TextRun({ text: doc.subtitle, size: PT(18), color: '0F172A' })] }),
    ...(opts.draft ? [new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: 'DRAFT: not approved', bold: true, color: 'B91C1C', size: PT(12) })] })] : []),
    caption('Document control', s),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders, rows: doc.control.map(c => new TableRow({ children: [
      new TableCell({ width: { size: 32, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' }, children: [new Paragraph({ children: [new TextRun({ text: c.key, bold: true })] })] }),
      new TableCell({ children: [new Paragraph(c.value)] }),
    ] })) }),
    new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: `${doc.openItems.length} open ${doc.openItems.length === 1 ? 'item is' : 'items are'} listed at the end of this document.`, italics: true, color: GREY })] }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Contents')] }),
    new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
    new Paragraph({ children: [new TextRun({ text: 'If the contents are empty, right-click here and choose Update Field.', italics: true, color: GREY, size: PT(8) })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
  const body = doc.sections.flatMap(sec => [
    new Paragraph({ heading: sec.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, children: [new TextRun(`${sec.number}  ${sec.title}`)] }),
    ...sec.blocks.flatMap(b => block(b, s)),
  ]);
  const small = { size: PT(8), color: GREY };
  return new Document({
    creator: 'AvalaOS', title: `${doc.title}: ${doc.subtitle}`, description: `${kind} for ${doc.subtitle}`,
    features: { updateFields: true },
    styles,
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
    sections: [{
      properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } }, titlePage: true },
      headers: { default: new Header({ children: [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1', space: 4 } }, children: [
        new TextRun({ text: `${s.organisation ? `${s.organisation} · ` : ''}${kind} · ${doc.subtitle}`, ...small }),
        ...(opts.draft ? [new TextRun({ text: '    DRAFT: not approved', bold: true, size: PT(8), color: 'B91C1C' })] : []),
      ] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], ...small })] })] }) },
      children: [...cover, ...body],
    }],
  });
}

/** The Word file, for download in the browser. */
export function toDocxBlob(doc: DocTree, opts: { draft: boolean; style?: DocxStyle }): Promise<Blob> {
  return Packer.toBlob(docxDocument(doc, opts));
}
