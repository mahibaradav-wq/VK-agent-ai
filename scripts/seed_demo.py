from sqlalchemy.exc import IntegrityError

from app import schemas, services
from app.database import SessionLocal, init_db


def main() -> None:
    init_db()
    db = SessionLocal()
    try:
        _safe_call(
            services.create_product,
            db,
            schemas.ProductCreate(
                id="PROD-DEMO-001",
                name="Органайзер для кухни",
                category="органайзеры",
                price=50000,
                stock=10,
            ),
        )
        idea = services.generate_idea(
            db,
            schemas.GenerateIdeaCreate(
                topic="хранение специй",
                house_zone="кухня",
                content_format="пост",
            ),
        )
        content = services.generate_content_draft(
            db,
            schemas.GenerateDraftCreate(
                idea_id=idea.id,
                content_type="пост",
                product_id="PROD-DEMO-001",
            ),
        )
        if content.status == "DRAFT":
            services.review_content(db, content.id)
            services.approve_content(db, content.id, schemas.ApprovalCreate(approved_by="owner"))
        services.publish_content(db, content.id, schemas.PublishCreate(platform="VK"))
        services.send_telegram_notification(
            db,
            schemas.NotificationCreate(message=f"Demo content {content.id} опубликован в mock VK"),
        )
        print("Demo data seeded.")
    finally:
        db.close()


def _safe_call(func, *args, **kwargs):
    try:
        return func(*args, **kwargs)
    except IntegrityError:
        args[0].rollback()
        return None


if __name__ == "__main__":
    main()

