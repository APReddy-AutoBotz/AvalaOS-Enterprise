// The figures the homepage gives for the sample case, under its screenshots. They must be what the demo
// shows (public/demo-data/sample.json): sample.test.ts reads the demo the way its pages do and fails when
// a figure here differs. Change the demo, run the test, and correct the figure here.
//
// - sources: the source files on the sample process;
// - plannedDocuments: the documents the sample's delivery plan plans (the others are one click away and
//   are not named in the line);
// - testCases: the cases in its test pack;
// - boardItems: the items on its Delivery board.
export const SAMPLE_FIGURES = { sources: 5, plannedDocuments: ['pdd', 'sdd'], testCases: 32, boardItems: 50 } as const;

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const say = (n: number) => WORDS[n] ?? String(n);
const DOC_NAME: Record<string, string> = { brd: 'a BRD', pdd: 'a PDD', frd: 'an FRD', sdd: 'an SDD', agent: 'an agent document' };
const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The line under the homepage's screenshots. */
export function sampleLine(f: { sources: number; plannedDocuments: readonly string[]; testCases: number; boardItems: number } = SAMPLE_FIGURES): string {
  return `Real product screens. A made-up sample case: ${say(f.sources)} source files in; ${listWords(f.plannedDocuments.map(d => DOC_NAME[d] ?? d))}, ${f.testCases} test cases and a ${f.boardItems}-item Delivery board out.`;
}
