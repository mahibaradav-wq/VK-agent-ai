from collections.abc import Sequence
from typing import TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models

ModelT = TypeVar("ModelT")


def list_all(db: Session, model: type[ModelT]) -> Sequence[ModelT]:
    return db.scalars(select(model).order_by(model.created_at.desc())).all()


def get_by_id(db: Session, model: type[ModelT], entity_id: str) -> ModelT | None:
    return db.get(model, entity_id)


def add_task(db: Session, task: models.Task) -> models.Task:
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def add_idea(db: Session, idea: models.Idea) -> models.Idea:
    db.add(idea)
    db.commit()
    db.refresh(idea)
    return idea


def add_product(db: Session, product: models.Product) -> models.Product:
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def add_content(db: Session, content: models.ContentItem, version: models.ContentVersion) -> models.ContentItem:
    db.add(content)
    db.add(version)
    db.commit()
    db.refresh(content)
    return content


def get_active_approval(db: Session, content_id: str, version_hash: str) -> models.Approval | None:
    stmt = select(models.Approval).where(
        models.Approval.content_id == content_id,
        models.Approval.version_hash == version_hash,
        models.Approval.is_active.is_(True),
    )
    return db.scalars(stmt).first()


def get_published_post(db: Session, content_id: str, platform: str, version_hash: str) -> models.PublishedPost | None:
    stmt = select(models.PublishedPost).where(
        models.PublishedPost.content_id == content_id,
        models.PublishedPost.platform == platform,
        models.PublishedPost.version_hash == version_hash,
    )
    return db.scalars(stmt).first()


def next_version_number(db: Session, content_id: str) -> int:
    stmt = select(models.ContentVersion).where(models.ContentVersion.content_id == content_id)
    return len(db.scalars(stmt).all()) + 1


def audit(
    db: Session,
    action: str,
    entity_type: str,
    entity_id: str,
    *,
    actor: str = "system",
    details: str | None = None,
) -> models.AuditLog:
    log = models.AuditLog(
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        actor=actor,
        details=details,
    )
    db.add(log)
    return log

