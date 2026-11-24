import {randomUUID} from 'node:crypto';
import {timestamp,logError} from './db.mjs';
import {monthsBetween,previousMonth} from './radar.mjs';
import {collect,NATIVE_MODES} from './collectors.mjs';
import {allSources,findSource,upsertPermits,setCoverage} from './service.mjs';
export function enqueue(db,ids,from,to){
 const months=monthsBetween(from,to);if(!Array.isArray(ids)||!ids.length||ids.length*months.length>200)throw new Error('Selecione de 1 a 200 consultas cidade/mês por lote.');
 let count=0;for(const id of [...new Set(ids)]){findSource(db,id);for(const month of months){const now=timestamp();try{db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?)').run(randomUUID(),id,month,'queued','',now,now);count++;}catch(e){if(!String(e.message).includes('UNIQUE'))throw e;}}}return count;
}
export function worker(db){
 let busy=false;
 return async()=>{if(busy)return;const job=db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get();if(!job)return;busy=true;
 try{db.prepare("UPDATE jobs SET status='running',updated_at=? WHERE id=?").run(timestamp(),job.id);
 const source=findSource(db,job.source_id),result=await collect(source,job.month);
 if(!['complete','partial','pending'].includes(result.status)||!Array.isArray(result.records))throw new Error('Resposta inválida do coletor municipal.');
 if(result.status==='pending'&&result.records.length)throw new Error('Fonte pendente não pode declarar registros coletados.');
 const saved=result.status==='pending'?{added:0,updated:0,count:0}:upsertPermits(db,source,result.records);
 const stored=db.prepare('SELECT COUNT(*) AS n FROM permits WHERE source_id=? AND substr(issued,1,7)=?').get(source.id,job.month).n;
 setCoverage(db,source.id,job.month,result.status,result.message,stored);
 const jobStatus=result.status==='pending'?'pending':'done';
 const summary=result.status==='pending'
  ?'Fonte pendente; nenhuma coleta executada. '+stored+' registros históricos preservados. '+result.message
  :result.status+': '+saved.count+' registros processados; '+saved.added+' novos, '+saved.updated+' atualizados; '+stored+' armazenados. '+result.message;
 db.prepare('UPDATE jobs SET status=?,message=?,updated_at=? WHERE id=?').run(jobStatus,summary,timestamp(),job.id);
 }catch(e){const count=db.prepare('SELECT COUNT(*) AS n FROM permits WHERE source_id=? AND substr(issued,1,7)=?').get(job.source_id,job.month).n;
 setCoverage(db,job.source_id,job.month,'unavailable',String(e.message)+' Registros anteriores preservados.',count);
 logError(db,'collection',e.message,{sourceId:job.source_id,month:job.month});
 db.prepare("UPDATE jobs SET status='failed',message=?,updated_at=? WHERE id=?").run(String(e.message).slice(0,3000),timestamp(),job.id);
 }finally{busy=false;}};
}
export function scheduler(db,timezone='America/New_York',now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now),get=t=>parts.find(p=>p.type===t).value;
 if(Number(get('hour'))<8)return 0;const day=get('year')+'-'+get('month')+'-'+get('day');
 if(db.prepare('SELECT day FROM scheduler_runs WHERE day=?').get(day))return 0;
 const ids=allSources(db).filter(s=>NATIVE_MODES.includes(s.mode)).map(s=>s.id),from=previousMonth(now),to=get('year')+'-'+get('month');
 const count=enqueue(db,ids,from,to);db.prepare('INSERT INTO scheduler_runs VALUES(?,?)').run(day,timestamp());return count;
}
