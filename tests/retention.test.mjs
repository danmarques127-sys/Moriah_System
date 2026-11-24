import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {purgeOldPermits, runRetentionIfDue, retentionStatus, setSetting, cutoffDate} from '../src/retention.mjs';

const now = new Date('2026-11-23T15:00:00Z');
function seed(db, rows) {
  const ins = db.prepare('INSERT INTO permits VALUES(?,?,?,?,?,?,?)');
  // first_seen/updated_at are RECENT for every row: only the issue date may decide the deletion
  for (const [id, issued] of rows) ins.run(id, 'boston', issued, 'k' + id, '{}', '2026-11-22T00:00:00Z', '2026-11-22T00:00:00Z');
}

test('a permit issued 13 months ago is deleted and one issued 11 months ago stays', () => {
  const db = openDatabase(':memory:');
  seed(db, [['old13', '2025-10-20'], ['new11', '2025-12-20'], ['today', '2026-11-20']]);
  const r = purgeOldPermits(db, now);
  assert.equal(r.deleted, 1); assert.equal(r.cutoff, '2025-11-23');
  assert.deepEqual(db.prepare('SELECT id FROM permits ORDER BY id').all().map(x => x.id), ['new11', 'today']);
  db.close();
});

test('the boundary day is kept and the cutoff follows the setting', () => {
  assert.equal(cutoffDate(now, 12), '2025-11-23');
  const db = openDatabase(':memory:');
  seed(db, [['edge', '2025-11-23'], ['before', '2025-11-22']]);
  assert.equal(purgeOldPermits(db, now).deleted, 1);
  setSetting(db, 'retention_months', 6);
  seed(db, [['m7', '2026-04-01']]);
  assert.equal(purgeOldPermits(db, now).deleted, 2); // 'edge' (Nov 2025) and 'm7' are older than 6 months
  db.close();
});

test('runs are logged, run once per day, and never before 8am', () => {
  const db = openDatabase(':memory:');
  seed(db, [['old', '2024-01-01']]);
  assert.equal(runRetentionIfDue(db, 'America/New_York', new Date('2026-11-23T10:00:00Z')), null); // 5am New York
  assert.equal(runRetentionIfDue(db, 'America/New_York', now).deleted, 1);
  assert.equal(runRetentionIfDue(db, 'America/New_York', now), null);
  const st = retentionStatus(db);
  assert.equal(st.totalDeleted, 1); assert.equal(st.last.deleted, 1); assert.equal(st.months, 12);
  db.close();
});
