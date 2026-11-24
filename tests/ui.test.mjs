import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
function ui(){
 const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8').replace(/^import .*;\n/,'').split("document.addEventListener('click'")[0];
 const root={innerHTML:'',querySelectorAll(){return[];}},context={console,Intl,Date,Map,Set,URL,URLSearchParams,structuredClone,setTimeout,clearTimeout,crypto:{randomUUID:()=>Math.random().toString(36)},SECTION_TYPES:['Roof / Rafters','Basement Walls'],document:{querySelector(){return root;},body:{classList:{add(){},remove(){}}}},window:{print(){}}};
 vm.createContext(context);vm.runInContext(source+';globalThis.ui={s,render,clearWorkspace,pollLabel,pollSummary};',context);return {root,...context.ui};
}
test('login view exposes no workspace draft data',()=>{const x=ui();x.render();assert.match(x.root.innerHTML,/data-form="login"/);assert.doesNotMatch(x.root.innerHTML,/PRIVATE-CLIENT/);});
test('radar offers from/to, multiple city selection, type and city-balanced ordering',()=>{const x=ui();x.s.me={role:'owner',email:'owner@example.test'};x.s.sources=[{id:'newton',city:'Newton',state:'MA',url:'https://www.newtonma.gov',mode:'report'}];x.s.radar={total:0,recordsLoaded:0,cityCounts:[],projects:[],pages:1,page:1,coverage:[],months:['2026-10']};x.render();assert.match(x.root.innerHTML,/name="from"/);assert.match(x.root.innerHTML,/name="to"/);assert.match(x.root.innerHTML,/data-city="newton"/);assert.match(x.root.innerHTML,/Balance across cities/);assert.doesNotMatch(x.root.innerHTML,/Qualified opportunities|Priority|Insulation|Create project|Estimates/);});
test('account tab shows password change and no company pricing; nav drops estimator, payments and employees',()=>{const x=ui();x.s.me={role:'owner',email:'owner@example.test',systemAdmin:true};x.s.members=[{email:'<b>x</b>',role:'owner'}];x.s.tab='settings';x.render();assert.match(x.root.innerHTML,/Change my password/);assert.match(x.root.innerHTML,/&lt;b&gt;x/);assert.doesNotMatch(x.root.innerHTML,/Precificação|Catálogo|Company profile|Insulation/);assert.doesNotMatch(x.root.innerHTML,/Projects &amp; Estimates|Projects & Estimates|>Payments<|>Employees</);assert.match(x.root.innerHTML,/Sources & Coverage|Sources &amp; Coverage/);assert.match(x.root.innerHTML,/>Admin</);assert.match(x.root.innerHTML,/>Errors</);});
test('admin sees the file-import modal with preview, escaped values and a confirm button',()=>{const x=ui();x.s.me={role:'owner',email:'o@x.test',systemAdmin:true};x.s.sources=[{id:'brookline',city:'Brookline',state:'MA',url:'https://aca-prod.accela.com/x',mode:'portal'}];x.s.radar={total:0,recordsLoaded:0,cityCounts:[],projects:[],pages:1,page:1,coverage:[],months:['2026-10']};x.s.tab='coverage';x.render();assert.match(x.root.innerHTML,/Import file \(PDF\/CSV\/XLSX\)/);x.s.modal='upload';x.s.upload={sourceId:'brookline',month:'2026-10',file:{name:'a.csv',size:2048},preview:{format:'text',rowsRead:2,inMonth:1,outsideMonth:1,undated:0,invalid:0,problems:[],range:{from:'2026-09-30',to:'2026-10-15'},sample:[{number:'BLD-1',issued:'2026-10-15',address:'<img src=x onerror=alert(1)>',type:'Building Permit',value:600000,description:'New dwelling'}]}};x.render();assert.match(x.root.innerHTML,/Confirm import of 1 permits/);assert.match(x.root.innerHTML,/&lt;img/);assert.doesNotMatch(x.root.innerHTML,/<img src=x/);});

