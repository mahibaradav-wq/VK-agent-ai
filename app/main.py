from collections.abc import Sequence
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
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
    raise HTTPException(status_code=exc.status_code, detail=exc.message)


@app.exception_handler(IntegrityError)
async def handle_integrity_error(_: Request, exc: IntegrityError):
    raise HTTPException(status_code=409, detail="Entity violates a uniqueness or relation constraint") from exc


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request, "app_name": settings.app_name})


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


@app.get("/api/content/{content_id}", response_model=schemas.ContentRead)
def get_content(content_id: str, db: Session = Depends(get_db)) -> models.ContentItem:
    content = repositories.get_by_id(db, models.ContentItem, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    return content


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


@app.get("/api/audit-logs", response_model=list[schemas.AuditLogRead])
def list_audit_logs(db: Session = Depends(get_db)) -> Sequence[models.AuditLog]:
    return repositories.list_all(db, models.AuditLog)


@app.get("/api/metrics", response_model=list[schemas.MetricsRead])
def list_metrics(db: Session = Depends(get_db)) -> list[models.MetricsSnapshot]:
    return services.list_metrics(db)

