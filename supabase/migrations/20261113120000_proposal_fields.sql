-- Work proposals (WP4.1, 4.2): keep a person's edit apart from selection, the parent by derivation key
-- (stable across regenerations, unlike row ids), and the requirement codes each item delivers.
alter table public.work_item_proposals
  add column user_edited boolean not null default false,
  add column parent_key text check (parent_key is null or length(parent_key) <= 200),
  add column requirement_codes text[] not null default '{}';
