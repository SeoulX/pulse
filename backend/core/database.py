from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from core.config import settings

client: AsyncIOMotorClient = None  # type: ignore


async def init_db():
    global client
    client = AsyncIOMotorClient(settings.MONGODB_URI)
    db = client[settings.DB_NAME]

    from models.user import User
    from models.project import Project
    from models.endpoint import Endpoint
    from models.check_result import CheckResult
    from models.notification import Notification

    await init_beanie(
        database=db,
        document_models=[User, Project, Endpoint, CheckResult, Notification],
    )


async def close_db():
    global client
    if client:
        client.close()
