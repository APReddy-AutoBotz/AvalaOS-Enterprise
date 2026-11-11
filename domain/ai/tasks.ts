// Registered AI tasks. A client names a task; it never sends a prompt.
// Phase 1 adds the extraction passes here (inventory, steps and flow, rules and exceptions, metrics).
import type { TaskDefinition } from './gateway.ts';
import { readFlowchart } from '../flowchart/vision.ts';

const str = { type: 'string' } as const;

/** A small end-to-end task used to check the gateway: who takes part in the process. */
const participants: TaskDefinition = {
  id: 'participants',
  schemaName: 'process_participants',
  instructions: [
    'List the roles, teams and external parties that take part in the process.',
    'Use the role or team, not a person\'s name, as the name when the source gives both; put the person in "person" or leave it empty.',
    'Use kind "external" for parties outside the organisation, "team" for groups and "person_role" for individual roles.',
  ].join('\n'),
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['roles'],
    properties: {
      roles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'kind', 'person', 'segmentId', 'excerpt', 'certainty'],
          properties: {
            name: str,
            kind: { type: 'string', enum: ['person_role', 'team', 'external'] },
            person: str,
            segmentId: str,
            excerpt: str,
            certainty: { type: 'string', enum: ['stated', 'inferred'] },
          },
        },
      },
    },
  },
  maxOutputTokens: 8000,
  verifyArrays: ['roles'],
};

export const TASKS: Record<string, TaskDefinition> = {
  [participants.id]: participants,
  [readFlowchart.id]: readFlowchart,
};
