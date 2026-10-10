from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TaskCreate(BaseModel):
    id: str
    title: str
    description: str | None = None
    status: str = "open"


class TaskRead(TaskCreate):
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class IdeaCreate(BaseModel):
    id: str
    title: str
    format: str
    house_zone: str | None = None
    status: str = "new"


class IdeaRead(IdeaCreate):
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProductCreate(BaseModel):
    id: str
    name: str
    category: str
    price: int = Field(ge=0, description="Price in minor currency units")
    stock: int = Field(default=0, ge=0)


class ProductRead(ProductCreate):
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ContentCreate(BaseModel):
    id: str
    title: str
    content_type: str
    body: str = Field(min_length=1)
    product_id: str | None = None


class ContentUpdate(BaseModel):
    title: str | None = None
    body: str | None = Field(default=None, min_length=1)
    product_id: str | None = None


class ContentRead(BaseModel):
    id: str
    title: str
    content_type: str
    body: str
    product_id: str | None
    status: str
    current_version_hash: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReviewRead(BaseModel):
    id: int
    content_id: str
    version_hash: str
    status: str
    notes: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ApprovalCreate(BaseModel):
    approved_by: str = "owner"


class ApprovalRead(BaseModel):
    id: int
    content_id: str
    version_hash: str
    approved_by: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PublishCreate(BaseModel):
    platform: str = "VK"


class PublishRead(BaseModel):
    status: str
    platform: str
    content_id: str
    version_hash: str
    publication_url: str
    mock: bool
    duplicate: bool = False


class AuditLogRead(BaseModel):
    id: int
    action: str
    entity_type: str
    entity_id: str
    actor: str
    details: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MetricsRead(BaseModel):
    id: int
    published_post_id: int | None
    platform: str
    views: int
    likes: int
    comments: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HealthRead(BaseModel):
    status: str
    app_name: str
    mock_mode: bool


class ErrorRead(BaseModel):
    detail: str | dict[str, Any]

