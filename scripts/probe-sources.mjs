import {SOURCES} from '../src/sources.mjs';
import {collect,NATIVE_MODES} from '../src/collectors.mjs';
import {monthsBetween,validatePermit} from '../src/radar.mjs';

const [month,...ids]=process.argv.slice(2);
if(!month||!ids.length){
 console.error('Usage: npm run probe -- YYYY-MM city-id [city-id ...]');
 console.error('Native sources: '+SOURCES.filter(s=>NATIVE_MODES.includes(s.mode)).map(s=>s.id).join(', '));
 process.exitCode=2;
}else{
 try{monthsBetween(month,month);}catch(e){console.error(e.message);process.exitCode=2;}
 if(!process.exitCode){
  for(const id of [...new Set(ids)]){
   const source=SOURCES.find(s=>s.id===id);
   if(!source){console.log(JSON.stringify({id,status:'invalid',error:'Unknown source id'}));process.exitCode=1;continue;}
   const started=Date.now();
   try{
    const result=await collect(source,month);
    const data=result.records||[];
    for(const record of data){
     const validated=validatePermit(record,source);
     if(!validated.issued.startsWith(month))throw new Error('Permit issued outside requested month');
    }
    const r={id,city:source.city,state:source.state,month,status:result.status,records:data.length,distinctIds:new Set(data.map(x=>x.id)).size,withContractor:data.filter(x=>x.contractor).length,withAddress:data.filter(x=>x.address).length,elapsedMs:Date.now()-started,message:result.message};
    console.log(JSON.stringify(r));
    if(result.status!=='complete')process.exitCode=1;
   }catch(e){console.log(JSON.stringify({id,month,status:'failed',elapsedMs:Date.now()-started,error:String(e.message||e).slice(0,500)}));process.exitCode=1;}
  }
 }
}
