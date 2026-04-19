import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import settings
from core.database import close_db, init_db

from api.handlers.auth import router as auth_router
from api.handlers.users import router as users_router
from api.handlers.projects import router as projects_router
from api.handlers.endpoints import router as endpoints_router
from api.handlers.stats import router as stats_router
from api.handlers.notifications import router as notifications_router
from api.handlers.analytics import router as analytics_router
from api.handlers.cron import router as cron_router
from api.handlers.discover import router as discover_router
from api.handlers.export import router as export_router
from api.handlers.health import router as health_router
from api.handlers.deployments import router as deployments_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await close_db()


app = FastAPI(title="Pulse API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

prefix = "/api"
app.include_router(health_router, prefix=prefix)
app.include_router(auth_router, prefix=prefix)
app.include_router(users_router, prefix=prefix)
app.include_router(projects_router, prefix=prefix)
app.include_router(endpoints_router, prefix=prefix)
app.include_router(stats_router, prefix=prefix)
app.include_router(notifications_router, prefix=prefix)
app.include_router(analytics_router, prefix=prefix)
app.include_router(cron_router, prefix=prefix)
app.include_router(discover_router, prefix=prefix)
app.include_router(export_router, prefix=prefix)
app.include_router(deployments_router, prefix=prefix)
