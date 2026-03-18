# Pulse — API Health Monitor

A real-time API health monitoring dashboard built with Next.js 14, deployed on Vercel's free tier. Monitor HTTP/HTTPS endpoints, get alerts when things go down, and visualize uptime with rich charts.

## Features

- **Real-time monitoring** — Checks endpoints every minute via Vercel Cron Jobs
- **Live dashboard** — Auto-refreshing (10s) overview with stats cards, performance charts, status donut, uptime bars, and recent notifications
- **Project grouping** — Organize endpoints by project (e.g., Salina, Scoup, DC/ML, V4) with color-coded labels and filtering
- **Endpoint management** — Add, edit, pause/resume, delete endpoints with custom headers, body, method, interval, and timeout
- **Multi-channel alerts** — Email (SMTP), Discord (webhook), and custom webhook notifications with rate limiting and recovery alerts
- **Role-based auth** — Admin and viewer roles with NextAuth.js v5, JWT sessions (1h expiry), and automatic session expiry redirect
- **AI analytics** — Claude-powered health analysis with scoring, insights, and recommendations (requires `ANTHROPIC_API_KEY`)
- **Data export** — CSV export for check history; PDF export (stubbed)
- **Dark mode** — Toggle between warm orange/amber (light) and cool blue/teal (dark) themes
- **Responsive design** — Modern card-based UI with rounded corners, gradients, and smooth transitions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router, TypeScript) |
| Styling | Tailwind CSS 3 + custom design system |
| Database | MongoDB Atlas (free M0) + Mongoose 9 |
| Auth | NextAuth.js v5 (credentials + bcryptjs) |
| Data Fetching | SWR (10s polling) |
| Charts | Recharts 3 |
| Theming | next-themes (light/dark) |
| Scheduling | Vercel Cron Jobs |
| Notifications | Nodemailer + fetch (Discord/webhook) |
| Validation | Zod 4 |
| AI | Anthropic Claude API (optional) |

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd pulse
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in MONGODB_URI and AUTH_SECRET at minimum

# 3. Run dev server
npm run dev
```

Open http://localhost:3000 — the first user to register automatically becomes admin.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `AUTH_SECRET` | Yes | NextAuth.js secret (generate with `openssl rand -base64 32`) |
| `CRON_SECRET` | Yes (prod) | Bearer token for Vercel Cron Job auth |
| `SMTP_HOST` | No | SMTP server for email notifications |
| `SMTP_PORT` | No | SMTP port (default: 587) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |
| `SMTP_FROM` | No | Sender email address |
| `ANTHROPIC_API_KEY` | No | Enable AI analytics |

## Deploy to Vercel

1. Push to GitHub
2. Import in Vercel
3. Add environment variables
4. Deploy — Cron jobs auto-configure from `vercel.json`

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # API route handlers
│   ├── dashboard/          # Dashboard pages
│   └── login/              # Login page
├── components/             # React components
│   ├── nav-sidebar.tsx     # Dark sidebar navigation
│   ├── dashboard-header.tsx # Header with search + theme toggle
│   ├── stats-cards.tsx     # Gradient stat cards
│   ├── project-filter-bar.tsx # Project tab filter
│   ├── project-context.tsx # Project filter state
│   ├── status-donut-chart.tsx
│   ├── response-trend-chart.tsx
│   ├── recent-checks-widget.tsx
│   ├── notifications-widget.tsx
│   ├── uptime-overview.tsx
│   ├── theme-toggle.tsx    # Light/dark mode switch
│   ├── session-guard.tsx   # Client-side auth guard
│   └── ...
├── lib/
│   ├── models/             # Mongoose schemas (project, endpoint, check-result, notification, user)
│   ├── hooks/              # Custom React hooks (useFilteredKey)
│   ├── services/           # Business logic
│   ├── helpers/            # API response + auth guards
│   ├── validators/         # Zod schemas
│   ├── mongodb.ts          # DB connection singleton
│   └── auth-options.ts     # NextAuth config
└── types/                  # TypeScript types
```

## Commands

```bash
npm run dev      # Development server (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
```
