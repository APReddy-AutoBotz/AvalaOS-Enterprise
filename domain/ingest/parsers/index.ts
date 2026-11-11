// One entry point: bytes and a file name in, ordered segments or a clear state out.
import type { ParseResult, SourceFormat } from '../segment.ts';
import { looksLikeTranscript, parsePlainText, parseSrt, parseTranscriptText, parseVtt } from './text.ts';
import { parseDocx } from './docx.ts';
import { parseXlsx } from './xlsx.ts';
import { parsePdf, type PdfJs } from './pdf.ts';
import { ZipError } from '../zip.ts';
import { parseDrawio } from '../../flowchart/drawio.ts';
import { parseBpmn } from '../../flowchart/bpmn.ts';
import { graphToSegments, type FlowGraph } from '../../flowchart/graph.ts';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface ParseOptions {
  /** pdf.js, needed only for PDF files. */
  pdfjs?: PdfJs | (() => Promise<PdfJs>);
}

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

function textFormat(name: string, text: string): SourceFormat {
  const e = ext(name);
  if (e === 'vtt' || /^﻿?WEBVTT/.test(text)) return 'vtt';
  if (e === 'srt' || /^﻿?\d+\r?\n\d{2}:\d{2}:\d{2},\d{3} -->/.test(text)) return 'srt';
  if (e === 'md' || e === 'markdown') return 'md';
  return looksLikeTranscript(text) ? 'transcript_txt' : 'txt';
}

export async function parseFile(file: { name: string; bytes: Uint8Array; sourceId: string }, opts: ParseOptions = {}): Promise<ParseResult> {
  const { name, bytes, sourceId } = file;
  if (bytes.length === 0) return { status: 'empty', format: 'unknown', message: 'The file is empty.' };
  if (bytes.length > MAX_FILE_BYTES) return { status: 'unsupported', format: 'unknown', message: `Files larger than ${MAX_FILE_BYTES / 1024 / 1024} MB are not supported.` };
  const e = ext(name);

  try {
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46]) || e === 'pdf') {
      if (!opts.pdfjs) return { status: 'error', format: 'pdf', message: 'PDF reading is not available here.' };
      const pdfjs = typeof opts.pdfjs === 'function' ? await opts.pdfjs() : opts.pdfjs;
      const r = await parsePdf(bytes, sourceId, pdfjs);
      if (r.needsOcr) return { status: 'needs_ocr', format: 'pdf', message: 'This PDF has little or no selectable text (it looks scanned). Run OCR on it, or upload the original document.' };
      return r.segments.length ? { status: 'ok', format: 'pdf', segments: r.segments, warnings: [] } : { status: 'empty', format: 'pdf', message: 'No text was found.' };
    }
    if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
      return { status: 'unsupported', format: 'unknown', message: 'Old Word and Excel formats (.doc, .xls) are not supported. Save the file as .docx or .xlsx.' };
    }
    if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
      if (e === 'xlsx' || e === 'xlsm') {
        const r = await parseXlsx(bytes, sourceId);
        return r.segments.length ? { status: 'ok', format: 'xlsx', segments: r.segments, warnings: r.warnings } : { status: 'empty', format: 'xlsx', message: 'No cell values were found.' };
      }
      if (e === 'docx' || e === 'docm' || e === '') {
        const segments = await parseDocx(bytes, sourceId);
        return segments.length ? { status: 'ok', format: 'docx', segments, warnings: [] } : { status: 'empty', format: 'docx', message: 'No text was found.' };
      }
      return { status: 'unsupported', format: 'unknown', message: `.${e} files are not supported here.` };
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(e)) {
      return { status: 'needs_vision', format: 'image', message: 'Images are read as flowcharts by the AI; what is read from them is marked inferred.' };
    }
    if (['svg', 'vsdx', 'vsd'].includes(e)) {
      return { status: 'unsupported', format: 'unknown', message: 'Export the diagram as draw.io, BPMN or PNG and upload that.' };
    }

    const text = new TextDecoder('utf-8').decode(bytes);
    if (text.includes('\u0000')) return { status: 'unsupported', format: 'unknown', message: 'This looks like a binary file, not text.' };
    if (e === 'drawio' || e === 'bpmn' || (e === 'xml' && /<mxfile\b|<mxGraphModel\b|<(\w+:)?definitions\b/.test(text))) {
      const isDrawio = e === 'drawio' || /<mxfile\b|<mxGraphModel\b/.test(text);
      const graph = isDrawio ? await parseDrawio(text) : parseBpmn(text);
      return flowchartResult(graph, sourceId, isDrawio ? 'drawio' : 'bpmn');
    }
    const format = textFormat(name, text);
    const segments =
      format === 'vtt' ? parseVtt(text, sourceId)
        : format === 'srt' ? parseSrt(text, sourceId)
          : format === 'transcript_txt' ? parseTranscriptText(text, sourceId)
            : parsePlainText(text, sourceId, format === 'md');
    return segments.length ? { status: 'ok', format, segments, warnings: [] } : { status: 'empty', format, message: 'No text was found.' };
  } catch (err) {
    const message = err instanceof ZipError ? `The file could not be opened: ${err.message}` : `The file could not be read: ${(err as Error).message}`;
    return { status: 'error', format: 'unknown', message };
  }
}

/** A parsed flowchart as segments, one per shape. */
export function flowchartResult(graph: FlowGraph, sourceId: string, format: 'drawio' | 'bpmn'): ParseResult {
  const segments = graphToSegments(graph, sourceId);
  return segments.length ? { status: 'ok', format, segments, warnings: graph.warnings } : { status: 'empty', format, message: 'No shapes were found in the diagram.' };
}
