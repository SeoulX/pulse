from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Pulse's own metadata DB (users, endpoints, deployment requests).
    # Distinct from `MONGODB_URI` which lives in devops-global-secrets
    # and points at the on-prem mongodb1/2/3 cluster used for app data
    # + monitored on the /dashboard/databases page. Both keys land in
    # the pod env via envFrom; this rename prevents the on-prem URI
    # (envFrom later index → wins) from overriding the Pulse metadata
    # URI and pointing user lookups at the wrong DB.
    PULSE_DB_URI: str = "mongodb://localhost:27017/pulse"
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

    # Separate webhook for deployment-lifecycle notifications (new
    # submissions awaiting approval, approve/reject decisions). Kept
    # distinct from DISCORD_WEBHOOK_URL (endpoint monitoring) so the
    # two streams can land in different Discord channels.
    DISCORD_DEPLOYMENT_WEBHOOK_URL: str = ""

    # Channel for DB up/down alerts fired by the sampler (Phase C).
    # Separate from DISCORD_WEBHOOK_URL (endpoint monitoring) and
    # DISCORD_DEPLOYMENT_WEBHOOK_URL (deploy approvals) so each stream
    # lands in its own channel.
    DISCORD_DB_ALERT_WEBHOOK_URL: str = ""

    DATA_RETENTION_DAYS: int = 30

    # Time-series sampler for the Databases page (Phase B). Every N
    # seconds the sampler probes each inventory key and inserts a
    # DbMetricSample. Clamped to >=15s in services/db_sampler.py.
    PULSE_DB_SAMPLE_INTERVAL: int = 60

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

    # Kafka. In-cluster clients use `kafka.kafka.svc.cluster.local:9092`
    # (PLAINTEXT CLIENT listener). Out-of-cluster (local docker, staging
    # dev boxes) hit the NodePort on the EXTERNAL listener — SASL_PLAINTEXT
    # with the `user1` client account. Auth fields left blank when
    # KAFKA_SECURITY_PROTOCOL=PLAINTEXT.
    KAFKA_BOOTSTRAP: str = "kafka.kafka.svc.cluster.local:9092"
    KAFKA_SECURITY_PROTOCOL: str = "PLAINTEXT"   # or SASL_PLAINTEXT
    KAFKA_SASL_MECHANISM: str = "PLAIN"          # PLAIN | SCRAM-SHA-256 | SCRAM-SHA-512
    KAFKA_SASL_USERNAME: str = ""
    KAFKA_SASL_PASSWORD: str = ""
    KAFKA_TOPIC_JOBS: str = "pulse.deploy.jobs"
    KAFKA_TOPIC_EVENTS: str = "pulse.deploy.events"
    KAFKA_TOPIC_OUTCOMES: str = "pulse.deploy.outcomes"
    KAFKA_CONSUMER_GROUP: str = "pulse-api-events"
    # Transport switch for stage status. `http` (default) keeps Jenkins →
    # POST /api/deployments/status; `kafka` reads from pulse.deploy.events;
    # `dual` runs both consumers side-by-side during the parity window.
    PULSE_STAGE_TRANSPORT: str = "http"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        # Don't crash on undeclared env vars. The pod env contains a lot
        # of keys from devops-global-secrets (MONGODB_URI, REDIS_*_URI,
        # ES_*_URI, POSTGRES_URI, ...) that the /api/databases handler
        # reads directly via os.environ — they don't belong on Settings.
        # `extra = "ignore"` lets Settings boot even when those keys
        # are present.
        extra = "ignore"


settings = Settings()
