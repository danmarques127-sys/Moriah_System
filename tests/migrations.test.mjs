import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';

test('every migration saves its version, and a half-applied migration is repaired on the next start', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'mig-')), 'x.sqlite');
  let db = openDatabase(path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 20);
  db.exec('PRAGMA user_version=16'); db.close(); // simulate the old database: 017 columns exist but the version stayed at 16
  db = openDatabase(path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 20);
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('estimate_requests') WHERE name='prospect_phone'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='ins_materials'").get());
});
