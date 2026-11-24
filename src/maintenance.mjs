// Daily automation for the administrator: database backup, health report and alert e-mail.
import {backup} from 'node:sqlite';
import {mkdirSync,readdirSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {getSetting,setSetting} from './retention.mjs';
import {allSources} from './service.mjs';
import {freshness} from './partners.mjs';
import {mailConfig,sendMail} from './mailer.mjs';
import {timestamp} from './db.mjs';

export const KEEP_BACKUPS = 14;
const localDay = (tz, now) => { const p = new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'}).formatToParts(now), g = t => p.find(x => x.type === t).value; return {day: g('year') + '-' + g('month') + '-' + g('day'), hour: Number(g('hour'))}; };
export const alertEmail = (db, env = process.env) => (db.prepare("SELECT value FROM app_settings WHERE key='alert_email'").get()?.value ?? env.ALERT_EMAIL ?? '').trim();

export async function runBackup(db, databasePath, day, {dir = process.env.BACKUP_DIR} = {}) {
  if (!databasePath || databasePath === ':memory:') return null;
  const target = dir || join(dirname(databasePath), 'backups'), file = join(target, 'permit-finder-' + day + '.sqlite');
  mkdirSync(target, {recursive: true});
  await backup(db, file);
  const old = readdirSync(target).filter(f => /^permit-finder-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort().slice(0, -KEEP_BACKUPS);
  for (const f of old) rmSync(join(target, f), {force: true});
  return file;
}

// Problems worth an e-mail: automatic collectors that failed in their latest check, and cities whose newest permit is older than the limit.
export function healthReport(db, now = new Date()) {
  const sources = allSources(db), fresh = freshness(db, sources, now), failing = [];
  for (const src of sources.filter(s => !['report', 'portal'].includes(s.mode))) {
    const last = db.prepare('SELECT status,month,message FROM coverage WHERE source_id=? ORDER BY checked_at DESC LIMIT 1').get(src.id);
    if (last && ['unavailable', 'failed'].includes(last.status)) failing.push({city: src.city + ', ' + src.state, month: last.month, message: String(last.message || '').slice(0, 160)});
  }
  const stale = fresh.filter(f => f.stale && f.permits > 0).map(f => ({city: f.city + ', ' + f.state, lastPermit: f.lastPermit, days: f.daysSincePermit}));
  const empty = fresh.filter(f => f.permits === 0).length;
  return {failing, stale, empty, total: sources.length, ok: !failing.length && !stale.length};
}
export function reportText(r, day) {
  const L = ['Moriah System — daily check ' + day, ''];
  if (r.ok) L.push('Everything looks fine: no failing collectors and no city with old data.');
  if (r.failing.length) { L.push('Collectors that failed in their latest run (' + r.failing.length + '):'); for (const f of r.failing) L.push(' - ' + f.city + ' ' + f.month + ': ' + f.message); L.push(''); }
  if (r.stale.length) { L.push('Cities with no new permits for too long (' + r.stale.length + '):'); for (const s of r.stale) L.push(' - ' + s.city + ': last permit ' + s.lastPermit + ' (' + s.days + ' days ago)'); L.push(''); }
  if (r.empty) L.push(r.empty + ' of ' + r.total + ' cities have no permits stored yet.');
  return L.join('\n');
}

// Once per local day, from 10:00 (after the 08:00 collection had time to finish).
export async function runDailyMaintenance(db, {databasePath, timezone = 'America/New_York', now = new Date(), env = process.env, mail = sendMail} = {}) {
  const {day, hour} = localDay(timezone, now);
  if (hour < 10 || getSetting(db, 'maint_day') === day) return null;
  setSetting(db, 'maint_day', day);
  const out = {day, backup: null, report: null, email: null};
  try { out.backup = await runBackup(db, databasePath, day); setSetting(db, 'last_backup', out.backup ? day + '|' + out.backup : ''); } catch (e) { setSetting(db, 'last_backup', day + '|FAILED: ' + String(e.message).slice(0, 120)); console.error('Backup error', e.name); }
  out.report = healthReport(db, now);
  setSetting(db, 'last_report', JSON.stringify({day, failing: out.report.failing.length, stale: out.report.stale.length, empty: out.report.empty}));
  const to = alertEmail(db, env), fp = JSON.stringify([out.report.failing.map(x => x.city), out.report.stale.map(x => x.city)]);
  const lastSent = getSetting(db, 'alert_sent_at'), weekOld = !lastSent || now - new Date(lastSent) > 7 * 86400000;
  if (!out.report.ok && to && (getSetting(db, 'alert_fp') !== fp || weekOld)) {
    const r = await mail({to, subject: 'Moriah System: ' + (out.report.failing.length + out.report.stale.length) + ' city problem(s)', text: reportText(out.report, day)}, mailConfig(env));
    out.email = r; setSetting(db, 'alert_result', day + '|' + (r.sent ? 'sent to ' + to : 'NOT sent: ' + r.reason));
    if (r.sent) { setSetting(db, 'alert_fp', fp); setSetting(db, 'alert_sent_at', now.toISOString()); }
  }
  return out;
}
export function automationStatus(db, env = process.env) {
  const split = v => { const i = String(v || '').indexOf('|'); return i < 0 ? {day: '', detail: ''} : {day: v.slice(0, i), detail: v.slice(i + 1)}; };
  const raw = k => db.prepare('SELECT value FROM app_settings WHERE key=?').get(k)?.value || '';
  let report = null; try { report = JSON.parse(raw('last_report') || 'null'); } catch {}
  return {alertEmail: alertEmail(db, env), mailConfigured: !!mailConfig(env), backup: split(raw('last_backup')), alert: split(raw('alert_result')), report};
}
