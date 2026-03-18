# Pulse — Product Requirements Document (PRD)

> Phase: Define → Step 5  
> Status: In Progress 
> Date: March 17, 2026  
> Version: 1.0

---

## 1. Executive Summary

Pulse is an API health monitor deployed on Vercel. It checks HTTP/HTTPS endpoints on user-defined intervals and presents live status, response times, uptime percentages, and history graphs on a real-time dashboard. It includes multi-user authentication with role-based access, alert notifications via email/Discord/webhook, and data export (CSV + PDF reports). It runs as a single Next.js application on Vercel's free tier with MongoDB Atlas (free tier) as the database.

**Target user:** Solo DevOps engineers and small backend teams (1–5 engineers) who manage 5–50 API endpoints and want a lightweight alternative to Pingdom, UptimeRobot, or Datadog.

**Success metric:** From `git push` to a working dashboard with live checks in under 5 minutes (deploy via Vercel).

---

## 2. User Stories

### 2.1 Endpoint Management

| ID | Story | Priority |
|----|-------|----------|
| US-1 | As a DevOps engineer, I can add an endpoint by providing a name, URL, HTTP method, expected status code, and check interval so that Pulse begins monitoring it immediately. | P0 |
| US-2 | As a DevOps engineer, I can edit an endpoint's configuration (URL, interval, expected status) and have the monitor restart with the new settings. | P0 |
| US-3 | As a DevOps engineer, I can delete an endpoint and have all its check history purged. | P0 |
| US-4 | As a DevOps engineer, I can pause/resume monitoring for an endpoint without deleting it. | P1 |
| US-5 | As a DevOps engineer, I can set custom HTTP headers (e.g., Authorization) for endpoints that require authentication. | P1 |
| US-6 | As a DevOps engineer, I can set a request body for POST/PUT endpoints. | P2 |

### 2.2 Dashboard & Monitoring

| ID | Story | Priority |
|----|-------|----------|
| US-7 | As a DevOps engineer, I can see a dashboard overview showing all endpoints with their current status (UP/DOWN/DEGRADED), last response time, and uptime percentage. | P0 |
| US-8 | As a DevOps engineer, I can see aggregate stats: total endpoints, count by status, average response time, and overall uptime. | P0 |
| US-9 | As a DevOps engineer, the dashboard auto-refreshes every 10 seconds without manual reload. | P0 |
| US-10 | As a DevOps engineer, I can click an endpoint to see its detail page with check history and a response time graph. | P0 |
| US-11 | As a DevOps engineer, I can see the last 100 check results for an endpoint in a table (timestamp, status, response time, error). | P1 |
| US-12 | As a DevOps engineer, I can see a line chart of response times over time for a specific endpoint. | P1 |

### 2.3 Alerting

| ID | Story | Priority |
|----|-------|----------|
| US-13 | As a DevOps engineer, I can enable alerting for an endpoint with a configurable failure threshold (N consecutive failures). | P1 |
| US-14 | As a DevOps engineer, I can see a visual alert indicator on the dashboard when an endpoint has exceeded its failure threshold. | P0 |
| US-15 | As a DevOps engineer, I can receive an email notification when an endpoint exceeds its failure threshold. | P1 |
| US-16 | As a DevOps engineer, I can receive a Discord notification via incoming webhook when an endpoint goes down. | P1 |
| US-17 | As a DevOps engineer, I can configure a custom webhook URL that receives a JSON payload when an alert fires. | P1 |
| US-18 | As a DevOps engineer, I can choose which notification channels (email, Discord, webhook) are active per endpoint. | P2 |
| US-19 | As a DevOps engineer, I receive a recovery notification when a previously-down endpoint comes back up. | P2 |

### 2.4 Project Grouping

| ID | Story | Priority |
|----|-------|----------|
| US-32 | As a DevOps engineer, I can create projects (e.g., Salina, Scoup, DC/ML, V4) to organize my endpoints. | P1 — Done |
| US-33 | As a DevOps engineer, I can assign an endpoint to a project when creating or editing it. | P1 — Done |
| US-34 | As a DevOps engineer, I can filter the dashboard by project to see only that project's endpoints and stats. | P1 — Done |
| US-35 | As a DevOps engineer, I can see endpoints grouped by project with color-coded section headers. | P1 — Done |
| US-36 | As an admin, I can edit or delete projects. Deleting a project unassigns its endpoints (does not delete them). | P1 — Done |
| US-37 | As a DevOps engineer, I can set a custom color for each project for visual distinction. | P2 — Done |

