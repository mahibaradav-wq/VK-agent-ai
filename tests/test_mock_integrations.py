from tests.test_workflow import create_publishable_content


def test_content_history_endpoints(client):
    create_publishable_content(client)
    client.post("/api/content/CONTENT-001/review")
    client.post("/api/content/CONTENT-001/approve", json={"approved_by": "owner"})

    versions = client.get("/api/content/CONTENT-001/versions")
    reviews = client.get("/api/content/CONTENT-001/reviews")
    approvals = client.get("/api/content/CONTENT-001/approvals")

    assert versions.status_code == 200
    assert versions.json()[0]["version_number"] == 1
    assert reviews.status_code == 200
    assert reviews.json()[0]["status"] == "PASSED"
    assert approvals.status_code == 200
    assert approvals.json()[0]["is_active"] is True


def test_mock_ozon_import_creates_and_updates_products(client):
    payload = {
        "products": [
            {
                "id": "OZON-001",
                "name": "Короб для хранения",
                "category": "хранение",
                "price": 120000,
                "stock": 5,
            }
        ]
    }

    created = client.post("/api/mock/ozon/import-products", json=payload)
    payload["products"][0]["stock"] = 8
    updated = client.post("/api/mock/ozon/import-products", json=payload)
    products = client.get("/api/products")

    assert created.status_code == 200
    assert created.json()["imported_count"] == 1
    assert updated.status_code == 200
    assert products.status_code == 200
    assert products.json()[0]["stock"] == 8


def test_mock_telegram_notification_is_stored(client):
    created = client.post(
        "/api/mock/telegram/notify",
        json={"channel": "telegram", "message": "Контент готов к публикации"},
    )
    notifications = client.get("/api/notifications")

    assert created.status_code == 201
    assert notifications.status_code == 200
    assert notifications.json()[0]["message"] == "Контент готов к публикации"


def test_publications_and_manual_metrics_collection(client):
    create_publishable_content(client)
    client.post("/api/content/CONTENT-001/review")
    client.post("/api/content/CONTENT-001/approve", json={"approved_by": "owner"})
    client.post("/api/content/CONTENT-001/publish", json={"platform": "VK"})

    publications = client.get("/api/publications")
    assert publications.status_code == 200
    published_post_id = publications.json()[0]["id"]

    collected = client.post(
        "/api/metrics/collect",
        json={
            "platform": "VK",
            "published_post_id": published_post_id,
            "views": 100,
            "likes": 12,
            "comments": 3,
        },
    )
    metrics = client.get("/api/metrics")

    assert collected.status_code == 201
    assert collected.json()["views"] == 100
    assert metrics.status_code == 200
    assert metrics.json()[0]["likes"] == 12

