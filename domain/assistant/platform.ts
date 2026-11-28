// How Avala OS works, as facts Ask Avala may cite (agreed with the owner, 14 November 2026: Ask Avala
// answers from the record and from this fixed description of the platform, so that "what happens to
// the documents if I choose another approach?" has an answer). Each line is a rule of the product that
// holds for every process; nothing here is about one process, and nothing is advice.
//
// Keep each line true to the code it names. When that code changes, change the line in the same pull request.
import type { StageId } from '../workspace/route.ts';

export interface PlatformFact { id: string; stage: StageId; text: string }
export const PLATFORM_LABEL = 'How Avala OS works';

const fact = (id: string, stage: StageId, text: string): PlatformFact => ({ id: `h:${id}`, stage, text: `${PLATFORM_LABEL}: ${text}` });

export const PLATFORM_FACTS: PlatformFact[] = [
  // domain/flowchart/svg.ts flowPicture without modes; domain/docs/pdd.ts section 2.
  fact('as-is', 'flows', 'the As-Is flow and the As-Is map describe how the work is done today. They change only when the process itself is edited (its steps, roles, decisions and flows), never because a different automation approach is chosen.'),
  // domain/flowchart/shape.ts mapShape and MAP_SHAPE; journey/process/FlowsStage.tsx (the switch); domain/docs/pdd.ts.
  fact('map-shape', 'flows', 'a map is drawn in swimlanes, one column per role, or as a simple flow, one column with each step\'s role written in its box and the role line darker where the work changes hands. Avala OS suggests a simple flow when one role or none has steps, or when more than six columns would be drawn; otherwise swimlanes. An editor can choose the other shape on the Flows stage; the choice holds for everyone, on Flows and in the Process Definition Document, and "Use the suggested shape" goes back. The flow editor always shows one column per role.'),
  // domain/assess/process.ts assessProcess with decisions, used by journey/process/FlowsStage.tsx,
  // DocumentsStage.tsx, WorkItemsStage.tsx and domain/docs/common.ts modeOf (pdd.ts section 3, sdd.ts, workitems/derive.ts).
  fact('to-be', 'documents', 'everything built for the future process follows the approach in effect for each step: the assessment\'s recommendation, or the approach a person chose instead. That is the To-Be map on the Flows stage and in the Process Definition Document (with its delivery model, detailed To-Be steps and scope for automation), the functional requirements, the automation units of the Solution Design Document and the work proposals.'),
  // journey/process/AssessmentStage.tsx Hero; domain/assess/process.ts lead.
  fact('verdict', 'assessment', 'when people have chosen approaches for steps, the Assessment stage shows the approach and the split of steps with those choices, and shows the scoring\'s own recommendation underneath. The scores and the ranking of approaches stay those of the scoring.'),
  // journey/process/AssessmentStage.tsx StepDetail; domain/assess/decisions.ts withOverride.
  fact('override', 'assessment', 'a person who can edit the process can choose a different approach for a step in the Assessment stage: select the step, choose the approach under "Override recommendation" and give the reason. The step then shows "Overridden by" with their name, its scores stay as computed, and the override can be removed.'),
  // The same: an override is one step's.
  // domain/assess/scoring.ts decidedFit, domain/assess/process.ts (the decided approach), journey/process/BriefPanel.tsx, DecidedPanel.tsx.
  fact('step-by-step', 'process', 'one approach can be decided for a whole process: in "The brief" on the Process stage, answer "What do you want from this process?" with "Document it: how it will be built is already decided", choose the approach (rule-based RPA, API integration, AI that assists people or an AI agent) and give the reason. Each step then takes a person\'s own choice for it if there is one; otherwise the decided approach where the scoring\'s rules say it can do the step; otherwise it stays with a person, with the reason. Where the approach falls short only because a fact is not known yet, the step is "not known yet" and the question that would settle it is named. Such a process has no Assessment page, score or ranking; the top of Documents says what the approach can do and which steps stay with people, and there a person can set one step themselves. Removing the decided approach goes back to the assessment. Otherwise an approach is chosen step by step in the Assessment stage.'),
  // domain/assess/scoring.ts; journey/process/AssessmentInputs.tsx.
  fact('scores', 'assessment', 'scores are computed by fixed scoring tables from the recorded facts of each step and application, such as whether the rules are written down, whether the input is structured, whether an API is confirmed and whether robots may use an application\'s screens. A score changes only when one of those facts changes, in the Assessment stage under Inputs. Ask Avala cannot change a score.'),
  // domain/requirements/derive.ts.
  fact('requirements', 'documents', 'a functional requirement is derived for each step whose approach in effect is automation, each human check and each exception. Its statement says what the solution shall do and does not name the approach; where a person chose the approach, its rationale says so.'),
  // domain/docs/edits.ts; journey/process/DocumentsStage.tsx.
  fact('edits-kept', 'documents', 'documents are rebuilt from the process, the assessment and the choices people made. Text a person edited in a section is kept; when the generated text under it changes, the section is marked "Needs review" and the person chooses Keep mine, Take update or Edit mine.'),
  // Package 14 (owner-approved 24 November 2026): domain/docs/keep.ts, versions.ts, approving.ts; approve_version,
  // keep_version_as_reads_now; journey/process/keepVersion.ts and DocumentsStage.tsx (the list of approved versions).
  fact('approved', 'documents', 'approving keeps every document of the process exactly as it reads at that moment, as an approved version that is never changed. Later changes are made in the working draft, and Documents shows what reads differently from the latest approved version. Approving again makes a new version, with a reason from the second version on. A process approved before copies were kept can be kept as it reads now.'),
  // journey/process/DiscoveryPanel.tsx, journey/AskAvala.tsx (the tab), domain/discovery/ (cards by rule, notice.ts,
  // wanted.ts), journey/process/BriefPanel.tsx (What you want to change); package B, plan section 11.
  fact('discovery', 'process', 'Discovery, the fourth tab of Ask Avala on a process, asks one question at a time about what a person said, each with the words that raised it or the gap it fills. Nothing is saved until a person presses Save. What a person wants to happen in future is kept under "What you want to change" and is never a step of the work done today. People who can edit the process run it.'),
  // journey/process/GapsAssistant.tsx (Closing the gaps, ClosedByPerson), AssessmentStage.tsx (the line), DocumentsStage.tsx
  // (the banner), journey/process/InterviewPanel.tsx and SeveralAnswers (Ask Avala's Questions tab), domain/questions/result.ts
  // meetingResult and whoToAsk; package 16, words proposed on 24 November 2026, with 5a's closed questions.
  fact('answer-questions', 'assessment', 'open questions are answered in Closing the gaps. On the Assessment stage, the line "N open questions could change the recommendation" opens it on those questions with Answer them; on Documents, the banner\'s Answer them opens it on every open question. In Ask Avala, the Questions tab takes one question at a time, and "Answer several from notes or a transcript" reads notes or a transcript for several at once. Answers read from notes are shown first and saved only when a person presses Save; afterwards Closing the gaps says how many open questions were closed and who to ask about the rest. Closing the gaps also lists the questions a person closed, with Reopen.'),
  // Where a person changes things (owner, 16 November 2026: asked how to correct the objective's wording, Ask
  // Avala knew the rules but not where to act). journey/process/BriefPanel.tsx MetaLine; patch.ts updateFact.
  fact('change-objective', 'process', 'the process objective and the process owner are changed in "The brief" at the top of the Process stage: press Change beside Objective or Process owner, then Save. Every document, requirement and new work item takes the new wording; items already on the Delivery board keep theirs.'),
  // journey/process/DocumentsStage.tsx (Edit on each section heading); domain/docs/edits.ts.
  fact('edit-section', 'documents', 'the wording of a document section is changed on the Documents stage: open the document and press Edit on the section heading. Tables and open items come from the process itself, so a wrong value in a table is corrected in the process, not in the document.'),
  // journey/process/RequirementsPanel.tsx, shown on the FRD tab.
  fact('edit-requirement', 'documents', 'a requirement is reworded on the Documents stage, on the FRD tab: open "Requirements register" with "Review and edit" and press Edit beside the requirement. "Use the derived wording" goes back to the wording worked out from the process.'),
  // journey/process/SectionComments.tsx.
  fact('comment', 'documents', 'a reviewer leaves a comment where they read: on the Documents stage, Comment on the section heading. The author or an editor resolves it.'),
  // domain/plan/purpose.ts (whatFollows, asksQuestion); journey/process/BriefPanel.tsx PurposeLine; journey/pages/ProcessesPage.tsx.
  fact('purpose', 'process', 'a person says what they want from a process: "Assess it and document it", which is what a process is until someone answers, or "Document it as it is". A process documented as it is has no assessment: no score, no ranking and no recommendation; its documents are the process document (PDD), with its map, and the evidence pack, and it is asked no question that only serves an assessment, such as how an automation could reach an application or the figures that size a saving. The answer is given when the process is added, and changed at any time in "The brief" at the top of the Process stage; changing it deletes nothing.'),
  // domain/workitems/board.ts; journey/pages/BoardPage.tsx.
  fact('board', 'work-items', 'work items already on the Delivery board are never changed for you. When a requirement linked to an item changes, the item shows "Upstream changed" with the wording before and after.'),
];