### 2.5 Authentication & Authorization

| ID | Story | Priority |
|----|-------|----------|
| US-20 | As an admin, I can create user accounts with email and password. | P0 |
| US-21 | As a user, I can log in with my email and password and receive a JWT token. | P0 |
| US-22 | As an admin, I can assign roles (admin, viewer) to users. | P1 |
| US-23 | As a viewer, I can see the dashboard and endpoint details but cannot add, edit, or delete endpoints. | P1 |
| US-24 | As an admin, I can manage all endpoints and user accounts. | P1 |
| US-25 | As a user, I am redirected to the login page if my session expires. | P0 — Done (3-layer: middleware + server layout + client SessionGuard + SWR 401 redirect) |

### 2.6 Data Export

| ID | Story | Priority |
|----|-------|----------|
| US-26 | As a DevOps engineer, I can export check history for a single endpoint as a CSV file. | P1 |
| US-27 | As a DevOps engineer, I can export a PDF report for a single endpoint showing uptime stats, response time graph, and recent history. | P2 |
| US-28 | As a DevOps engineer, I can export a dashboard summary PDF with all endpoints' status and aggregate stats. | P2 |

### 2.7 Deployment

| ID | Story | Priority |
|----|-------|----------|
| US-29 | As a DevOps engineer, I can deploy Pulse by pushing to a Git repo connected to Vercel. | P0 |
| US-30 | As a DevOps engineer, I can configure Pulse via Vercel environment variables (MongoDB URI, default intervals, retention days, SMTP, Discord webhook). | P0 |
| US-31 | As a DevOps engineer, my monitoring data persists in MongoDB Atlas. | P0 |

---

## 3. Functional Requirements

### 3.1 Health Check Engine

| ID | Requirement | Details |
|----|-------------|---------|
| FR-1 | HTTP checks | Use `fetch` to perform HTTP requests against configured endpoints from Next.js API routes. |
| FR-2 | Cron-based scheduling | A Vercel Cron Job triggers `/api/cron/check` every minute. The route fetches all active endpoints due for a check (based on their interval and `last_checked_at`) and checks them in parallel using `Promise.allSettled`. |
| FR-3 | Status classification | UP = expected status code returned. DEGRADED = non-5xx unexpected status. DOWN = 5xx, timeout, or connection error. |
| FR-4 | Immediate first check | When an endpoint is created or activated, a check is triggered immediately via an internal call to the check logic (not waiting for cron). |
| FR-5 | Configurable timeout | Per-endpoint timeout (default: 10s, min: 1s, max: 60s) using `AbortController`. |
| FR-6 | Configurable interval | Per-endpoint check interval (default: 60s, min: 60s, max: 3600s). Minimum 60s due to Vercel Cron's 1-minute granularity on free tier. |
| FR-7 | Parallel execution | All due endpoint checks run concurrently via `Promise.allSettled` — one slow endpoint does not block others. |
| FR-8 | Failure counting | Track `consecutive_failures` per endpoint. Reset to 0 on successful check. |

### 3.2 Data Storage

| ID | Requirement | Details |
|----|-------------|---------|
| FR-9 | Endpoint persistence | Store endpoint configs in MongoDB Atlas `endpoints` collection via Mongoose. |
| FR-10 | Check result storage | Store each check result in MongoDB Atlas `check_results` collection with `endpoint_id` reference. |
| FR-11 | TTL auto-cleanup | Apply a TTL index on `checked_at` to auto-delete results older than the configured retention period (default: 30 days). |
| FR-12 | Uptime calculation | `uptime_percentage = (successful_checks / total_checks) * 100`, rolling since endpoint creation. |
| FR-13 | Index optimization | Compound index on `(endpoint_id, checked_at)` for fast history queries. Index on `is_active` for cron job filtering. |

### 3.3 Notifications