test('admin tab shows accounts, health filters and escapes values',()=>{
 const x=ui();x.s.me={role:'owner',email:'o@x.test',systemAdmin:true};
 x.s.radar={total:0,recordsLoaded:0,cityCounts:[],projects:[],pages:1,page:1,coverage:[],months:['2026-10']};
 x.s.tab='admin';
 x.s.admin={users:[{id:'1',email:'<b>boss</b>@x.test',role:'owner',systemAdmin:true,activeSessions:2,workspace:'Main',createdAt:'2026-11-01T10:00:00Z'}],
  sources:[{id:'a',city:'Alpha',state:'MA',mode:'documents',automatic:true,reason:'',url:'https://a.gov'},{id:'b',city:'Beta',state:'CT',mode:'portal',automatic:false,reason:'Import by hand.',url:'https://b.gov'}],
  coverage:[{sourceId:'a',month:'2026-10',status:'unavailable',message:'HTTP 403 <script>x</script>',count:0,checkedAt:'2026-11-23T10:00:00Z'}],
  checks:[{sourceId:'a',ok:false,httpStatus:403,note:'Blocked.',checkedAt:'2026-11-23T10:00:00Z'}],failedJobs:[],retention:{months:12,totalDeleted:7,last:{createdAt:'2026-11-23T10:00:00Z',cutoff:'2025-11-23',deleted:3},runs:[]}};
 x.render();
 const html=x.root.innerHTML;
 assert.match(html,/Registered accounts \(1\)/);assert.match(html,/12 months/);assert.match(html,/3 deleted/);assert.match(html,/&lt;b&gt;boss/);
 assert.match(html,/Alpha/);assert.doesNotMatch(html,/<script>x/);assert.match(html,/Failed/);
 assert.match(html,/Check source links/);assert.match(html,/Retry failed collections/);
 assert.match(html,/Manual cities \(1\)/);
 x.s.adminFilter='all';x.render();assert.match(x.root.innerHTML,/Import by hand\./);
});

test('errors tab lists every recorded failure with its reason and filters by area',()=>{
 const x=ui();x.s.me={role:'owner',email:'o@x.test',systemAdmin:true};
 x.s.radar={total:0,recordsLoaded:0,cityCounts:[],projects:[],pages:1,page:1,coverage:[],months:['2026-10']};x.s.tab='errors';
 x.s.admin={retention:{months:12,totalDeleted:0,last:null,runs:[]},users:[],sources:[{id:'danvers',city:'Danvers',state:'MA',mode:'documents',automatic:true,reason:'',url:'https://d.gov'}],coverage:[],checks:[],failedJobs:[],
  errors:[{id:2,createdAt:'2026-11-23T10:00:00Z',area:'collection',sourceId:'danvers',month:'2026-10',message:'Fonte respondeu HTTP 403 <i>x</i>'},{id:1,createdAt:'2026-11-22T10:00:00Z',area:'import',sourceId:'',month:'',message:'Arquivo inválido'}]};
 x.render();let html=x.root.innerHTML;
 assert.match(html,/Danvers/);assert.match(html,/HTTP 403 &lt;i&gt;/);assert.match(html,/Arquivo inválido/);assert.match(html,/City collection/);
 x.s.errorArea='import';x.render();html=x.root.innerHTML;assert.doesNotMatch(html,/HTTP 403/);assert.match(html,/Arquivo inválido/);
});

