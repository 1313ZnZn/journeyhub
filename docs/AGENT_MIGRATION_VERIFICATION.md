# Python Agent migration verification

## Delivered scope

- Opt-in `python-langchain` runtime for `discover`, `discover_plan` and `trip_chat`.
- Python 3.12/FastAPI service using actual LangChain model/tool binding and a
  LangGraph decision, validation and bounded repair graph.
- Existing JavaScript domain tools, action/observation loop, Supabase ownership,
  leases, checkpoints and explicit Apply/payment confirmation retained.
- Versioned server-to-server contract, bounded requests/responses, authentication,
  timeout/concurrency limits, redacted errors and structured application metrics.
- Locked Python dependencies, Dockerfile, reproducible verification command,
  migration/runbook documentation and interview walkthrough.

## Passed checks

| Check | Evidence and scope |
| --- | --- |
| `npm run test:agent` | Ruff; 29 Python cases; 12 Node verification scripts |
| Python graph/API tests | Valid calls, unregistered/multiple/truncated calls, malformed arguments, one repair, exhausted repair, token accounting, schema validation, request isolation, auth, limits, timeout, saturation and redacted failures |
| Provider contract | Real LangChain `ChatOpenAI` serialization/parsing against a mocked HTTP transport |
| Cross-language integration | Real local FastAPI server and LangGraph; existing JS saved-trip information tools, two account snapshots, discovery search/select, planning proposal/routes/save and checkpoint resume |
| Existing agent regressions | Planning constraints and fallback, trip changes, payment quote/confirmation boundary, ownership, task leases, retry and asynchronous handler behavior |
| `npm run build` | Full application bundle built successfully |
| `npm test` | Existing calendar, reset, chat and clear-conversation suite passed; DB cases use isolated PGlite |
| `node work/journeyhub/test-trip-chat-payments.cjs` | Existing virtual-payment UI, receipt, idempotency and isolation suite passed |
| Docker build | Locked production dependency install succeeded with trusted CA supplied via BuildKit secret; TLS verification stayed enabled |
| Docker startup | Actual Uvicorn startup as UID 10001, HTTP health and unauthenticated 401, `.env` and test fixtures absent; external networking disabled |
| `git diff --check` | No whitespace errors |

Python application tests and cross-language integration were rerun after the final
logging/request-size changes. Docker verification used fixture credentials only
and did not send a model request.

## Boundaries

The model, map provider and database in local integration tests are fixtures.
These are not live model-quality evaluations, cloud SQL rollback tests or
browser-login acceptance tests. No user conversation was cleared, no order or
payment was created, and no database migration was applied.

The Python service has not been deployed to a hosted environment. Production
secrets and Edge Functions have not been changed. `legacy` remains the default
runtime. The owner must review/merge the PR; enabling Python requires the separate
service, both affected Edge entrypoints, server-side configuration and live
test-account acceptance described in the service README.

The migration covers the central decision layer. It does not migrate every AI
helper, move all business logic to Python, add RAG/vector search, or introduce a
LangGraph durable checkpointer. No production performance/accuracy improvement
has been measured or claimed.
