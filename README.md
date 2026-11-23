# Moriah System · Permit Radar

Private web application. Moriah System collects issued municipal building permits (MA/CT/RI) into a searchable radar and, from any permit, continues into the estimator workflow:

**Municipal permit → project/client → insulation takeoff → materials/cost → saved proposal.**

No OpenAI/ChatGPT login, API, model, embedding, AI agent, or AI token is used by this application. Authentication session tokens and CSRF tokens are ordinary security mechanisms, not AI usage. Hosting, disk, backups and domains are separate infrastructure costs.

## Included

- Private email/password login, owner/estimator/viewer roles and workspace-scoped projects, estimates, pricing and lead notes.
- Radar across MA/CT/RI, multiple cities, inclusive from/to months (up to24), type/priority/status filters, CSV export, evidence and balanced ordering across cities.
- New houses, ADUs, major additions, gut renovation, conversions and insulation signals. A lone electrical permit saying “wire new house” is not treated as a verified new-house building permit. Minor decks/roofing/window jobs stay outside the qualified view.
- Project creation directly from a permit with its address and municipal reference.
- Eight insulation sections: roof/rafters, slopes, ceiling, gables, exterior walls, basement walls, blockers and crawl space.
- Rectangle/triangle/projected-roof/direct area, feet/inches, quantity, one/two sides, total opening deductions, cavity depth, target R and extra waste.
- Layered assemblies: fixed2-inch CC plus OC fill to the remaining R, or configurable individual layers.
- Foam board feet, calibrated gallons,45-gallon barrel volume equivalents, rounded package totals across sections, fiberglass/ROCKWOOL/blow-in/foam board/coating catalog and editable coverage/prices.
- Material/labor/overhead/margin, optional manual subtotal, discount, configurable tax/deposit, material CSV and printable English proposal/PDF via the browser.
- Saved immutable estimate versions, company/project snapshots and workspace JSON backup.
- Persistent collection jobs and a daily local non-AI scheduler, with source errors and pending months visible.

## Coverage is measured, not promised

The registry starts with26 municipal sources. Seven API/CSV collectors, 16 document collectors are implemented (Brookline and Newton are imported by hand) (see below). Source availability can change.

**Newton and other report/OpenGov/Accela sources are listed but are not presented as automatically connected.** A homepage or search link does not prove bulk collection works. CAPTCHA, login barriers and HTTP403 are not bypassed. Missing/unpublished reports are pending, never an invented zero. No indiscriminate all-address crawl is implemented. This is not a claim that all559municipalities in the three states are connected.

**Document collectors.** 16 cities (Needham, Wellesley, Belmont, Arlington, Lexington, Sudbury, Andover, Wakefield, Reading, Danvers, Waltham, West Hartford, Milford, Amesbury, North Attleborough, Chatham) use `src/documents.mjs`: the collector reads the city's listing page (or a fixed file link), picks the file for the requested period (or the newest one), downloads it (PDF via `pdftotext`, XLSX, CSV or HTML) and extracts rows deterministically. Per-city settings live in `src/source-configs.mjs`. **None of these layouts has been validated against a live document yet**, so they finish as `partial` (never `complete`) and say so in the job log; a layout that is not recognized fails the job, and a document that has no permits for the month stays `pending`. Where a city publishes the payment or submission date instead of the issue date, the permit description says so. The Accela collector (`src/accela.mjs`) is kept but not enabled for any city. Brookline (Accela portal), Newton (OpenGov export button) and Carlisle (summary tables without permit numbers or dates) have no collector and are import-only; use the admin file import (PDF/CSV/XLSX) on the Cities screen for it. Weston, Newport, Warwick and Providence were removed because no public source exists. Requires `poppler-utils` (already in the Docker image) when running outside Docker.

Other sources can be added by the system administrator for normalized import. Deterministic CSV/XLSX/PDF-table conversion is available in tools/normalize_report.py. PDF layouts that cannot be extracted reliably require a dedicated parser or a municipal export; no AI fallback runs behind the scenes.

No historical permit database, client records or saved estimates from earlier applications are embedded in this repository. The application begins empty.

## Quick start on a local computer

Requires Node24 (native node:sqlite); no JavaScript packages need installing.

1. Set ADMIN_EMAIL and a unique ADMIN_PASSWORD of at least16characters in your shell, or use Node's --env-file option with a private .env file.
2. For local testing use NODE_ENV=development and APP_URL=http://localhost:3000.
3. Run npm start, or node --env-file=.env src/server.mjs.
4. Open http://localhost:3000 and sign in with the account you configured.

The owner account is initialized only when the database has no users. There is no public signup or default shared password. ADMIN_PASSWORD is not a password reset mechanism for an existing database.

## Independent production hosting

Use a single persistent Docker host with a domain. Set DNS to the host, allow ports80/443, copy .env.example to a private .env and configure:

- DOMAIN: your hostname without https.
- APP_URL: the exact HTTPS origin for that hostname.
- ADMIN_EMAIL and ADMIN_PASSWORD: your initial owner credentials.
- COMPANY_NAME: optional company display name.
- ENABLE_SCHEDULER=1: enables the native daily scheduler.

