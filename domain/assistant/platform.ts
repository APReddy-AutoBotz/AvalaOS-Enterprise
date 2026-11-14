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
  // domain/assess/process.ts assessProcess with decisions, used by journey/process/FlowsStage.tsx,
  // DocumentsStage.tsx, WorkItemsStage.tsx and domain/docs/common.ts modeOf (pdd.ts section 3, sdd.ts, workitems/derive.ts).
  fact('to-be', 'documents', 'everything built for the future process follows the approach in effect for each step: the assessment\'s recommendation, or the approach a person chose instead. That is the To-Be map on the Flows stage and in the Process Definition Document (with its delivery model, detailed To-Be steps and scope for automation), the functional requirements, the automation units of the Solution Design Document and the work proposals.'),
  // journey/process/AssessmentStage.tsx Hero; domain/assess/process.ts lead.
  fact('verdict', 'assessment', 'when people have chosen approaches for steps, the Assessment stage shows the approach and the split of steps with those choices, and shows the scoring\'s own recommendation underneath. The scores and the ranking of approaches stay those of the scoring.'),
  // journey/process/AssessmentStage.tsx StepDetail; domain/assess/decisions.ts withOverride.
  fact('override', 'assessment', 'a person who can edit the process can choose a different approach for a step in the Assessment stage: select the step, choose the approach under "Override recommendation" and give the reason. The step then shows "Overridden by" with their name, its scores stay as computed, and the override can be removed.'),
  // The same: an override is one step's.
  fact('step-by-step', 'assessment', 'an approach is chosen step by step. There is no single setting that puts one approach on every step of a process.'),
  // domain/assess/scoring.ts; journey/process/AssessmentInputs.tsx.
  fact('scores', 'assessment', 'scores are computed by fixed scoring tables from the recorded facts of each step and application, such as whether the rules are written down, whether the input is structured, whether an API is confirmed and whether robots may use an application\'s screens. A score changes only when one of those facts changes, in the Assessment stage under Inputs. Ask Avala cannot change a score.'),
  // domain/requirements/derive.ts.
  fact('requirements', 'documents', 'a functional requirement is derived for each step whose approach in effect is automation, each human check and each exception. Its statement says what the solution shall do and does not name the approach; where a person chose the approach, its rationale says so.'),
  // domain/docs/edits.ts; journey/process/DocumentsStage.tsx.
  fact('edits-kept', 'documents', 'documents are rebuilt from the process, the assessment and the choices people made. Text a person edited in a section is kept; when the generated text under it changes, the section is marked "Needs review" and the person chooses Keep mine, Take update or Edit mine.'),
  // domain/docs/changes.ts; the model_approve rule.
  fact('approved', 'documents', 'an approved revision is never changed. Later changes are made in the working draft, and Documents shows what changed since the approved revision.'),
  // domain/workitems/board.ts; journey/pages/BoardPage.tsx.
  fact('board', 'work-items', 'work items already on the Delivery board are never changed for you. When a requirement linked to an item changes, the item shows "Upstream changed" with the wording before and after.'),
];
