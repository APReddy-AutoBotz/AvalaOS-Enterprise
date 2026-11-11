# Inherited schema (reference only)

`migrations/` and `tests/` here are the AvalaOS Core database schema at `88d0643`: 107 migrations, 256 tables. They are **not** applied to the AvalaOS Enterprise database and nothing reads them.

They are kept so that logic worth porting can be looked up. The live schema is `supabase/migrations/`.

The edge functions in `supabase/functions/` were written against this inherited schema. They are not deployed to the new project; they are replaced function by function as the new workspace is built.
