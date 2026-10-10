def test_landing_page_describes_product(client):
    response = client.get("/")

    assert response.status_code == 200
    assert "AI-планер" in response.text
    assert "Открыть кабинет" in response.text


def test_dashboard_page_renders(client):
    response = client.get("/app")

    assert response.status_code == 200
    assert "Рабочий кабинет" in response.text
    assert "Контентный pipeline" in response.text


def test_site_forms_create_ai_content_workflow(client):
    product = client.post(
        "/app/products",
        data={
            "id": "PROD-WEB-001",
            "name": "Органайзер для шкафа",
            "category": "органайзеры",
            "price": "79000",
            "stock": "4",
        },
        follow_redirects=False,
    )
    assert product.status_code == 303

    idea_response = client.post(
        "/app/ideas",
        data={"topic": "порядок в шкафу", "house_zone": "спальня", "content_format": "пост"},
        follow_redirects=False,
    )
    assert idea_response.status_code == 303
    ideas = client.get("/api/ideas").json()
    idea_id = ideas[0]["id"]

    draft_response = client.post(
        "/app/content-drafts",
        data={"idea_id": idea_id, "product_id": "PROD-WEB-001", "content_type": "пост"},
        follow_redirects=False,
    )
    assert draft_response.status_code == 303
    content = client.get("/api/content").json()[0]

    assert content["status"] == "DRAFT"
    assert content["product_id"] == "PROD-WEB-001"

    review = client.post(f"/app/content/{content['id']}/review", follow_redirects=False)
    approval = client.post(f"/app/content/{content['id']}/approve", data={"approved_by": "owner"}, follow_redirects=False)
    publish = client.post(f"/app/content/{content['id']}/publish", data={"platform": "VK"}, follow_redirects=False)

    assert review.status_code == 303
    assert approval.status_code == 303
    assert publish.status_code == 303
    assert client.get("/api/publications").json()[0]["platform"] == "VK"


def test_site_metrics_and_telegram_forms(client):
    telegram = client.post(
        "/app/telegram",
        data={"message": "Mock уведомление из сайта"},
        follow_redirects=False,
    )
    metrics = client.post(
        "/app/metrics",
        data={"platform": "VK", "published_post_id": "", "views": "10", "likes": "2", "comments": "1"},
        follow_redirects=False,
    )

    assert telegram.status_code == 303
    assert metrics.status_code == 303
    assert client.get("/api/notifications").json()[0]["message"] == "Mock уведомление из сайта"
    assert client.get("/api/metrics").json()[0]["views"] == 10

