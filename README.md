# JourneyHub

JourneyHub connects AI-assisted trip planning, a traveler calendar, simulated
reservations, Travel Memories and a Staff workspace. It uses a modular JavaScript
frontend, Supabase Edge Functions and PostgreSQL. An optional Python
LangChain/LangGraph service supplies the Agent decision layer.

## Start here

| Task | Guide |
| --- | --- |
| Find frontend, Agent, database or test code | [Repository map](docs/development/REPOSITORY_MAP.md) |
| Install dependencies and run locally | [Local development](docs/development/LOCAL_DEVELOPMENT.md) |
| Understand Vercel and backend releases | [Build and deployment](docs/deployment/README.md) |
| Work with teammates and open a PR | [Contributing](CONTRIBUTING.md) |
| Browse technical and historical documents | [Documentation index](docs/README.md) |
| Understand the Agent architecture | [Agent walkthrough](docs/AGENT_INTERVIEW_GUIDE.md) |

## Quick start

Requires Node.js 22.12 or newer and Git. From the repository root:

```sh
npm run setup
npm run build
npm test
```

`npm run build` writes a local development package to
`outputs/JourneyHub-Supabase/`. For live development data, copy
`work/journeyhub/config.example.js` to the ignored
`work/journeyhub/config.local.js` and configure a development Supabase URL and
browser publishable/anon key. Without this configuration, the build uses a
placeholder intended for mocked tests. See the local development guide before
serving the app.

The Vercel build is **`npm run build:preview`**, and its public output is
**`outputs/JourneyHub-Vercel/`**. The larger development package contains SQL and
other non-public files and must not be exposed as a public website.

## Repository layout

```text
docs/                   Development guides and dated implementation records
scripts/                Workspace verification commands
services/agent-api/     Optional Python decision service and its tests
work/journeyhub/        Frontend, builds, catalogue, tests and SQL sources
  supabase/functions/  Edge Functions and shared domain tools
  supabase/migrations/ Ordered migration history
outputs/                Generated local builds; ignored by Git
```

Application and test paths are retained because existing scripts load modules by
filename. Historical account-reset and Staff reports are organized under
[docs/history](docs/history/README.md).

## Release boundaries

Contributors work on branches and open pull requests; the owner reviews and
merges. Vercel builds the frontend from Git. Edge Functions, database migrations
and the Python service have separate release steps. A frontend merge does not
deploy those backends or enable the Python runtime.

The Python runtime is opt-in; `legacy` remains the default in the source. Its
[service guide](services/agent-api/README.md) covers configuration and
`npm run test:agent` with Python 3.12 and uv.

Use test accounts and development environments for write tests. Credentials,
user records, browser storage and private screenshots do not belong in Git.
Third-party assets retain their bundled licenses. Historical verification reports
describe their original test dates, not the current health of the live site.
