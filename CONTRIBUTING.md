# Contributing to CrewCore

## Branches

| Branch | Use |
|---|---|
| `main` | Source of truth for releases — build production (crewcore.in on Hostinger) from it. Only merged through pull requests. |
| `<name>-changes` / `feature/<topic>` | Your work. One branch per person or per feature, branched from the latest `main`. |
| `fix/<topic>` | Small urgent fixes. |

Rules:
- Pull `main` before starting; rebase or merge `main` into your branch before opening a PR.
- Delete a branch after its PR is merged.
- Never force-push `main`.

Old branches were cleaned up on 2026-10-05: the April snapshot that used to be `main` is kept as the tag `archive/main-2026-04`.

## Secrets

Never commit `.env` or any key. `.env*` is git-ignored; only `.env.example` (placeholders) is tracked. The Supabase **service-role** key, SMTP password, MSG91 and Anthropic keys belong only in Supabase function secrets or your local `.env`. If a secret is ever committed, rotate it immediately — deleting the file does not remove it from git history.

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