| ID | Requirement | Details |
|----|-------------|---------|
| FR-14 | Email notifications | Send email via SMTP using Nodemailer when an endpoint breaches its alert threshold. Configurable SMTP host, port, user, password via environment variables. |
| FR-15 | Discord notifications | Send message to a Discord incoming webhook URL when alert fires. |
| FR-16 | Custom webhook | POST a JSON payload `{ endpoint, status, consecutive_failures, checked_at }` to a user-configured URL. |
| FR-17 | Recovery notifications | Send a "recovered" notification when a previously-alerting endpoint returns to UP. |
| FR-18 | Notification config per endpoint | Each endpoint stores which channels are enabled (email, discord, webhook) and channel-specific config (e.g., webhook URL). |
| FR-19 | Notification log | Store last 50 sent notifications in a `notifications` collection for debugging. |
| FR-20 | Rate limiting | Max 1 alert notification per endpoint per 5 minutes to prevent spam during flapping. |

### 3.4 Authentication & Authorization

| ID | Requirement | Details |
|----|-------------|---------|
| FR-21 | User model | `users` collection with fields: email, hashed_password, role (admin/viewer), created_at. |
| FR-22 | Password hashing | bcrypt via `bcryptjs`. |
| FR-23 | Session auth | Use NextAuth.js (Auth.js v5) with credentials provider. JWT strategy with access tokens (1h expiry) + refresh tokens (7d expiry) stored in httpOnly cookies. |
| FR-24 | Login endpoint | `POST /api/auth/login` → handled by NextAuth.js credentials provider. |
| FR-25 | Register endpoint | `POST /api/auth/register` → admin-only (first user auto-becomes admin). |
| FR-26 | Protected routes | All `/api/endpoints/*`, `/api/stats`, `/api/export/*` routes require valid session. `/api/health` remains public. Middleware protects pages and API routes. |
| FR-27 | Role enforcement | Viewers: read-only access (GET routes only). Admins: full CRUD + user management. |
| FR-28 | First-run setup | If no users exist, the first registration creates an admin account without requiring auth. |
| FR-29 | Current user endpoint | `GET /api/auth/me` → returns logged-in user's profile and role (via NextAuth.js session). |

### 3.5 Data Export

| ID | Requirement | Details |
|----|-------------|---------|
| FR-30 | CSV export | `GET /api/export/endpoints/[id]/csv` → download check history as CSV (columns: timestamp, status, status_code, response_time_ms, error). |
| FR-31 | PDF endpoint report | `GET /api/export/endpoints/[id]/pdf` → download single-endpoint report with uptime stats, response time chart (server-rendered via @react-pdf/renderer), and recent history table. |
| FR-32 | PDF dashboard summary | `GET /api/export/dashboard/pdf` → download aggregate report with all endpoints' status and stats. |
| FR-33 | Date range filter | Export endpoints accept `?from=ISO&to=ISO` query params to scope the data window. |

### 3.6 REST API

| ID | Endpoint | Method | Description |
|----|----------|--------|-------------|
| FR-34 | `/api/health` | GET | Returns `{ status: "ok" }` (public) |
| FR-35 | `/api/auth/[...nextauth]` | GET/POST | NextAuth.js handler (login, session, CSRF) |
| FR-36 | `/api/auth/register` | POST | Create user (admin-only; first user is auto-admin) |
| FR-37 | `/api/auth/me` | GET | Current user profile and role |
| FR-38 | `/api/stats` | GET | Aggregate dashboard stats |
| FR-39 | `/api/endpoints` | GET | List all monitored endpoints |
| FR-40 | `/api/endpoints` | POST | Create endpoint → trigger first check |
| FR-41 | `/api/endpoints/[id]` | GET | Get single endpoint |
| FR-42 | `/api/endpoints/[id]` | PUT | Update endpoint config |
| FR-43 | `/api/endpoints/[id]` | DELETE | Delete endpoint → purge history |
| FR-44 | `/api/endpoints/[id]/history` | GET | Check results (newest first, `?limit=100`) |
| FR-45 | `/api/export/endpoints/[id]/csv` | GET | Download endpoint history as CSV |
| FR-46 | `/api/export/endpoints/[id]/pdf` | GET | Download endpoint report as PDF |
| FR-47 | `/api/export/dashboard/pdf` | GET | Download dashboard summary PDF |
| FR-48 | `/api/notifications` | GET | List recent notification log entries |
| FR-49 | `/api/users` | GET | List users (admin-only) |
| FR-50 | `/api/users/[id]` | PUT | Update user role (admin-only) |
| FR-51 | `/api/users/[id]` | DELETE | Delete user (admin-only) |
| FR-52 | `/api/cron/check` | GET | Vercel Cron Job handler — checks all due endpoints (secured via `CRON_SECRET`) |
| FR-53b | `/api/projects` | GET | List all projects with endpoint counts |
| FR-53c | `/api/projects` | POST | Create project (admin-only) |
| FR-53d | `/api/projects/[id]` | GET | Get single project |
| FR-53e | `/api/projects/[id]` | PUT | Update project (admin-only) |
| FR-53f | `/api/projects/[id]` | DELETE | Delete project, nullify endpoint references (admin-only) |

