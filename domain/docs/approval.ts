// What the Documents page says about an approved revision, until an approved document is kept as it read
// (package 14 of docs/next-plan.md). Approval keeps the process record; the documents are built from it each
// time they open, with today's section edits, people's choices and settings, so the page never says the
// approved document is unchanged (finding F07 of the outside review, 17 November 2026).

/** The sentence after "N sections changed since approved revision R: the process was edited after approval." */
export const approvedNote = (revision: number | string): string =>
  `Revision ${revision}'s process is kept as it was approved. Its documents are built afresh each time they open, so later section edits, choices and settings show in them too; approve this draft to make these changes approved.`;

/** The sentence after "Approved revision R was approved as …; this draft is …." */
export const approvedAnswerNote = (revision: number | string): string =>
  `Revision ${revision}'s documents follow the answer it was approved with; approve this draft to make the new answer approved.`;
