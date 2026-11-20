import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {openDatabase,audit,timestamp} from './db.mjs';
import {bootstrap,workspaceSettings,saveSettings,saveProject,getProject,listProjects,saveEstimate,getEstimate,listEstimates,saveReview,radarData,allSources,findSource,upsertPermits,setCoverage,addSource,createMember} from './service.mjs';
import {checkPassword,hashPassword,newSession,getSession,csrfMatches,cookie,rateLimit,validEmail} from './auth.mjs';
import {calculateEstimate} from './estimator.mjs';
import {enqueue,worker,scheduler} from './jobs.mjs';
import {previousMonth,monthsBetween} from './radar.mjs';
const assets={'/':'../public/index.html','/app.mjs':'../public/app.mjs','/style.css':'../public/style.css','/shared/estimator.mjs':'./estimator.mjs'};
const mimes={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
async function body(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'Use application/json.');
 let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>4000000)throw new HttpError(413,'Arquivo excede 4 MB.');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'JSON inválido.');}
}
export async function createApplication(options={}){
 const config={databasePath:process.env.DATABASE_PATH||'data/permit-finder.sqlite',adminEmail:process.env.ADMIN_EMAIL,adminPassword:process.env.ADMIN_PASSWORD,companyName:process.env.COMPANY_NAME,production:process.env.NODE_ENV==='production',appUrl:process.env.APP_URL||'http://localhost:3000',trustProxy:process.env.TRUST_PROXY==='1',...options};
 if(config.testLoginEmail&&(config.production||process.env.NODE_ENV==='production'))throw new Error('Acesso de teste proibido em produção.');
 const origin=new URL(config.appUrl).origin;if(config.production&&!origin.startsWith('https:'))throw new Error('APP_URL deve usar HTTPS em produção.');
 const db=config.db||openDatabase(config.databasePath);await bootstrap(db,config);
 const loginRate=rateLimit(),mutationRate=rateLimit(60000,120),collectRate=rateLimit(60000,5);
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
    const session=newSession(db,row.id);res.setHeader('Set-Cookie',cookie(session.token,config.production));return send(res,200,{ok:true});
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
    audit(db,user.workspace_id,'Importação: '+source.id+', '+result.added+' novos, '+result.updated+' atualizados');return send(res,200,result);
   }
   if(path==='/api/jobs'&&req.method==='GET')return send(res,200,{jobs:db.prepare('SELECT id,source_id AS sourceId,month,status,message,updated_at AS updatedAt FROM jobs ORDER BY created_at DESC LIMIT 100').all()});
   if(path==='/api/jobs'&&req.method==='POST'){admin();if(!collectRate(user.id))throw new HttpError(429,'Aguarde para iniciar outra coleta.');const b=await body(req);return send(res,202,{queued:enqueue(db,b.sources,b.from,b.to)});}
   if(path==='/api/backup'&&req.method==='GET'){owner();const projects=listProjects(db,user),rows=db.prepare('SELECT id FROM estimates WHERE workspace_id=? ORDER BY created_at').all(user.workspace_id);return send(res,200,{format:'permit-finder-workspace-v1',createdAt:timestamp(),settings:workspaceSettings(db,user.workspace_id),projects,estimates:rows.map(r=>getEstimate(db,user,r.id)),reviews:db.prepare('SELECT project_key AS projectKey,status,notes,contact_date AS contactDate FROM lead_reviews WHERE workspace_id=?').all(user.workspace_id)});}
   if(path==='/api/audit'&&req.method==='GET'){owner();return send(res,200,{events:db.prepare('SELECT event,created_at AS createdAt FROM audit WHERE workspace_id=? ORDER BY id DESC LIMIT 100').all(user.workspace_id)});}
   throw new HttpError(404,'Operação não encontrada.');
  }catch(e){
   const status=e.status||400;if(status>=500)console.error('Request failed',requestId,e.name);
   send(res,status,{error:e.message?.includes('UNIQUE')?'Registro já existente.':String(e.message||'Não foi possível concluir a operação.').slice(0,1000)});
  }
 });
 server.requestTimeout=30000;server.headersTimeout=15000;
 let jobTimer,scheduleTimer;
 if(options.startBackground!==false){db.prepare("UPDATE jobs SET status='queued',message='Retomada após reinício' WHERE status='running'").run();const run=worker(db);jobTimer=setInterval(()=>run().catch(e=>console.error('Collector worker error',e.name)),2000);
 if(process.env.ENABLE_SCHEDULER==='1'){const tick=()=>{try{scheduler(db,process.env.SCAN_TIMEZONE||'America/New_York');}catch(e){console.error('Scheduler error',e.name);}};tick();scheduleTimer=setInterval(tick,60000);}}
 return {server,db,config,async close(){clearInterval(jobTimer);clearInterval(scheduleTimer);await new Promise(r=>server.close(r));db.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const app=await createApplication();app.server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Permit Finder listening on port '+(process.env.PORT||3000)));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