### 3.7 Frontend

| ID | Requirement | Details |
|----|-------------|---------|
| FR-53 | Login page | Email + password form at `/login`. Redirects to dashboard on success. |
| FR-54 | Auth guard | Next.js middleware redirects unauthenticated users to `/login`. |
| FR-55 | Overview page | Grid of endpoint cards showing: name, URL, status badge, response time, uptime %. Server Component with client-side polling. |
| FR-56 | Stats cards | 4 cards at top: total endpoints, UP count, DOWN count, average response time. |
| FR-57 | Endpoint detail page | Status badge, config summary, response time line chart, check history table, export buttons. |
| FR-58 | Add endpoint form | Fields: name, URL, method, expected status, interval, timeout, headers, body, alert toggle, notification channel config. Uses Server Actions or API route. |
| FR-59 | Edit endpoint form | Pre-populated with current values. |
| FR-60 | Delete confirmation | Modal or confirm dialog before deletion. |
| FR-61 | Pause/resume toggle | Button on endpoint card and detail page. |
| FR-62 | Auto-refresh | SWR or React Query polls `/api/endpoints` and `/api/stats` every 10 seconds from Client Components. |
| FR-63 | Routing | Next.js App Router. Pages: `/`, `/login`, `/dashboard`, `/dashboard/endpoints/[id]`, `/dashboard/endpoints/new`, `/dashboard/endpoints/[id]/edit`, `/dashboard/users`. |
| FR-64 | Export buttons | "Export CSV" and "Export PDF" buttons on endpoint detail page. "Export Summary PDF" on overview page. |
| FR-65 | User management page | Admin-only page to list, create, and delete users. Assign roles. |
| FR-66 | Notification config UI | Per-endpoint form section to enable email/Discord/webhook and set channel URLs. |
| FR-67 | Alert notification log | Page or modal showing recent notification history (timestamp, channel, endpoint, status). |
| FR-68 | Dark mode | Light/dark theme toggle via next-themes. Light = warm orange/amber palette. Dark = cool blue/teal palette. Persists via class on `<html>`. |
| FR-69 | Dashboard widgets | Dashboard overview includes: gradient stat cards, performance bar chart, status donut chart, endpoint list widget, notifications widget with filter tabs, uptime overview with per-endpoint progress bars. |
| FR-70 | Theme-aware charts | Recharts components use `useTheme()` to dynamically switch colors between light (orange/amber) and dark (blue/teal) palettes. |
| FR-71 | Dashboard header | Top bar with page title, search input (rounded), theme toggle button, and user avatar. |
| FR-72 | Session guard | Client-side `SessionGuard` component monitors auth status and redirects to `/login` on expiry. SWR fetcher handles 401 with redirect. |
| FR-73 | Server-side auth | Dashboard layout calls `auth()` server-side and redirects unauthenticated users before page renders. |
| FR-74 | AI analytics page | `/dashboard/analytics` page with Claude-powered health analysis: score ring, insights (warning/info/critical/success), recommendations. |
| FR-75 | Per-endpoint AI analysis | Endpoint detail page includes inline AI analysis button with score, insights, and recommendations. |
| FR-76 | Project model | `projects` collection with fields: name (unique), color (hex). Timestamps auto-managed. |
| FR-77 | Endpoint project reference | Endpoints have an optional `projectId` field referencing `projects`. Defaults to `null` for backward compatibility. Indexed for fast filtering. |
| FR-78 | Project CRUD API | `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/[id]`. List includes endpoint counts via aggregation. Delete cascades to nullify (not delete) endpoint references. |
| FR-79 | Project-filtered endpoints | `GET /api/endpoints?projectId=X` filters by project. `projectId=none` returns unassigned endpoints. |
| FR-80 | Project-filtered stats | `GET /api/stats?projectId=X` returns stats scoped to a single project. |
| FR-81 | Project filter bar | Dashboard has horizontal tab pills for each project + "All". Clicking filters all widgets (stats, charts, endpoint list, uptime overview). State managed via React context (`ProjectFilterContext`). |
| FR-82 | Endpoint grouping | `EndpointGrid` groups endpoints by project with color-coded section headers when showing all projects. |
| FR-83 | Project selector in form | Endpoint create/edit form includes a project dropdown populated from `/api/projects`. |
| FR-84 | Project management page | `/dashboard/projects` page for creating, editing (name + color), and deleting projects. Card grid layout with endpoint counts. |

