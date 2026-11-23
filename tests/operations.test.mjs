import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../src/server.mjs';

test('workspace financial and employee records persist via authenticated APIs',async t=>{
 const app=await createApplication({databasePath:':memory:',adminEmail:'owner@example.test',adminPassword:'long-test-password-123',appUrl:'http://127.0.0.1',startBackground:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 app.config.appUrl=base;t.after(()=>app.close());
 const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'long-test-password-123'})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 const me=await(await fetch(base+'/api/me',{headers:{Cookie:cookie}})).json();
 const get=async url=>{const r=await fetch(base+url,{headers:{Cookie:cookie}});assert.equal(r.status,200);return r.json();};
 const post=async(url,body)=>fetch(base+url,{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify(body)});
 assert.equal((await post('/api/finances',{date:'2026-11-23',direction:'income',category:'Painting',description:'Invoice paid',amount:1250.75})).status,201);
 assert.equal((await post('/api/finances',{date:'2026-11-23',direction:'expense',category:'Materials',description:'Paint purchase',amount:150.25})).status,201);
 const cash=await get('/api/finances');assert.equal(cash.summary.incomeCents,125075);assert.equal(cash.summary.netCents,110050);
 const employee=await post('/api/employees',{name:'Test Employee',hourlyRate:30});assert.equal(employee.status,201);
 const {id}=await employee.json();
 assert.equal((await post('/api/time-entries',{employeeId:id,date:'2026-11-23',hours:7.5,notes:'Site work'})).status,201);
 const staff=await get('/api/employees');assert.equal(staff.entries[0].minutes,450);assert.equal(staff.entries[0].hourlyCents,3000);
 assert.equal((await post('/api/time-entries',{employeeId:'different-workspace',date:'2026-11-23',hours:1})).status,400);
});
