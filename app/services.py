import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, repositories, schemas
from app.agents.generator import ContentDraftAgent, IdeaAgent
from app.agents.reviewer import ReviewerAgent
from app.integrations.mock_publishers import MockPublisher


class DomainError(Exception):
    status_code = 400

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class NotFoundError(DomainError):
    status_code = 404


class ConflictError(DomainError):
    status_code = 409


def content_hash(*, title: str, body: str, product_id: str | None) -> str:
    payload = json.dumps(
        {"title": title.strip(), "body": body.strip(), "product_id": product_id},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def create_task(db: Session, payload: schemas.TaskCreate) -> models.Task:
    task = models.Task(**payload.model_dump())
    db.add(task)
    repositories.audit(db, "CREATE_TASK", "task", task.id)
    db.commit()
    db.refresh(task)
    return task


def create_idea(db: Session, payload: schemas.IdeaCreate) -> models.Idea:
    idea = models.Idea(**payload.model_dump())
    db.add(idea)
    repositories.audit(db, "CREATE_IDEA", "idea", idea.id)
    db.commit()
    db.refresh(idea)
    return idea


def generate_idea(
    db: Session,
    payload: schemas.GenerateIdeaCreate,
    agent: IdeaAgent | None = None,
) -> models.Idea:
    agent = agent or IdeaAgent()
    generated = agent.generate(
        topic=payload.topic,
        house_zone=payload.house_zone,
        content_format=payload.content_format,
    )
    existing = db.get(models.Idea, generated.id)
    if existing:
        return existing

    return create_idea(
        db,
        schemas.IdeaCreate(
            id=generated.id,
            title=generated.title,
            format=generated.format,
            house_zone=generated.house_zone,
            status="ai_generated",
        ),
    )


def create_product(db: Session, payload: schemas.ProductCreate) -> models.Product:
    product = models.Product(**payload.model_dump())
    db.add(product)
    repositories.audit(db, "CREATE_PRODUCT", "product", product.id)
    db.commit()
    db.refresh(product)
    return product


def create_content(db: Session, payload: schemas.ContentCreate) -> models.ContentItem:
    if payload.product_id and not db.get(models.Product, payload.product_id):
        raise NotFoundError(f"Product {payload.product_id} not found")

    version_hash = content_hash(title=payload.title, body=payload.body, product_id=payload.product_id)
    content = models.ContentItem(
        id=payload.id,
        title=payload.title,
        content_type=payload.content_type,
        body=payload.body,
        product_id=payload.product_id,
        status=models.ContentStatus.DRAFT.value,
        current_version_hash=version_hash,
    )
    version = models.ContentVersion(
        content_id=payload.id,
        version_number=1,
        title=payload.title,
        body=payload.body,
        product_id=payload.product_id,
        version_hash=version_hash,
    )
    db.add(content)
    db.add(version)
    repositories.audit(db, "CREATE_CONTENT", "content", content.id, details=f"version_hash={version_hash}")
    db.commit()
    db.refresh(content)
    return content


def generate_content_draft(
    db: Session,
    payload: schemas.GenerateDraftCreate,
    agent: ContentDraftAgent | None = None,
) -> models.ContentItem:
    idea = db.get(models.Idea, payload.idea_id) if payload.idea_id else None
    if payload.idea_id and not idea:
        raise NotFoundError(f"Idea {payload.idea_id} not found")

    title = payload.title or (idea.title if idea else None)
    if not title:
        raise DomainError("Either idea_id or title is required")

    if payload.product_id and not db.get(models.Product, payload.product_id):
        raise NotFoundError(f"Product {payload.product_id} not found")

    agent = agent or ContentDraftAgent()
    generated = agent.generate(
        idea_title=title,
        content_type=payload.content_type,
        product_id=payload.product_id,
    )
    existing = db.get(models.ContentItem, generated.id)
    if existing:
        return existing

    content = create_content(
        db,
        schemas.ContentCreate(
            id=generated.id,
            title=generated.title,
            content_type=generated.content_type,
            body=generated.body,
            product_id=generated.product_id,
        ),
    )
    repositories.audit(
        db,
        "GENERATE_CONTENT_DRAFT",
        "content",
        content.id,
        details=f"idea_id={payload.idea_id}" if payload.idea_id else "source=title",
    )
    db.commit()
    db.refresh(content)
    return content


def list_content_versions(db: Session, content_id: str) -> list[models.ContentVersion]:
    _require_content(db, content_id)
    stmt = (
        select(models.ContentVersion)
        .where(models.ContentVersion.content_id == content_id)
        .order_by(models.ContentVersion.version_number.desc())
    )
    return list(db.scalars(stmt).all())


def list_content_reviews(db: Session, content_id: str) -> list[models.ContentReview]:
    _require_content(db, content_id)
    stmt = (
        select(models.ContentReview)
        .where(models.ContentReview.content_id == content_id)
        .order_by(models.ContentReview.created_at.desc())
    )
    return list(db.scalars(stmt).all())


def list_content_approvals(db: Session, content_id: str) -> list[models.Approval]:
    _require_content(db, content_id)
    stmt = (
        select(models.Approval)
        .where(models.Approval.content_id == content_id)
        .order_by(models.Approval.created_at.desc())
    )
    return list(db.scalars(stmt).all())


def update_content(db: Session, content_id: str, payload: schemas.ContentUpdate) -> models.ContentItem:
    content = db.get(models.ContentItem, content_id)
    if not content:
        raise NotFoundError(f"Content {content_id} not found")

    if payload.product_id and not db.get(models.Product, payload.product_id):
        raise NotFoundError(f"Product {payload.product_id} not found")

    new_title = payload.title if payload.title is not None else content.title
    new_body = payload.body if payload.body is not None else content.body
    new_product_id = payload.product_id if payload.product_id is not None else content.product_id
    new_hash = content_hash(title=new_title, body=new_body, product_id=new_product_id)

    content.title = new_title
    content.body = new_body
    content.product_id = new_product_id

    if new_hash != content.current_version_hash:
        content.current_version_hash = new_hash
        content.status = models.ContentStatus.DRAFT.value
        for approval in content.approvals:
            if approval.is_active:
                approval.is_active = False
        version = models.ContentVersion(
            content_id=content.id,
            version_number=repositories.next_version_number(db, content.id),
            title=content.title,
            body=content.body,
            product_id=content.product_id,
            version_hash=new_hash,
        )
        db.add(version)
        repositories.audit(db, "INVALIDATE_APPROVAL", "content", content.id, details=f"version_hash={new_hash}")

    repositories.audit(db, "UPDATE_CONTENT", "content", content.id)
    db.commit()
    db.refresh(content)
    return content


def review_content(db: Session, content_id: str, reviewer: ReviewerAgent | None = None) -> models.ContentReview:
    content = db.get(models.ContentItem, content_id)
    if not content:
        raise NotFoundError(f"Content {content_id} not found")

    reviewer = reviewer or ReviewerAgent()
    result = reviewer.review(content.body)
    status = models.ReviewStatus.PASSED.value if result.passed else models.ReviewStatus.REVISION_REQUIRED.value
    content.status = (
        models.ContentStatus.READY_FOR_APPROVAL.value
        if result.passed
        else models.ContentStatus.REVISION_REQUIRED.value
    )
    review = models.ContentReview(
        content_id=content.id,
        version_hash=content.current_version_hash,
        status=status,
        notes=result.notes,
    )
    db.add(review)
    repositories.audit(db, "REVIEW_CONTENT", "content", content.id, details=status)
    db.commit()
    db.refresh(review)
    return review


def approve_content(db: Session, content_id: str, payload: schemas.ApprovalCreate) -> models.Approval:
    content = db.get(models.ContentItem, content_id)
    if not content:
        raise NotFoundError(f"Content {content_id} not found")
    if content.status != models.ContentStatus.READY_FOR_APPROVAL.value:
        raise ConflictError("Content must pass review before approval")

    for approval in content.approvals:
        if approval.is_active:
            approval.is_active = False

    approval = models.Approval(
        content_id=content.id,
        version_hash=content.current_version_hash,
        approved_by=payload.approved_by,
        is_active=True,
    )
    content.status = models.ContentStatus.APPROVED.value
    db.add(approval)
    repositories.audit(
        db,
        "APPROVE_CONTENT",
        "content",
        content.id,
        actor=payload.approved_by,
        details=f"version_hash={content.current_version_hash}",
    )
    db.commit()
    db.refresh(approval)
    return approval


def publish_content(
    db: Session,
    content_id: str,
    payload: schemas.PublishCreate,
    publisher: MockPublisher | None = None,
) -> schemas.PublishRead:
    content = db.get(models.ContentItem, content_id)
    if not content:
        raise NotFoundError(f"Content {content_id} not found")

    platform = payload.platform.upper()
    existing = repositories.get_published_post(db, content.id, platform, content.current_version_hash)
    if existing:
        repositories.audit(
            db,
            "PUBLISH_DUPLICATE_SKIPPED",
            "content",
            content.id,
            details=f"platform={platform}; version_hash={content.current_version_hash}",
        )
        db.commit()
        return schemas.PublishRead(
            status="mock",
            platform=platform,
            content_id=content.id,
            version_hash=content.current_version_hash,
            publication_url=existing.publication_url,
            mock=existing.mock,
            duplicate=True,
        )

    if content.status not in {models.ContentStatus.APPROVED.value, models.ContentStatus.SCHEDULED.value}:
        raise ConflictError("Content must be approved before publication")

    approval = repositories.get_active_approval(db, content.id, content.current_version_hash)
    if not approval:
        raise ConflictError("Active approval for current content version is required")

    publisher = publisher or MockPublisher()
    result = publisher.publish(platform=platform, content_id=content.id, version_hash=content.current_version_hash)
    published = models.PublishedPost(
        content_id=content.id,
        platform=platform,
        version_hash=content.current_version_hash,
        publication_url=result.publication_url,
        mock=result.mock,
    )
    job = models.PublicationJob(
        content_id=content.id,
        platform=platform,
        version_hash=content.current_version_hash,
        status=models.PublicationStatus.PUBLISHED.value,
        result_json=json.dumps(result.__dict__, ensure_ascii=False, sort_keys=True),
    )
    metrics = models.MetricsSnapshot(platform=platform, published_post_id=None)
    content.status = models.ContentStatus.PUBLISHED.value
    db.add(published)
    db.flush()
    metrics.published_post_id = published.id
    db.add(job)
    db.add(metrics)
    repositories.audit(
        db,
        "PUBLISH_CONTENT",
        "content",
        content.id,
        details=f"platform={platform}; version_hash={content.current_version_hash}",
    )
    db.commit()

    return schemas.PublishRead(
        status=result.status,
        platform=platform,
        content_id=content.id,
        version_hash=content.current_version_hash,
        publication_url=result.publication_url,
        mock=result.mock,
    )


def list_metrics(db: Session) -> list[models.MetricsSnapshot]:
    stmt = select(models.MetricsSnapshot).order_by(models.MetricsSnapshot.created_at.desc())
    return list(db.scalars(stmt).all())


def list_published_posts(db: Session) -> list[models.PublishedPost]:
    stmt = select(models.PublishedPost).order_by(models.PublishedPost.created_at.desc())
    return list(db.scalars(stmt).all())


def list_notifications(db: Session) -> list[models.Notification]:
    stmt = select(models.Notification).order_by(models.Notification.created_at.desc())
    return list(db.scalars(stmt).all())


def import_ozon_products(db: Session, payload: schemas.OzonImportCreate) -> schemas.OzonImportRead:
    product_ids: list[str] = []
    for item in payload.products:
        product = db.get(models.Product, item.id)
        if product:
            product.name = item.name
            product.category = item.category
            product.price = item.price
            product.stock = item.stock
        else:
            db.add(models.Product(**item.model_dump()))
        product_ids.append(item.id)

    repositories.audit(
        db,
        "MOCK_OZON_IMPORT_PRODUCTS",
        "product",
        ",".join(product_ids),
        details=f"count={len(product_ids)}",
    )
    db.commit()
    return schemas.OzonImportRead(status="mock", imported_count=len(product_ids), product_ids=product_ids)


def send_telegram_notification(db: Session, payload: schemas.NotificationCreate) -> models.Notification:
    notification = models.Notification(channel=payload.channel, message=payload.message)
    db.add(notification)
    repositories.audit(
        db,
        "MOCK_TELEGRAM_NOTIFY",
        "notification",
        payload.channel,
        details=payload.message,
    )
    db.commit()
    db.refresh(notification)
    return notification


def collect_metrics(db: Session, payload: schemas.MetricsCollectCreate) -> models.MetricsSnapshot:
    platform = payload.platform.upper()
    if payload.published_post_id and not db.get(models.PublishedPost, payload.published_post_id):
        raise NotFoundError(f"Published post {payload.published_post_id} not found")

    metrics = models.MetricsSnapshot(
        published_post_id=payload.published_post_id,
        platform=platform,
        views=payload.views,
        likes=payload.likes,
        comments=payload.comments,
    )
    db.add(metrics)
    repositories.audit(
        db,
        "COLLECT_METRICS",
        "metrics",
        platform,
        details=f"views={payload.views}; likes={payload.likes}; comments={payload.comments}",
    )
    db.commit()
    db.refresh(metrics)
    return metrics


def _require_content(db: Session, content_id: str) -> models.ContentItem:
    content = db.get(models.ContentItem, content_id)
    if not content:
        raise NotFoundError(f"Content {content_id} not found")
    return content

