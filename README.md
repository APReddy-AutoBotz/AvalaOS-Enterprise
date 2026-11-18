# Avala OS

Avala OS turns the source material for a business process (call transcripts, procedures, flowcharts) into one editable record of the process, a recommendation for each step (by rules or an API, with AI, or kept with a person) worked out by fixed tables, the documents a team needs (BRD, PDD, FRD, SDD, an agent definition, a test pack, an evidence pack) and maps of the process, and reviewed work items on a Delivery board. Every line traces to a source, and a named person confirms what the AI read.

It runs live at [avalaos.com](https://avalaos.com), with a demo on a made-up sample case at [avalaos.com/demo](https://avalaos.com/demo).

## What is where

- `journey/`: the screens (React).
- `domain/`: the rules, with no screens and no I/O: the process record, the scoring, the documents, the questions, the board. Each has tests beside it.
- `supabase/functions/`: the five server functions (the AI gateway, the reading of sources, invitations, the weekday email, walkthrough requests).
- `supabase/migrations/`: the database, as applied to the live project; `supabase/tests/`: its rules, checked against the database.
- `eval/`: the measures of the AI's reading and of Ask Avala, on the sample case.
- `tests/e2e/`: the browser tests.
- `docs/`: the plan and what comes next.

[AGENTS.md](AGENTS.md) is the full brief, for people and coding agents alike: the rules that always apply, how the owner works, what each part does, and what is set up outside the code.

## Running it

Requires Node 22.

```
npm ci
npm run dev
```

For a local copy that keeps everything in the browser (no server, no AI), set `VITE_JOURNEY_STORE=memory`. To use a Supabase project, create `.env.local` with its public settings:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Never commit `.env*` files, a service-role key or an AI provider's key: keys live only in the server's secrets.

## Checks

```
npm test         # typecheck (screens and server functions) and the unit tests
npm run build    # the production build
```

CI runs these and the browser tests on every pull request.