---

## 4. Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-1 | Performance | Dashboard loads with 50 endpoints | < 1 second |
| NFR-2 | Performance | Health check overhead beyond endpoint latency | < 50ms |
| NFR-3 | Performance | Concurrent endpoint checks per cron invocation | Up to 100 parallel (via `Promise.allSettled`) |
| NFR-4 | Resource | Vercel serverless function execution time | < 10 seconds per cron invocation (free tier limit) |
| NFR-5 | Resource | MongoDB Atlas storage per endpoint per month (60s interval) | ~15MB |
| NFR-6 | Reliability | Cron check handler survives individual endpoint errors | `Promise.allSettled` — catch + log + continue |
| NFR-7 | Reliability | App recovers from temporary MongoDB disconnect | Retry on next cron cycle |
| NFR-8 | Deploy | Push to working dashboard | < 5 minutes (Vercel build + deploy) |
| NFR-9 | Deploy | Configuration via environment variables | Vercel Environment Variables dashboard or `.env.local` for dev |
| NFR-10 | Data | History auto-cleanup via TTL | Configurable retention (default 30 days) |
| NFR-11 | Security | JWT session token expiry | 1 hour |
| NFR-12 | Security | JWT refresh token expiry | 7 days |
| NFR-13 | Security | Passwords hashed with bcrypt | Cost factor 12 |
| NFR-14 | Notifications | Max 1 alert per endpoint per 5 minutes | Prevent notification spam |
| NFR-15 | Notifications | Notification delivery timeout | < 10 seconds per channel |
| NFR-16 | Export | PDF generation time | < 5 seconds for 1000 check results |
| NFR-17 | Vercel Limits | Serverless function size | < 50MB (uncompressed) |
| NFR-18 | Vercel Limits | Cron job frequency (free tier) | Minimum 1 minute interval |

---

## 5. UI Wireframes (Text)

### 5.1 Overview Page

