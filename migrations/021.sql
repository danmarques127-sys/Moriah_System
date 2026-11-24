-- Job extras (rollers, drop cloths, plastic sheeting...) shared by trades, plus the painting calculator (paint by the gallon / 5-gallon bucket, crew hours).
CREATE TABLE IF NOT EXISTS job_extras(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,trade TEXT NOT NULL,name TEXT NOT NULL,unit TEXT NOT NULL DEFAULT 'each',unit_cost REAL NOT NULL DEFAULT 0,unit_price REAL NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS job_extras_company ON job_extras(company_id,trade);
CREATE TABLE IF NOT EXISTS paint_products(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'interior',coverage REAL NOT NULL DEFAULT 350,gal_price REAL NOT NULL DEFAULT 0,bucket_price REAL NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS paint_products_company ON paint_products(company_id);
CREATE TABLE IF NOT EXISTS paint_settings(company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,crew_size INTEGER NOT NULL DEFAULT 2,sqft_per_hour REAL NOT NULL DEFAULT 150,hour_cost REAL NOT NULL DEFAULT 70,hour_profit REAL NOT NULL DEFAULT 60,bucket_gal REAL NOT NULL DEFAULT 5);
PRAGMA user_version=21;
