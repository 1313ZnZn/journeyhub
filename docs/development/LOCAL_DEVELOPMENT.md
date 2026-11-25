# Local development

## Install

Use Node.js 22.12 or newer and Git. Run commands from the repository root:

```sh
git clone https://github.com/1313ZnZn/journeyhub.git
cd journeyhub
npm run setup
```

The root package delegates installation to `work/journeyhub/package-lock.json`
using `npm ci`. Do not accidentally create a second root lockfile by using a
different installation workflow.

## Browser configuration

Copy `work/journeyhub/config.example.js` to `work/journeyhub/config.local.js`.
Use a development project URL and a browser publishable/anon key, following the
example's property names. `config.local.js` is ignored by Git. Model credentials
and service-role/secret keys belong on the server, never in browser config.

The example is a non-working placeholder for mocked tests. Building with it does
not provide working cloud login or an Agent backend. Do not copy production
sessions, passwords or user datasets into fixtures.

## Build and serve

```sh
npm run build
python -m http.server 8080 --bind 127.0.0.1 --directory outputs/JourneyHub-Supabase
```

The optional server example requires Python and binds only to localhost. Open
`http://127.0.0.1:8080/`. This output also contains SQL and packaging files, so it
must not be exposed publicly. The deployable static output is documented in
[Build and deployment](../deployment/README.md).

The standard build creates the integrated app at `index.html` and a compatibility
redirect at `ai-plan.html`. `build-ai-plan.cjs` is a separate historical generator,
not the root `npm run build` entrypoint.

## Tests

```sh
npm test
```

The root suite covers weather, Calendar, account reset, Trip Agent chat and
conversation clearing. Its database cases use isolated PGlite. Feature tests
outside the root suite are listed in the [repository map](REPOSITORY_MAP.md).
`npm test` does not run every test in the repository.

For the optional Python service, run `npm run test:agent` with Python 3.12 and uv.
The wrapper installs locked dependencies and runs Ruff, Python tests and Node
integration/regression scripts. See the
[service README](../../services/agent-api/README.md).

## Backend development

Use a separate development Supabase project. Review project-specific references
in scheduler SQL and migration history before setting up that environment. The
ordered files in `work/journeyhub/supabase/migrations/` are the migration history;
generated `database.sql` does not replace the full chain.

Bootstrap on a fresh hosted project is not established by the retained export
documentation. Inspect and test the intended setup before applying migrations;
never replay already-applied versions on the live project.

The `.env.example` files list server configuration names. Cloning does not copy
production users, Staff permissions, wallets or browser-local Travel Memories.
Establish development access separately.
