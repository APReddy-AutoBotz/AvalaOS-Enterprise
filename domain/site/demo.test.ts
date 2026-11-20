import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_FILES_NOTE, DEMO_START_STAGE, demoPointerText } from './demo.ts';

test("the demo's words say what to look at and never mention local mode", () => {
  assert.equal(DEMO_START_STAGE, 'assessment');
  for (const line of [demoPointerText(), DEMO_FILES_NOTE]) assert.doesNotMatch(line, /local mode|not available/i);
  assert.match(demoPointerText(), /assessment.*Documents/);
  assert.match(DEMO_FILES_NOTE, /workspace of your own/);
});
