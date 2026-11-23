# Municipal source expansion — 2026-11-23

The Permit Finder source registry was expanded across Massachusetts, Connecticut and Rhode Island.

## Added municipality references

| Municipality | State | Official entry point | Collector | Status |
|---|---|---|---|---|
| Springfield | MA | https://www.springfield-ma.gov/permits/permits | none | Registered, pending |
| Lowell | MA | https://www.lowellma.gov/1084/Monthly-Permit-Reports | monthly application reports (manual normalization and issue-date checks) | Registered, pending |
| Chicopee | MA | https://www.chicopeema.gov/626/Online-Permits-and-Licenses | none | Registered, pending |
| Bridgeport | CT | https://www.bridgeportct.gov/government/departments/city-attorney/records-request | Park City Portal lookup | Registered, pending |
| Stamford | CT | https://www.stamfordct.gov/government/operations/building-department/building-records | records requests | Registered, pending |
| Pawtucket | RI | https://pawtucketri.gov/zoning-department/zoning-code-enforcement-information/ | municipality/ViewPoint portal | Registered, pending |

All above URLs are public municipality reference pages. No new municipality has a validated live ingestion connector in this change. A portal lookup **does not** establish bulk/monthly access. Do not report zero issued permits when collection is pending.

## Required next steps for each municipality

1. Identify an official, publicly accessible issuance list with document date and pagination.
2. Establish actual permitted access and stable parsing schema or a human-reviewed report import.
3. Add deterministic parser tests with representative sanitized fixtures and malformed/unavailable document tests.
4. Confirm permitted date vs application date, address, unique permit IDs, and no duplicated projects.
5. Validate monthly sample against the municipal source, then enable NATIVE_MODES and scheduled collection only if complete enough.

The application currently collects automatically only the seven original native modes, and the expansion preserves this distinction. The `report` and `portal` modes return `pending` via `collect()`. All current stored permits and existing lead reviews remain unaffected; there is no schema migration.

**Security:** Do not bypass login, captcha, access controls, privacy settings or rate limits on municipal sites.

## Existing-source repair and address lookup

Newton: the previous monthly report URL was not a working ingestion endpoint. The catalog now links to the official Inspectional Services portal entry point, which directs citizens to NewGov/OpenGov records lookup. Newton remains pending because no supported bulk endpoint or monthly issued-permits feed has been validated.

Springfield: the city's official contact page explicitly points the public to its OpenGov portal for individual permit lookup without login. The catalog now uses this public portal destination. This is **address lookup capability**, not proof that automated mass enumeration is supported.

Lowell: its 2026 monthly reports are described by the municipality as applications, with permit statuses and inspection statuses. Do not equate all report rows with permits issued. Confirm the actual issuance date/status before importing.

Address-based fallback design: when no comprehensive municipal feed exists, use authorized, independently obtained parcel/address candidates and explicit targeted lookups, track per-address check date and outcome, and rate-limit to comply with access policy. Do not generate fake house numbers, crawl every plausible address, bypass authentication or declare complete city coverage. Automated OpenGov access is blocked pending supported access/API validation.

The project key now removes a trailing city/state/ZIP only when it matches the actual source city. Project records in the database are **not** silently migrated; existing stored keys and reviews must be backed up and reconciled before any data migration.
