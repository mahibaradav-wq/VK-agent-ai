from collections.abc import Sequence
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, repositories, schemas, services
from app.config import get_settings
from app.database import get_db, init_db

settings = get_settings()
templates = Jinja2Templates(directory="app/templates")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.exception_handler(services.DomainError)
async def handle_domain_error(_: Request, exc: services.DomainError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(IntegrityError)
async def handle_integrity_error(_: Request, exc: IntegrityError):
    return JSONResponse(status_code=409, content={"detail": "Entity violates a uniqueness or relation constraint"})


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "landing.html", {"app_name": settings.app_name})


@app.get("/app", response_class=HTMLResponse)
def web_dashboard(request: Request, db: Session = Depends(get_db)):
    context = _dashboard_context(request, db)
    return templates.TemplateResponse(request, "dashboard.html", context)


@app.post("/app/products")
def web_create_product(
    id: str = Form(...),
    name: str = Form(...),
    category: str = Form(...),
    price: int = Form(...),
    stock: int = Form(0),
    db: Session = Depends(get_db),
):
    services.create_product(db, schemas.ProductCreate(id=id, name=name, category=category, price=price, stock=stock))
    return RedirectResponse(url="/app", status_code=303)


@app.post("/app/ideas")
def web_generate_idea(
    topic: str = Form(...),
    house_zone: str = Form(...),
    content_format: str = Form("пост"),
    db: Session = Depends(get_db),
):
    services.generate_idea(
        db,
        schemas.GenerateIdeaCreate(topic=topic, house_zone=house_zone, content_format=content_format),
    )
    return RedirectResponse(url="/app", status_code=303)


@app.post("/app/content-drafts")
def web_generate_content_draft(
    idea_id: str = Form(...),
    content_type: str = Form("пост"),
    product_id: str = Form(""),
    db: Session = Depends(get_db),
):
    services.generate_content_draft(
        db,
        schemas.GenerateDraftCreate(
            idea_id=idea_id,
            content_type=content_type,
            product_id=product_id or None,
        ),
    )
    return RedirectResponse(url="/app", status_code=303)


@app.post("/app/content")
def web_create_content(
    id: str = Form(...),
    title: str = Form(...),
    content_type: str = Form("пост"),
    body: str = Form(...),
    product_id: str = Form(""),
    db: Session = Depends(get_db),
):
    services.create_content(
        db,
        schemas.ContentCreate(
            id=id,
            title=title,
            content_type=content_type,
            body=body,
            product_id=product_id or None,
        ),
    )
    return RedirectResponse(url="/app", status_code=303)


@app.post("/app/content/{content_id}/review")
def web_review_content(content_id: str, db: Session = Depends(get_db)):
    services.review_content(db, content_id)
    return RedirectResponse(url="/app", status_code=303)


@app.post("/app/content/{content_id}/approve")
def web_approve_content(
    content_id: str,
    approved_by: str = Form("owner"),
    db: Session = Depends(get_db),
):
    services.approve_content(db, content_id, schemas.ApprovalCreate(approved_by=approved_by))
    return RedirectResponse(url="/app", status_code=303)


@app.post("/app/content/{content_id}/publish")
def web_publish_content(
    content_id: str,
    platform: str = Form("VK"),
    db: Session = Depends(get_db),
):
    services.publish_content(db, content_id, schemas.PublishCreate(platform=platform))
    return RedirectResponse(url="/app", status_code=303)


@app.post("/app/telegram")
def web_send_telegram_notification(
    message: str = Form(...),
    db: Session = Depends(get_db),
):
    services.send_telegram_notification(db, schemas.NotificationCreate(channel="telegram", message=message))
    return RedirectResponse(url="/app", status_code=303)


