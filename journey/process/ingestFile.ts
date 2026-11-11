// Turns an uploaded file into a stored source: parsed here in the browser with the domain parsers,
// or, for an image, read as a flowchart by the AI on the server. Nothing is stored for a file that
// cannot be read; the person is told why.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseFile } from '../../domain/ingest/parsers/index.ts';
import type { PdfJs } from '../../domain/ingest/parsers/pdf.ts';
import { graphToSegments } from '../../domain/flowchart/graph.ts';
import { readingToGraph } from '../../domain/flowchart/vision.ts';
import { formatFromName, FORMAT_LABEL, sourceKey, titleFromFileName, type StoredFormat } from '../../domain/workspace/sources.ts';
import type { JourneyStore, NewSource } from '../store/types.ts';

export const ACCEPT = '.vtt,.srt,.txt,.md,.docx,.pdf,.xlsx,.drawio,.bpmn,.xml,.png,.jpg,.jpeg,.webp';
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

let pdfjs: Promise<PdfJs> | null = null;
const loadPdfJs = () => {
  pdfjs ??= import('pdfjs-dist').then(m => { m.GlobalWorkerOptions.workerSrc = pdfWorkerUrl; return m as unknown as PdfJs; });
  return pdfjs;
};

const dataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error ?? new Error('The file could not be read.'));
  r.readAsDataURL(file);
});

// Both variants name both fields, so narrowing on `ok` works without strictNullChecks.
export type IngestResult = { ok: true; source: NewSource; message?: undefined } | { ok: false; message: string; source?: undefined };

export async function ingestFile(store: JourneyStore, workspaceId: string, file: File, takenKeys: string[]): Promise<IngestResult> {
  const key = sourceKey(formatFromName(file.name), takenKeys);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await parseFile({ name: file.name, bytes, sourceId: key }, { pdfjs: loadPdfJs });
  const base = { key, title: titleFromFileName(file.name), fileName: file.name, byteSize: bytes.length };

  if (r.status === 'ok') {
    const format = r.format as StoredFormat;
    return { ok: true, source: { ...base, format, kind: FORMAT_LABEL[format], segments: r.segments, inferred: false, warnings: r.warnings } };
  }
  if (r.status === 'needs_vision') {
    if (!store.aiAvailable) return { ok: false, message: 'Images are read by the AI on the server, which is not available in local mode. Upload the draw.io or BPMN file instead.' };
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, message: 'The image is larger than 7 MB. Export it smaller, or upload the draw.io or BPMN file.' };
    const reading = await store.readFlowchartImage(workspaceId, await dataUrl(file));
    const graph = readingToGraph(reading);
    const segments = graphToSegments(graph, key);
    if (!graph.nodes.length) return { ok: false, message: 'No flowchart shapes could be read from this image.' };
    return { ok: true, source: { ...base, format: 'image', kind: FORMAT_LABEL.image, segments, inferred: true, warnings: graph.warnings } };
  }
  return { ok: false, message: r.message };
}
