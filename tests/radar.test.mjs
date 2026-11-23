import {test} from 'node:test';import assert from 'node:assert/strict';import {monthsBetween,normalizeAddress,projectKey,assess,groupProjects,diversify,validatePermit} from '../src/radar.mjs';import {parseCsv,collect} from '../src/collectors.mjs';import {SOURCES} from '../src/sources.mjs';
const source=SOURCES.find(s=>s.id==='boston'),now=new Date('2026-11-11T12:00Z');
const p=(extra={})=>({id:'boston:P1',sourceId:'boston',city:'Boston',state:'MA',address:'12 Main Street',number:'P1',issued:'2026-10-20',description:'Construct new single family dwelling',type:'Building Permit',value:0,contractor:'',applicant:'',status:'Issued',sourceUrl:source.url,...extra});
test('date range includes month boundaries and limits size',()=>{assert.deepEqual(monthsBetween('2026-11','2027-02'),['2026-11','2026-12','2027-01','2027-02']);assert.throws(()=>monthsBetween('2026-12','2026-11'));assert.throws(()=>monthsBetween('2020-01','2026-01'));});
test('unit notation normalized without merging different units',()=>{assert.equal(normalizeAddress('12 Main Street Apt 2'),normalizeAddress('12 MAIN ST #2'));assert.notEqual(projectKey(p({address:'12 Main St #1'})),projectKey(p({address:'12 Main St #2'})));});
test('new house score follows rules and is qualified',()=>{const r=assess([p({value:1200000,contractor:'GC'})],now);assert.equal(r.score,100);assert.equal(r.tier,'HOT');assert.equal(r.kind,'New house');assert.equal(r.qualified,true);});
test('electrical wire new house alone is not a new-house bid',()=>{const r=assess([p({type:'Residential Electrical',description:'Wire new house'})],now);assert.equal(r.qualified,false);});
test('deck under Residential Addition category does not get major addition points',()=>{const r=assess([p({type:'Residential Addition',description:'Build a small open deck'})],now);assert.equal(r.qualified,false);assert.equal(r.kind,'Other');});
test('ADU and full gut are selected',()=>{assert.equal(assess([p({description:'Create an ADU in existing structure'})],now).kind,'ADU');assert.equal(assess([p({description:'Full gut renovation of the dwelling'})],now).qualified,true);});
test('trade associated to an actual building permit is grouped and not penalized',()=>{const r=groupProjects([p(),p({id:'boston:E1',type:'Electrical',description:'Wire new house',address:'12 Main ST'})],[],now);assert.equal(r.length,1);assert.equal(r[0].score,60);assert.equal(r[0].qualified,true);});
test('permit age never proves stage',()=>assert.equal(assess([p()],now).stage,'ESTIMATED STAGE'));
test('contact status survives regrouping',()=>assert.equal(groupProjects([p()],[{projectKey:projectKey(p()),status:'Contatado',notes:'Keep',contactDate:'2026-10-30'}],now)[0].review.status,'Contatado'));
test('diversification retains all rows and balances first page',()=>{const a={master:{city:'Boston',state:'MA'}},b={master:{city:'Newton',state:'MA'}};const result=diversify([a,a,a,b]);assert.equal(result.length,4);assert.deepEqual(result.slice(0,2),[a,b]);});
test('provenance validation blocks lookalike domains and invalid dates',()=>{assert.equal(validatePermit(p(),source).city,'Boston');assert.throws(()=>validatePermit(p({sourceUrl:'https://data.boston.gov.evil.example/'}),source));assert.throws(()=>validatePermit(p({issued:'2026-02-30'}),source));});
test('CSV parses quotes multiline and BOM',()=>{assert.equal(parseCsv('\uFEFFname,scope\r\n"ABC, LLC","a\nb ""c"""\r\n')[0].scope,'a\nb "c"');assert.throws(()=>parseCsv('x\n"broken'));});
test('unsupported municipal portal is pending not zero coverage',async()=>{const r=await collect(SOURCES.find(s=>s.id==='newton'),'2026-10');assert.equal(r.status,'pending');assert.deepEqual(r.records,[]);});
test('HTTP403 propagates as source failure not empty result',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>new Response('Forbidden',{status:403});try{await assert.rejects(collect(source,'2026-10'),/HTTP 403/);}finally{globalThis.fetch=old;}});
test('Milton nested issue-date filter is correctly formed',async()=>{const old=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(options.body.get('columns[5][search][value]'),'2026-10-01 | 2026-10-31');return Response.json({data:[],recordsFiltered:0});};try{assert.equal((await collect(SOURCES.find(s=>s.id==='milton'),'2026-10')).status,'complete');}finally{globalThis.fetch=old;}});
test('Westerly absent publication stays pending',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>new Response('<a href="/old.csv">Monthly Report September 2026.csv</a>');try{assert.equal((await collect(SOURCES.find(s=>s.id==='westerly'),'2026-10')).status,'pending');}finally{globalThis.fetch=old;}});

