-- Starting prices refreshed from store prices (Nov 2026). Only rows still at the old starting values are changed.
UPDATE ins_materials SET pack='pack',unit_cost=106,pack_cover=195.2 WHERE name='Fiberglass batt R-13' AND unit_cost=0.45;
UPDATE ins_materials SET pack='pack',unit_cost=117,pack_cover=118.83 WHERE name='Fiberglass batt R-19' AND unit_cost=0.7;
UPDATE ins_materials SET pack='pack',unit_cost=88.82,pack_cover=53.33 WHERE name='Fiberglass batt R-30' AND unit_cost=0.95;
UPDATE paint_products SET gal_price=62,bucket_price=280 WHERE name='Interior wall paint' AND gal_price=45 AND bucket_price=190;
UPDATE paint_products SET gal_price=32,bucket_price=130 WHERE name='Ceiling paint' AND gal_price=38 AND bucket_price=160;
UPDATE paint_products SET gal_price=54.6,bucket_price=273 WHERE name='Exterior paint' AND gal_price=55 AND bucket_price=240;
UPDATE paint_products SET gal_price=31 WHERE name='Primer' AND gal_price=32;
PRAGMA user_version=22;
