# Build and deployment

## Frontend build contract

The checked-in `vercel.json` defines these values:

| Setting | Value |
| --- | --- |
| Root assumed by the scripts | Repository root |
| Install command | `npm ci --prefix work/journeyhub` |
| Build command | `npm run build:preview` |
| Public output directory | `outputs/JourneyHub-Vercel` |
| Routing | Existing files first; unmatched paths return 404 |

`npm run build` generates `outputs/JourneyHub-Supabase`, a development package
including SQL and packaging material. `npm run build:preview` runs that build,
copies allowed frontend resources to `outputs/JourneyHub-Vercel`, writes public
configuration and checks forbidden files and credential patterns.

The name `build:preview` selects the packaging process; it does **not** select
a Vercel environment. Git branch/project settings and the deployment target
determine Preview versus Production.

## Public configuration

Configure these on the intended Vercel environment, checking branch restrictions:

- `JOURNEYHUB_PUBLIC_SUPABASE_URL`
- `JOURNEYHUB_PUBLIC_SUPABASE_KEY`

The key must be a browser publishable key or appropriate legacy anon key, never
a service-role or secret key. The build embeds these values in `config.js`.
Model credentials do not belong in either variable. Pattern checks are useful
safeguards, not a substitute for reviewing the credential type.

An offline build check can use deliberately fake public configuration in a local
PowerShell process:

```powershell
$env:JOURNEYHUB_PUBLIC_SUPABASE_URL = 'https://journeyhub-build-test.supabase.co'
$env:JOURNEYHUB_PUBLIC_SUPABASE_KEY = 'sb_publishable_repository_check_not_a_real_key'
npm run build:preview
Remove-Item Env:JOURNEYHUB_PUBLIC_SUPABASE_URL
Remove-Item Env:JOURNEYHUB_PUBLIC_SUPABASE_KEY
```

Do not deploy those test values or treat them as a login test. Supply actual
public configuration through the deployment platform's environment settings.

## Review and verification

Check the intended branch and Vercel project before pushing. The established
workflow uses owner-reviewed PRs and a `main` production branch; confirm live
project settings rather than assuming they still match.

After an authorized Preview deployment, verify the reported environment and Ready
status, then inspect actual HTTP content: `/` is HTML, `/config.js` is JavaScript,
and missing or excluded resources return 404. `ai-plan.html` currently redirects
to the integrated app. A 200 homepage fallback is not a static-resource pass.
Record login, Agent behavior and account-isolation tests separately.

## Independent backend releases

| Component | Source | Release boundary |
| --- | --- | --- |
| Frontend | `work/journeyhub/`, `vercel.json` | Vercel Git build |
| Edge Functions | `work/journeyhub/supabase/functions/` | Separate deployment and server configuration |
| Database | `work/journeyhub/supabase/migrations/` | Reviewed, ordered migration rollout; do not replay applied versions |
| Optional Python runtime | `services/agent-api/` | Separate service deployment and server runtime selection |

The [Python service guide](../../services/agent-api/README.md) describes activation
and rollback. [Historical cloud verification](../history/README.md) does not
authorize new database changes or establish current live deployment health.