Run docker compose up -d --build. Caddy terminates HTTPS. The app is not exposed directly to the public network; SQLite is stored in the app_data volume. Inspect docker compose logs and /health.

**Do not delete the volume, use ephemeral hosting, or run multiple app replicas against SQLite.** This deployment is a single-instance modular application suitable for a private workspace or modest multi-workspace use. Horizontal scaling requires moving storage and job coordination to a shared database/queue. GitHub is source storage and CI; pushing this repository alone does not deploy a website.

No external hosting account, domain, certificate deployment or live production URL has been created by this repository commit. There is no paid subscription checkout or public self-service signup; workspace provisioning is administrator-controlled.

## Scheduler and collection

With ENABLE_SCHEDULER=1, at08:00 America/New_York or the next application tick, the server queues the previous and current month for native collectors. SQLite records the claimed day and queued jobs. Failed jobs preserve old records and report the failure. A daily scheduler is independent of the original ChatGPT automation, which is not modified.

For a manual local/operator run:
- npm run collect -- 2026-09 2026-10
- npm run collect -- 2026-10 2026-10 boston

The web “Coletar fontes automáticas” action queues selected native cities without blocking the page. A global system administrator controls collection and imports because municipal records are shared public-source data. Workspaces never share client projects, estimates, notes or contacts stored in lead reviews.

## Product setup and calculation notes

CC starts at50USD/gallon, OC at37USD/gallon, barrel volume45gallons, R/in7.5and4.2. Initial effective yields96BF/gal CC and384BF/gal OC reproduce the supplied consumption example after rounding: around42gal CC and82gal OC.

These are editable workflow calibration parameters, not a guarantee of manufacturer yield. Confirm whether your gallon measurement means combined chemicals or one component. Barrel equivalents are volume references, not automatic A/B-set purchasing quantities.

FiberglassR15 coverage65.67sqft/bag is provisional from the supplied788sqft/12bags example. Other package coverage and prices must be entered from the exact product sheet. Zero coverage fails the calculation; zero prices remain visibly incomplete. Blow-in coverage is keyed by R-value; coating adds no thermal R in this model.

Target R is user-defined. The software does not determine code compliance, foam approval, vapor/thermal barrier suitability or legal contract requirements. Tax/deposit defaults are0 and must be configured by the business. Proposal notes are user-authored. All calculations are repeated on the server before saving.

## Import and migration

The radar accepts JSON containing records or permits, including a normalized export from the old radar when sourceIDs match. It splits uploads by source/month, preserves repeated IDs, and can import compatible lead reviews after their records exist. Manual imports remain marked partial because completeness has not been machine-verified.

See docs/imports.md. Estimates from the earlier standalone estimator may use a different schema; they are not silently migrated. Export and retain their backups before any migration.

## Accounts and data

Owners can add users to their own workspace and change pricing/company settings. Estimators can manage projects and estimates; viewers can only read. All users can change their own password; this revokes existing sessions.

An operator can create another isolated workspace with:
NEW_USER_EMAIL, NEW_USER_PASSWORD and optionally NEW_WORKSPACE_NAME set privately, then node scripts/admin.mjs create-workspace.

Password recovery: set NEW_USER_EMAIL and NEW_USER_PASSWORD privately, then node scripts/admin.mjs reset-password. No email/SMS is sent. Do not put real credentials in command history, GitHub issues, logs or source files.

## Backup, validation and limits

- npm run backup -- /private/backups/permit-finder.sqlite uses SQLite's online backup API.
- Store database backups privately; they include account hashes and business records.
- The Settings backup button exports only the signed-in workspace's application data, never passwords/sessions or another workspace.
- Restore a database backup with the application stopped and preserve volume ownership. Back up before code/database changes.
- npm run check checks JavaScript syntax.
- npm test runs estimator/radar and HTTP authentication/tenant-isolation tests with in-memory databases and mocked municipal responses.
- GitHub Actions runs syntax checks, tests and Docker build on main pushes and PRs.
- Live municipal availability and browser visual behavior are not certified by unit tests. Check the actual workflow result; do not infer that tests ran simply because a workflow file exists.

Source publication is independent of production deployment. Keep this repository private unless you intentionally choose to open-source the code. Never commit .env, SQLite files, exports or customer data.

## Private test preview

Run `npm run start:test` with Node 24. This explicitly starts a test-only server with username `mestre` and the agreed public fixture password `shazam123@`. Do not reuse this password for real accounts. Keep Codespaces port visibility **Private**.

This command uses a separate persistent `data/permit-finder-test.sqlite` database, ignores the real account bootstrap variables, and does not reset your existing accounts or estimates. The normal `npm start` command never creates this account. Test startup and test login configuration are rejected in production.

In Codespaces the preview address is derived automatically from its environment. The test server also supports the Codespaces localhost Origin rewrite only for a same-origin request with an exactly matching localhost Host. Foreign origins and cross-site requests remain blocked. Outside Codespaces this exception is absent.
