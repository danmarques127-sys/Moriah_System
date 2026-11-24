import {randomUUID} from 'node:crypto';
import {hashPassword,validEmail} from './auth.mjs';
import {transaction,timestamp,audit} from './db.mjs';
import {SOURCES} from './sources.mjs';
import {validatePermit,projectKey,monthsBetween,groupProjects,diversify} from './radar.mjs';
export function allSources(db){return [...SOURCES,...db.prepare('SELECT data FROM custom_sources ORDER BY id').all().map(r=>JSON.parse(r.data)).filter(s=>!SOURCES.some(x=>x.id===s.id))];}
export function findSource(db,id){const s=allSources(db).find(x=>x.id===id);if(!s)throw new Error('Cidade não cadastrada.');return s;}
export async function bootstrap(db,config){
 if(db.prepare('SELECT COUNT(*) AS n FROM users').get().n)return;
 if(!validEmail(config.adminEmail))throw new Error('Defina ADMIN_EMAIL antes do primeiro início.');
 const hash=await hashPassword(config.adminPassword),wid=randomUUID(),uid=randomUUID(),name=config.companyName||'Moriah System';
 transaction(db,()=>{db.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run(wid,name,'{}',timestamp());db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(uid,wid,config.adminEmail.toLowerCase(),hash,'owner',1,timestamp());});
}
const text=(v,max=1000)=>{if(typeof v!=='string'||v.length>max)throw new Error('Texto inválido.');return v.trim();};
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
 let projects=groupProjects(records,reviews);if(!includeArchived)projects=projects.filter(p=>!p.records.every(r=>/^(closed|finaled|completed|complete|cancelled|canceled|void|expired)$/i.test(String(r.status||'').trim())));if(query.mode!=='all')projects=projects.filter(p=>p.qualified);if(query.tier&&query.tier!=='All')projects=projects.filter(p=>p.tier===query.tier);if(query.status&&query.status!=='All')projects=projects.filter(p=>p.review.status===query.status);
 if(query.q){const q=String(query.q).toLowerCase();projects=projects.filter(p=>[p.master.address,p.master.city,...p.records.map(r=>r.description+' '+r.number+' '+r.contractor)].join(' ').toLowerCase().includes(q));}
 const kinds={};for(const p of projects)kinds[p.kind]=(kinds[p.kind]||0)+1;
 const weekMap={};for(const p of projects){const d=new Date((p.master.issued||'')+'T00:00:00Z');if(isNaN(d))continue;d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));const k=d.toISOString().slice(0,10);weekMap[k]=(weekMap[k]||0)+1;}
 const weeks=Object.entries(weekMap).sort().slice(-16).map(([week,count])=>({week,count}));const declaredValue=projects.reduce((a,p)=>a+(Number(p.value)||0),0);
 if(query.kind&&query.kind!=='All')projects=projects.filter(p=>p.kind===query.kind);
 if(query.order==='recent')projects.sort((a,b)=>b.master.issued.localeCompare(a.master.issued));else if(query.order!=='score')projects=diversify(projects);
 const total=projects.length,page=Math.max(1,Math.floor(Number(query.page)||1)),offset=(page-1)*50;
 const coverage=db.prepare('SELECT source_id AS sourceId,month,status,message,count,checked_at AS checkedAt FROM coverage WHERE month>=? AND month<=?').all(from,to);
 const cityCounts=db.prepare('SELECT source_id AS sourceId,COUNT(*) AS count FROM permits WHERE issued>=? AND issued<=? GROUP BY source_id').all(from+'-01',to+'-31');
 return {from,to,months,sources:allSources(db),coverage,cityCounts,total,page,pages:Math.max(1,Math.ceil(total/50)),projects:query.export==='1'?projects:projects.slice(offset,offset+50),truncated,recordsLoaded:records.length,qualified:projects.length,kinds,weeks,declaredValue};
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

// Workspace user management (owner only). The workspace owner account (system administrator) and the acting user are protected.
function memberRow(db, user, id) {
  const row = db.prepare('SELECT id,email,role,system_admin AS systemAdmin FROM users WHERE id=? AND workspace_id=?').get(String(id), user.workspace_id);
  if (!row) throw new Error('Usuário não encontrado.');
  return row;
}
export async function updateMember(db, user, raw) {
  const row = memberRow(db, user, raw.id);
  if (raw.role !== undefined) {
    if (!['owner', 'viewer'].includes(raw.role)) throw new Error('Papel inválido.');
    if (raw.role !== row.role) {
      if (row.id === user.id) throw new Error('Você não pode alterar o seu próprio papel.');
      if (row.systemAdmin) throw new Error('O proprietário do workspace não pode ser rebaixado.');
      db.prepare('UPDATE users SET role=? WHERE id=?').run(raw.role, row.id);
      audit(db, user.workspace_id, 'Papel de ' + row.email + ' alterado para ' + raw.role, user.email, 'config');
    }
  }
  if (raw.password !== undefined && raw.password !== '') {
    if (row.systemAdmin && row.id !== user.id) throw new Error('A senha do proprietário só pode ser alterada por ele mesmo (Profile).');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(raw.password), row.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
    audit(db, user.workspace_id, 'Senha redefinida para ' + row.email, user.email, 'config');
  }
  return {ok: true};
}
export function removeMember(db, user, raw) {
  const row = memberRow(db, user, raw.id);
  if (row.id === user.id) throw new Error('Você não pode remover a si mesmo.');
  if (row.systemAdmin) throw new Error('O proprietário do workspace não pode ser removido.');
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
  db.prepare('DELETE FROM users WHERE id=?').run(row.id);
  audit(db, user.workspace_id, 'Usuário removido: ' + row.email, user.email, 'config');
  return {ok: true};
}
