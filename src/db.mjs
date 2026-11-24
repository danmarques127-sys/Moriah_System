import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
export function openDatabase(path){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path);
 db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 const LATEST=11,version=db.prepare('PRAGMA user_version').get().user_version;
 if(version>LATEST)throw new Error('Unsupported database version: '+version);
 if(version===0)db.exec(readFileSync(new URL('../migrations/001.sql',import.meta.url),'utf8'));
 // Each migration file ends with PRAGMA user_version=N; apply the missing ones in order.
 for(let v=db.prepare('PRAGMA user_version').get().user_version+1;v<=LATEST;v++)db.exec(readFileSync(new URL('../migrations/'+String(v).padStart(3,'0')+'.sql',import.meta.url),'utf8'));
 return db;
}
export function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
export const timestamp=()=>new Date().toISOString();
export function audit(db,workspace,event,actor='',kind='system'){db.prepare('INSERT INTO audit(workspace_id,event,created_at,actor,kind) VALUES(?,?,?,?,?)').run(workspace,event,timestamp(),actor,kind);}
// Every failure the administrator should be able to read later (area: collection, source-link, import, server).
export function logError(db,area,message,{sourceId='',month=''}={}){try{db.prepare('INSERT INTO error_log(created_at,area,source_id,month,message) VALUES(?,?,?,?,?)').run(timestamp(),area,sourceId,month,String(message||'Erro sem mensagem.').slice(0,2000));db.prepare('DELETE FROM error_log WHERE id<=(SELECT MAX(id)-2000 FROM error_log)').run();}catch{/* logging must never break a request */}}
