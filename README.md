# Ariadne

Ariadne is a collaborative EPUB platform for serious readers: personal reading workflows, shared lending between users, and production-ready server deployment.

It is designed for one thing: preserving reading continuity and trust at scale, across sessions, devices, and shared libraries.

## Product Focus

Ariadne is not a generic "ebook viewer". It focuses on:

- Reliable return-to-context reading (progress, location, highlights, notes)
- Multi-user collaboration (friends, sharing, borrowing/lending, audit trail)
- Operational stability (migration safety, resilient refresh paths, predictable deployment)

## What Is Implemented

### Reading and Library System

- EPUB ingestion with duplicate handling and bulk upload pipeline
- Per-book reading preferences (theme, typography, flow mode)
- Paginated and continuous reading modes with controlled mode transitions
- Reader-level search, annotation workflows, bookmarks, and jump-back context
- Global library search over metadata and annotation surfaces
- Collections, notes, highlights, trash retention, and export flows

### Collaboration and Loan Model

- Account-based server mode with JWT auth
- Friends graph, friend discovery, and per-friend privacy controls
- Recommendation inbox + loan inbox workflows
- Borrow/lend lifecycle with clear status transitions (`PENDING`, `ACTIVE`, `RETURNED`, `REVOKED`, `EXPIRED`)
- Borrowed/Lent workspaces with synchronized state and refresh hardening
- Loan activity timeline and discussion surfaces
- Renewal request workflow and lender decisions
- Notification center backed by server-side persistence

### Data and Entitlement Guarantees

- Global `Book` identity with per-user `UserBook` state
- Scoped annotation visibility and lender/borrower permission boundaries
- Server-side entitlement checks for protected resources
- Migration-backed schema for collaboration entities (`BookLoan`, `LoanReviewMessage`, `LoanDiscussionReadState`, etc.)

### Reliability and Operations

- Docker-based deployment for backend, frontend, and PostgreSQL
- Prisma migrations for schema evolution
- Build/runtime stamping to verify running container branch/commit quickly
- Frontend resilience against transient backend outages (last-known-good library protection)

## Architecture

### Frontend

- React + Vite
- Primary orchestration: `src/pages/Home.jsx`
- Reading UI: `src/pages/Reader.jsx`, `src/components/BookView.jsx`
- Persistence/search layers: `src/services/db.js`, `src/services/searchIndex.js`, `src/services/contentSearchIndex.js`

### Backend

- Node.js + Express + Prisma + PostgreSQL
- API entrypoint: `server/src/index.js`
- Auth and access middleware: `server/src/auth.js`, `server/src/middleware.js`
- DB schema/migrations: `server/prisma`

## Local Development

### Frontend-only mode

```bash
npm install
npm run dev
```

### Full collaborative stack

```bash
docker compose up -d --build db backend
docker compose --profile frontend up -d --build frontend
```

## Environment

Create `.env` in project root for compose-based runs:

```env
JWT_SECRET=<strong-random-secret>
APP_BASE_URL=http://<SERVER_IP>:4000
VITE_API_BASE_URL=http://<SERVER_IP>:4000
LOAN_SCHEDULER_ENABLED=true
LOAN_SCHEDULER_INTERVAL_MS=60000
APP_BUILD_REF=<branch@commit>
VITE_BUILD_STAMP=<branch@commit>
```

## Deployment and Upgrade Notes

When pulling new backend changes:

```bash
docker compose exec backend npx prisma migrate deploy
docker compose up -d --build backend frontend
```

Health/build verification:

```bash
curl -s http://<SERVER_IP>:4000/health
```

Expected response includes build stamp:

```json
{"ok":true,"buildRef":"<branch@commit>"}
```

## Quality and Testing

Available suites:

```bash
npm run lint
npm run test:unit
npm run test:e2e
npm run test:e2e:collab
```

- Standard E2E suite covers local-mode product workflows.
- Dedicated collab E2E suite validates server-mode behavior (including refresh resilience).

## AI Roadmap (Planned)

The UI contains placeholders for AI capabilities. These are intentionally not presented as shipped features yet.

Planned next AI layers:

- Context restart briefs: precise "where you left off" narrative before resuming
- Chapter and arc summaries with citation anchors to the source text
- Passage-level explainers (concept unpacking, terminology, historical references)
- Reading memory graph across highlights, notes, and prior sessions
- Retrieval-based Q&A over the current book and personal annotation history
- Adaptive study assistant (review prompts, spaced recall from your own notes/highlights)

Roadmap principle: AI features must be auditable, source-grounded, and non-destructive to the core reading flow.

## Project Layout (Key Files)

- `src/pages/Home.jsx` - library and collaboration orchestration
- `src/pages/Reader.jsx` - reading workflow and annotation interactions
- `src/components/BookView.jsx` - EPUB rendering engine integration
- `src/pages/library/` - modular library workspace sections
- `server/src/index.js` - HTTP API and domain workflow composition
- `server/prisma/schema.prisma` - data model
- `server/prisma/migrations/` - migration history

## License

No open-source license has been declared in this repository yet.
