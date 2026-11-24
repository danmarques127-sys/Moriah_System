import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {openDatabase,audit,timestamp,logError} from './db.mjs';
import {bootstrap,workspaceSettings,saveSettings,saveProject,getProject,listProjects,saveEstimate,getEstimate,listEstimates,saveReview,radarData,allSources,findSource,upsertPermits,setCoverage,addSource,createMember} from './service.mjs';
import {checkPassword,hashPassword,newSession,getSession,csrfMatches,cookie,rateLimit,validEmail} from './auth.mjs';
import {calculateEstimate} from './estimator.mjs';
import {enqueue,worker,scheduler} from './jobs.mjs';
import {previousMonth,monthsBetween,validatePermit} from './radar.mjs';
import {parseUploadedFile} from './documents.mjs';
import {checkAllSources} from './source-audit.mjs';
import {partnersOverview,partnersAction} from './partners.mjs';
import {NATIVE_MODES} from './collectors.mjs';
import {runRetentionIfDue,retentionStatus} from './retention.mjs';
import {recordManualImport,manualImportStatus} from './manual.mjs';
const assets={'/':'../public/index.html','/app.mjs':'../public/app.mjs','/style.css':'../public/style.css','/shared/estimator.mjs':'./estimator.mjs'};
const mimes={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
async function body(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'Use application/json.');
 let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>4000000)throw new HttpError(413,'Arquivo excede 4 MB.');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'JSON inválido.');}
}
async function rawBody(req,limit){
 let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new HttpError(413,'Arquivo excede 25 MB.');chunks.push(chunk);}return Buffer.concat(chunks);
}
export async function createApplication(options={}){
 const config={databasePath:process.env.DATABASE_PATH||'data/permit-finder.sqlite',adminEmail:process.env.ADMIN_EMAIL,adminPassword:process.env.ADMIN_PASSWORD,companyName:process.env.COMPANY_NAME,production:process.env.NODE_ENV==='production',appUrl:process.env.APP_URL||'http://localhost:3000',trustProxy:process.env.TRUST_PROXY==='1',...options};
 if(config.testLoginEmail&&(config.production||process.env.NODE_ENV==='production'))throw new Error('Acesso de teste proibido em produção.');
 const origin=new URL(config.appUrl).origin;if(config.production&&!origin.startsWith('https:'))throw new Error('APP_URL deve usar HTTPS em produção.');
 const db=config.db||openDatabase(config.databasePath);await bootstrap(db,config);
 const loginRate=rateLimit(),mutationRate=rateLimit(60000,120),collectRate=rateLimit(60000,5),uploadRate=rateLimit(60000,30);
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 const server=http.createServer(async(req,res)=>{
  const requestId=randomUUID();res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');res.setHeader('X-Request-Id',requestId);
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(config.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try{
   const url=new URL(req.url,config.appUrl),path=url.pathname,mutating=!['GET','HEAD'].includes(req.method);
   if(path==='/health'&&req.method==='GET')return send(res,200,{ok:true,version:'1.0.0'});
   if(assets[path]&&req.method==='GET'){const suffix=path==='/'?'.html':path.endsWith('.css')?'.css':'.mjs';res.writeHead(200,{'Content-Type':mimes[suffix]});return res.end(await readFile(new URL(assets[path],import.meta.url)));}
   if(!path.startsWith('/api/'))throw new HttpError(404,'Página não encontrada.');
   if(mutating){
    const expectedOrigin=new URL(config.appUrl).origin;
    const proxyOrigin=config.testLoginEmail&&!config.production&&config.developmentProxyOrigin;
    const trustedDevelopmentProxy=proxyOrigin&&req.headers.origin===proxyOrigin&&req.headers.host===new URL(proxyOrigin).host&&req.headers['sec-fetch-site']==='same-origin';
    if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==expectedOrigin&&!trustedDevelopmentProxy)throw new HttpError(403,'Origem não autorizada.');
    if(config.production&&!req.headers.origin)throw new HttpError(403,'Origem obrigatória.');
   }
   if(path==='/api/login'&&req.method==='POST'){
    const ip=config.trustProxy?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',').at(-1).trim():req.socket.remoteAddress;
    const b=await body(req);if(!loginRate('ip:'+ip)||!loginRate('email:'+String(b.email).toLowerCase()))throw new HttpError(429,'Muitas tentativas. Aguarde 15 minutos.');
    const loginEmail=config.testLoginEmail&&b.email==='mestre'?config.testLoginEmail:b.email;
    const row=validEmail(loginEmail)?db.prepare('SELECT * FROM users WHERE email=?').get(loginEmail.toLowerCase()):null;
    const valid=await checkPassword(b.password,row?.password_hash);if(!row||!valid)throw new HttpError(401,'E-mail ou senha incorretos.');
    audit(db,row.workspace_id,'Login',row.email,'login');const session=newSession(db,row.id);res.setHeader('Set-Cookie',cookie(session.token,config.production));return send(res,200,{ok:true});
   }
   const user=getSession(db,req);if(!user)throw new HttpError(401,'Entre na sua conta.');
   if(mutating){if(!csrfMatches(req.headers['x-csrf-token'],user.csrf))throw new HttpError(403,'Sessão inválida. Recarregue a página.');if(!mutationRate(user.id))throw new HttpError(429,'Aguarde para continuar.');}
   const owner=()=>{if(user.role!=='owner')throw new HttpError(403,'Acesso reservado ao proprietário do workspace.');};
   const editor=()=>{if(user.role==='viewer')throw new HttpError(403,'Conta com acesso somente à leitura.');};
   const admin=()=>{if(!user.system_admin)throw new HttpError(403,'Acesso reservado ao administrador do sistema.');};
   if(path==='/api/me'&&req.method==='GET')return send(res,200,{user:{id:user.id,email:user.email,role:user.role,systemAdmin:!!user.system_admin},csrf:user.csrf,settings:workspaceSettings(db,user.workspace_id)});
   if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash);res.setHeader('Set-Cookie',cookie('',config.production,0));return send(res,200,{ok:true});}
   if(path==='/api/password'&&req.method==='POST'){const b=await body(req),row=db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);if(!await checkPassword(b.currentPassword,row.password_hash))throw new HttpError(400,'Senha atual incorreta.');const hash=await hashPassword(b.newPassword);db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);res.setHeader('Set-Cookie',cookie('',config.production,0));return send(res,200,{ok:true});}
   if(path==='/api/settings'&&req.method==='PUT'){owner();return send(res,200,{settings:saveSettings(db,user,await body(req))});}
   if(path==='/api/members'&&req.method==='GET'){owner();return send(res,200,{members:db.prepare('SELECT id,email,role FROM users WHERE workspace_id=? ORDER BY email').all(user.workspace_id)});}
   if(path==='/api/members'&&req.method==='POST'){owner();return send(res,201,await createMember(db,user,await body(req)));}
   // Workspace-scoped operational ledgers: no external payment processing or payroll.
   if(path==='/api/finances'&&req.method==='GET'){
    const rows=db.prepare('SELECT id,entry_date AS date,direction,category,description,amount_cents AS amountCents,project_id AS projectId FROM financial_entries WHERE workspace_id=? ORDER BY entry_date DESC,created_at DESC LIMIT 1000').all(user.workspace_id);
    const summary=rows.reduce((a,r)=>{a[r.direction]+=r.amountCents;return a;},{income:0,expense:0});
    return send(res,200,{entries:rows,summary:{incomeCents:summary.income,expenseCents:summary.expense,netCents:summary.income-summary.expense}});
   }
   if(path==='/api/finances'&&req.method==='POST'){
    editor();const b=await body(req),direction=String(b.direction||''),date=String(b.date||''),amount=Number(b.amount);
    if(!['income','expense'].includes(direction)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||!Number.isFinite(amount)||amount<=0||amount>10000000)throw new HttpError(400,'Invalid financial entry.');
    const cents=Math.round(amount*100),category=String(b.category||'Other').trim().slice(0,100),description=String(b.description||'').trim().slice(0,1000);
    if(!category||!description)throw new HttpError(400,'Category and description are required.');
    const id=randomUUID();db.prepare('INSERT INTO financial_entries VALUES(?,?,?,?,?,?,?,?,?)').run(id,user.workspace_id,date,direction,category,description,cents,null,timestamp());
    return send(res,201,{id});
   }
   if(path==='/api/employees'&&req.method==='GET'){
    const employees=db.prepare('SELECT id,name,hourly_cents AS hourlyCents,active FROM employees WHERE workspace_id=? ORDER BY name').all(user.workspace_id);
    const entries=db.prepare('SELECT t.id,t.employee_id AS employeeId,e.name AS employeeName,t.work_date AS date,t.hours_minutes AS minutes,t.hourly_cents AS hourlyCents,t.notes FROM time_entries t JOIN employees e ON e.id=t.employee_id AND e.workspace_id=t.workspace_id WHERE t.workspace_id=? ORDER BY t.work_date DESC,t.created_at DESC LIMIT 1000').all(user.workspace_id);
    return send(res,200,{employees,entries});
   }
   if(path==='/api/employees'&&req.method==='POST'){
    editor();const b=await body(req),name=String(b.name||'').trim(),hourly=Number(b.hourlyRate);
    if(!name||name.length>200||!Number.isFinite(hourly)||hourly<0||hourly>10000)throw new HttpError(400,'Invalid employee details.');
    const id=randomUUID();db.prepare('INSERT INTO employees VALUES(?,?,?,?,?,?)').run(id,user.workspace_id,name,Math.round(hourly*100),1,timestamp());return send(res,201,{id});
   }
   if(path==='/api/time-entries'&&req.method==='POST'){
    editor();const b=await body(req),date=String(b.date||''),hours=Number(b.hours),notes=String(b.notes||'').trim().slice(0,1000);
    const employee=db.prepare('SELECT id,hourly_cents FROM employees WHERE id=? AND workspace_id=? AND active=1').get(b.employeeId,user.workspace_id);
    if(!employee||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||!Number.isFinite(hours)||hours<=0||hours>24)throw new HttpError(400,'Invalid time entry.');
    const minutes=Math.round(hours*60);if(minutes<1)throw new HttpError(400,'Duration is too short.');
    const id=randomUUID();db.prepare('INSERT INTO time_entries VALUES(?,?,?,?,?,?,?,?,?)').run(id,user.workspace_id,employee.id,date,minutes,null,notes,employee.hourly_cents,timestamp());return send(res,201,{id});
   }
   if(path==='/api/projects'&&req.method==='GET')return send(res,200,{projects:listProjects(db,user)});
   if(path==='/api/projects'&&req.method==='POST'){editor();return send(res,201,{project:saveProject(db,user,await body(req))});}
   if(path.startsWith('/api/projects/')&&req.method==='GET'){const project=getProject(db,user,decodeURIComponent(path.slice('/api/projects/'.length)));if(!project)throw new HttpError(404,'Projeto não encontrado.');return send(res,200,{project});}
   if(path==='/api/estimates'&&req.method==='GET')return send(res,200,{estimates:listEstimates(db,user,url.searchParams.get('projectId'))});
   if(path==='/api/estimates'&&req.method==='POST'){editor();return send(res,201,{estimate:saveEstimate(db,user,await body(req))});}
   if(path.startsWith('/api/estimates/')&&req.method==='GET'){const estimate=getEstimate(db,user,decodeURIComponent(path.slice('/api/estimates/'.length)));if(!estimate)throw new HttpError(404,'Orçamento não encontrado.');return send(res,200,{estimate});}
   if(path==='/api/calculate'&&req.method==='POST'){editor();return send(res,200,{result:calculateEstimate((await body(req)).input,workspaceSettings(db,user.workspace_id))});}
   if(path==='/api/radar'&&req.method==='GET'){const query=Object.fromEntries(url.searchParams);query.from||=previousMonth();query.to||=query.from;return send(res,200,radarData(db,user,query));}
   if(path==='/api/reviews'&&req.method==='PUT'){editor();saveReview(db,user,await body(req));return send(res,200,{ok:true});}
   if(path==='/api/sources'&&req.method==='GET')return send(res,200,{sources:allSources(db)});
   if(path==='/api/sources'&&req.method==='POST'){admin();return send(res,201,{source:addSource(db,await body(req))});}
   if(path==='/api/import'&&req.method==='POST'){
    admin();const b=await body(req),source=findSource(db,b.sourceId);if(!Array.isArray(b.records)||b.records.length>1000)throw new Error('Envie até 1.000 permits por lote.');monthsBetween(b.month,b.month);
    if(b.records.some(p=>String(p.issued).slice(0,7)!==b.month))throw new Error('Registros fora do mês declarado.');
    const result=upsertPermits(db,source,b.records);
    const stored=db.prepare('SELECT COUNT(*) AS n FROM permits WHERE source_id=? AND substr(issued,1,7)=?').get(source.id,b.month).n;
    setCoverage(db,source.id,b.month,'partial',String(b.message||'Importação manual; cobertura integral não certificada.'),stored);
    audit(db,user.workspace_id,'Importação: '+source.id+', '+result.added+' novos, '+result.updated+' atualizados',user.email,'import');recordManualImport(db,source.id,b.month,result,user.email);return send(res,200,result);
   }
   if(path==='/api/import-file'&&req.method==='POST'){
    admin();if(!uploadRate(user.id))throw new HttpError(429,'Aguarde para enviar outro arquivo.');
    const source=findSource(db,url.searchParams.get('sourceId')),month=String(url.searchParams.get('month')||''),filename=String(url.searchParams.get('filename')||'arquivo').slice(0,200),confirm=url.searchParams.get('confirm')==='1';
    monthsBetween(month,month);const buffer=await rawBody(req,25000000);if(!buffer.length)throw new HttpError(400,'Arquivo vazio.');
    const parsed=await parseUploadedFile({buffer,source,month}),valid=[],problems=[];
    for(const r of parsed.records){try{validatePermit(r,source);valid.push(r);}catch(e){problems.push(String(e.message).slice(0,200));}}
    const norm=x=>String(x).toLowerCase(),addrs=(parsed.addresses||[]).map(norm).filter(Boolean);
    let cityHint=null;if(addrs.length){const share=name=>addrs.filter(a=>a.includes(norm(name))).length/addrs.length;const mine=share(source.city);if(mine<0.2){const best=allSources(db).filter(x=>x.id!==source.id).map(x=>({id:x.id,city:x.city,state:x.state,share:share(x.city)})).sort((a,b)=>b.share-a.share)[0];if(best&&best.share>=0.5)cityHint={id:best.id,city:best.city,state:best.state};}}
    const monthHint=!valid.length&&parsed.suggestedMonth&&parsed.suggestedMonth!==month?parsed.suggestedMonth:null;
    const summary={cityHint,monthHint,format:parsed.format,rowsRead:parsed.rowsRead,inMonth:valid.length,outsideMonth:parsed.outside,undated:parsed.undated,approx:parsed.approx||0,invalid:problems.length,problems:problems.slice(0,3),range:parsed.range,
     sample:valid.slice(0,15).map(r=>({number:r.number,issued:r.issued,address:r.address,type:r.type,value:r.value,description:r.description.slice(0,160)}))};
    if(!confirm)return send(res,200,{preview:true,...summary});
    if(!valid.length)throw new HttpError(400,'Nenhum permit válido de '+month+' neste arquivo.');
    const result=upsertPermits(db,source,valid);
    const stored=db.prepare('SELECT COUNT(*) AS n FROM permits WHERE source_id=? AND substr(issued,1,7)=?').get(source.id,month).n;
    setCoverage(db,source.id,month,'partial','Importação manual do arquivo "'+filename+'" ('+parsed.format.toUpperCase()+'): '+valid.length+' permits de '+month+'. Completude não certificada.',stored);
    audit(db,user.workspace_id,'Importação de arquivo: '+source.id+' '+month+', '+result.added+' novos, '+result.updated+' atualizados',user.email,'import');recordManualImport(db,source.id,month,result,user.email);
    return send(res,200,{preview:false,...summary,...result});
   }
   if(path==='/api/jobs'&&req.method==='GET')return send(res,200,{jobs:db.prepare('SELECT id,source_id AS sourceId,month,status,message,updated_at AS updatedAt FROM jobs ORDER BY created_at DESC LIMIT 100').all()});
   if(path==='/api/jobs'&&req.method==='POST'){admin();if(!collectRate(user.id))throw new HttpError(429,'Aguarde para iniciar outra coleta.');const b=await body(req);return send(res,202,{queued:enqueue(db,b.sources,b.from,b.to)});}
   if(path==='/api/backup'&&req.method==='GET'){owner();const projects=listProjects(db,user),rows=db.prepare('SELECT id FROM estimates WHERE workspace_id=? ORDER BY created_at').all(user.workspace_id);return send(res,200,{format:'permit-finder-workspace-v1',createdAt:timestamp(),settings:workspaceSettings(db,user.workspace_id),projects,estimates:rows.map(r=>getEstimate(db,user,r.id)),reviews:db.prepare('SELECT project_key AS projectKey,status,notes,contact_date AS contactDate FROM lead_reviews WHERE workspace_id=?').all(user.workspace_id)});}
   // System-administrator portal: accounts, collection health, source-link audit (never exposes password hashes or tokens).
   if(path==='/api/admin/overview'&&req.method==='GET'){admin();
    const users=db.prepare('SELECT u.id,u.email,u.role,u.system_admin AS systemAdmin,u.created_at AS createdAt,w.name AS workspace,(SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.expires_at>?) AS activeSessions FROM users u JOIN workspaces w ON w.id=u.workspace_id ORDER BY u.created_at').all(Date.now()).map(u=>({...u,systemAdmin:!!u.systemAdmin}));
    const sources=allSources(db).map(x=>({id:x.id,city:x.city,state:x.state,mode:x.mode,automatic:NATIVE_MODES.includes(x.mode),reason:x.reason||'',url:x.url}));
    const coverage=db.prepare('SELECT source_id AS sourceId,month,status,message,count,checked_at AS checkedAt FROM coverage ORDER BY month DESC LIMIT 3000').all();
    const checks=db.prepare('SELECT source_id AS sourceId,checked_at AS checkedAt,ok,http_status AS httpStatus,note FROM source_checks').all().map(c=>({...c,ok:!!c.ok}));
    const failedJobs=db.prepare("SELECT source_id AS sourceId,month,message,updated_at AS updatedAt FROM jobs WHERE status='failed' ORDER BY updated_at DESC LIMIT 50").all();
    const errors=db.prepare('SELECT id,created_at AS createdAt,area,source_id AS sourceId,month,message FROM error_log ORDER BY id DESC LIMIT 300').all();
    return send(res,200,{users,sources,coverage,checks,failedJobs,errors,retention:retentionStatus(db),manual:manualImportStatus(db)});}
   if(path==='/api/admin/check-sources'&&req.method==='POST'){admin();if(!collectRate(user.id))throw new HttpError(429,'Aguarde para iniciar outra verificação.');
    const list=allSources(db);checkAllSources(db,list).catch(()=>{});audit(db,user.workspace_id,'admin:check-sources',user.email,'admin');return send(res,202,{started:list.length});}
   if(path==='/api/admin/retry-failed'&&req.method==='POST'){admin();if(!collectRate(user.id))throw new HttpError(429,'Aguarde para iniciar outra coleta.');
    const native=new Set(allSources(db).filter(x=>NATIVE_MODES.includes(x.mode)).map(x=>x.id));
    const rows=db.prepare("SELECT source_id AS id,month FROM coverage WHERE status='unavailable' ORDER BY month DESC LIMIT 60").all().filter(r=>native.has(r.id));
    let queued=0;for(const r of rows)queued+=enqueue(db,[r.id],r.month,r.month);audit(db,user.workspace_id,'admin:retry-failed',user.email,'admin');return send(res,202,{queued});}
   if(path==='/api/admin/partners'&&req.method==='GET'){admin();return send(res,200,partnersOverview(db,allSources(db)));}
   if(path==='/api/admin/partners'&&req.method==='POST'){admin();const b=await body(req);const r=partnersAction(db,allSources(db),user.email,b);return send(res,200,r);}
   if(path==='/api/audit'&&req.method==='GET'){owner();return send(res,200,{events:db.prepare('SELECT event,created_at AS createdAt FROM audit WHERE workspace_id=? ORDER BY id DESC LIMIT 100').all(user.workspace_id)});}
   throw new HttpError(404,'Operação não encontrada.');
  }catch(e){
   const status=e.status||400;if(status>=500)console.error('Request failed',requestId,e.name);
   try{const pathname=new URL(req.url,'http://x').pathname;if(status>=500)logError(db,'server',pathname+': '+e.message);else if(/^\/api\/import/.test(pathname)&&status!==401&&status!==403)logError(db,'import',e.message,{sourceId:String(new URL(req.url,'http://x').searchParams.get('sourceId')||''),month:String(new URL(req.url,'http://x').searchParams.get('month')||'')});}catch{/* ignore */}
   send(res,status,{error:e.message?.includes('UNIQUE')?'Registro já existente.':String(e.message||'Não foi possível concluir a operação.').slice(0,1000)});
  }
 });
 server.requestTimeout=30000;server.headersTimeout=15000;
 let jobTimer,scheduleTimer;
 if(options.startBackground!==false){db.prepare("UPDATE jobs SET status='queued',message='Retomada após reinício' WHERE status='running'").run();const run=worker(db);jobTimer=setInterval(()=>run().catch(e=>console.error('Collector worker error',e.name)),2000);
 if(process.env.ENABLE_SCHEDULER==='1'){const tick=()=>{try{runRetentionIfDue(db,process.env.SCAN_TIMEZONE||'America/New_York');const n=scheduler(db,process.env.SCAN_TIMEZONE||'America/New_York');if(n)checkAllSources(db,allSources(db)).catch(()=>{});}catch(e){console.error('Scheduler error',e.name);}};tick();scheduleTimer=setInterval(tick,60000);}}
 return {server,db,config,async close(){clearInterval(jobTimer);clearInterval(scheduleTimer);await new Promise(r=>server.close(r));db.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const app=await createApplication();app.server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Moriah System listening on port '+(process.env.PORT||3000)));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
