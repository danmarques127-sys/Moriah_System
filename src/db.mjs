import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
export function openDatabase(path){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path);
 db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 const version=db.prepare('PRAGMA user_version').get().user_version;
 if(version===0)db.exec(readFileSync(new URL('../migrations/001.sql',import.meta.url),'utf8'));
 else if(version!==1)throw new Error('Unsupported database version: '+version);
 return db;
}
export function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
export const timestamp=()=>new Date().toISOString();
export function audit(db,workspace,event){db.prepare('INSERT INTO audit(workspace_id,event,created_at) VALUES(?,?,?)').run(workspace,event,timestamp());}
