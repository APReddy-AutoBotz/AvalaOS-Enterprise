// The figures the homepage gives for the sample case, under its screenshots. They must be what the demo
// shows (public/demo-data/sample.json): sample.test.ts reads the demo the way its pages do and fails when
// a figure here differs. Change the demo, run the test, and correct the figure here.
//
// - sources: the source files on the sample process;
// - documents: the documents offered on its Documents page (BRD, PDD, FRD, SDD and the agent document as
//   the delivery plan lists them; the test pack and the evidence pack are not counted as documents);
// - testCases: the cases in its test pack;
// - boardItems: the items on its Delivery board.
export const SAMPLE_FIGURES = { sources: 5, documents: 5, testCases: 32, boardItems: 50 } as const;

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const say = (n: number) => WORDS[n] ?? String(n);

/** The line under the homepage's screenshots. */
export function sampleLine(f: { sources: number; documents: number; testCases: number; boardItems: number } = SAMPLE_FIGURES): string {
  return `Real product screens. A made-up sample case: ${say(f.sources)} source files in; ${say(f.documents)} documents, ${f.testCases} test cases and a ${f.boardItems}-item Delivery board out.`;
}
