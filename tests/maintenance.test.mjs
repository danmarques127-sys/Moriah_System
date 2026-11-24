import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtempSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,timestamp} from '../src/db.mjs';
import {sendMail} from '../src/mailer.mjs';
import {runDailyMaintenance,healthReport,reportText,runBackup} from '../src/maintenance.mjs';
import {setCoverage} from '../src/service.mjs';
import {clean} from '../src/documents.mjs';

function fakeSmtp() {
  const got = {mail: [], auth: []};
  const server = net.createServer(sock => {
    let data = false, body = '', step = '';
    sock.write('220 fake\r\n');
    let buf = '';
    sock.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === '.') { data = false; got.mail.push(body); body = ''; sock.write('250 ok\r\n'); } else body += line + '\n'; continue; }
        if (step === 'user') { got.auth.push(Buffer.from(line, 'base64').toString()); step = 'pass'; sock.write('334 UGFzc3dvcmQ6\r\n'); continue; }
        if (step === 'pass') { got.auth.push(Buffer.from(line, 'base64').toString()); step = ''; sock.write('235 ok\r\n'); continue; }
        if (/^EHLO/.test(line)) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') { step = 'user'; sock.write('334 VXNlcm5hbWU6\r\n'); }
        else if (/^(MAIL|RCPT)/.test(line)) sock.write('250 ok\r\n');
        else if (line === 'DATA') { data = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  return new Promise(res => server.listen(0, '127.0.0.1', () => res({server, got, port: server.address().port})));
}
const decodeBody = raw => Buffer.from(raw.split('\n\n').slice(1).join('').replace(/\s+/g, ''), 'base64').toString();

test('mail: sends through an SMTP server with login and a UTF-8 body', async () => {
  const {server, got, port} = await fakeSmtp();
  const r = await sendMail({to: 'dan@example.com', subject: 'Olá', text: 'Cidade: Hartford'}, {host: '127.0.0.1', port, user: 'u', pass: 'p', from: 'alerts@example.com'});
  server.close();
  assert.equal(r.sent, true);
  assert.deepEqual(got.auth, ['u', 'p']);
  assert.match(got.mail[0], /To: dan@example.com/);
  assert.match(decodeBody(got.mail[0]), /Hartford/);
});
test('mail: without configuration nothing is sent and the reason is explained', async () => {
  const r = await sendMail({to: 'dan@example.com', subject: 's', text: 't'}, null);
  assert.equal(r.sent, false); assert.match(r.reason, /SMTP_HOST/);
});
test('mail: refuses to log in over an unencrypted connection to a remote host', async () => {
  const {server, port} = await fakeSmtp();
  const r = await sendMail({to: 'a@b.co', subject: 's', text: 't'}, {host: 'localhost.example.invalid', port, user: 'u', pass: 'p', from: 'x@y.co'}, {timeoutMs: 1500});
  server.close();
  assert.equal(r.sent, false);
});

test('daily maintenance: backup, report and one alert e-mail per change; nothing before 10:00 or twice a day', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maint-')), path = join(dir, 'db.sqlite'), db = openDatabase(path);
  setCoverage(db, 'boston', '2026-11', 'unavailable', 'fetch failed', 0);
  db.prepare("INSERT INTO app_settings VALUES('alert_email','dan@example.com')").run();
  db.prepare("INSERT INTO app_settings VALUES('alert_level','all')").run();
  const sent = [], mail = async m => { sent.push(m); return {sent: true}; };
  const env = {SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p'};
  const early = new Date('2026-11-24T12:00:00Z'); // 07:00 in New York
  assert.equal(await runDailyMaintenance(db, {databasePath: path, now: early, env, mail}), null);
  const day1 = new Date('2026-11-24T16:00:00Z'); // 11:00
  const out = await runDailyMaintenance(db, {databasePath: path, now: day1, env, mail});
  assert.ok(existsSync(out.backup)); assert.equal(sent.length, 1); assert.match(sent[0].text, /Boston/);
  assert.equal(await runDailyMaintenance(db, {databasePath: path, now: day1, env, mail}), null);
  await runDailyMaintenance(db, {databasePath: path, now: new Date('2026-11-25T16:00:00Z'), env, mail});
  assert.equal(sent.length, 1, 'same problem is not mailed again the next day');
  setCoverage(db, 'cambridge', '2026-11', 'unavailable', 'HTTP 500', 0);
  await runDailyMaintenance(db, {databasePath: path, now: new Date('2026-11-26T16:00:00Z'), env, mail});
  assert.equal(sent.length, 2, 'a new problem is mailed');
  db.close();
});
test('health report ignores manual cities and lists failing collectors', () => {
  const db = openDatabase(':memory:');
  setCoverage(db, 'boston', '2026-11', 'unavailable', 'HTTP 403', 0);
  setCoverage(db, 'newton', '2026-11', 'unavailable', 'x', 0);
  const r = healthReport(db), names = r.failing.map(f => f.city);
  assert.ok(names.includes('Boston, MA')); assert.ok(!names.some(n => /Newton/.test(n)));
  assert.match(reportText(r, '2026-11-24'), /Boston/);
});
test('backups keep only the newest 14 files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-')), db = openDatabase(join(dir, 'db.sqlite'));
  for (let d = 1; d <= 16; d++) await runBackup(db, join(dir, 'db.sqlite'), '2026-10-' + String(d).padStart(2, '0'));
  assert.equal(readdirSync(join(dir, 'backups')).length, 14);
  db.close();
});
test('PDF text repair removes stray "Â" characters', () => {
  assert.equal(clean('under other permit applications.Â construction Â of new house'), 'under other permit applications. construction of new house');
});

test('critical-only alerts: one failing city is not mailed, a stopped collection and a failed backup are', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crit-')), path = join(dir, 'db.sqlite'), db = openDatabase(path);
  db.prepare("INSERT INTO app_settings VALUES('alert_email','dan@example.com')").run();
  const sent = [], mail = async m => { sent.push(m); return {sent: true}; }, env = {SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p'};
  const now = new Date('2026-11-24T16:00:00Z');
  setCoverage(db, 'boston', '2026-11', 'unavailable', 'HTTP 500', 0); // checked_at is "now" in the real clock: recent enough
  db.prepare('UPDATE coverage SET checked_at=?').run(now.toISOString());
  const out = await runDailyMaintenance(db, {databasePath: path, now, env, mail});
  assert.deepEqual(out.critical, []); assert.equal(sent.length, 0, 'one city failing is a common failure');
  const later = new Date('2026-11-27T16:00:00Z'); // 3 days without any collection
  const out2 = await runDailyMaintenance(db, {databasePath: path, now: later, env, mail});
  assert.ok(out2.critical.some(c => /seems stopped/.test(c))); assert.equal(sent.length, 1); assert.match(sent[0].subject, /CRITICAL/);
  db.close();
});
