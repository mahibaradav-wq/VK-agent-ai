def create_publishable_content(client, content_id="CONTENT-001"):
    client.post(
        "/api/products",
        json={
            "id": "PROD-001",
            "name": "Органайзер для кухни",
            "category": "органайзеры",
            "price": 50000,
            "stock": 10,
        },
    )
    response = client.post(
        "/api/content",
        json={
            "id": content_id,
            "title": "5 ошибок в маленькой кухне",
            "content_type": "пост",
            "body": "Вот основные ошибки хранения на маленькой кухне и способы их исправить.",
            "product_id": "PROD-001",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_healthcheck(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["mock_mode"] is True


def test_publish_without_approval_is_rejected(client):
    create_publishable_content(client)

    response = client.post("/api/content/CONTENT-001/publish", json={"platform": "VK"})

    assert response.status_code == 409
    assert "approved" in response.json()["detail"]


def test_review_approval_and_publish_flow(client):
    create_publishable_content(client)

    review = client.post("/api/content/CONTENT-001/review")
    assert review.status_code == 200
    assert review.json()["status"] == "PASSED"

    approval = client.post("/api/content/CONTENT-001/approve", json={"approved_by": "owner"})
    assert approval.status_code == 200
    assert approval.json()["is_active"] is True

    published = client.post("/api/content/CONTENT-001/publish", json={"platform": "VK"})
    assert published.status_code == 200
    assert published.json()["status"] == "mock"
    assert published.json()["platform"] == "VK"
    assert published.json()["mock"] is True
    assert published.json()["duplicate"] is False


def test_publish_same_version_is_idempotent(client):
    create_publishable_content(client)
    client.post("/api/content/CONTENT-001/review")
    client.post("/api/content/CONTENT-001/approve", json={"approved_by": "owner"})

    first = client.post("/api/content/CONTENT-001/publish", json={"platform": "VK"})
    second = client.post("/api/content/CONTENT-001/publish", json={"platform": "VK"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["duplicate"] is True
    assert second.json()["publication_url"] == first.json()["publication_url"]


def test_content_update_invalidates_approval(client):
    create_publishable_content(client)
    client.post("/api/content/CONTENT-001/review")
    client.post("/api/content/CONTENT-001/approve", json={"approved_by": "owner"})

    update = client.patch(
        "/api/content/CONTENT-001",
        json={"body": "Обновлённый текст с новыми советами по хранению на кухне."},
    )
    assert update.status_code == 200
    assert update.json()["status"] == "DRAFT"

    response = client.post("/api/content/CONTENT-001/publish", json={"platform": "VK"})
    assert response.status_code == 409
    assert "approved" in response.json()["detail"]


def test_short_content_requires_revision(client):
    client.post(
        "/api/content",
        json={
            "id": "CONTENT-002",
            "title": "Короткий пост",
            "content_type": "пост",
            "body": "Коротко.",
        },
    )

    review = client.post("/api/content/CONTENT-002/review")

    assert review.status_code == 200
    assert review.json()["status"] == "REVISION_REQUIRED"
    content = client.get("/api/content/CONTENT-002")
    assert content.json()["status"] == "REVISION_REQUIRED"

