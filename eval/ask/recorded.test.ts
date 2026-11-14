// The demo's recorded answers (public/demo-data/ask-answers.json) are played back against the facts the
// panel builds from the demo's own data. Every sentence must still find its fact and its quote there, or
// it would be dropped in the demo; and the recorded questions are exactly the panel's starter questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readAnswer } from '../../domain/assistant/ask.ts';
import { findRecorded, type RecordedAnswer } from '../../domain/assistant/recorded.ts';
import { STARTERS } from '../../journey/process/askSubjects.ts';
import { factsFor, loadQuestions, loadSample } from './sample.ts';
import type { Question } from './scorer.ts';

const recorded = JSON.parse(fs.readFileSync(new URL('../../public/demo-data/ask-answers.json', import.meta.url), 'utf8')) as RecordedAnswer[];
const sample = await loadSample();
const set = loadQuestions();
const SCOPE: Record<string, Question['scope']> = { askProcess: 'process', askBoard: 'board', askWorkspace: 'workspace' };
const norm = (s: string) => s.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ');

test('every starter question of every scope has a recorded answer, and nothing else is recorded', () => {
  const tasks = { process: 'askProcess', board: 'askBoard', workspace: 'askWorkspace' } as const;
  for (const [scope, qs] of Object.entries(STARTERS)) for (const q of qs) assert.ok(findRecorded(recorded, tasks[scope as keyof typeof tasks], q), `${scope}: "${q}"`);
  assert.equal(recorded.length, Object.values(STARTERS).flat().length);
});

test('each recorded answer leads with a direct answer and every sentence finds its fact and its quote in the demo', () => {
  for (const r of recorded) {
    const { question, facts } = factsFor({ id: 'R', kind: 'answered', scope: SCOPE[r.task], question: r.question }, sample, set);
    const reply = r.reply as { sentences: { segmentId: string; excerpt: string }[] };
    const answer = readAnswer(r.reply, facts);
    assert.ok(answer.lead, `${question}: a direct answer first`);
    assert.equal(answer.sentences.length, reply.sentences.length, `${question}: every sentence still has its fact`);
    for (const s of reply.sentences) {
      const f = facts.find(x => x.id === s.segmentId)!;
      assert.ok(norm(f.text).includes(norm(s.excerpt)), `${question}: the quote "${s.excerpt}" is still in ${s.segmentId}`);
    }
  }
});
