import {request as httpRequest} from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestApplication} from '../scripts/test-server.mjs';
import {createApplication} from '../src/server.mjs';

async function preview(t){
 const app=await createTestApplication({databasePath:':memory:',appUrl:'http://127.0.0.1',startBackground:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port;
 app.config.appUrl=base;t.after(()=>app.close());
 const login=(password='shazam123@',headers={})=>fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify({email:'mestre',password})});
 return {...app,base,login};
}
test('explicit test preview authenticates mestre with ordinary session and CSRF',async t=>{
 const f=await preview(t),res=await f.login();assert.equal(res.status,200);
 const cookie=res.headers.get('set-cookie').split(';')[0];assert.match(res.headers.get('set-cookie'),/HttpOnly/);
 const me=await fetch(f.base+'/api/me',{headers:{Cookie:cookie}});
 assert.equal(me.status,200);const data=await me.json();assert.equal(data.user.role,'owner');assert.equal(data.user.systemAdmin,true);
 const denied=await fetch(f.base+'/api/logout',{method:'POST',headers:{Cookie:cookie,Origin:f.base,'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
 const radar=await fetch(f.base+'/api/radar?from=2026-10&to=2026-10',{headers:{Cookie:cookie}});assert.equal(radar.status,200);
 const html=await (await fetch(f.base+'/app.mjs')).text();assert.match(html,/input\('Email or username','email','','text'/);
});
test('test preview rejects wrong password and foreign origin',async t=>{
 const f=await preview(t);assert.equal((await f.login('incorrect')).status,401);
 assert.equal((await f.login('shazam123@',{Origin:'https://evil.example'})).status,403);
 assert.equal((await f.login('shazam123@',{'Sec-Fetch-Site':'cross-site'})).status,403);
});
async function proxyLogin(f,headers){
 return new Promise((resolve,reject)=>{
  const req=httpRequest(f.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',...headers}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
  req.on('error',reject);req.end(JSON.stringify({email:'mestre',password:'shazam123@'}));
 });
}
test('Codespaces localhost origin rewrite is restricted by Host and fetch metadata',async t=>{
 const f=await preview(t);f.config.developmentProxyOrigin='http://localhost:3000';
 assert.equal(await proxyLogin(f,{Origin:'http://localhost:3000',Host:'localhost:3000','Sec-Fetch-Site':'same-origin'}),200);
 assert.equal(await proxyLogin(f,{Origin:'http://localhost:3000',Host:'localhost:3000','Sec-Fetch-Site':'cross-site'}),403);
 assert.equal((await f.login('shazam123@',{Origin:'http://localhost:3000','Sec-Fetch-Site':'same-origin'})).status,403);
});
test('normal server does not enable the master alias',async t=>{
 const app=await createApplication({databasePath:':memory:',adminEmail:'owner@example.test',adminPassword:'normal-owner-password-123',production:false,appUrl:'http://127.0.0.1',startBackground:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;app.config.appUrl=base;t.after(()=>app.close());
 const res=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'mestre',password:'shazam123@'})});assert.equal(res.status,401);
 assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get('mestre@permit-finder.example').n,0);
});
test('production refuses the preview launcher and master configuration',async()=>{
 await assert.rejects(createTestApplication({production:true}),/proibido em produção/);
 await assert.rejects(createApplication({production:true,testLoginEmail:'mestre@permit-finder.example',appUrl:'https://example.test'}),/proibido em produção/);
});
