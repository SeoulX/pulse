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
from api.handlers.databases import router as databases_router
from api.handlers.infisical import router as infisical_router
from api.handlers.security import router as security_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Kick off the Databases time-series sampler. Fire-and-forget — the
    # task is cancelled on shutdown via the finally block below.
    import asyncio
    from services.db_sampler import run_sampler_loop
    sampler_task = asyncio.create_task(run_sampler_loop())

    # Infisical secret-change history poller. Reads secret_versions_v2
    # from the Infisical Postgres directly (OSS audit_logs is empty).
    # First iteration backfills; subsequent are deltas.
    from services import infisical_history
    infisical_task = asyncio.create_task(infisical_history.poll_loop())

    # Kafka producer + optional stage-event consumer. Consumer is only
    # started when PULSE_STAGE_TRANSPORT ∈ {kafka, dual}; the http path
    # keeps working regardless (POST /api/deployments/status handler).
    from services import kafka_events
    from api.handlers.deployments import handle_kafka_event
    kafka_started = False
    try:
        await kafka_events.start_producer()
        kafka_started = True
        if settings.PULSE_STAGE_TRANSPORT in ("kafka", "dual"):
            kafka_events.start_consumer(handle_kafka_event)
    except Exception:
        # Kafka is optional for boot — degrade to http-only, log, keep going.
        traceback.print_exc()

    try:
        yield
    finally:
        sampler_task.cancel()
        try:
            await sampler_task
        except (asyncio.CancelledError, Exception):
            pass
        infisical_task.cancel()
        try:
            await infisical_task
        except (asyncio.CancelledError, Exception):
            pass
        if kafka_started:
            try:
                await kafka_events.stop_consumer()
                await kafka_events.stop_producer()
            except Exception:
                pass
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
app.include_router(databases_router, prefix=prefix)
app.include_router(infisical_router, prefix=prefix)
app.include_router(security_router, prefix=prefix)
