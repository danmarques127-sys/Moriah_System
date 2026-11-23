import {test} from 'node:test';
import assert from 'node:assert/strict';
import {worker} from '../src/jobs.mjs';

test('pending municipal collection preserves historical permits and shows pending status', async () => {
 const job={id:'job-1',source_id:'newton',month:'2026-10',status:'queued'};
 const calls=[];
 const db={prepare(sql){return {
  get(){if(sql.startsWith("SELECT * FROM jobs"))return job.status==='queued'?{...job}:undefined;
   if(sql.startsWith("SELECT COUNT(*) AS n FROM permits"))return {n:3};
   throw new Error('Unexpected get: '+sql);},
  all(){if(sql.startsWith('SELECT data FROM custom_sources'))return [];
   throw new Error('Unexpected all: '+sql);},
  run(...args){calls.push({sql,args});
   if(sql.startsWith("UPDATE jobs SET status='running'"))job.status='running';
   if(sql.startsWith('UPDATE jobs SET status=?'))job.status=args[0];
   return {};}
 };}};
 await worker(db)();
 assert.equal(job.status,'pending');
 const coverage=calls.find(c=>c.sql.startsWith('INSERT INTO coverage'));
 assert.ok(coverage);
 assert.equal(coverage.args[2],'pending');
 assert.equal(coverage.args[4],3);
 const completion=calls.find(c=>c.sql.startsWith('UPDATE jobs SET status=?'));
 assert.match(completion.args[1],/3 registros históricos preservados/);
});
