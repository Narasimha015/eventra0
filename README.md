# Eventra

Eventra is an intelligent event operations and decision-support platform that combines event management, historical data collection, data-quality validation, event simulation, operational risk analysis, and a future-ready machine-learning pipeline. Current operational estimates are rule-based; experimental model metrics use explicitly labeled synthetic demonstration data, not production observations.

See [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md), [ML_READINESS.md](ML_READINESS.md), [EVENT_SIMULATION.md](EVENT_SIMULATION.md), [HISTORICAL_DATA_IMPORT.md](HISTORICAL_DATA_IMPORT.md), [PROJECT_DIFFERENTIATORS.md](PROJECT_DIFFERENTIATORS.md), and [DEMO_GUIDE.md](DEMO_GUIDE.md) for the Phase 4B data and demonstration boundaries.

Historical imports are available only to administrators at **Admin → Data Intelligence**. New historical records are stored separately and remain unverified until source documentation is reviewed. The prediction-point timeline captures only recorded information at or before each cutoff; earlier points without an eligible snapshot remain unavailable.

The isolated synthetic ML demonstration can be tested with `cd ml` then `npm test`. It compares a training-mean baseline with Ridge regression on a deterministic synthetic dataset using chronological holdout metrics. These metrics are not real-world Eventra accuracy.

Eventra is an intelligent event management project. It combines event operations with a transparent Event Intelligence Engine that analyzes persisted records, estimates attendance, identifies capacity/schedule risks, and recommends explainable actions. The React/Vite frontend provides public discovery and separate attendee, organizer, and administrator workspaces. The Express/SQLite foundation preserves server-enforced roles, registration/ticket integrity, and organizer ownership.

## Architecture

- `event-react-app/`: React 19 and Vite frontend with a public landing/discovery experience plus attendee, organizer, and admin workspaces for events, tickets, venues, vendors, analytics, activity, calendars, and settings.
- `server/`: Express 5 API. Route modules live in `server/src/routes/`; shared auth/validation/error handling is in `server/src/`.
- Event Intelligence: `server/src/intelligence.js` is a deterministic rule-based/statistical calculation module. Its authenticated routes aggregate existing Eventra records on demand; it adds no database tables or snapshot state. Organizer UI lives in `event-react-app/src/IntelligenceDashboard.jsx` and is lazy-loaded.
- SQLite: `server/data/eventra.sqlite` by default. The database contains users, events, venues, vendors, registrations/tickets, check-ins, activity, settings, and migration records.
- `server/data.json`: preserved legacy source data. `npm run db:migrate` imports it once; the source file remains unchanged. Aggregate registration counts without attendee identities are retained as legacy baselines and included in capacity/analytics calculations.

The frontend sends requests to `http://localhost:4000/api` by default. Set `VITE_API_URL` when the API is hosted elsewhere. Success responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "details?" } }`. The public site only presents events available through the API; if the seed data has no upcoming events, discovery displays an empty state until organizers add them.

## Roles and authentication

- **ADMIN** can manage users, events, venues, vendors, platform-wide analytics, and account settings.
- **ORGANIZER** can manage their own events, attendees/tickets, venues, vendors, analytics, and settings. Ownership is checked by the API on resource reads and writes.
- **ATTENDEE** can browse public events, register, cancel their own registration, and access their own ticket QR.

Passwords use bcrypt with per-password salts. Login sessions use signed JWTs in HTTP-only, SameSite=Lax cookies. The signing secret is required; the server refuses to start without `EVENTRA_JWT_SECRET` containing at least 32 characters. API clients may also send a bearer token if they issue one through a trusted integration, but the browser app does not store tokens in localStorage.

## Install and run

Use Node.js 20.19+ or 22.12+ (Node 24 is suitable) and npm.

### API setup (PowerShell)

```powershell
cd "server"
npm ci
Copy-Item .env.example .env
```

Edit `server/.env` and replace the JWT placeholder with a private random value. Generate one with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

For the first setup, migrate the existing demo data and start the API:

```powershell
npm run db:migrate
npm start
```

The API listens on `http://localhost:4000`. Health check: `GET http://localhost:4000/api/health`.

### Frontend setup (second terminal)

