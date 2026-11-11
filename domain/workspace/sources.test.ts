import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFromName, quoteInContext, sourceKey, titleFromFileName } from './sources.ts';
import type { IngestSegment } from '../ingest/segment.ts';

test('source keys are short, by kind, and never reused', () => {
  assert.equal(sourceKey('vtt', []), 'call-1');
  assert.equal(sourceKey('srt', ['call-1', 'doc-1']), 'call-2');
  assert.equal(sourceKey('image', ['flow-1']), 'flow-2');
  assert.equal(formatFromName('Flow.PNG'), 'image');
  assert.equal(formatFromName('notes'), 'txt');
  assert.equal(titleFromFileName('04-SOP_vendor-invoice.docx'), '04 SOP vendor invoice');
});

test('a quote is found in its segment, ignoring case, spacing and quote marks, with its neighbours', () => {
  const seg = (n: number, text: string, timestamp: string): IngestSegment => ({ id: `call-1:${n}`, sourceId: 'call-1', kind: 'cue', text, locator: { timestamp } });
  const segs = [seg(1, 'Hello.', '00:00:01'), seg(2, 'We check the  “PO number” first, then the GSTIN.', '00:00:05'), seg(3, 'Bye.', '00:00:09')];
  const q = quoteInContext(segs, { sourceId: 'call-1', locator: { timestamp: '00:00:05' }, excerpt: 'we check the "po number" first' })!;
  assert.equal(q.segment.id, 'call-1:2');
  assert.equal(q.before?.id, 'call-1:1');
  assert.equal(q.after?.id, 'call-1:3');
  assert.equal(segs[1].text.slice(...q.range!), 'We check the  “PO number” first');
  assert.equal(quoteInContext(segs, { sourceId: 'call-1', locator: {}, excerpt: 'not there' }), null);
});
