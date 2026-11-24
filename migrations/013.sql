-- Estimate editor: line items for the customer, private internal cost and sales tax.
ALTER TABLE estimate_requests ADD COLUMN line_items TEXT NOT NULL DEFAULT '[]';
ALTER TABLE estimate_requests ADD COLUMN internal_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE estimate_requests ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0;
PRAGMA user_version=13;
