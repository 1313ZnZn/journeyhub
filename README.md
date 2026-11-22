# JourneyHub

Private collaboration source for the JourneyHub travel application. This repository contains the modular frontend, Supabase functions and migrations, sample catalogue, vendored map assets and automated tests. It does not include production credentials, user records, browser storage or screenshots.

## Local development

Install Node.js 22.12 or newer and Git, then:

```sh
git clone https://github.com/1313ZnZn/journeyhub.git
cd journeyhub
npm run setup
# Copy work/journeyhub/config.example.js to work/journeyhub/config.local.js
# Fill in your development Supabase URL and browser publishable/anon key.
npm run build
npm test
```

Serve outputs/JourneyHub-Supabase with a local static web server (for example python -m http.server 8080 --directory outputs/JourneyHub-Supabase). Without a configured development backend the UI cannot load live data. The default config is a placeholder for mocked tests only.

## Structure

- work/journeyhub: frontend modules, styles, HTML template and build scripts.
- work/journeyhub/supabase/functions: planner, agent, care, email and official information research services.
- work/journeyhub/supabase/migrations: ordered database migration history.
- work/journeyhub/.env.example: server configuration names; all secrets must stay outside Git.
- outputs/JourneyHub-Supabase: generated build, ignored by Git.
- services/agent-api: Python/FastAPI LangChain + LangGraph decision runtime for the durable planner and Trip Agent. See its [setup and migration guide](services/agent-api/README.md).
- docs/AGENT_INTERVIEW_GUIDE.md: [architecture walkthrough and interview notes](docs/AGENT_INTERVIEW_GUIDE.md).

The Python runtime is an opt-in backend migration. Run `npm run test:agent` with
Python 3.12 and uv installed to verify the service and existing Edge callers
without cloud credentials. It does not replace all AI helpers or enable itself
through a frontend deployment.

## Backend setup

Use a separate development Supabase project. Replace YOUR_PROJECT_REF in scheduler SQL and migrations with that project's reference before applying them; these tasks call that project's Edge Functions. Apply the full migration chain in timestamp order using the Supabase CLI from work/journeyhub, and deploy its functions with development secrets. Do not use the generated database.sql alone as the current schema, and do not run reset or test SQL against production. SQL tests may create fixture users and bookings. Migration bootstrap has not been tested on a clean hosted project in this export.

The original.html prototype still includes legacy mock accounts which the build removes; these are not production login credentials. Existing production users, staff accounts and wallet data are not copied. Establish development staff access separately.

## Collaboration and release

The owner invites contributors through repository Settings > Collaborators. Work on a branch and open a pull request, review and run the relevant tests before merging. The connected Vercel project builds the frontend from Git. Supabase functions, migrations and the Python agent service have separate release steps; merging frontend code does not deploy those backends. The owner reviews and merges pull requests.

This initial export preserves the existing application behaviour; packaging changes only add local configuration, documentation and prevent frontend builds from rewriting migrations. Third-party assets retain their bundled licenses.
