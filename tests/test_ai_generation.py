def test_generate_idea_is_deterministic(client):
    payload = {
        "topic": "хранение специй",
        "house_zone": "кухня",
        "content_format": "пост",
    }

    first = client.post("/api/ai/ideas", json=payload)
    second = client.post("/api/ai/ideas", json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["status"] == "ai_generated"


def test_generate_content_draft_from_ai_idea(client):
    idea = client.post(
        "/api/ai/ideas",
        json={
            "topic": "хранение контейнеров",
            "house_zone": "кухня",
            "content_format": "пост",
        },
    ).json()

    draft = client.post(
        "/api/ai/content-drafts",
        json={"idea_id": idea["id"], "content_type": "пост"},
    )

    assert draft.status_code == 201
    assert draft.json()["status"] == "DRAFT"
    assert draft.json()["title"] == idea["title"]
    assert "Mock AI draft" in draft.json()["body"]


def test_ai_draft_can_pass_approval_and_publish(client):
    idea = client.post(
        "/api/ai/ideas",
        json={
            "topic": "организация прихожей",
            "house_zone": "прихожая",
            "content_format": "пост",
        },
    ).json()
    draft = client.post(
        "/api/ai/content-drafts",
        json={"idea_id": idea["id"], "content_type": "пост"},
    ).json()

    review = client.post(f"/api/content/{draft['id']}/review")
    approval = client.post(f"/api/content/{draft['id']}/approve", json={"approved_by": "owner"})
    published = client.post(f"/api/content/{draft['id']}/publish", json={"platform": "VK"})

    assert review.status_code == 200
    assert review.json()["status"] == "PASSED"
    assert approval.status_code == 200
    assert published.status_code == 200
    assert published.json()["mock"] is True


def test_generate_content_draft_requires_idea_or_title(client):
    response = client.post("/api/ai/content-drafts", json={"content_type": "пост"})

    assert response.status_code == 400
    assert "Either idea_id or title is required" == response.json()["detail"]

