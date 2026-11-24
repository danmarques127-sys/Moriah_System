-- Real pricing method: price = material (qty x cost) + crew days x day cost + crew days x day profit (+ optional fireblocking). Days are rounded up.
ALTER TABLE ins_settings ADD COLUMN day_profit REAL NOT NULL DEFAULT 1200;
ALTER TABLE ins_settings ADD COLUMN fire_price REAL NOT NULL DEFAULT 1200;
UPDATE ins_settings SET crew_day_cost=1100 WHERE crew_day_cost=800;
UPDATE ins_materials SET unit_cost=55 WHERE name='Closed Cell Spray Foam' AND unit_cost=50;
UPDATE ins_materials SET unit_cost=70 WHERE name='Roxul 3 inches 3x15' AND unit_cost=1.0;
PRAGMA user_version=20;
