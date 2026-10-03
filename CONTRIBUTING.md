# Contributing to CrewCore

## Branches

| Branch | Use |
|---|---|
| `main` | Production. Deployed. Only merged through pull requests. |
| `<name>-changes` / `feature/<topic>` | Your work. One branch per person or per feature, branched from the latest `main`. |
| `fix/<topic>` | Small urgent fixes. |

Rules:
- Pull `main` before starting; rebase or merge `main` into your branch before opening a PR.
- Delete a branch after its PR is merged.
- Never force-push `main`.

Suggested clean-up of today's remote branches (needs the repo owner's OK): merge or close `Dangi-fixes`, `suraj-fixes`, `Suraj-Updates`, `Latest-CrewCore`, `payroll-latest-changes-(for-production)-` into `main` via PRs, then delete them, so `main` is the single source of truth.

## Commits

- Present tense, prefix with the area: `feat: …`, `fix: …`, `test: …`, `docs: …`, `chore: …`.
- Stage files explicitly (`git add <paths>`) — several people/tools work in the same tree; don't sweep someone else's half-finished files into your commit.
- Never commit secrets: `.env*` is ignored; edge functions read keys with `Deno.env.get`. The Supabase **anon** key is public by design; the **service-role** key must never appear in the repo.

## Database changes

1. Write a re-runnable migration in `supabase/migrations/YYYYMMDD_N_description.sql` (check the folder for the next free `N`).
2. Dry-run it inside `BEGIN … RAISE EXCEPTION` with role/permission checks on the **test tenant**.
3. Apply with `npx supabase db query --linked -f <file>` — never `supabase db push`.
4. If the mobile app reads/writes the tables you changed, note what the app team must do in the PR.

## Before opening a PR

- `npm run build` passes, `npm run test:unit` passes.
- New screens checked at phone width (≈390 px).
- `npm run lint` — CI reports lint without blocking until the existing backlog is fixed; don't add new errors.
- Fill in the PR template.
