import {openDatabase} from '../src/db.mjs';import {allSources} from '../src/service.mjs';import {NATIVE_MODES} from '../src/collectors.mjs';import {enqueue,worker} from '../src/jobs.mjs';import {previousMonth} from '../src/radar.mjs';
const db=openDatabase(process.env.DATABASE_PATH||'data/permit-finder.sqlite');
const from=process.argv[2]||previousMonth(),to=process.argv[3]||from,id=process.argv[4],ids=id?[id]:allSources(db).filter(s=>NATIVE_MODES.includes(s.mode)).map(s=>s.id);
console.log(enqueue(db,ids,from,to)+' queries queued.');const tick=worker(db);while(db.prepare("SELECT id FROM jobs WHERE status='queued' LIMIT 1").get())await tick();db.close();
