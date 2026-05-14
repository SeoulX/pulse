from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    MONGODB_URI: str = "mongodb://localhost:27017/pulse"
    DB_NAME: str = "pulse"

    JWT_SECRET_KEY: str = "change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    CRON_SECRET: str = ""

    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM: str = "Pulse <noreply@pulse.dev>"

    DISCORD_WEBHOOK_URL: str = ""

    DATA_RETENTION_DAYS: int = 30

    LLM_URL: str = ""
    LLM_KEY: str = ""
    LLM_MODEL: str = "qwen2.5:3b"

    CORS_ORIGINS: str = "http://localhost:3000"

    BITBUCKET_WORKSPACE: str = "metawhale"
    BITBUCKET_USER: str = ""
    BITBUCKET_APP_PASSWORD: str = ""
    JENKINS_WEBHOOK_URL: str = "https://jenkins.media-meter.in/generic-webhook-trigger/invoke?token=bitbucket-webhook"

    # Shared bearer token Jenkins presents when calling GET /api/deployments/spec/<slug>
    # at bootstrap time. Same secret value lives in the Jenkins JCasC credential
    # store as `jenkins-shared-secret`. Empty disables the endpoint (returns 503).
    JENKINS_SHARED_SECRET: str = ""

    # Redis (cluster's redis-stack/redis-kl1-master). Pulse publishes spec.json and
    # job entries here for Jenkins to consume at bootstrap time.
    REDIS_HOST: str = "192.168.10.40"
    REDIS_PORT: int = 31379
    REDIS_PASSWORD: str = ""
    REDIS_DB: int = 0

    # When true (default), approved deployments only log a plan. Flip to false to
    # actually call add_webhook / delete_tag / push_tag. Phase 1 stops at tags_pushed;
    # Jenkins callback (phase 2) will advance to completed.
    PULSE_DRY_RUN: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