test('ArcGIS invalid response is a failure, not complete coverage',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:'unavailable'});
 try{await assert.rejects(collect(SOURCES.find(s=>s.id==='hartford'),'2026-10'),/Consulta municipal não disponível/);}
 finally{globalThis.fetch=old;}
});
test('ArcGIS full page followed by an empty page confirms pagination',async()=>{
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({features:calls===1?Array.from({length:1000},(_,i)=>({attributes:{OBJECTID:i+1,DateIssued:Date.UTC(2026,9,15),PROPERTY_ADDRESS:'1 Main St',DESCRIPTION:'New house',RECORD_TYPE_TYPE:'Building Permit'}})):[]});};
 try{const result=await collect(SOURCES.find(s=>s.id==='hartford'),'2026-10');assert.equal(calls,2);assert.equal(result.status,'complete');assert.equal(result.records.length,1000);}
 finally{globalThis.fetch=old;}
});
test('ArcGIS repeated full page fails rather than reporting complete',async()=>{
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({features:Array.from({length:1000},(_,i)=>({attributes:{OBJECTID:i+1,DateIssued:Date.UTC(2026,9,15),PROPERTY_ADDRESS:'1 Main St',DESCRIPTION:'New house',RECORD_TYPE_TYPE:'Building Permit'}}))});};
 try{await assert.rejects(collect(SOURCES.find(s=>s.id==='hartford'),'2026-10'),/Paginação ArcGIS repetiu registros/);assert.equal(calls,2);}
 finally{globalThis.fetch=old;}
});

test('monthly report sources are discoverable but not falsely marked as native',async()=>{
 for(const name of ['southbury','bethel']){
  const source=SOURCES.find(s=>s.id===name);
  assert.ok(source);assert.equal(source.state,'CT');assert.equal(source.mode,'report');
  const result=await collect(source,'2026-10');assert.equal(result.status,'pending');
 }
});
test('Westerly real CSV-shaped report can produce normalized permits',async()=>{
 const source=SOURCES.find(s=>s.id==='westerly'),old=globalThis.fetch;
 const csv='Title,Type,Date Issued,Record #,Full Address,Type of Improvement,Estimated cost of Labor and Materials,GC Name,Applicant Name,GC Phone #\nBuilding Permit,Permit/License,10/15/2026,2026-001,14 Main St,New single family house,600000,Builder LLC,Applicant,401-555-0100\n';
 let calls=0;
 globalThis.fetch=async url=>{calls++;return new Response(calls===1?'<a href="/DocumentCenter/View/123/Monthly-Report-October-2026csv">Monthly Report October 2026.csv</a>':csv);};
 try{const result=await collect(source,'2026-10');assert.equal(calls,2);assert.equal(result.status,'complete');assert.equal(result.records.length,1);assert.equal(result.records[0].contractor,'Builder LLC');assert.equal(result.records[0].phone,'401-555-0100');}
 finally{globalThis.fetch=old;}
});
test('unsupported source jobs stay pending rather than showing successful collection',async()=>{
 const {openDatabase}=await import('../src/db.mjs');
 const {enqueue,worker}=await import('../src/jobs.mjs');
 const db=openDatabase(':memory:');
 try{
  enqueue(db,['southbury'],'2026-10','2026-10');
  await worker(db)();
  const job=db.prepare('SELECT status FROM jobs').get();
  const coverage=db.prepare('SELECT status,count FROM coverage WHERE source_id=? AND month=?').get('southbury','2026-10');
  assert.equal(job.status,'pending');assert.equal(coverage.status,'pending');assert.equal(coverage.count,0);
 }finally{db.close();}
});
