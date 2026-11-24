// Manual imports: who uploaded what and when, so cities that need hand-delivered files can be tracked.
import {timestamp} from './db.mjs';
export function recordManualImport(db, sourceId, month, result, email = '') {
  db.prepare('INSERT INTO manual_imports(source_id,month,imported_at,added,updated,by_email) VALUES(?,?,?,?,?,?)').run(sourceId, month, timestamp(), result.added || 0, result.updated || 0, email);
}
// Latest upload per city (date, month covered, who) plus how many uploads it has had.
export function manualImportStatus(db) {
  return db.prepare('SELECT m.source_id AS sourceId,m.imported_at AS lastAt,m.month,m.by_email AS byEmail,(SELECT COUNT(*) FROM manual_imports x WHERE x.source_id=m.source_id) AS uploads FROM manual_imports m WHERE m.id=(SELECT MAX(id) FROM manual_imports y WHERE y.source_id=m.source_id)').all();
}
