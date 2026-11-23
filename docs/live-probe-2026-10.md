# Live collector verification — October 2026

Date checked: 2026-11-23 (GitHub Actions runner, Node 24)

Source: [GitHub Actions run 45264728733](https://github.com/danmarques127-sys/Permit_Finder/actions/runs/45264728733). This is a **read-only probe**, not an import into the Moriah System database.

| Municipality | State | Probe status | Records | Records with contractor | Records with address |
|---|---|---|---:|---:|---:|
| Westerly | RI | complete | 122 | 108 | 122 |
| Hartford | CT | complete | 355 | 0 | 355 |
| Somerville | MA | complete | 185 | 184 | 185 |
| Boston | MA | complete | 3349 | 0 | 3318 |
| Cambridge | MA | complete | 188 | 0 | 188 |
| Milton | MA | complete | 251 | 0 | 251 |
| Worcester | MA | complete | 450 | 4 | 450 |
| **Total** | | | **4900** | **296** | **4869** |

**Interpretation:** `complete` means the current collector returned a full period under its implemented pagination rules; it does not prove that municipal publication is exhaustive. Permits may be irrelevant to insulation. Zero contractor fields means this adapter did not return a contractor value; it is not proof that the municipality has no contractor data.

## Known next tasks

- Improve contractor attribution where allowed by the public source; never confuse applicant/homeowner with contractor.
- Evaluate source-specific scope/description quality and classification false positives.
- Build deterministic parsers for CT PDF report sources before enabling their automatic ingestion.
- Test imports and review workflow inside the Codespace using a test database; this probe did not modify user application data.
- Verify that pages, credentials and hosted workflow operate when deployed, separately from unit tests.
- Continue source-by-source rollout for CT and RI; do not mark all 208 municipalities connected.
