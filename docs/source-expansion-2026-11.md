# Municipal source expansion — 2026-11-23

The Permit Finder source registry was expanded across Massachusetts, Connecticut and Rhode Island.

## Added municipality references

| Municipality | State | Official entry point | Collector | Status |
|---|---|---|---|---|
| Springfield | MA | https://www.springfield-ma.gov/permits/permits | none | Registered, pending |
| Lowell | MA | https://www.lowellma.gov/1084/Monthly-Permit-Reports | monthly reports (manual normalization) | Registered, pending |
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
