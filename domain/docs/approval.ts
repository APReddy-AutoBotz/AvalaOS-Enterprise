// What the Documents page says about an approved revision, until an approved document is kept as it read
// (package 14 of docs/next-plan.md). Approval keeps the process record; the documents are built from it each
// time they are opened, with today's section edits, people's choices and settings, so the page never says the
// approved document is unchanged (finding F07 of the outside review, 17 November 2026).

/** The sentence after "N sections changed since approved revision R: the process was edited after approval." */
export const approvedNote = (revision: number | string): string =>
  `Approved revision ${revision} of the process is kept exactly as approved. Its documents are rebuilt each time they are opened, so later section edits, choices and settings appear in them too. Approve this draft to make these changes the approved version.`;

/** The sentence after "Approved revision R was approved as …; this draft is …." */
export const approvedAnswerNote = (revision: number | string): string =>
  `Approved revision ${revision}'s documents follow the answer it was approved with. Approve this draft to make the new answer the approved version.`;
