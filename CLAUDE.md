# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pulse is an API health monitoring tool with a split architecture: **FastAPI** (Python) backend and **Next.js 14** (TypeScript) frontend, deployed via Docker Compose. Uses MongoDB Atlas (free M0 cluster) for persistence.

## Tech Stack

### Backend (`backend/`)
- **Framework**: FastAPI + Uvicorn
- **Database**: MongoDB Atlas via Motor (async) + Beanie ODM
- **Auth**: JWT (python-jose) + bcrypt
- **Validation**: Pydantic v2 + pydantic-settings
- **HTTP Client**: httpx (async endpoint checks)
- **Notifications**: aiosmtplib (email), httpx (Discord/webhook)
- **Export**: fpdf2 (PDF)
- **AI**: Ollama-compatible LLM API for health analysis (configurable via `LLM_URL`, `LLM_KEY`, `LLM_MODEL`)
- **Config**: pydantic-settings reads from `.env` file

### Frontend (`frontend/`)
- **Framework**: Next.js 14 (App Router, TypeScript, standalone output)
- **Styling**: Tailwind CSS 3 with Radix UI primitives
- **Theming**: next-themes for light/dark mode
- **Data Fetching**: SWR with polling
- **Charts**: Recharts 3
- **Icons**: lucide-react

### Infrastructure
- **Orchestration**: Docker Compose
- **Backend image**: python:3.12-slim
- **Frontend image**: node:18-alpine (multi-stage build)

## Development Commands

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in MONGODB_URI at minimum
uvicorn main:app --reload     # dev server at localhost:8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev                   # dev server at localhost:3000
npm run build                 # production build
npm run lint                  # ESLint
```

### Docker (full stack)
```bash
docker compose up --build     # backend :8000, frontend :3000
```

## Architecture

### Backend Layout (`backend/`)

- `main.py` — FastAPI app with CORS, lifespan (DB init/close), router registration
- `core/config.py` — `Settings` (pydantic-settings): `MONGODB_URI`, `JWT_SECRET_KEY`, `CRON_SECRET`, SMTP, Discord, LLM, CORS
- `core/database.py` — Motor/Beanie connection singleton
- `core/security.py` — JWT token creation/verification, password hashing
- `api/handlers/` — Route handlers: `auth`, `users`, `projects`, `endpoints`, `stats`, `notifications`, `analytics`, `cron`, `discover`, `export`, `health`
- `api/deps.py` — Dependency injection (current user, auth guards)
- `models/` — Beanie document models: `user`, `project`, `endpoint`, `check_result`, `notification`
- `schemas/` — Pydantic request/response schemas: `auth`, `user`, `project`, `endpoint`
- `services/` — Business logic (check engine, notifications, export)

All API routes are prefixed with `/api`.

### Frontend Layout (`frontend/src/`)

- `app/` — Next.js App Router pages (login, dashboard, endpoints, projects, notifications, analytics, users)
- `components/` — React components (dashboard widgets, navigation, forms, charts, theme toggle)
- `lib/api.ts` — API client: `API_URL` from `NEXT_PUBLIC_API_URL`, token management (localStorage), `apiFetch()` helper
- `lib/swr/fetcher.ts` — SWR fetcher using `apiFetch()`
- `lib/hooks/use-filtered-key.ts` — Appends `projectId` filter to SWR keys

### Auth Flow

1. Frontend sends credentials to `POST /api/auth/login`
2. Backend returns JWT token
3. Frontend stores token in localStorage, sends as `Authorization: Bearer` header
4. Backend `api/deps.py` validates JWT on protected routes

### Health Check Engine

`GET /api/cron/check` — queries active endpoints due for check, runs async HTTP checks via `httpx`, persists results, updates endpoint stats, triggers notifications on threshold breach. Secured via `CRON_SECRET` Bearer token.

### Environment Variables

Backend config in `backend/.env` (see `backend/.env.example`). Key vars:
- `MONGODB_URI` — MongoDB Atlas connection string (required)
- `JWT_SECRET_KEY` — JWT signing secret
- `CRON_SECRET` — secures cron endpoint
- `CORS_ORIGINS` — comma-separated allowed origins
- `LLM_URL`, `LLM_KEY`, `LLM_MODEL` — Ollama-compatible LLM for AI analytics

Frontend: `NEXT_PUBLIC_API_URL` is set at build time (passed as Docker build arg in `docker-compose.yml`).

### Data

MongoDB Atlas collections: `projects`, `endpoints`, `check_results` (TTL index at 30 days), `notifications`, `users`.

### Key Pages

`/login`, `/dashboard`, `/dashboard/projects`, `/dashboard/endpoints/[id]`, `/dashboard/endpoints/new`, `/dashboard/endpoints/[id]/edit`, `/dashboard/users`, `/dashboard/notifications`, `/dashboard/analytics`

## Docker Notes

- `NEXT_PUBLIC_API_URL` is a build-time variable (inlined by Next.js). Set via `build.args` in `docker-compose.yml`.
- Backend reads `.env` at runtime via pydantic-settings.
- Frontend uses `output: "standalone"` for minimal Docker image.

## What's TODO

- No tests yet
- Cron scheduling (currently must be triggered externally or via a scheduler container)

## Design Reference

Full PRD with user stories, functional requirements, NFRs, and implementation slices in `pulse.md`.