@app.post("/app/metrics")
def web_collect_metrics(
    platform: str = Form("VK"),
    published_post_id: str = Form(""),
    views: int = Form(0),
    likes: int = Form(0),
    comments: int = Form(0),
    db: Session = Depends(get_db),
):
    services.collect_metrics(
        db,
        schemas.MetricsCollectCreate(
            platform=platform,
            published_post_id=int(published_post_id) if published_post_id else None,
            views=views,
            likes=likes,
            comments=comments,
        ),
    )
    return RedirectResponse(url="/app", status_code=303)


@app.get("/health", response_model=schemas.HealthRead)
def health():
    return schemas.HealthRead(status="ok", app_name=settings.app_name, mock_mode=settings.mock_mode)


@app.get("/api/tasks", response_model=list[schemas.TaskRead])
def list_tasks(db: Session = Depends(get_db)) -> Sequence[models.Task]:
    return repositories.list_all(db, models.Task)


@app.post("/api/tasks", response_model=schemas.TaskRead, status_code=201)
def create_task(payload: schemas.TaskCreate, db: Session = Depends(get_db)) -> models.Task:
    return services.create_task(db, payload)


@app.get("/api/tasks/{task_id}", response_model=schemas.TaskRead)
def get_task(task_id: str, db: Session = Depends(get_db)) -> models.Task:
    task = repositories.get_by_id(db, models.Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.get("/api/ideas", response_model=list[schemas.IdeaRead])
def list_ideas(db: Session = Depends(get_db)) -> Sequence[models.Idea]:
    return repositories.list_all(db, models.Idea)


@app.post("/api/ideas", response_model=schemas.IdeaRead, status_code=201)
def create_idea(payload: schemas.IdeaCreate, db: Session = Depends(get_db)) -> models.Idea:
    return services.create_idea(db, payload)


@app.post("/api/ai/ideas", response_model=schemas.IdeaRead, status_code=201)
def generate_idea(payload: schemas.GenerateIdeaCreate, db: Session = Depends(get_db)) -> models.Idea:
    return services.generate_idea(db, payload)


@app.get("/api/products", response_model=list[schemas.ProductRead])
def list_products(db: Session = Depends(get_db)) -> Sequence[models.Product]:
    return repositories.list_all(db, models.Product)


@app.post("/api/products", response_model=schemas.ProductRead, status_code=201)
def create_product(payload: schemas.ProductCreate, db: Session = Depends(get_db)) -> models.Product:
    return services.create_product(db, payload)


@app.get("/api/content", response_model=list[schemas.ContentRead])
def list_content(db: Session = Depends(get_db)) -> Sequence[models.ContentItem]:
    return repositories.list_all(db, models.ContentItem)


@app.post("/api/content", response_model=schemas.ContentRead, status_code=201)
def create_content(payload: schemas.ContentCreate, db: Session = Depends(get_db)) -> models.ContentItem:
    return services.create_content(db, payload)


@app.post("/api/ai/content-drafts", response_model=schemas.ContentRead, status_code=201)
def generate_content_draft(
    payload: schemas.GenerateDraftCreate,
    db: Session = Depends(get_db),
) -> models.ContentItem:
    return services.generate_content_draft(db, payload)


@app.get("/api/content/{content_id}", response_model=schemas.ContentRead)
def get_content(content_id: str, db: Session = Depends(get_db)) -> models.ContentItem:
    content = repositories.get_by_id(db, models.ContentItem, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    return content


@app.get("/api/content/{content_id}/versions", response_model=list[schemas.ContentVersionRead])
def list_content_versions(content_id: str, db: Session = Depends(get_db)) -> list[models.ContentVersion]:
    return services.list_content_versions(db, content_id)


@app.get("/api/content/{content_id}/reviews", response_model=list[schemas.ReviewRead])
def list_content_reviews(content_id: str, db: Session = Depends(get_db)) -> list[models.ContentReview]:
    return services.list_content_reviews(db, content_id)


@app.get("/api/content/{content_id}/approvals", response_model=list[schemas.ApprovalRead])
def list_content_approvals(content_id: str, db: Session = Depends(get_db)) -> list[models.Approval]:
    return services.list_content_approvals(db, content_id)


@app.patch("/api/content/{content_id}", response_model=schemas.ContentRead)
def update_content(
    content_id: str,
    payload: schemas.ContentUpdate,
    db: Session = Depends(get_db),
) -> models.ContentItem:
    return services.update_content(db, content_id, payload)


@app.post("/api/content/{content_id}/review", response_model=schemas.ReviewRead)
def review_content(content_id: str, db: Session = Depends(get_db)) -> models.ContentReview:
    return services.review_content(db, content_id)


@app.post("/api/content/{content_id}/approve", response_model=schemas.ApprovalRead)
def approve_content(
    content_id: str,
    payload: schemas.ApprovalCreate,
    db: Session = Depends(get_db),
) -> models.Approval:
    return services.approve_content(db, content_id, payload)


@app.post("/api/content/{content_id}/publish", response_model=schemas.PublishRead)
def publish_content(
    content_id: str,
    payload: schemas.PublishCreate,
    db: Session = Depends(get_db),
) -> schemas.PublishRead:
    return services.publish_content(db, content_id, payload)


@app.get("/api/publications", response_model=list[schemas.PublishedPostRead])
def list_published_posts(db: Session = Depends(get_db)) -> list[models.PublishedPost]:
    return services.list_published_posts(db)


@app.get("/api/audit-logs", response_model=list[schemas.AuditLogRead])
def list_audit_logs(db: Session = Depends(get_db)) -> Sequence[models.AuditLog]:
    return repositories.list_all(db, models.AuditLog)


@app.get("/api/notifications", response_model=list[schemas.NotificationRead])
def list_notifications(db: Session = Depends(get_db)) -> list[models.Notification]:
    return services.list_notifications(db)


@app.post("/api/mock/telegram/notify", response_model=schemas.NotificationRead, status_code=201)
def send_telegram_notification(
    payload: schemas.NotificationCreate,
    db: Session = Depends(get_db),
) -> models.Notification:
    return services.send_telegram_notification(db, payload)


@app.post("/api/mock/ozon/import-products", response_model=schemas.OzonImportRead)
def import_ozon_products(
    payload: schemas.OzonImportCreate,
    db: Session = Depends(get_db),
) -> schemas.OzonImportRead:
    return services.import_ozon_products(db, payload)


@app.get("/api/metrics", response_model=list[schemas.MetricsRead])
def list_metrics(db: Session = Depends(get_db)) -> list[models.MetricsSnapshot]:
    return services.list_metrics(db)


@app.post("/api/metrics/collect", response_model=schemas.MetricsRead, status_code=201)
def collect_metrics(
    payload: schemas.MetricsCollectCreate,
    db: Session = Depends(get_db),
) -> models.MetricsSnapshot:
    return services.collect_metrics(db, payload)


def _dashboard_context(request: Request, db: Session) -> dict:
    tasks = repositories.list_all(db, models.Task)
    ideas = repositories.list_all(db, models.Idea)
    products = repositories.list_all(db, models.Product)
    content_items = repositories.list_all(db, models.ContentItem)
    publications = services.list_published_posts(db)
    notifications = services.list_notifications(db)
    metrics = services.list_metrics(db)
    audit_logs = repositories.list_all(db, models.AuditLog)

    return {
        "request": request,
        "app_name": settings.app_name,
        "stats": {
            "ideas": len(ideas),
            "products": len(products),
            "content": len(content_items),
            "publications": len(publications),
        },
        "tasks": tasks[:5],
        "ideas": ideas[:10],
        "products": products[:10],
        "content_items": content_items[:10],
        "publications": publications[:10],
        "notifications": notifications[:5],
        "metrics": metrics[:5],
        "audit_logs": audit_logs[:8],
    }

