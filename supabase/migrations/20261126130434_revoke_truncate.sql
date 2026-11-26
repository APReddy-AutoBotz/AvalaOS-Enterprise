-- Signed-in people never empty a whole table (plan: claude/truncate-revoke-plan-26-nov.md, options b and c).
--
-- TRUNCATE empties a table at once, ignores row-level security and fires no delete trigger. The API cannot
-- send it, so this closes no open door; it takes away a right nobody should hold (docs/next-plan.md,
-- hardening). The 22 tables below still held it from the default grant; the other tables in public already
-- lose it in their own migrations. Nothing in the site, the server functions, the scripts or the workflows
-- uses TRUNCATE. service_role and postgres keep it; anon held it on no table.
--
-- To undo: grant truncate on the same tables to authenticated, and
-- `alter default privileges for role postgres in schema public grant truncate on tables to authenticated;`.

revoke truncate on
  public.assessments,
  public.delivery_projects,
  public.delivery_sprints,
  public.delivery_work_item_comments,
  public.delivery_work_items,
  public.document_revisions,
  public.documents,
  public.flow_diagrams,
  public.organizations,
  public.process_model_edits,
  public.process_model_revisions,
  public.processes,
  public.profiles,
  public.proposal_requirements,
  public.requirements,
  public.work_item_proposals,
  public.work_item_requirements,
  public.workspace_ai_settings,
  public.workspace_audit,
  public.workspace_invites,
  public.workspace_members,
  public.workspaces
from authenticated;

-- New tables made by postgres (every migration here) start without it, so a later migration no longer
-- needs its own revoke line. Everything else the default gives authenticated stays as it was.
--
-- Not covered: tables made by supabase_admin. Its own default privileges in public give anon and
-- authenticated every right, TRUNCATE included, and postgres cannot change them (it is not a member of
-- supabase_admin). Every table in public is made by postgres today (26 November 2026), and the migrations
-- run as postgres; should a table in public ever be made by supabase_admin, revoke it there by hand.
alter default privileges for role postgres in schema public revoke truncate on tables from authenticated;
