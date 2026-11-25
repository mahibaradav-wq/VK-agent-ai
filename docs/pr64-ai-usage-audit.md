# PR #64 — AI usage accounting audit

Branch: `cursor/vps-full-readiness-audit-ee77`  
Base: `cursor/vps-probe-harness-isolation-ee77` (PR #63)  
Scope: accurate paid AI unit accounting for Agent AI + Studio revise (mock-only verification).

## Unit model

- **1 paid HTTP call = 1 AI unit** (chat/completions or images/generations).
- Providers expose `paidCalls` on successful results and on errors after a billed attempt.
- Flow: **reserve max → charge actual → release unused → grow reserve** if fallback/extra calls exceed the initial reserve.
- `PaidAccount` tracks `{ periodStart, reserved, charged }` per request; `settlePaidAi` releases `reserved - min(charged, reserved)`.
- Concurrent workspace requests still go through transactional `lockWorkspaceMetric` + `reserveUsage`.

Constants / helpers:

| Helper | Role |
|---|---|
| `MAX_POST_COMPLETION_CALLS = 2` | Worst-case draft + length revise for one post text |
| `textGenerateReserveUnits(kind)` | `post` → 2, other kinds → 1 |
| `agentUsageUnits(kind, count, copyCount)` | `copyCount × 2 + visual assets` |
| `studioReviseReserveUnits(...)` | platforms × 2 for text + slideCount for visuals |
| `paidCallsFromResult` / `paidCallsFromError` | Read billed units from provider I/O |

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
| Provider fallback (region) | failed attempt(s) + success | often 1 | grow reserve to cover all paid attempts |
| Partial failure after success | successful calls kept | sometimes released all | keep charged; release only unused reserve |
| `applyToPost` / replay | 0 new paid calls | 0 | 0 |

## Bugs fixed

1. **Agent AI under-reserve** — reserved `copyCount + visuals` while live post text can spend 2 chat calls each → reserve now `copyCount × MAX_POST_COMPLETION_CALLS + visuals`.
2. **Studio revise under-reserve** — text rewrite reserved 1 unit per platform; now reserves 2 per platform.
3. **Fallback undercount** — failed paid attempts on OpenAI before backup were not always kept; `callWithFallback` notes `paidCalls` on failures and `notePaidCalls` grows the reserve when needed.
4. **Charge sync** — generate / composeAgentPost / reviseStudioCard share `PaidAccount` + settle; partial errors keep successful charges; unused reserve is released.

## Code touchpoints

- `src/modules/ai/usage-units.ts` — shared unit helpers
- `src/modules/ai/visual.ts` — `agentUsageUnits` / `studioReviseReserveUnits`
- `src/modules/ai/ai-service.ts` — `PaidAccount`, `notePaidCalls`, `settlePaidAi`, wiring for generate / agent / revise
- `src/server/ai/openai-compatible.ts` — attach `paidCalls` on chat/image success and errors
- `src/server/ai/types.ts` — optional `paidCalls` on generate/image outputs
- `src/modules/ai/ai-usage-accounting.test.ts` — 16 required mock tests

## Required tests (all mock, 16/16 PASS)

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

## Full checks (this run)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` (277, with `PROBE_HARNESS_ADMIN_URL`) | PASS |
| AI module vitest (51) | PASS |
| `npm run test:vps` (108) | PASS |
| `bash -n` VPS scripts | PASS |
| `npx prisma validate` | PASS |
| `npm run build` | PASS |
| Playwright e2e (8) | PASS (`AUTH_ALLOW_PUBLIC_REGISTRATION=true`) |

No merge, deploy, SSH, VPS survey, paid OpenAI, live VK/Telegram, or `.env` dump.

## Residual risks

- If a fallback paid call happens when the monthly limit cannot grow (`beginPaidAi` for extra units fails after the HTTP call already succeeded), the metric may still under-record that last call. Normal path grows reserve before settle when headroom exists.
- Docker Engine image build/run and real VPS volume permissions remain unproven in this agent environment.
- CSP / in-memory rate limit / operator backup cron — unchanged accepted warnings.

## Status

Agent AI / Studio revise **undercount residual risk is cleared** for the accounted paths above (mock-proven; live paid APIs not exercised per hard limits).