test('loading text names the city being collected and the final summary counts successes and failures',()=>{
 const x=ui();x.s.sources=[{id:'waltham',city:'Waltham'},{id:'sudbury',city:'Sudbury'}];x.s.pollStart='2026-11-23T10:00:00.000Z';
 x.s.jobs=[{sourceId:'waltham',month:'2026-10',status:'running',updatedAt:'2026-11-23T10:00:05Z'},{sourceId:'sudbury',month:'2026-10',status:'done',updatedAt:'2026-11-23T10:00:03Z'},{sourceId:'sudbury',month:'2026-09',status:'queued',updatedAt:'2026-11-23T10:00:01Z'},{sourceId:'old',month:'2026-01',status:'failed',updatedAt:'2026-11-01T10:00:00Z'}];
 assert.equal(x.pollLabel(),'Collecting Waltham 2026-10 (1 of 3)…');
 x.s.jobs=[{sourceId:'waltham',month:'2026-10',status:'failed',updatedAt:'2026-11-23T10:00:05Z'},{sourceId:'sudbury',month:'2026-10',status:'done',updatedAt:'2026-11-23T10:00:08Z'},{sourceId:'sudbury',month:'2026-09',status:'pending',updatedAt:'2026-11-23T10:00:09Z'}];
 assert.equal(x.pollSummary(),'Collection finished: 1 succeeded, 1 pending, 1 failed. See the Errors tab for the reasons.');
});

test('manual cities section lists the reason, the last upload, overdue status and a preselected import button',()=>{
 const x=ui();x.s.me={role:'owner',email:'o@x.test',systemAdmin:true};
 x.s.radar={total:0,recordsLoaded:0,cityCounts:[],projects:[],pages:1,page:1,coverage:[],months:['2026-10']};x.s.tab='admin';
 x.s.admin={retention:{months:12,totalDeleted:0,last:null,runs:[]},users:[],coverage:[],checks:[],failedJobs:[],errors:[],
  sources:[{id:'danvers',city:'Danvers',state:'MA',mode:'portal',automatic:false,reason:'Site blocks automated access (403).',url:'https://d.gov'},{id:'newton',city:'Newton',state:'MA',mode:'portal',automatic:false,reason:'OpenGov export.',url:'https://n.gov'},{id:'boston',city:'Boston',state:'MA',mode:'boston',automatic:true,reason:'',url:'https://b.gov'}],
  manual:[{sourceId:'newton',lastAt:new Date().toISOString(),month:'2026-10',byEmail:'o@x.test',uploads:2}]};
 x.render();const html=x.root.innerHTML;
 assert.match(html,/Manual cities \(2\)/);assert.match(html,/Site blocks automated access/);assert.match(html,/2 uploads/);
 assert.match(html,/data-action="openUpload" data-id="danvers"/);assert.match(html,/<b>1<\/b> are overdue/);
 assert.doesNotMatch(html,/Official source ↗<\/a><\/small><\/td><td>[^<]*Boston/);
});

test('partners tab renders every admin section and escapes values',()=>{const x=ui();x.s.me={role:'owner',email:'o@x.test',systemAdmin:true};x.s.sources=[{id:'a',city:'Alpha',state:'MA'}];
 x.s.partners={trades:[{id:1,name:'Painting',active:true}],companies:[{id:1,name:'<b>Acme</b>',contactName:'',contactEmail:'',contactPhone:'',active:true,joinedOn:'2026-01-01',tradeIds:[1]}],clients:[{id:1,companyId:1,email:'c@x.test',name:'',active:true,cities:['a']}],coverage:[{companyId:1,name:'Acme',active:true,trades:['Painting'],cities:['a']}],usage:[{companyId:1,name:'Acme',seen:3,exported:1,lastAt:null}],freshness:[{sourceId:'a',city:'Alpha',state:'MA',permits:0,lastPermit:null,lastCollection:null,daysSincePermit:null,stale:true}],retention:{months:12,last:null,totalDeleted:0,runs:[]},settings:{retention_months:12,stale_days:45},audit:[{id:1,createdAt:'2026-11-01T00:00:00Z',actor:'mestre',kind:'login',event:'Login'}]};
 x.s.tab='partners';for(const [sec,re] of [['companies',/&lt;b&gt;Acme/],['trades',/Painting/],['clients',/c@x\.test/],['coverage',/Alpha, MA/],['freshness',/No data/],['retention',/12 months/],['audit',/mestre/],['usage',/Permits exported/],['psettings',/Alert after days/]]){x.s.pSection=sec;x.render();assert.match(x.root.innerHTML,re,sec);}
 assert.match(x.root.innerHTML,/>Partners</);});
