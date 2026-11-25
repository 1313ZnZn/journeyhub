# Contributing to JourneyHub

## Work from a branch

Fetch the latest `origin/main`, inspect `git status`, and create a focused branch.
Keep existing uncommitted changes in their original checkout. If that checkout
contains unrelated work, use a separate checkout or worktree.

```sh
git fetch origin
git switch -c fix/short-description origin/main
```

Run this example only in a clean checkout. Never reset, clean or stash someone
else's unfinished work as part of setting up your change.

## Keep changes reviewable

- Edit source in `work/journeyhub/`, not generated files in `outputs/`.
- Preserve module ordering and relative paths unless the change requires moving
  them. The build and many tests resolve files relative to their own directory.
- Preserve applied migration versions. New database changes need a reviewed
  migration and a separate rollout decision.
- Put current guidance in `docs/development/` or `docs/deployment/`, and dated
  plans and reports in the relevant `docs/history/` feature folder.
- Put private local evidence in ignored `.artifacts/` or `.local/` folders.
  Deliberate documentation images can go under `docs/` after reviewing them for
  account information and credentials.
- Stage explicit files or paths, then inspect the staged diff before committing.

## Verify the change

```sh
npm run setup
npm run build
npm test
git diff --check
```

Run the relevant feature tests in the
[repository map](docs/development/REPOSITORY_MAP.md). For Python decision service
changes, also run `npm run test:agent` with Python 3.12 and uv installed.

Local tests use mocks or isolated databases. Report browser, external API and
cloud tests separately. A successful build does not prove login, planning,
payment or data isolation passed end to end. SQL fixture files must not be
executed against production as a routine test command.

## Open a pull request

Describe the problem, resulting behavior and actual validation. Note any separate
backend rollout or unverified behavior. Include no API secrets, `.env` files,
account credentials or generated build directories.

Pushing a tracked branch can trigger Vercel Preview. Confirm the connected
project's branch and environment settings before relying on that behavior.
The owner reviews and merges into `main`; do not merge or promote a production
deployment on their behalf without authorization.
