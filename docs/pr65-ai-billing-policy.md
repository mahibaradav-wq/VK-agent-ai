# PR #65 — AI billing network classification policy

Conservative workspace AI units for OpenAI-compatible transport failures.

## Rule

| Outcome | Class | Units |
|---|---|---|
| HTTP response received (2xx / 4xx / 5xx) | `likely_billable` | **1** |
| Proven request never sent (DNS `ENOTFOUND` / `EAI_AGAIN`, `ECONNREFUSED`, unreachable host before connect) | `non_billable` | **0** |
| Timeout, abort, reset, generic `fetch failed`, unknown | `unknown` | **1** |

**Do not** treat every `fetch` exception as `paidCalls: 0`. Charge **1** unless it is proven the request never left the client.

Helpers: `classifyPaidHttpOutcome`, `classifyFetchFailure`, `paidCallsForHttpClass` in `src/modules/ai/usage-units.ts`.  
Adapter: `src/server/ai/openai-compatible.ts` attaches `paidCalls` from `classifyFetchFailure` on catch.

## Interaction with reserve / fallback

- `ensureReserve` still runs before each provider attempt (PR #64).
- Billable failures stay charged; unused reserve releases on settle.
- No double charge: one `paidCalls` on the error/result; `notePaidCalls` once per attempt.
- Insufficient limit → no extra provider call (fallback refused before HTTP).

## Tariff note

This policy only maps transport outcomes to unit counts. It does not change plan prices or monthly limits.
