# Moriah System — implementation plan

## Product scope

Moriah System is a multi-workspace business platform. Current development priority is **Permit Intelligence**. Future modules (not yet implemented as part of this work) are cash flow, job costing, employee time, and business operations (invoices, proposals, follow-ups and CRM).

The existing insulation estimator remains operational as a legacy feature while the platform evolves. Do not delete data or rename database files without a backup and migration plan.

## What a municipal source status means

1. **Registered**: a URL and municipality are listed in `src/sources.mjs` or `custom_sources`. No data extraction is implied.
2. **Native collector**: `src/collectors.mjs` contains an implementation for its mode. This is not a live-availability guarantee.
3. **Coverage complete**: a collection run returned all paginated records within the implemented bounds for a specific source/month. This does not guarantee the municipality published all permits.
4. **Coverage partial**: a record/page cap or a known limitation prevented a full scan.
5. **Coverage pending**: a portal/report has no validated collector or the relevant report was not published. A pending result is **not** an empty month.
6. **Coverage unavailable**: an error occurred. Existing records are preserved; they should not be represented as current fresh coverage.

The application should show the per-source, per-month state and report the last check. Job processing status and coverage status have distinct meanings.

## Municipality expansion policy

Rhode Island has 39 municipalities; Connecticut has 169. Do not mark all 208 as connected simply because a state permit portal or regional directory lists them.

Before accepting a new native collector, record:
- municipality, state, official landing page and exact permit-data page;
- source vendor/platform only if confirmed by a live municipal page;
- whether records can be searched without authentication or challenge bypass;
- published fields (issue date, permit ID, address, description, contractor, amount);
- pagination/export behavior and the maximum trustworthy historical interval;
- sample records and source URLs, including how duplicates and withdrawn records are treated;
- negative outcomes (HTTP restrictions, unstructured PDFs, incomplete publication);
- repeatable automated test fixtures and a successful real-world manual verification.

Public data may change over time. Never identify a portal home page as proof of bulk access. Do not brute-force all addresses, bypass CAPTCHA or authorization requirements.

## Immediate acceptance criteria

- Unsupported sources remain pending, not represented as verified zero records.
- ArcGIS pagination refuses repeated pages, invalid API payloads and limit exhaustion.
- Cached records are preserved through blocked/pending collections.
- Unit tests cover negative cases and full-page boundaries.
- Existing accounts, leads, estimates and source IDs are left unchanged.
- Live municipality coverage remains **unvalidated** until actual requests are run and recorded.

## Next phase

Investigate/report-test CT and RI sources individually (starting with published monthly reports). Only then add municipal adapters or vetted import workflows, source-by-source, with provenance and per-month completeness.
