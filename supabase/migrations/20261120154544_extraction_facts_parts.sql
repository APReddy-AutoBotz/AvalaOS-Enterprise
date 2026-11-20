-- Reading sources within the length of one answer (docs/next-plan.md, section 3e).
-- The facts merge is asked in parts (domain/extract/factsParts.ts). Each part's answer, or the note that
-- it was split into smaller parts, is stored as `facts:<part>`; when every part is in, they are joined
-- and stored as `merge:facts`, which moves the run on exactly as the single answer did. A failed step
-- stores `failed:<step>` with the tokens its call used, so they are in the run's totals.
--
-- Neither name starts with `pass:`, `merge:` or `review:`, so extraction_put_part counts neither and
-- moves no stage on: only the part names allowed change. The released code never writes these names.

alter table public.extraction_run_parts drop constraint extraction_run_parts_part_check;
alter table public.extraction_run_parts add constraint extraction_run_parts_part_check
  check (part ~ '^(pass|merge|review|facts|failed):[A-Za-z0-9._:-]{1,80}$');
