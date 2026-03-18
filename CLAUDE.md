# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pulse is an API health monitoring tool deployed on Vercel's free tier. It monitors HTTP/HTTPS endpoints on configurable intervals and displays results on a real-time dashboard. Uses MongoDB Atlas (free M0 cluster) for persistence and Vercel Cron Jobs for scheduled checks.

## Tech Stack

- **Framework**: Next.js 14 (App Router, TypeScript)
- **Styling**: Tailwind CSS 3 with custom design system (no shadcn/ui primitives installed)
- **Theming**: next-themes for light/dark mode toggle (light = orange/amber palette, dark = blue/teal palette)
- **Database**: MongoDB Atlas (free tier) + Mongoose 9
- **Auth**: NextAuth.js v5 (Auth.js beta) with credentials provider + bcryptjs
- **Data Fetching**: SWR with 10-second global polling interval
- **Charts**: Recharts 3
- **Scheduling**: Vercel Cron Jobs (1-minute interval, configured in `vercel.json`)
- **Notifications**: Nodemailer (email), fetch (Discord/webhook)
- **Export**: csv-stringify (CSV); PDF export stubbed with @react-pdf/renderer
- **Validation**: Zod 4
- **AI**: Anthropic Claude API for endpoint health analysis (optional, requires `ANTHROPIC_API_KEY`)

## Development Commands

```bash
npm install              # install dependencies
npm run dev              # dev server at localhost:3000
npm run build            # production build
npm run lint             # ESLint
```

Copy `.env.example` to `.env.local` and fill in `MONGODB_URI` and `AUTH_SECRET` at minimum.

## Architecture

### Source Layout (`src/`)

- `app/` — Next.js App Router pages and API route handlers
- `components/` — React components (dashboard widgets, navigation, forms, theme toggle)
- `lib/models/` — Mongoose schemas: `project.ts`, `user.ts`, `endpoint.ts`, `check-result.ts`, `notification.ts`
- `lib/hooks/` — Custom React hooks: `use-filtered-key.ts` (appends `projectId` filter to SWR keys)
- `lib/validators/` — Zod schemas for API input validation
- `lib/services/` — Core business logic: `check-endpoint.ts`, `notification.ts`, `export.ts`
- `lib/helpers/` — `api-response.ts` (standardized JSON responses), `auth-guard.ts` (session/role checks)
- `lib/mongodb.ts` — Mongoose connection singleton (cached on `global` for hot reload)
- `lib/auth-options.ts` — NextAuth v5 config (credentials provider, JWT callbacks, route protection)
- `auth.ts` — Re-exports `{ handlers, auth, signIn, signOut }` from NextAuth
- `types/index.ts` — NextAuth module augmentation and shared TS types

### Auth Flow (3-Layer Protection)

1. **Middleware**: `middleware.ts` uses NextAuth `authorized` callback to protect `/dashboard/*` and API routes. Public: `/api/health`, `/api/auth/*`, `/api/cron/*`.
2. **Server-side**: `dashboard/layout.tsx` calls `auth()` and redirects to `/login` if no session (defense in depth).
3. **Client-side**: `SessionGuard` component wraps dashboard, monitors `useSession()` status, and redirects on session expiry. SWR fetcher also redirects to `/login` on 401 responses.

Session: JWT strategy, 1-hour expiry (`maxAge: 60 * 60`). The `requireAuth()` / `requireAdmin()` helpers in `lib/helpers/auth-guard.ts` are used inside individual route handlers for role checks.

### Health Check Engine

No persistent process. Vercel Cron hits `GET /api/cron/check` every minute (configured in `vercel.json`). The handler queries active endpoints whose `lastCheckedAt + interval <= now`, runs `checkEndpoint()` for each via `Promise.allSettled`, persists results to `check_results`, updates endpoint stats, and triggers notifications if thresholds are breached. Secured via `CRON_SECRET` Bearer token. On endpoint creation, `POST /api/endpoints` triggers an immediate first check inline.

### Notifications

Rate-limited (max 1 alert per endpoint per 5 min). Channels: email (Nodemailer), Discord (webhook POST), custom webhook. Sends recovery notifications when endpoints come back UP. All notifications logged to `notifications` collection.

### Projects

Endpoints can be grouped into projects (e.g., Salina, Scoup, DC/ML, V4). The `Project` model stores `name` and `color`. Endpoints reference a project via `projectId` (nullable — existing endpoints without a project still work). The dashboard has a `ProjectFilterBar` with tab pills that filter all widgets by project. Filter state is managed via `ProjectFilterContext` in the dashboard layout; each widget reads the context via `useFilteredKey()` hook which appends `?projectId=X` to SWR URLs. The `/api/endpoints` and `/api/stats` routes accept an optional `projectId` query parameter. The `EndpointGrid` groups endpoints by project with color-coded section headers. Project CRUD is at `/api/projects` and `/api/projects/[id]`. Deleting a project sets `projectId = null` on its endpoints (cascade nullify, not cascade delete).

### Data

MongoDB Atlas collections: `projects`, `endpoints`, `check_results` (TTL index at 30 days on `checkedAt`), `notifications`, `users`. Compound index on `(endpointId, checkedAt)` for fast history queries. Index on `projectId` in endpoints for efficient filtering.

### Frontend

#### Providers & Theming

`src/components/providers.tsx` wraps the app with `ThemeProvider` (next-themes, class-based) + `SessionProvider` + `SWRConfig` (10s global refresh). `<html>` tag has `suppressHydrationWarning` for next-themes compatibility.

#### Color System

- **Light mode**: Warm orange/amber palette — sidebar `#1a1a1a`, primary `#e8871e`, stat card gradients from `#fef3e0` to `#1a1a1a`, accents `#f0a830`
- **Dark mode**: Cool blue/teal palette — sidebar `#0c2d3f`, primary `#2a7f9e`, stat card gradients from `#b8e6ef` to `#0c2d3f`, accents `#5ab4c5`
- Components use `dark:` Tailwind variants for theme-aware styling. Charts use `useTheme()` from next-themes for dynamic color switching.

#### Dashboard Layout

- `NavSidebar` — Dark sidebar with rounded right corners, active item highlighting, logo, navigation links (Overview, Projects, Add Endpoint, Notifications, AI Analytics, Users), logout
- `DashboardHeader` — Page title, search bar, theme toggle (`ThemeToggle` component), user avatar
- `ProjectFilterBar` — Horizontal tab pills to filter dashboard by project; reads from `ProjectFilterContext`
- `StatsCards` — 4 gradient stat cards (Total, Up, Down, Avg Response) with theme-aware colors, project-filtered
- Dashboard page grid: performance bar chart, status donut chart, endpoint list, notifications widget, uptime overview — all project-filterable

#### Key Pages

`/login`, `/dashboard`, `/dashboard/projects`, `/dashboard/endpoints/[id]`, `/dashboard/endpoints/new`, `/dashboard/endpoints/[id]/edit`, `/dashboard/users`, `/dashboard/notifications`, `/dashboard/analytics`

## Vercel Constraints

- Serverless function timeout: 10 seconds (free tier)
- Cron minimum interval: 1 minute (free tier)
- Function size limit: 50MB uncompressed
- No persistent processes — all state in MongoDB Atlas

## What's Stubbed / TODO

- PDF export routes return 501 (need @react-pdf/renderer implementation)
- No tests yet

## Design Reference

Full PRD with user stories, functional requirements, NFRs, and implementation slices in `pulse.md`.
