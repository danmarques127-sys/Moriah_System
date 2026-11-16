# Architecture and trust boundaries

Decision: independent Node24 modular server, native SQLite and browser ES modules. No runtime JavaScript packages, OpenAI services or remote AI inference.

The implementation rebuilds the earlier workflows; it does not embed Sites Workers, ChatGPT auth headers, Cloudflare D1 bindings, service bypass tokens or linked ChatGPT schedules.

Private trust boundary:
- Passwords: salted scrypt with per-password random salt.
- Sessions: opaque random credential stored only as SHA256 in SQLite, HttpOnly/SameSiteStrict cookie, Secure in production.
- CSRF: session-bound random token plus exact configured Origin validation.
- Login/expensive mutation throttling; no public registration.
- App routes perform workspace authorization per resource.
- Workspace data: company/pricing, users, client projects, estimates, lead reviews.
- Global public-source data: municipal registry, permits, coverage, collection jobs.
- Only system administrators collect/import global data or add sources.
- UI clears prior workspace draft state on logout/login to prevent cross-account data leakage in a shared browser.
- CSP limits scripts to same-origin modules. User fields are escaped before HTML rendering. Proposals do not contain internal costing details.
- Only reviewed static collector endpoints are fetched. Custom municipal sources support import but are not arbitrary network fetchers.
- Logs do not contain passwords, cookies, service keys or full request bodies.
- A saved estimate stores its computed result and company/project snapshots. Recalculation creates a new version; old proposals do not silently change when pricing changes.

Operational limits:
- Single SQLite instance with durable disk; no horizontal replica deployment.
- No subscription billing, payments, password-recovery email provider or self-service tenant signup.
- No automatic statewide coverage guarantee; report/portal source integration is explicitly separate from source registration.
- No current-deployed Site database is shipped in Git.
- No production hosting or browser QA has been performed merely by committing source.
