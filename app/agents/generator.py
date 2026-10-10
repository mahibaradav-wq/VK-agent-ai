from dataclasses import dataclass
from hashlib import sha1


@dataclass(frozen=True)
class GeneratedIdea:
    id: str
    title: str
    format: str
    house_zone: str


@dataclass(frozen=True)
class GeneratedDraft:
    id: str
    title: str
    content_type: str
    body: str
    product_id: str | None


class IdeaAgent:
    """Deterministic idea generator for mock mode."""

    def generate(self, *, topic: str, house_zone: str, content_format: str = "пост") -> GeneratedIdea:
        seed = _short_hash("idea", topic, house_zone, content_format)
        normalized_topic = topic.strip().lower()
        normalized_zone = house_zone.strip().lower()
        return GeneratedIdea(
            id=f"IDEA-AI-{seed}",
            title=f"Как навести порядок: {normalized_topic} в зоне «{normalized_zone}»",
            format=content_format,
            house_zone=house_zone,
        )


class ContentDraftAgent:
    """Deterministic draft generator for mock mode."""

    def generate(
        self,
        *,
        idea_title: str,
        content_type: str = "пост",
        product_id: str | None = None,
    ) -> GeneratedDraft:
        seed = _short_hash("content", idea_title, content_type, product_id or "")
        title = idea_title.strip()
        body = (
            f"{title}\n\n"
            "1. Осмотрите зону и уберите лишнее.\n"
            "2. Сгруппируйте вещи по частоте использования.\n"
            "3. Выберите понятное место хранения для каждой группы.\n"
            "4. Добавьте простой органайзер, если он реально экономит время.\n\n"
            "Mock AI draft: текст создан локально и требует ревизии перед публикацией."
        )
        return GeneratedDraft(
            id=f"CONTENT-AI-{seed}",
            title=title,
            content_type=content_type,
            body=body,
            product_id=product_id,
        )


def _short_hash(*parts: str) -> str:
    payload = "|".join(parts)
    return sha1(payload.encode("utf-8")).hexdigest()[:10].upper()

