-- Insulation proposal lines work like the reference tool: price = FT x inches x unit price (per board foot), inches = target R / R per inch.
-- unit_price is the SELL price per board foot (foam) or per sq ft (batts/blown-in); unit_cost stays the private cost per gallon / pack.
DELETE FROM ins_materials;
ALTER TABLE ins_materials ADD COLUMN unit_price REAL NOT NULL DEFAULT 0;
PRAGMA user_version=19;
