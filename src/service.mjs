import {randomUUID} from 'node:crypto';
import {settingsFrom,DEFAULT_SETTINGS,calculateEstimate} from './estimator.mjs';
import {hashPassword,validEmail} from './auth.mjs';
import {transaction,timestamp,audit} from './db.mjs';
import {SOURCES} from './sources.mjs';
import {validatePermit,projectKey,monthsBetween,groupProjects,diversify} from './radar.mjs';
export function allSources(db){return [...SOURCES,...db.prepare('SELECT data FROM custom_sources ORDER BY id').all().map(r=>JSON.parse(r.data)).filter(s=>!SOURCES.some(x=>x.id===s.id))];}
export function findSource(db,id){const s=allSources(db).find(x=>x.id===id);if(!s)throw new Error('Cidade não cadastrada.');return s;}
export async function bootstrap(db,config){
 if(db.prepare('SELECT COUNT(*) AS n FROM users').get().n)return;
 if(!validEmail(config.adminEmail))throw new Error('Defina ADMIN_EMAIL antes do primeiro início.');
 const hash=await hashPassword(config.adminPassword),wid=randomUUID(),uid=randomUUID(),settings=structuredClone(DEFAULT_SETTINGS);settings.company.name=config.companyName||settings.company.name;
 transaction(db,()=>{db.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run(wid,settings.company.name,JSON.stringify(settings),timestamp());db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(uid,wid,config.adminEmail.toLowerCase(),hash,'owner',1,timestamp());});
}
export function workspaceSettings(db,wid){const row=db.prepare('SELECT settings FROM workspaces WHERE id=?').get(wid);if(!row)throw new Error('Workspace ausente.');return JSON.parse(row.settings);}
export function saveSettings(db,user,raw){const settings=settingsFrom(raw);db.prepare('UPDATE workspaces SET name=?,settings=? WHERE id=?').run(settings.company.name,JSON.stringify(settings),user.workspace_id);audit(db,user.workspace_id,'Configurações atualizadas');return settings;}
const text=(v,max=1000)=>{if(typeof v!=='string'||v.length>max)throw new Error('Texto inválido.');return v.trim();};
export function saveProject(db,user,raw){
 const data={};for(const key of ['name','client','email','phone','address','billingAddress','salesperson','notes','sourceProjectKey'])data[key]=text(String(raw[key]??''),key==='notes'?10000:1000);
 if(!data.name||!data.address)throw new Error('Informe nome e endereço do projeto.');if(data.email&&!validEmail(data.email))throw new Error('E-mail inválido.');
 const id=raw.id||randomUUID(),old=db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=?').get(id,user.workspace_id);
 if(raw.id&&!old)throw new Error('Projeto não encontrado.');
 if(old)db.prepare('UPDATE projects SET name=?,data=?,updated_at=? WHERE id=? AND workspace_id=?').run(data.name,JSON.stringify(data),timestamp(),id,user.workspace_id);
 else db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?)').run(id,user.workspace_id,data.name,JSON.stringify(data),timestamp(),timestamp());
 audit(db,user.workspace_id,'Projeto salvo');return {id,...data};
}
export function getProject(db,user,id){const row=db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=?').get(id,user.workspace_id);return row?{id:row.id,...JSON.parse(row.data),updatedAt:row.updated_at}:null;}
export function listProjects(db,user){return db.prepare('SELECT id,data,updated_at FROM projects WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 2000').all(user.workspace_id).map(r=>({id:r.id,...JSON.parse(r.data),updatedAt:r.updated_at}));}
export function saveEstimate(db,user,raw){
 const project=getProject(db,user,raw.projectId);if(!project)throw new Error('Projeto não encontrado.');
 const title=text(String(raw.title||'Estimate'),200),settings=workspaceSettings(db,user.workspace_id),result=calculateEstimate(raw.input,settings);
 const id=randomUUID();db.prepare('INSERT INTO estimates VALUES(?,?,?,?,?,?,?,?)').run(id,user.workspace_id,project.id,title,JSON.stringify(raw.input),JSON.stringify(result),JSON.stringify({company:settings.company,project}),timestamp());
 audit(db,user.workspace_id,'Orçamento salvo');return {id,projectId:project.id,title,input:raw.input,result,company:settings.company,project,createdAt:timestamp()};
}
export function getEstimate(db,user,id){const r=db.prepare('SELECT * FROM estimates WHERE id=? AND workspace_id=?').get(id,user.workspace_id);if(!r)return null;return {id:r.id,projectId:r.project_id,title:r.title,input:JSON.parse(r.input),result:JSON.parse(r.result),...JSON.parse(r.company),createdAt:r.created_at};}
export function listEstimates(db,user,projectId){return db.prepare('SELECT id,project_id,title,result,created_at FROM estimates WHERE workspace_id=? AND (?=\'\' OR project_id=?) ORDER BY created_at DESC LIMIT 1000').all(user.workspace_id,projectId||'',projectId||'').map(r=>({id:r.id,projectId:r.project_id,title:r.title,total:JSON.parse(r.result).total,createdAt:r.created_at}));}
export function saveReview(db,user,raw){
 if(!['Novo','Analisar','Contatado','Orçamento enviado','Ganho','Perdido','Descartado'].includes(raw.status))throw new Error('Status inválido.');
 const key=text(String(raw.projectKey||''),1000),notes=text(String(raw.notes||''),15000),contactDate=text(String(raw.contactDate||''),10);
 if(contactDate&&!/^\d{4}-\d{2}-\d{2}$/.test(contactDate))throw new Error('Data de contato inválida.');
 if(!db.prepare('SELECT id FROM permits WHERE project_key=? LIMIT 1').get(key))throw new Error('Obra não encontrada.');
 db.prepare('INSERT INTO lead_reviews VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,project_key) DO UPDATE SET status=excluded.status,notes=excluded.notes,contact_date=excluded.contact_date,updated_at=excluded.updated_at').run(user.workspace_id,key,raw.status,notes,contactDate,timestamp());
}
export function upsertPermits(db,source,rawRecords){
 if(!Array.isArray(rawRecords)||rawRecords.length>20000)throw new Error('Lote inválido.');const records=rawRecords.map(p=>validatePermit(p,source));let added=0,updated=0;
 transaction(db,()=>{const select=db.prepare('SELECT data FROM permits WHERE id=?'),insert=db.prepare('INSERT INTO permits VALUES(?,?,?,?,?,?,?)'),update=db.prepare('UPDATE permits SET issued=?,project_key=?,data=?,updated_at=? WHERE id=?');
 for(const p of records){const old=select.get(p.id);if(old){const previous=JSON.parse(old.data);for(const key of ['phone','email','contactUrl','inspection'])if(!p[key]&&previous[key])p[key]=previous[key];}
 const data=JSON.stringify(p),now=timestamp();if(!old){insert.run(p.id,source.id,p.issued,projectKey(p),data,now,now);added++;}else if(old.data!==data){update.run(p.issued,projectKey(p),data,now,p.id);updated++;}}
 });return {added,updated,count:records.length};
}
export function setCoverage(db,id,month,status,message,count){db.prepare('INSERT INTO coverage VALUES(?,?,?,?,?,?) ON CONFLICT(source_id,month) DO UPDATE SET status=excluded.status,message=excluded.message,count=excluded.count,checked_at=excluded.checked_at').run(id,month,status,String(message).slice(0,8000),count,timestamp());}
export function radarData(db,user,query){
 const from=query.from,to=query.to,months=monthsBetween(from,to),ids=String(query.cities||'').split(',').filter(Boolean);
 if(ids.length>80)throw new Error('Selecione até 80 cidades ou deixe Todas.');for(const id of ids)findSource(db,id);
 const includeArchived=query.includeArchived==='1';const archivalCutoff=new Date();archivalCutoff.setUTCMonth(archivalCutoff.getUTCMonth()-12);const cutoff=archivalCutoff.toISOString().slice(0,10);const params=[from+'-01',monthsBetween(to,to)[0]+'-31'];let where='issued>=? AND issued<=?';if(!includeArchived){where+=' AND issued>=?';params.push(cutoff);}
 if(query.state&&query.state!=='Todos'){if(!['MA','CT','RI'].includes(query.state))throw new Error('Estado inválido.');const stateIds=allSources(db).filter(s=>s.state===query.state).map(s=>s.id);where+=' AND source_id IN ('+stateIds.map(()=>'?').join(',')+')';params.push(...stateIds);}
 if(ids.length){where+=' AND source_id IN ('+ids.map(()=>'?').join(',')+')';params.push(...ids);}
 const rows=db.prepare('SELECT data FROM permits WHERE '+where+' ORDER BY issued DESC,id LIMIT 30001').all(...params),truncated=rows.length>30000;
 const records=rows.slice(0,30000).map(r=>JSON.parse(r.data));const reviews=db.prepare('SELECT project_key AS projectKey,status,notes,contact_date AS contactDate FROM lead_reviews WHERE workspace_id=?').all(user.workspace_id);
 let projects=groupProjects(records,reviews);if(query.mode!=='all')projects=projects.filter(p=>p.qualified);if(query.kind&&query.kind!=='All')projects=projects.filter(p=>p.kind===query.kind);if(query.tier&&query.tier!=='All')projects=projects.filter(p=>p.tier===query.tier);if(query.status&&query.status!=='All')projects=projects.filter(p=>p.review.status===query.status);
 if(query.q){const q=String(query.q).toLowerCase();projects=projects.filter(p=>[p.master.address,p.master.city,...p.records.map(r=>r.description+' '+r.number+' '+r.contractor)].join(' ').toLowerCase().includes(q));}
 if(query.order!=='score')projects=diversify(projects);
 const total=projects.length,page=Math.max(1,Math.floor(Number(query.page)||1)),offset=(page-1)*50;
 const coverage=db.prepare('SELECT source_id AS sourceId,month,status,message,count,checked_at AS checkedAt FROM coverage WHERE month>=? AND month<=?').all(from,to);
 const cityCounts=db.prepare('SELECT source_id AS sourceId,COUNT(*) AS count FROM permits WHERE issued>=? AND issued<=? GROUP BY source_id').all(from+'-01',to+'-31');
 return {from,to,months,sources:allSources(db),coverage,cityCounts,total,page,pages:Math.max(1,Math.ceil(total/50)),projects:query.export==='1'?projects:projects.slice(offset,offset+50),truncated,recordsLoaded:records.length,qualified:projects.length};
}
export function addSource(db,raw){
 const id=text(String(raw.id||''),60),city=text(String(raw.city||''),80),state=raw.state,url=new URL(raw.url);
 if(!/^[a-z0-9-]+$/.test(id)||!city||!['MA','CT','RI'].includes(state)||url.protocol!=='https:'||url.port||url.username||url.password||!/\.(gov|us|org)$/.test(url.hostname))throw new Error('Use cidade/estado e página municipal oficial HTTPS.');
 if(allSources(db).some(s=>s.id===id||s.city.toLowerCase()===city.toLowerCase()&&s.state===state))throw new Error('Cidade já cadastrada.');
 const source={id,city,state,url:url.href,mode:'report',allowedHosts:[]};db.prepare('INSERT INTO custom_sources VALUES(?,?)').run(id,JSON.stringify(source));return source;
}
export async function createMember(db,user,raw){
 if(!validEmail(raw.email)||!['owner','estimator','viewer'].includes(raw.role))throw new Error('E-mail ou papel inválido.');
 const hash=await hashPassword(raw.password),id=randomUUID();db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(id,user.workspace_id,raw.email.toLowerCase(),hash,raw.role,0,timestamp());return {id,email:raw.email,role:raw.role};
}
