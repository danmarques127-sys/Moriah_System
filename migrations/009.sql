-- Belmont, Lowell and Manchester-by-the-Sea were removed from the source list (no usable public report yet).
DELETE FROM permits WHERE source_id IN ('belmont','lowell','manchester');
DELETE FROM coverage WHERE source_id IN ('belmont','lowell','manchester');
DELETE FROM jobs WHERE source_id IN ('belmont','lowell','manchester');
DELETE FROM manual_imports WHERE source_id IN ('belmont','lowell','manchester');
DELETE FROM client_cities WHERE source_id IN ('belmont','lowell','manchester');
DELETE FROM source_checks WHERE source_id IN ('belmont','lowell','manchester');
PRAGMA user_version=9;
