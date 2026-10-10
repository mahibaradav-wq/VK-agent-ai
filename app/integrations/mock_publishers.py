from dataclasses import dataclass


@dataclass(frozen=True)
class MockPublicationResult:
    status: str
    platform: str
    publication_url: str
    mock: bool = True


class MockPublisher:
    def publish(self, *, platform: str, content_id: str, version_hash: str) -> MockPublicationResult:
        normalized_platform = platform.upper()
        return MockPublicationResult(
            status="mock",
            platform=normalized_platform,
            publication_url=f"/mock/{normalized_platform.lower()}/{content_id}-{version_hash[:8]}",
        )

