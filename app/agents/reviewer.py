from dataclasses import dataclass


@dataclass(frozen=True)
class ReviewResult:
    passed: bool
    notes: str


class ReviewerAgent:
    """Deterministic reviewer for mock mode.

    The first MVP needs predictable behavior for tests and demos, so the agent
    applies simple local rules instead of calling an external LLM.
    """

    min_body_length = 20

    def review(self, body: str) -> ReviewResult:
        normalized = body.strip()
        if len(normalized) < self.min_body_length:
            return ReviewResult(False, "Текст слишком короткий для публикации.")
        if "запрещено" in normalized.lower():
            return ReviewResult(False, "Текст содержит запрещённое слово.")
        return ReviewResult(True, "Материал прошёл mock-ревизию.")

