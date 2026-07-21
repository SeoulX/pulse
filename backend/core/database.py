from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from core.config import settings

client: AsyncIOMotorClient = None  # type: ignore


async def init_db():
    global client
    client = AsyncIOMotorClient(settings.PULSE_DB_URI)
    db = client[settings.DB_NAME]

    from models.user import User
    from models.project import Project
    from models.endpoint import Endpoint
    from models.check_result import CheckResult
    from models.notification import Notification
    from models.deployment import DeploymentRequest
    from models.deployment_event import DeploymentEvent
    from models.db_metric_sample import DbMetricSample
    from models.infisical_secret_event import InfisicalSecretEvent
    from models.security_scan import SecurityScan

    await init_beanie(
        database=db,
        document_models=[User, Project, Endpoint, CheckResult, Notification, DeploymentRequest, DeploymentEvent, DbMetricSample, InfisicalSecretEvent, SecurityScan],
    )


async def close_db():
    global client
    if client:
        client.close()
