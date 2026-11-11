# AvalaOS Enterprise

AvalaOS Enterprise turns the source material for a business process (transcripts, SOPs, flowcharts) into an editable assessment, industry-standard delivery documents and flows, and reviewed work items on a Delivery board.

**Evaluate before you automate. Govern before you execute.**

## Status

This repository continues [AvalaOS-Core](https://github.com/APReddy-AutoBotz/AvalaOS-Core) from commit `88d0643`. The application code is inherited; the product journey is being rebuilt around a single editable Process Model. The plan, with the current gaps and every work package, is in [docs/product-plan.md](docs/product-plan.md).

Nothing here is production-ready.

## Getting started

Requires Node 22.

```
npm ci
npm run dev
```

Create `.env.local` with the public client settings for your Supabase project:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable or anon key>
```

Never commit `.env*` files or any service-role key.

## Verification

```
npm test         # typecheck, edge typecheck, unit tests
npm run build    # production build
```

CI runs the same commands on every pull request.

## Working in this repository

Read [AGENTS.md](AGENTS.md). It is the brief for both people and coding agents.