```powershell
cd "event-react-app"
npm ci
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). To create a production frontend bundle, run `npm run build`; `npm run preview` serves that bundle locally.

If already at the repository root, enter each directory with `cd server` or `cd event-react-app` first. The two apps have separate package manifests and lockfiles.

## Database and demo data

- `npm run db:migrate` imports `server/data.json` once into the SQLite database. It is idempotent and leaves the source JSON intact.
- `npm run db:seed` creates or refreshes the local demo accounts and starter venues/events/vendors. It is intentionally disabled when `NODE_ENV=production`.
- Database location can be changed with `EVENTRA_DB_PATH`.
- Do not delete `server/data.json` until you have confirmed the imported data and backed up the SQLite database.
- For a clean local demo, stop the API, back up or remove `server/data/eventra.sqlite`, then run the migration command again. The original JSON remains the migration source.

### Development-only accounts

| Role | Email | Default local password |
| --- | --- | --- |
| Administrator | `admin@eventra.local` | `Eventra@2026` |
| Organizer | `organizer@eventra.local` | `Organizer@2026` |
| Attendee | `attendee@eventra.local` | `Attendee@2026` |

These are demo-only credentials. Override them with `EVENTRA_DEMO_ADMIN_PASSWORD`, `EVENTRA_DEMO_ORGANIZER_PASSWORD`, and `EVENTRA_DEMO_ATTENDEE_PASSWORD` before running local seed/migration commands. Never use these defaults in a deployed environment. Public attendee sign-up is available from the login screen and requires a 12-character password.

Legacy user password hashes used a custom, shared-salt format and cannot be safely converted to bcrypt without the original passwords. The legacy JSON remains available as a backup; in development, the demo accounts are re-seeded with the documented local credentials. For production migration, issue password resets instead of relying on demo credentials.

## API overview

- `GET /api/health`
- `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/POST /api/users` (administrator only)
- `GET/POST /api/events`, `GET/PATCH/DELETE /api/events/:id`
- `POST /api/events/:id/register` (attendee self-registration)
- `GET/POST /api/registrations`, `POST /api/tickets/:id/cancel`, `GET /api/tickets` (attendee-owned tickets)
- `POST /api/check-in` (organizer/admin; accepts secure QR token or a ticket identifier)
- `GET/POST/PATCH /api/attendees`; `GET/POST/PATCH/DELETE /api/venues` and `/api/vendors` with role and ownership checks
- `GET /api/analytics`, `GET/POST/PATCH /api/activity`, `GET/PUT /api/settings`
- `GET /api/events/:id/intelligence` (admin or owning organizer; readiness, attendance estimate, crowd risk, recommendations, actual trends)
- `POST /api/events/:id/what-if` (admin or owning organizer; read-only scenario from `expectedRegistrations`)

Ticket capacity and check-in are enforced in SQLite transactions. Duplicate registrations are constrained per attendee/event. Ticket tokens are cryptographically random, stored as hashes, and validated by the API; a ticket can only be checked in once. Venue assignment checks availability and capacity, and assigned venues cannot be removed until their events are reassigned.

## Tests and verification

From `server/`:

```powershell
npm test
npm run test:smoke
```

The API tests cover login/session cookies, role enforcement, event ownership, registration duplicates and capacity, single-use ticket check-in, venue CRUD, Event Intelligence calculations/authorization/what-if behavior, and health/public event smoke checks. From `event-react-app/`, run:

```powershell
npm run lint
npm run build
```

For a local smoke check, start the API and frontend in separate terminals using the commands above, then open `http://localhost:5173`. Use the development-only accounts to inspect each role. The API test suite is the source of automated coverage for authorization, ownership, registration/capacity, ticket check-in, venue CRUD and Event Intelligence. The frontend currently has no separate automated UI test script.

## Security and operational notes

- Keep `.env` private; it is ignored by Git. Configure an origin-specific `EVENTRA_CORS_ORIGIN` and a unique random JWT secret for each deployed environment.
- Demo accounts and seed passwords are for local development only. Demo seeding refuses to run in production.
- SQLite is appropriate for a single-instance project demonstration. Back up the database; use managed PostgreSQL and deployment migrations before multi-instance or production use.
- Legacy aggregate counts have no attendee-level ticket records. They remain visible in totals and capacity checks but cannot be individually cancelled or checked in.
- Email/SMS delivery, payment processing, camera-based QR scanning, and production deployment infrastructure are not included.
- The event-planning assistant remains a local rule-based template, not a connected generative AI service.
- Event Intelligence is a transparent rule-based/statistical planning aid, not a trained machine-learning model. The bundled legacy aggregate counts lack attendee-level check-in outcomes, so the engine labels the fallback as an early estimate. Formulas, assumptions, API scope, and the demo flow are documented in [EVENT_INTELLIGENCE.md](EVENT_INTELLIGENCE.md).

## Product scope and next steps

The planning assistant is a rule-based template prototype. Calendar pages display event dates but do not sync with external calendars. Notifications show recorded workspace activity and do not deliver email, SMS, or push messages. Ticket QR codes are issued and validated by the API; camera scanning is not included. Event Intelligence explains its statistical/rule-based methodology and uncertainty; it does not claim ML accuracy. Payments and production deployment infrastructure are outside the current project scope. A next phase can add automated frontend interaction tests, evaluate intelligence calibration on a larger consent-aware dataset, and consider notification delivery, payments, calendar integration, camera scanning, and deployment hardening.
