import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {openDatabase,audit,timestamp,logError} from './db.mjs';
import {bootstrap,radarData,allSources,findSource,upsertPermits,setCoverage,addSource,createMember,updateMember,removeMember} from './service.mjs';
import {checkPassword,hashPassword,newSession,getSession,csrfMatches,cookie,rateLimit,validEmail} from './auth.mjs';
import {enqueue,worker,scheduler} from './jobs.mjs';
import {previousMonth,monthsBetween,validatePermit} from './radar.mjs';
import {parseUploadedFile} from './documents.mjs';
import {checkAllSources} from './source-audit.mjs';
import {partnersOverview,partnersAction} from './partners.mjs';
import {listLists,listAction,listKeys,permitDetail,saveNote,listFollowups,followupAction,listEstimates,estimateAction} from './business.mjs';
import {listInvoices,invoiceAction,listJobs,jobAction,overview} from './finance.mjs';
import {listCustomers,customerDetail,customerAction} from './crm.mjs';
import {listPrices,pricesAction,calculate} from './pricing.mjs';
import {clockStatus,clockAction,addReport,reportPhoto,timeOverview,setRate} from './timeclock.mjs';
import {getProfile,saveProfile,setFavorite,addVisit,listVisits,photoFor,listTeam,saveTeamMember,teamAction,isOwner,clientLogin,getClientSession,clientCookie,clientPermits,clientCities,recordClientUsage,portalEnabled} from './client-api.mjs';
import {NATIVE_MODES} from './collectors.mjs';
import {runDailyMaintenance,automationStatus,alertEmail} from './maintenance.mjs';
import {mailConfig,deliver} from './mailer.mjs';
import {runRetentionIfDue,retentionStatus,cutoffDate,getSetting} from './retention.mjs';
import {recordManualImport,manualImportStatus} from './manual.mjs';
const assets={'/':'../public/index.html','/app.mjs':'../public/app.mjs','/style.css':'../public/style.css','/client':'../public/client.html','/client.mjs':'../public/client.mjs'};
for(const f of ['logo.png','logo-mark.png','favicon.png','favicon.ico','icon-192.png','apple-touch-icon.png','login-bg.jpg'])assets['/'+f]='../public/'+f;
const mimes={'.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
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
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(self)');
  if(config.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try{
   const url=new URL(req.url,config.appUrl),path=url.pathname,mutating=!['GET','HEAD'].includes(req.method);
   if(path==='/health'&&req.method==='GET')return send(res,200,{ok:true,version:'1.0.0'});
   if(assets[path]&&req.method==='GET'){const suffix=(path==='/'||path==='/client')?'.html':path.slice(path.lastIndexOf('.'));res.writeHead(200,{'Content-Type':mimes[suffix],...(/\.(png|ico|jpg)$/.test(path)?{'Cache-Control':'public, max-age=86400'}:{})});return res.end(await readFile(new URL(assets[path],import.meta.url)));}
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
   // ----- Client channel (separate login/cookie; 404 while the portal is switched off). Never returns municipal links. -----
   if(path.startsWith('/api/client/')){
    if(!portalEnabled(db))throw new HttpError(404,'Operação não encontrada.');
    if(path==='/api/client/login'&&req.method==='POST'){
     const ip=config.trustProxy?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',').at(-1).trim():req.socket.remoteAddress,b=await body(req);
     if(!loginRate('cip:'+ip)||!loginRate('cemail:'+String(b.email).toLowerCase()))throw new HttpError(429,'Muitas tentativas. Aguarde 15 minutos.');
     const token=await clientLogin(db,b.email,b.password);if(!token)throw new HttpError(401,'E-mail ou senha incorretos.');
     audit(db,null,'Login de cliente',String(b.email).toLowerCase(),'client-login');res.setHeader('Set-Cookie',clientCookie(token,config.production));return send(res,200,{ok:true});
    }
    const client=getClientSession(db,req);if(!client)throw new HttpError(401,'Entre na sua conta.');
    if(path==='/api/client/me'&&req.method==='GET'){const pr=getProfile(db,client);return send(res,200,{client:{email:client.email,name:pr.me.name,company:pr.company.name,role:client.role,photo:pr.me.photo,logo:pr.company.logo}});}
    if(path==='/api/client/clock'&&req.method==='GET')return send(res,200,clockStatus(db,client));
    if(path==='/api/client/clock'&&req.method==='POST')return send(res,200,clockAction(db,client,await body(req)));
    if(path==='/api/client/report'&&req.method==='POST'){if(!uploadRate('cr:'+client.id))throw new HttpError(429,'Aguarde para enviar outro relatório.');return send(res,201,addReport(db,client,await body(req)));}
    if(path==='/api/client/report-photo'&&req.method==='GET'){const ph=reportPhoto(db,client,url.searchParams.get('id'));if(!ph)throw new HttpError(404,'Foto não encontrada.');res.writeHead(200,{'Content-Type':ph.mime,'Cache-Control':'private, max-age=3600'});return res.end(ph.data);}
    if(isOwner(client)&&path==='/api/client/overview'&&req.method==='GET')return send(res,200,overview(db,client));
    if(isOwner(client)&&path==='/api/client/invoices'&&req.method==='GET')return send(res,200,listInvoices(db,client));
    if(isOwner(client)&&path==='/api/client/invoices'&&req.method==='POST'){const b=await body(req);if(b.op==='send'||b.op==='receipt'){if(!uploadRate('ci:'+client.id))throw new HttpError(429,'Aguarde para enviar outro e-mail.');}return send(res,200,await invoiceAction(db,client,b));}
    if(isOwner(client)&&path==='/api/client/jobs'&&req.method==='GET')return send(res,200,listJobs(db,client));
    if(isOwner(client)&&path==='/api/client/jobs'&&req.method==='POST')return send(res,200,jobAction(db,client,await body(req)));
    if(isOwner(client)&&path==='/api/client/customers'&&req.method==='GET'){const id=url.searchParams.get('id');return send(res,200,id?customerDetail(db,client,id):listCustomers(db,client,{q:url.searchParams.get('q')||'',status:url.searchParams.get('status')||''}));}
    if(isOwner(client)&&path==='/api/client/customers'&&req.method==='POST')return send(res,200,customerAction(db,client,await body(req),client.name||client.email));
    if(isOwner(client)&&path==='/api/client/prices'&&req.method==='GET')return send(res,200,listPrices(db,client));
    if(isOwner(client)&&path==='/api/client/prices'&&req.method==='POST'){const b=await body(req);return send(res,200,b.op==='calc'?calculate(db,client,b):pricesAction(db,client,b));}
    if(path==='/api/client/time'&&isOwner(client)&&req.method==='GET')return send(res,200,timeOverview(db,client));
    if(path==='/api/client/time'&&isOwner(client)&&req.method==='POST')return send(res,200,setRate(db,client,await body(req)));
    if(client.role==='employee'&&!['/api/client/logout','/api/client/profile'].includes(path))throw new HttpError(403,'Seu perfil de funcionário ainda não tem telas disponíveis.');
    if(path==='/api/client/profile'&&req.method==='GET')return send(res,200,getProfile(db,client));
    if(path==='/api/client/profile'&&req.method==='POST')return send(res,200,await saveProfile(db,client,await body(req),hashPassword));
    if(path==='/api/client/favorite'&&req.method==='POST'){const b=await body(req);return send(res,200,setFavorite(db,client,b.permitKey,!!b.on));}
    if(path==='/api/client/lists'&&req.method==='GET')return send(res,200,listLists(db,client));
    if(path==='/api/client/lists'&&req.method==='POST')return send(res,200,listAction(db,client,await body(req)));
    if(path==='/api/client/list-permits'&&req.method==='GET'){const q=Object.fromEntries(url.searchParams),keys=listKeys(db,client,q.listId);q.keys=keys.length?keys.join(','):'none';delete q.fav;const r=clientPermits(db,client,q,allSources(db));recordClientUsage(db,client,'seen',r.permits.length);return send(res,200,r);}
    if(path==='/api/client/permit'&&req.method==='GET')return send(res,200,permitDetail(db,client,allSources(db),url.searchParams.get('key')));
    if(path==='/api/client/note'&&req.method==='POST')return send(res,200,saveNote(db,client,await body(req)));
    if(path==='/api/client/followups'&&req.method==='GET')return send(res,200,listFollowups(db,client,new Date().toLocaleString('sv-SE',{timeZone:'America/New_York'}).replace(' ','T')));
    if(path==='/api/client/followups'&&req.method==='POST')return send(res,200,followupAction(db,client,await body(req)));
    if(path==='/api/client/estimates'&&req.method==='GET')return send(res,200,listEstimates(db,client));
    if(path==='/api/client/estimates'&&req.method==='POST'){const b=await body(req);b.companyName=client.company;return send(res,200,await estimateAction(db,client,allSources(db),b));}
    if(path==='/api/client/visits'&&req.method==='GET')return send(res,200,{visits:listVisits(db,client,url.searchParams.get('permitKey')||'')});
    if(path==='/api/client/visits'&&req.method==='POST'){if(!uploadRate('cv:'+client.id))throw new HttpError(429,'Aguarde para enviar outra visita.');return send(res,201,addVisit(db,client,allSources(db),await body(req)));}
    if(path==='/api/client/photo'&&req.method==='GET'){const ph=photoFor(db,client,url.searchParams.get('id'));if(!ph)throw new HttpError(404,'Foto não encontrada.');res.writeHead(200,{'Content-Type':ph.mime,'Cache-Control':'private, max-age=3600'});return res.end(ph.data);}
    if(path.startsWith('/api/client/team')){
     if(!isOwner(client))throw new HttpError(403,'Somente o responsável pela empresa gerencia a equipe.');
     if(path==='/api/client/team'&&req.method==='GET')return send(res,200,listTeam(db,client,allSources(db)));
     if(path==='/api/client/team'&&req.method==='POST'){const b=await body(req);if(b.op)return send(res,200,await teamAction(db,client,b,hashPassword));return send(res,200,await saveTeamMember(db,client,allSources(db),b,hashPassword));}
    }
    if(path==='/api/client/logout'&&req.method==='POST'){db.prepare('DELETE FROM client_sessions WHERE token_hash=?').run(client.token_hash);res.setHeader('Set-Cookie',clientCookie('',config.production,0));return send(res,200,{ok:true});}
    if(path==='/api/client/permits'&&req.method==='GET'){const q=Object.fromEntries(url.searchParams),r=clientPermits(db,client,q,allSources(db));recordClientUsage(db,client,q.export==='1'?'exported':'seen',r.permits.length);return send(res,200,r);}
    throw new HttpError(404,'Operação não encontrada.');
   }
   const user=getSession(db,req);if(!user)throw new HttpError(401,'Entre na sua conta.');
   if(mutating){if(!csrfMatches(req.headers['x-csrf-token'],user.csrf))throw new HttpError(403,'Sessão inválida. Recarregue a página.');if(!mutationRate(user.id))throw new HttpError(429,'Aguarde para continuar.');}
   const owner=()=>{if(user.role!=='owner')throw new HttpError(403,'Acesso reservado ao proprietário do workspace.');};
   const editor=()=>{if(user.role==='viewer')throw new HttpError(403,'Conta com acesso somente à leitura.');};
   const admin=()=>{if(!user.system_admin)throw new HttpError(403,'Acesso reservado ao administrador do sistema.');};
   const profileOf=()=>db.prepare('SELECT display_name AS displayName,phone,title,photo FROM user_profiles WHERE user_id=?').get(user.id)||{displayName:'',phone:'',title:'',photo:''};
   if(path==='/api/me'&&req.method==='GET')return send(res,200,{user:{id:user.id,email:user.email,role:user.role,systemAdmin:!!user.system_admin,profile:profileOf()},csrf:user.csrf});
   if(path==='/api/profile'&&req.method==='POST'){const b=await body(req),clean=(v,m)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,m),cur=profileOf();
    const photo=b.photo===undefined?cur.photo:String(b.photo||'');if(photo&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)||photo.length>200000))throw new HttpError(400,'A foto deve ser PNG, JPEG ou WebP de até 150 KB.');
    const phone=clean(b.phone,40);if(phone&&!/^[\d\s().+\-x]+$/i.test(phone))throw new HttpError(400,'Telefone inválido.');
    db.prepare('INSERT INTO user_profiles(user_id,display_name,phone,title,photo,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,phone=excluded.phone,title=excluded.title,photo=excluded.photo,updated_at=excluded.updated_at').run(user.id,clean(b.displayName,80),phone,clean(b.title,80),photo,timestamp());
    audit(db,user.workspace_id,'Perfil atualizado',user.email,'config');return send(res,200,{profile:profileOf()});}
   if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash);res.setHeader('Set-Cookie',cookie('',config.production,0));return send(res,200,{ok:true});}
   if(path==='/api/password'&&req.method==='POST'){const b=await body(req),row=db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);if(!await checkPassword(b.currentPassword,row.password_hash))throw new HttpError(400,'Senha atual incorreta.');const hash=await hashPassword(b.newPassword);db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);res.setHeader('Set-Cookie',cookie('',config.production,0));return send(res,200,{ok:true});}
   if(path==='/api/members'&&req.method==='GET'){owner();return send(res,200,{members:db.prepare('SELECT u.id,u.email,u.role,u.system_admin AS systemAdmin,IFNULL(p.display_name,\'\') AS name FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.workspace_id=? ORDER BY u.email').all(user.workspace_id)});}
   if(path==='/api/members/update'&&req.method==='POST'){owner();return send(res,200,await updateMember(db,user,await body(req)));}
   if(path==='/api/members/remove'&&req.method==='POST'){owner();return send(res,200,removeMember(db,user,await body(req)));}
   if(path==='/api/members'&&req.method==='POST'){owner();return send(res,201,await createMember(db,user,await body(req)));}
   // Workspace-scoped operational ledgers: no external payment processing or payroll.
   if(path==='/api/radar'&&req.method==='GET'){const query=Object.fromEntries(url.searchParams);query.from||=previousMonth();query.to||=query.from;return send(res,200,radarData(db,user,query));}
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
    const toMonth=String(url.searchParams.get('to')||month);monthsBetween(month,toMonth);const buffer=await rawBody(req,25000000);if(!buffer.length)throw new HttpError(400,'Arquivo vazio.');
    const parsed=await parseUploadedFile({buffer,source,month,toMonth}),valid=[],problems=[];
    for(const r of parsed.records){try{validatePermit(r,source);valid.push(r);}catch(e){problems.push(String(e.message).slice(0,200));}}
    const cutoff=cutoffDate(new Date(),Number(getSetting(db,'retention_months'))||12),tooOld=valid.filter(r=>r.issued<cutoff).length;for(let i=valid.length-1;i>=0;i--)if(valid[i].issued<cutoff)valid.splice(i,1);
    const norm=x=>String(x).toLowerCase(),addrs=(parsed.addresses||[]).map(norm).filter(Boolean);
    let cityHint=null;if(addrs.length){const share=name=>addrs.filter(a=>a.includes(norm(name))).length/addrs.length;const mine=share(source.city);if(mine<0.2){const best=allSources(db).filter(x=>x.id!==source.id).map(x=>({id:x.id,city:x.city,state:x.state,share:share(x.city)})).sort((a,b)=>b.share-a.share)[0];if(best&&best.share>=0.5)cityHint={id:best.id,city:best.city,state:best.state};}}
    const multi=toMonth>month,monthHint=!multi&&parsed.suggestedMonth&&parsed.suggestedMonth!==month&&parsed.outside>valid.length?parsed.suggestedMonth:null,byMonth={};for(const r of valid)byMonth[r.issued.slice(0,7)]=(byMonth[r.issued.slice(0,7)]||0)+1;
    const summary={cityHint,monthHint,toMonth,months:byMonth,fileFrom:parsed.fileFrom,fileTo:parsed.fileTo,tooOld,retentionCutoff:cutoff,format:parsed.format,rowsRead:parsed.rowsRead,inMonth:valid.length,outsideMonth:parsed.outside,undated:parsed.undated,approx:parsed.approx||0,invalid:problems.length,problems:problems.slice(0,3),range:parsed.range,
     sample:valid.slice(0,15).map(r=>({number:r.number,issued:r.issued,address:r.address,type:r.type,value:r.value,description:r.description.slice(0,160)}))};
    if(!confirm)return send(res,200,{preview:true,...summary});
    if(!valid.length)throw new HttpError(400,'Nenhum permit válido de '+month+(toMonth>month?' a '+toMonth:'')+' neste arquivo.');
    const result={added:0,updated:0};
    for(const m of Object.keys(byMonth).sort()){const part=valid.filter(r=>r.issued.slice(0,7)===m),r=upsertPermits(db,source,part);result.added+=r.added;result.updated+=r.updated;
     const stored=db.prepare('SELECT COUNT(*) AS n FROM permits WHERE source_id=? AND substr(issued,1,7)=?').get(source.id,m).n;
     setCoverage(db,source.id,m,'partial','Importação manual do arquivo "'+filename+'" ('+parsed.format.toUpperCase()+'): '+part.length+' permits de '+m+'. Completude não certificada.',stored);recordManualImport(db,source.id,m,r,user.email);}
    audit(db,user.workspace_id,'Importação de arquivo: '+source.id+' '+month+(toMonth>month?' a '+toMonth:'')+', '+result.added+' novos, '+result.updated+' atualizados',user.email,'import');
    return send(res,200,{preview:false,...summary,...result});
   }
   if(path==='/api/jobs'&&req.method==='GET')return send(res,200,{jobs:db.prepare('SELECT id,source_id AS sourceId,month,status,message,updated_at AS updatedAt FROM jobs ORDER BY created_at DESC LIMIT 100').all()});
   if(path==='/api/jobs'&&req.method==='POST'){admin();if(!collectRate(user.id))throw new HttpError(429,'Aguarde para iniciar outra coleta.');const b=await body(req);return send(res,202,{queued:enqueue(db,b.sources,b.from,b.to)});}
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
   if(path==='/api/admin/partners'&&req.method==='GET'){admin();return send(res,200,{...partnersOverview(db,allSources(db)),automation:automationStatus(db)});}
   if(path==='/api/admin/partners'&&req.method==='POST'){admin();const b=await body(req);
    if(b.op==='testEmail'){const to=alertEmail(db);if(!to)throw new HttpError(400,'Salve um e-mail de alerta primeiro.');const r=await deliver({to,subject:'Moriah System: test e-mail',text:'This is a test message from Moriah System. If you can read it, alerts will reach you.'},mailConfig());audit(db,null,'E-mail de teste '+(r.sent?'enviado':'falhou')+' para '+to,user.email,'config');return send(res,200,r);}
    if(b.op==='setClientPassword'){const row=db.prepare('SELECT email FROM client_accounts WHERE id=?').get(Number(b.id));if(!row)throw new HttpError(400,'Conta não encontrada.');
     db.prepare('UPDATE client_accounts SET password_hash=? WHERE id=?').run(await hashPassword(b.password),Number(b.id));db.prepare('DELETE FROM client_sessions WHERE client_id=?').run(Number(b.id));
     audit(db,null,'Senha de cliente definida: '+row.email,user.email,'config');return send(res,200,{});}
    const r=partnersAction(db,allSources(db),user.email,b);return send(res,200,r);}
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
 if(process.env.ENABLE_SCHEDULER==='1'){const tick=()=>{try{runRetentionIfDue(db,process.env.SCAN_TIMEZONE||'America/New_York');const n=scheduler(db,process.env.SCAN_TIMEZONE||'America/New_York');runDailyMaintenance(db,{databasePath:config.databasePath,timezone:process.env.SCAN_TIMEZONE||'America/New_York'}).catch(e=>console.error('Maintenance error',e.name));if(n)checkAllSources(db,allSources(db)).catch(()=>{});}catch(e){console.error('Scheduler error',e.name);}};tick();scheduleTimer=setInterval(tick,60000);}}
 return {server,db,config,async close(){clearInterval(jobTimer);clearInterval(scheduleTimer);await new Promise(r=>server.close(r));db.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const app=await createApplication();app.server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Moriah System listening on port '+(process.env.PORT||3000)));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
