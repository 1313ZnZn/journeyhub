# JourneyHub documentation

Use the development and deployment guides for current repository commands.
Implementation reports retain the claims and limitations recorded when written.

## Development and architecture

- [Local development](development/LOCAL_DEVELOPMENT.md): dependencies, local
  configuration, builds and verification.
- [Repository map](development/REPOSITORY_MAP.md): frontend and backend code,
  feature tests, outputs and file placement.
- [Agent architecture walkthrough](AGENT_INTERVIEW_GUIDE.md).
- [Python decision service](../services/agent-api/README.md): configuration,
  integration tests and rollout.
- [Python migration verification](AGENT_MIGRATION_VERIFICATION.md): historical
  checks and remaining deployment boundaries.
- [Contributing](../CONTRIBUTING.md): branches, explicit staging and PR review.

## Deployment

- [Build and deployment](deployment/README.md): actual Vercel command/output,
  public configuration and independent backend releases.

## Feature records

- [Historical document index](history/README.md).
- [Account reset retention](history/account-reset/RESET_RETENTION_REPORT.md):
  started or checked-in reservations are retained during reset.
- [Staff direct publication](history/staff/STAFF_DIRECT_PUBLICATION_REPORT.md):
  shared Staff capabilities and publication by the plan creator. Earlier
  separate-approver plans are historical, not the current intended workflow.

The four legacy `README-*.txt` files in `work/journeyhub/` stay beside the scripts
that reference them. They are feature/background notes rather than primary setup
instructions.
