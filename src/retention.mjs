// Automatic retention: permits older than the retention period (by ISSUE date, never by import date) are deleted for good.
import {timestamp} from './db.mjs';

export const DEFAULTS = {retention_months: '12', stale_days: '45'};
export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key);
  return row ? row.value : DEFAULTS[key];
}
export function setSetting(db, key, value) {
  db.prepare('INSERT INTO app_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
export function cutoffDate(now, months) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
export function purgeOldPermits(db, now = new Date(), day = now.toISOString().slice(0, 10)) {
  const months = Math.max(1, Math.min(120, Number(getSetting(db, 'retention_months')) || 12)), cutoff = cutoffDate(now, months);
  const deleted = Number(db.prepare('DELETE FROM permits WHERE issued < ?').run(cutoff).changes);
  db.prepare('INSERT INTO retention_runs(day,created_at,cutoff,months,deleted) VALUES(?,?,?,?,?)').run(day, timestamp(), cutoff, months, deleted);
  console.log('Retention: ' + deleted + ' permits issued before ' + cutoff + ' deleted.');
  return {deleted, cutoff, months};
}
// Once per local day, after 8am like the collection scheduler.
export function runRetentionIfDue(db, timezone = 'America/New_York', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'}).formatToParts(now), get = t => parts.find(p => p.type === t).value;
  if (Number(get('hour')) < 8) return null;
  const day = get('year') + '-' + get('month') + '-' + get('day');
  if (db.prepare('SELECT 1 FROM retention_runs WHERE day=?').get(day)) return null;
  return purgeOldPermits(db, now, day);
}
export function retentionStatus(db) {
  const last = db.prepare('SELECT day,created_at AS createdAt,cutoff,months,deleted FROM retention_runs ORDER BY id DESC LIMIT 1').get() || null;
  const total = Number(db.prepare('SELECT COALESCE(SUM(deleted),0) AS n FROM retention_runs').get().n);
  return {months: Number(getSetting(db, 'retention_months')), last, totalDeleted: total, runs: db.prepare('SELECT day,cutoff,deleted FROM retention_runs ORDER BY id DESC LIMIT 10').all()};
}
