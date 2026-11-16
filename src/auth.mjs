import {scrypt,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
export const digest=(text)=>createHash('sha256').update(text).digest('hex');
export function validEmail(value){return typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
export async function hashPassword(password){
 if(typeof password!=='string'||password.length<16||password.length>256)throw new Error('Use uma senha entre 16 e 256 caracteres.');
 const salt=randomBytes(16).toString('hex');const key=await derive(password,salt,64,{N:32768,r:8,p:1,maxmem:67108864});
 return salt+':'+key.toString('hex');
}
export async function checkPassword(password,stored){
 if(typeof password!=='string'||password.length>256)return false;
 const [salt,hex]=String(stored||'').split(':');const target=hex&&/^[a-f0-9]{128}$/.test(hex)?Buffer.from(hex,'hex'):Buffer.alloc(64);
 const key=await derive(password,salt||'invalid-user-salt',64,{N:32768,r:8,p:1,maxmem:67108864});return timingSafeEqual(key,target);
}
export function newSession(db,userId){
 const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex'),expires=Date.now()+72*3600000;
 db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
 db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(digest(token),userId,csrf,expires);return {token,csrf,expires};
}
export function getSession(db,req){
 const match=String(req.headers.cookie||'').match(/(?:^|;\s*)pf_session=([a-f0-9]{64})(?:;|$)/);if(!match)return null;
 return db.prepare('SELECT u.id,u.workspace_id,u.email,u.role,u.system_admin,s.csrf,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(match[1]),Date.now())||null;
}
export function csrfMatches(actual,expected){return typeof actual==='string'&&actual.length===64&&typeof expected==='string'&&expected.length===64&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}
export function cookie(token,secure=true,maxAge=259200){return 'pf_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge+(secure?'; Secure':'');}
export function rateLimit(windowMs=900000,max=10){
 const attempts=new Map();
 return (key)=>{const now=Date.now();for(const [k,v] of attempts)if(v.until<=now)attempts.delete(k);if(attempts.size>10000)attempts.delete(attempts.keys().next().value);
 let bucket=attempts.get(key);if(!bucket){bucket={until:now+windowMs,count:0};attempts.set(key,bucket);}bucket.count++;return bucket.count<=max;};
}
