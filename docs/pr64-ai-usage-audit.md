# PR #64 — AI usage accounting audit

Branch: `cursor/vps-full-readiness-audit-ee77`  
Base: `cursor/vps-probe-harness-isolation-ee77` (PR #63)  
Scope: accurate paid AI unit accounting for Agent AI + Studio revise (mock-only verification).

## Unit model

- **1 paid HTTP call = 1 AI unit** (chat/completions or images/generations).
- Providers expose `paidCalls` on successful results and on errors after a billed attempt.
- Flow: **reserve max → `ensureReserve` before every provider attempt (incl. fallback) → charge actual → release unused**.
- Extra paid attempts never start if the monthly metric cannot grow to cover them.
- `PaidAccount` tracks `{ periodStart, reserved, charged }` per request; `settlePaidAi` releases `reserved - min(charged, reserved)`.
- Concurrent workspace requests still go through transactional `lockWorkspaceMetric` + `reserveUsage`.

Constants / helpers:

| Helper | Role |
|---|---|
| `MAX_POST_COMPLETION_CALLS = 2` | Worst-case draft + length revise for one post text |
| `textGenerateReserveUnits(kind)` | `post` → 2, other kinds → 1 |
| `attemptReserveUnits(kind)` | Worst-case units for one provider attempt |
| `agentUsageUnits(kind, count, copyCount)` | `copyCount × 2 + visual assets` |
| `studioReviseReserveUnits(...)` | platforms × 2 for text + slideCount for visuals |
| `classifyPaidHttpOutcome` / `paidCallsForHttpClass` | HTTP vs network billing class |
| `paidCallsFromResult` / `paidCallsFromError` | Read billed units from provider I/O |

## HTTP error classification

Superseded for network failures by **PR #65** — see `docs/pr65-ai-billing-policy.md`.

| Outcome | Class | Units |
|---|---|---|
| Provider returned HTTP (any status) | `likely_billable` | 1 |
| Proven never sent (DNS / connect refused) | `non_billable` | 0 |
| Timeout / abort / unknown fetch failure | `unknown` | **1** (conservative) |

Tariff rules unchanged: classification only maps transport to `paidCalls`. No double charge on attach/settle.

## Inventory

| Operation | Actual API calls (live OpenAI-compatible) | Previous reserve | Required / new reserve |
|---|---|---|---|
| Text generate (ideas/headline/…) | 1 chat | 1 | 1 |
| Post generate | 1–2 chat (draft ± length revise) | 2 (G1) | 2 |
| Agent AI, 1 platform, image | ≤2 chat + 1 image | 2 (undercounted revise) | **3** |
| Agent AI, 2 platforms, image | ≤4 chat + 1 image | 3 | **5** |
| Agent AI carousel N | ≤2×platforms chat + N images | platforms + N | **2×platforms + N** |
| Agent AI video S seconds | ≤2×platforms chat + S/2 frames | platforms + S/2 | **2×platforms + S/2** |
| Studio revise text (P platforms) | ≤2P chat | P (undercount) | **2P** |
| Studio revise visual (S slides) | S images | S | S |
| Studio revise both | ≤2P chat + S images | P + S | **2P + S** |
| Provider fallback (region) | failed attempt(s) + success | often 1 | **ensureReserve before each attempt**; refuse if grow impossible |
| Partial failure after success | successful calls kept | sometimes released all | keep charged; release only unused reserve |
| `applyToPost` / replay | 0 new paid calls | 0 | 0 |

## Bugs fixed

1. **Agent AI under-reserve** — reserved `copyCount + visuals` while live post text can spend 2 chat calls each → reserve now `copyCount × MAX_POST_COMPLETION_CALLS + visuals`.
2. **Studio revise under-reserve** — text rewrite reserved 1 unit per platform; now reserves 2 per platform.
3. **Fallback undercount** — failed paid attempts noted via `paidCalls`; unused initial reserve released on settle.
4. **Fallback without headroom** — previously a backup HTTP call could run and then fail to grow the metric. Now `ensureReserve(attemptUnits)` runs **before** every provider attempt (text + image, injected and multi-provider). If grow fails, further providers are not called; already spent units stay charged.
5. **Injected provider failure charge** — mock/injected path now notes billable failures the same way as the fallback loop.
6. **Charge sync** — generate / composeAgentPost / reviseStudioCard share `PaidAccount` + settle; partial errors keep successful charges.

## Code touchpoints

- `src/modules/ai/usage-units.ts` — unit helpers + HTTP classification
- `src/modules/ai/visual.ts` — `agentUsageUnits` / `studioReviseReserveUnits`
- `src/modules/ai/ai-service.ts` — `PaidAccount`, `ensureReserve`, `notePaidCalls`, `settlePaidAi`, `callWithFallback` billing gate
- `src/server/ai/openai-compatible.ts` — `paidCalls` on chat/image success and errors
- `src/server/ai/types.ts` — optional `paidCalls` on generate/image outputs
- `src/modules/ai/ai-usage-accounting.test.ts` — base 16 + fallback gate suite

## Required tests (mock)

### Base suite (16/16 PASS)

1. Text generate: reserve matches billed chat  
2. Post + length revise: both chat calls billed  
3. Agent AI one platform: text + visual match counts  
4. Agent AI two platforms: both texts + visual  
5. Carousel: one unit per card image  
6. Video: one unit per frame  
7. Revise text only  
8. Revise visual only  
9. Revise both  
10. First API fail releases whole reserve  
11. Fail after first success keeps first charge  
12. DB save fail after paid success keeps charge  
13. Replay (`applyToPost`) no double charge  
14. Two parallel near-limit generates cannot exceed limit  
15. Insufficient limit → no provider API calls  
16. Provider fallback counts real paid calls from failed attempt  

### Fallback reservation gate (PASS)

| Test | Asserts |
|---|---|
| HTTP vs network classification | billable=1, network=0 |
| Fallback with enough limit | fail+success → used=2, backup called |
| Fallback with insufficient limit | backup **not** called; first spend kept |
| Failed first + failed backup | both spends charged |
| Successful second after billable first | provider=backup, used=2 |
| Partial multi-image error | text + first frame + failed second kept |
| Error after successful text | text + failed image kept |
| Parallel fallbacks at limit boundary | used ≤ limit; at most one full fallback success |
| Released unused after success | agent reserve 3 → used 2 |
| No stuck reserve after fail | used=0 then next op works |

## Full checks (this run)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` (287, with `PROBE_HARNESS_ADMIN_URL`) | PASS |
| AI module vitest | PASS (61) |
| `npm run test:vps` | PASS (108) |
| `bash -n` VPS scripts | PASS |
| `npx prisma validate` | PASS |
| `npm run build` | PASS |
| Playwright e2e | PASS (8) |
| GitHub CI + VPS readiness | (see HEAD after push) |

No merge, deploy, SSH, VPS survey, paid OpenAI, live VK/Telegram, or `.env` dump.

## Residual risks

- Docker Engine image build/run and real VPS volume permissions remain unproven in this agent environment.
- CSP / in-memory rate limit / operator backup cron — unchanged accepted warnings.
- Emergency path: if a provider returns more `paidCalls` than `attemptUnits` predicted (should not happen with current adapters), `notePaidCalls` still tries to grow after the fact; adapters must keep `paidCalls ≤ attemptUnits`.

## Status

Agent AI / Studio revise undercount **and** fallback-without-reserve residual risks are cleared (mock-proven; live paid APIs not exercised per hard limits).
