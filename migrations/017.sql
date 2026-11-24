-- Richer estimate requests: customer phone, job type, timeline, extra details and photos.
ALTER TABLE estimate_requests ADD COLUMN prospect_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE estimate_requests ADD COLUMN job_type TEXT NOT NULL DEFAULT '';
ALTER TABLE estimate_requests ADD COLUMN timeline TEXT NOT NULL DEFAULT '';
ALTER TABLE estimate_requests ADD COLUMN details TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS estimate_photos(id INTEGER PRIMARY KEY AUTOINCREMENT,request_id INTEGER NOT NULL REFERENCES estimate_requests(id) ON DELETE CASCADE,mime TEXT NOT NULL,data BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS estimate_photos_request ON estimate_photos(request_id);
-- Site visits can be created without a permit (typed address) and name the customer.
ALTER TABLE site_visits ADD COLUMN customer TEXT NOT NULL DEFAULT '';
