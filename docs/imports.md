# Deterministic municipal report import

Only the global system administrator can add sources and import records. All imported permits are public-source records shared by workspaces; do not import private client/proposal data as permits.

Required JSON:
- sourceId: registered city ID.
- month: YYYY-MM.
- records: up to1000 records per API request.
- Each record: id prefixed with sourceId plus colon; sourceId; city; state; address; number; issued as valid YYYY-MM-DD; full useful description; type; value as a nonnegative number; status; contractor; applicant; sourceUrl as an official HTTPS document/record URL.
- Optional: published business phone/email, contactUrl, inspection evidence.
- Empty strings mean missing data. Value0 means undisclosed, not a zero-cost project.
- Missing GC is not inferred from an applicant. Do not infer email formats.

The browser accepts larger JSON files up to12MB and splits requests into500-record batches. It understands records, permits, or an array. Register any missing source before importing. A custom source allows its exact municipal host; approved third-party document hosts must be added explicitly to the reviewed source registry.

The document's issue date must be used. Application date, certificate of occupancy, permit expiration and status “open” are different concepts. Review full descriptions, pagination, duplicates and all pages. An address-only portal is not a full monthly issuance directory.

## CSV/XLSX/PDF table parser without AI

For CSV, Python standard library is sufficient. For XLSX or PDFs install tools/requirements.txt into a separate Python virtual environment. Run:

python tools/normalize_report.py downloaded-report.csv --config mapping.json --month 2026-10 --out normalized.json

The mapping JSON contains:
- source: id, city, state, documentUrl.
- columns: keys number, issued, address, description, type and optionally value, status, contractor, applicant, phone, email; values are exact header labels in the report.
- include: optional exact column/value filters (for example document type equals Building Permit).

The parser supports standard quoted CSV, workbook cells and extractable PDF tables. It does not perform OCR, interpret arbitrary free-form layouts, solve CAPTCHA or invent missing facts. Unknown dates or conflicting duplicate permit numbers fail the import. The output always requires a human completeness check. Do not present a partial table extraction as statewide coverage.

Old Sites radar exports may include reviews; those are workspace-scoped on import. Original client records/estimate schemas need a separate reviewed migration, not automatic field guessing.