```
┌──────────────────────────────────────────────────────────────────┐
│  PULSE                                    [+ Add Endpoint]       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐        │
│  │ Total    │ │ Up       │ │ Down     │ │ Avg Response │        │
│  │   12     │ │   10     │ │    1     │ │   187ms      │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ● Payment API        https://api.stripe.com/v1/health     │  │
│  │   UP   142ms   99.87%                    [pause] [edit]   │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ ● User Service       https://users.internal/health        │  │
│  │   UP   38ms    100.0%                    [pause] [edit]   │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ ○ Webhook Receiver   https://hooks.example.com/ping       │  │
│  │   DOWN  —      94.21%   ⚠ 5 failures    [pause] [edit]   │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ ◐ Legacy API         https://old.api.com/status           │  │
│  │   DEGRADED  2100ms  97.3%                [pause] [edit]   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 Endpoint Detail Page

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Back to Dashboard              Payment API           [Edit]  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Status: ● UP       Uptime: 99.87%      Last check: 12s ago    │
│  URL: https://api.stripe.com/v1/health                          │
│  Method: GET    Expected: 200    Interval: 60s    Timeout: 10s  │
│                                                                  │
│  Response Time (last 24h)                                        │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  250ms ┤                                                   │  │
│  │  200ms ┤        ╱╲                                         │  │
│  │  150ms ┤  ─────╱  ╲───╱╲──────────────────────             │  │
│  │  100ms ┤              ╲╱                                   │  │
│  │   50ms ┤                                                   │  │
│  │     0  ┼────────────────────────────────────────────────   │  │
│  │        00:00   04:00   08:00   12:00   16:00   20:00       │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Check History                                                   │
│  ┌──────────┬────────┬──────────┬─────────────────────────────┐  │
│  │ Time     │ Status │ RT (ms)  │ Error                       │  │
│  ├──────────┼────────┼──────────┼─────────────────────────────┤  │
│  │ 12:05:01 │ UP     │ 142      │ —                           │  │
│  │ 12:04:01 │ UP     │ 138      │ —                           │  │
│  │ 12:03:01 │ UP     │ 155      │ —                           │  │
│  │ 12:02:01 │ DOWN   │ —        │ Timeout                     │  │
│  └──────────┴────────┴──────────┴─────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 5.3 Add/Edit Endpoint Form

```
┌──────────────────────────────────────────────────────────────────┐
│  Add New Endpoint                                       [Cancel] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Name           [ Payment API                              ]     │
│  URL            [ https://api.stripe.com/v1/health         ]     │
│  Method         [ GET ▾ ]                                        │
│  Expected Status [ 200  ]                                        │
│  Check Interval  [ 60   ] seconds                                │
│  Timeout         [ 10   ] seconds                                │
│                                                                  │
│  Headers (optional)                                              │
│  ┌─────────────────────┬───────────────────────────────────────┐ │
│  │ Key                 │ Value                                 │ │
│  ├─────────────────────┼───────────────────────────────────────┤ │
│  │ Authorization       │ Bearer sk_live_...                    │ │
│  └─────────────────────┴───────────────────────────────────────┘ │
│  [+ Add header]                                                  │
│                                                                  │
│  Body (optional, for POST/PUT)                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ☐ Enable alerting   After [ 3 ] consecutive failures           │
│                                                                  │
│  Notification Channels                                           │
│  ☐ Email    [ ops@company.com                              ]     │
│  ☐ Discord    [ https://hooks.discord.com/services/...         ]     │
│  ☐ Webhook  [ https://my-alerts.com/hook                   ]     │
│                                                                  │
│                                     [Cancel]  [Save Endpoint]    │
└──────────────────────────────────────────────────────────────────┘
```

### 5.4 Login Page

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                          PULSE                                   │
│                    API Health Monitor                             │
│                                                                  │
│               ┌──────────────────────────────┐                   │
│  Email        │ admin@company.com            │                   │
│               └──────────────────────────────┘                   │
│               ┌──────────────────────────────┐                   │
│  Password     │ ••••••••••                   │                   │
│               └──────────────────────────────┘                   │
│                                                                  │
│               [          Log In              ]                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 5.5 User Management Page (Admin)

```
┌──────────────────────────────────────────────────────────────────┐
│  PULSE > Users                               [+ Create User]    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────┬─────────┬──────────────┬──────────────┐  │
│  │ Email              │ Role    │ Created      │ Actions      │  │
│  ├────────────────────┼─────────┼──────────────┼──────────────┤  │
│  │ admin@company.com  │ Admin   │ Mar 17, 2026 │              │  │
│  │ dev@company.com    │ Viewer  │ Mar 17, 2026 │ [role] [del] │  │
│  │ ops@company.com    │ Viewer  │ Mar 18, 2026 │ [role] [del] │  │
│  └────────────────────┴─────────┴──────────────┴──────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 6. Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) + TypeScript |
| Styling | Tailwind CSS 3 + custom design system (dual-palette theming) |
| Theming | next-themes (class-based light/dark toggle) |
| Data Fetching | SWR (client-side polling, 10s interval) + Server Components (initial load) |
| Charts | Recharts 3 |
| Database | MongoDB Atlas (free tier, M0) + Mongoose 9 |
| Auth | NextAuth.js v5 (Auth.js) with credentials provider + bcryptjs |
| HTTP Client | Native `fetch` (for health checks in API routes) |
| Notifications | Nodemailer (email) + fetch (Discord/webhook) |
| Export | csv-stringify (CSV); @react-pdf/renderer (PDF, stubbed) |
| Scheduling | Vercel Cron Jobs (`vercel.json` cron config) |
| Deployment | Vercel (free tier) — zero Docker required |
| Validation | Zod 4 (schema validation for API inputs and env vars) |
| AI | Anthropic Claude API (optional health analysis + scoring) |

---

## 7. Implementation Plan (Slices)

Development follows vertical slices — each slice delivers a working increment.

| Slice | Scope | Depends On | Estimate |
|-------|-------|------------|----------|
| **S1: Foundation** | Next.js project setup (App Router, TypeScript, Tailwind, shadcn/ui), MongoDB Atlas connection via Mongoose, models/schemas, `/api/health` route, `vercel.json` with cron config | — | 0.5 day |
| **S2: Auth** | NextAuth.js v5 setup with credentials provider, User model, bcryptjs password hashing, register API route, first-run admin setup, middleware auth guard, session helpers | S1 | 1.5 days |
| **S3: CRUD API** | Endpoint CRUD API routes (`POST`, `GET`, `PUT`, `DELETE` in `/api/endpoints`), Zod schema validation, auth-protected | S1, S2 | 0.5 day |
| **S4: Check Engine** | `checkEndpoint()` utility function, `/api/cron/check` route handler (fetches due endpoints, runs checks via `Promise.allSettled`, persists results), `CRON_SECRET` auth, immediate check on endpoint creation | S1 | 1 day |
| **S5: Notifications** | Notification service (email via Nodemailer, Discord webhook, custom webhook), per-endpoint channel config, notification log collection, rate limiting, recovery notifications | S4 | 1.5 days |
| **S6: Stats & History API** | `/api/stats` aggregate endpoint, `/api/endpoints/[id]/history` endpoint | S3, S4 | 0.5 day |
| **S7: Export API** | CSV export route, PDF report generation (@react-pdf/renderer), dashboard summary PDF, date range filtering | S6 | 1 day |
| **S8: Layout & Shell** | Root layout, dashboard layout with sidebar/nav, auth-aware navigation, SWR provider, loading states | S2 | 0.5 day |
| **S9: Login Page** | `/login` page with credentials form, NextAuth.js `signIn`/`signOut`, redirect on session expiry | S8 | 0.5 day |
| **S10: Overview Page** | `/dashboard` page — StatsCards (Server Component), EndpointCard grid (Client Component with SWR polling), status badges, "Export Summary PDF" button | S6, S8 | 1 day |
| **S11: Endpoint Forms** | `/dashboard/endpoints/new` and `/dashboard/endpoints/[id]/edit` pages, delete confirmation dialog, pause/resume toggle, notification channel config section | S3, S8 | 1 day |
| **S12: Detail Page** | `/dashboard/endpoints/[id]` page — HistoryTable, ResponseChart (Recharts), export buttons (CSV + PDF), back navigation | S6, S8 | 1 day |
| **S13: Alerting & Notifications UI** | Alert indicator on dashboard, notification channel config per endpoint, notification log viewer page | S5, S10 | 0.5 day |
| **S14: User Management UI** | `/dashboard/users` admin-only page: list users, create user, delete user, change roles | S2, S8 | 0.5 day |
| **S15: Vercel Deploy** | `vercel.json` finalization (cron, rewrites), `.env.example`, environment variable documentation, README with deploy button | S1–S14 | 0.5 day |
| **S16: Polish** | Error states, empty states, loading skeletons, edge cases, final QA on Vercel | All | 1 day |
| **S17: UI Redesign** | Modern card-based dashboard with gradient stat cards, donut chart, bar chart, endpoint list widget, notifications widget, uptime overview. Dark sidebar. Rounded-2xl design system. | S10 | Done |
| **S18: Dark Mode** | next-themes integration, dual-palette theming (orange/amber light, blue/teal dark), theme toggle in header and login page, `dark:` variants across all components | S17 | Done |
| **S19: Auth Hardening** | 3-layer auth protection (middleware + server layout redirect + client SessionGuard), SWR fetcher 401 redirect, session expiry handling | S2 | Done |
| **S20: AI Analytics** | `/dashboard/analytics` page with Claude API integration, health scoring, insights, recommendations. Per-endpoint analysis on detail page. | S6 | Done |
| **S21: Project Grouping** | Project model, CRUD API (`/api/projects`), `projectId` on endpoints, project-filtered `/api/endpoints` and `/api/stats`, `ProjectFilterContext` + `ProjectFilterBar` on dashboard, endpoint form project selector, `EndpointGrid` grouped by project, project management page at `/dashboard/projects`, nav sidebar "Projects" link | S3, S10 | Done |

**Total estimate: ~12 days (original) + 5 additional slices completed**

### Dependency Graph

```
S1 (Foundation)
├── S2 (Auth)
│   ├── S3 (CRUD API) → S6 (Stats) → S7 (Export)
│   ├── S8 (Layout & Shell)
│   │   ├── S9 (Login Page)
│   │   ├── S10 (Overview) ← needs S6
│   │   ├── S11 (Forms) ← needs S3
│   │   ├── S12 (Detail) ← needs S6
│   │   └── S14 (User Mgmt)
│   └── S5 (Notifications) ← needs S4
│       └── S13 (Alerting UI) ← needs S10
├── S4 (Check Engine)
│   ├── S5 (Notifications)
│   └── S6 (Stats)
└── S15 (Vercel Deploy) ← needs S1–S14
    └── S16 (Polish) ← needs all
```

---

## 8. Out of Scope (v2 Backlog)

| Feature | Notes |
|---------|-------|
| WebSocket real-time push | Replace 10s polling with server-push updates |
| SSL certificate monitoring | Check cert expiry dates |
| Public status page | Shareable incident/uptime page |
| Response body validation | Check for specific content in responses |
| Docker / self-hosted deployment | Dockerfile + Docker Compose for self-hosting |
| Custom check scripts | User-defined health check logic |
| Grouped endpoints | Organize by service/team/tag |
| OAuth / SSO | Google, GitHub, SAML login providers via NextAuth.js |
| Audit log | Track who changed what and when |

---

## 9. Acceptance Criteria (Gate Checklist Preview)

These will be formally validated in Step 8 before shipping:

- [ ] `vercel deploy` (or git push) deploys successfully with no build errors
- [ ] Vercel Cron Job triggers `/api/cron/check` every minute
- [ ] First user to register becomes admin automatically
- [ ] Can log in, and dashboard redirects to login when session expires
- [ ] Viewers can see dashboard but cannot create/edit/delete endpoints
- [ ] Admins can manage endpoints and user accounts
- [ ] Can add, edit, pause, resume, and delete an endpoint via the UI
- [ ] First check fires immediately on endpoint creation; subsequent checks run via cron
- [ ] Dashboard shows correct status (UP/DOWN/DEGRADED) for each endpoint
- [ ] Stats cards show accurate counts and average response time
- [ ] Endpoint detail page shows history table and response time graph
- [ ] Alert indicator appears when consecutive failures exceed threshold
- [ ] Email notification fires when alert threshold is breached (SMTP configured)
- [ ] Discord notification fires via webhook when alert threshold is breached
- [ ] Custom webhook receives JSON payload on alert
- [ ] Recovery notification fires when endpoint comes back UP
- [ ] CSV export downloads correct check history with date range filter
- [ ] PDF endpoint report contains uptime stats, chart, and history
- [ ] PDF dashboard summary contains all endpoints' status
- [ ] Data persists in MongoDB Atlas across deployments
- [ ] Check history older than 30 days is automatically cleaned up (TTL index)
- [ ] Dashboard auto-refreshes without manual reload
- [ ] No console errors in browser, no unhandled exceptions in Vercel function logs
- [ ] All API routes complete within Vercel's 10-second function timeout (free tier)
- [x] Dark mode toggle works and persists, switching between orange/amber and blue/teal palettes
- [x] Dashboard shows gradient stat cards, performance chart, status donut, endpoint list, notifications, and uptime overview
- [x] Unauthenticated users are redirected to login (3-layer: middleware, server layout, client guard)
- [x] Session expiry triggers automatic redirect to login page
- [x] AI analytics page shows health score, insights, and recommendations (when API key configured)
- [x] Theme toggle visible on login page and dashboard header
- [x] Can create, edit, and delete projects with custom colors
- [x] Can assign endpoints to projects via the endpoint form
- [x] Dashboard filters all widgets (stats, charts, lists) by selected project
- [x] Endpoint grid groups endpoints by project with color-coded headers
- [x] Deleting a project unassigns endpoints without deleting them

---

_PRD updated March 17, 2026. Slices S1–S16 originally planned; S17–S20 added and completed during development._
