-- WP3.5: an edited proposal records the hash of the derived text it was edited from, so a later
-- change to the process asks the person to review the edit instead of silently keeping it.
alter table public.work_item_proposals add column base_hash text check (base_hash is null or length(base_hash) <= 64);
