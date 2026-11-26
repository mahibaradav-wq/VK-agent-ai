# PR #66 — Edge → Node session invalidation: integration + E2E

Stacked on PR #65 (`cursor/pr65-ai-billing-session-ee77-90d9`).

- Base HEAD (PR #65): `832b15227f37f38c70146d87466c91e99a5dbbae`
- Branch: `cursor/pr66-session-invalidation-e2e-ee77`
- Final HEAD: see the PR (the report-only commit follows `23dde44`)

## A — Review results

| # | Item | Result |
|---|------|--------|
| 1 | Edge forwards the original cookie to the Node endpoint | OK (asserted: endpoint receives the exact cookie) |
| 2 | Node checks JWT + DB `sessionVersion` | OK (`getToken` + `resolveSessionToken`) |
| 3 | Missing user / version mismatch → deny | OK |
| 4 | Endpoint 5xx / bad JSON / network / timeout → deny | **Defect: no timeout (hang)**; fixed |
| 5 | No middleware → endpoint → middleware loop | OK (`/api/auth/*` is outside the matcher) |
| 6 | `/app/*` and `/admin/*` go through middleware | OK (matcher) |
| 7 | API + Server Actions own Node `auth()` check | OK (tested with real route + real action) |
| 8 | New login after reset gets the current `sessionVersion` | OK |

## Defects found and fixed

1. **Cookie forwarded to a Host-derived origin.** Middleware built the check URL from `request.nextUrl.origin`, which follows the client-controlled Host header. A spoofed Host would receive the session cookie (reproduced in the integration harness: the attacker listener received the cookie). It also risks a public-URL hairpin in containers. Fix: origin is now server-controlled — `SESSION_CHECK_ORIGIN` if set, otherwise `http://127.0.0.1:${PORT||3000}` (the Dockerfile sets `PORT=3000`).
2. **No timeout on the Edge → Node call.** A hung Node endpoint would hang the request. Fix: `AbortSignal.timeout` (default 3000 ms, `SESSION_CHECK_TIMEOUT_MS` override); timeout → deny.
3. **DB failure inside session-check surfaced as an unhandled 500.** Still denied, but now an explicit `503 {valid:false}` with `Cache-Control: no-store` on every response.

No auth architecture change; no security check weakened (still fail closed everywhere).

## Changed files

- `src/middleware.ts` — pinned origin, timeout
- `src/app/api/auth/session-check/route.ts` — 503 on DB error, `no-store`
- `vitest.config.ts` — inline `next-auth` so `@/auth` can be imported in tests
- `src/modules/auth/session-invalidation.integration.test.ts` — 20 tests (new)
- `e2e/session-invalidation.spec.ts` — 4 Playwright tests (new)
- `docs/pr66-session-invalidation-e2e-report.md` (this file)

## Scenarios

Integration (Vitest, real Postgres, real middleware function, real `session-check` handler behind a real `node:http` server, real `auth()` / `/api/ai/connect` POST / `createPost` server action with only `next/headers` shimmed to supply the cookie):

| Scenario | Result |
|----------|--------|
| S1 stale cookie after reset → `/app` and `/admin` redirect to `/login?session=expired` | PASS |
| S1 original cookie forwarded to Node check | PASS |
| S1 old JWT: `auth()` empty, API 401, Server Action rejects (403) | PASS |
| S2 new login: sessionVersion == DB, old+1; new cookie passes, old denied | PASS |
| S3 HTTP 500 / 503 (even with `valid:true` body) / bad JSON / `valid:"true"` / network failure / timeout → deny | PASS |
| S3 AUTH_SECRET missing → deny, no Node call; forged secret → deny | PASS |
| S3 DB lookup throws → 503 `{valid:false}` | PASS |
| S4 deleted user → middleware denies and `auth()` empty | PASS |
| S5 public pages untouched, no Node call; matcher excludes `/login` and `/api/auth/*`; valid session passes with exactly one check; Host-derived origin never receives the cookie | PASS |

E2E (Playwright against `next start`): register → login → reset password in a second browser context → old cookie is redirected on `/app` and `/admin`, 401 on `/api/ai/connect`; new login works; public pages 200; `/login?session=expired` does not loop; `session-check` anonymous → 401 `{valid:false}` + `no-store`; valid session not blocked; spoofed Host request still served.

## Checks (local)

| Check | Result |
|-------|--------|
| `npm ci` | PASS |
| `prisma generate` / `prisma validate` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS — 58 files, 319 tests (needs `PROBE_HARNESS_ADMIN_URL`, as in CI) |
| `npm run test:vps` | PASS — 108 |
| `npm run build` | PASS |
| Playwright | PASS — 12 (8 existing + 4 new) |
| `bash -n` all VPS scripts | PASS |

Playwright is not part of GitHub CI. Locally it needs `AUTH_ALLOW_PUBLIC_REGISTRATION=true` in the server env (registration is closed otherwise).

## GitHub Actions

See the PR checks (CI and VPS readiness); results are recorded in the PR description.

## Limitations

- Server Actions are proven at the `auth()` level through a real action; a literal browser-initiated action POST with a stale cookie is blocked earlier by middleware, so the Node-side action denial is not separately observable end to end.
- `next/headers` is shimmed in Vitest to provide request-scope cookies; everything else is the real module.
- If the app is ever served on a port other than `PORT`/3000 behind a mapping, set `SESSION_CHECK_ORIGIN` (otherwise the check fails closed and logs users out).

## Confirmation

No merge, deploy, SSH, VPS access, production DB, paid AI call, live VK/Telegram post, or secret/.env change or logging. #64 and #65 left open.
