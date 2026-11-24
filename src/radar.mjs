export function monthsBetween(from,to){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(from)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(to)||from>to||from<'2009-01')throw new Error('Intervalo de meses inválido.');
 const out=[];let cursor=from;while(cursor<=to){out.push(cursor);if(out.length>24)throw new Error('Selecione até 24 meses por consulta.');const [y,m]=cursor.split('-').map(Number);cursor=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);}return out;
}
export function previousMonth(now=new Date()){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit'}).formatToParts(now);return new Date(Date.UTC(Number(p.find(x=>x.type==='year').value),Number(p.find(x=>x.type==='month').value)-2,1)).toISOString().slice(0,7);}
export function normalizeAddress(value){
 return String(value??'').toUpperCase()
 .replace(/\b(STREET|AVENUE|ROAD|DRIVE|LANE|COURT|PLACE|BOULEVARD|TERRACE)\b/g,w=>({STREET:'ST',AVENUE:'AVE',ROAD:'RD',DRIVE:'DR',LANE:'LN',COURT:'CT',PLACE:'PL',BOULEVARD:'BLVD',TERRACE:'TER'})[w])
 .replace(/\b(?:APT|APARTMENT|UNIT)\s*#?\s*|#\s*(?=[A-Z0-9])/g,' UNIT ')
 .replace(/[^A-Z0-9 /-]/g,' ').replace(/\s+/g,' ').trim();
}
export function projectKey(p){
 // Strip only a matching municipality/state/postcode suffix; preserve unit identities.
 const city=String(p.city??'').toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
 let address=normalizeAddress(p.address);
 if(city){
   // city contains only letters/numbers/spaces and is safe in RegExp.
   const suffix=new RegExp('(?:\\s+)'+city+'(?:\\s+(?:MA|CT|RI))?(?:\\s+\\d{5}(?:-\\d{4})?)?$');
   address=address.replace(suffix,'').trim();
 }
 return p.state+'|'+city+'|'+(address||p.id);
}
export function validatePermit(raw,source){
 if(!raw||typeof raw!=='object')throw new Error('Registro inválido.');const p={};
 for(const k of ['id','address','number','issued','description','type','status','contractor','applicant','sourceUrl']){p[k]=String(raw[k]??'');if(p[k].length>(k==='description'?20000:2000))throw new Error('Campo de permit muito longo.');}
 if(!p.id.startsWith(source.id+':')||p.id.length>300||p.id.endsWith(':undefined')||!p.description||!/^\d{4}-\d{2}-\d{2}$/.test(p.issued))throw new Error('Permit sem identificador, descrição ou emissão válida.');
 const d=new Date(p.issued+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==p.issued)throw new Error('Data de emissão inválida.');
 const u=new URL(p.sourceUrl),hosts=[new URL(source.url).hostname,...(source.allowedHosts||[])];if(u.protocol!=='https:'||!hosts.includes(u.hostname))throw new Error('Evidência fora da fonte municipal cadastrada.');
 p.sourceId=source.id;p.city=source.city;p.state=source.state;p.value=Number(raw.value??0);if(!Number.isFinite(p.value)||p.value<0||p.value>1e12)throw new Error('Valor declarado inválido.');
 for(const k of ['owner','phone','email']){const v=String(raw[k]??'').replace(/\s+/g,' ').trim().slice(0,200);if(v&&(k!=='email'||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))&&(k!=='phone'||/\d{7}/.test(v.replace(/\D/g,'')+'0000000')&&/^[\d\s().+\-x]+$/i.test(v)))p[k]=v;}
 if(raw.dateApprox===true)p.dateApprox=true;
 for(const k of ['phone','email','inspection','contactUrl'])if(raw[k]){p[k]=String(raw[k]).slice(0,3000);if(k==='contactUrl'&&new URL(p[k]).protocol!=='https:')throw new Error('URL de contato inválida.');}return p;
}
export function assess(records,now=new Date()){
 const building=records.filter(p=>!/electrical|plumbing|gas permit|gas fitting|mechanical|hvac|sheet metal|fire alarm/i.test(p.type));
 const basis=building.length?building:records,description=basis.map(p=>p.description).join(' ').toLowerCase(),types=basis.map(p=>p.type).join(' ').toLowerCase(),text=description+' '+types;
 const reasons=[],add=(yes,label,points)=>{if(yes)reasons.push({label,points});};
 const residential=/residen|dwelling|single.family|two.family|multi.family|townhome|townhouse|apartment|new house|new home/.test(text);
 const newPhrase=[...description.matchAll(/\bnew\b.{0,90}?(?:residence|residential building|dwelling|single.family|two.family|multi.family|townhome|townhouse|apartment building|home|house)\b/g)].some(m=>!/roof|porch|deck|stair|window|door|wiring|plumbing|bathroom|kitchen|addition|existing|boiler|hvac/.test(m[0]));
 const existingAddition=/existing.{0,30}(?:structure|residence|house|home)|additional level|remain a single.family/.test(description)&&/addition|additional level/.test(description);
 const newHome=(residential||/new structure\s*-\s*r\b/.test(types))&&(newPhrase||/residential new construction|new structure\s*-\s*r\b/.test(types)||(/building: new construction|erect\/new construction/.test(types)&&!existingAddition));
 const adu=/\badu\b|accessory dwelling/.test(description),gut=/\bgut\b|full renov|whole.house|complete.{0,20}renovat|major renov|renovate entire|substantial renov|fire restoration/.test(description);
 const addition=/(?:second|third|2nd|3rd)[- ]?(?:story|floor)[- ]?addition|major addition|large addition|rear addition|residential addition|over.garage addition|addition.{0,45}(?:bedroom|living|family room|two.story)|(?:construct|build|new).{0,35}(?:four.season|4.season|conditioned).{0,15}(?:room|addition)/.test(description);
 const conversion=!newHome&&/(?:basement|attic|garage).{0,50}(?:convert|conversion|living|finish|habitable)|(?:convert|conversion|finish).{0,50}(?:basement|attic|garage)/.test(description);
 const multiConversion=/(?:multi.family|condo).{0,25}conversion|convert.{0,30}(?:multi.family|condo|two.family)/.test(description);
 const envelope=/insulat|thermal envelope|air seal|spray foam|weatheriz/.test(description.replace(/(?:no|without|excluding)\s+(?:new\s+)?insulation(?:\s+work)?/g,''));
 const value=Math.max(...records.map(p=>p.value||0));const commercial=/commercial|warehouse|office building/.test(types)&&/new construction|major renov|new building/.test(description+' '+types);
 const scope=newHome||adu||gut||addition||conversion||multiConversion||envelope||commercial;
 const tradeOnly=!building.length;
 const minor=!scope&&/window|roof|siding|deck|kitchen|bathroom|repair|replace|water heater|boiler|solar|fence|pool|driveway|shed/.test(description);
 add(newHome,'Construção residencial nova',50);add(adu,'ADU',40);add(gut,'Reforma completa',40);add(addition,'Grande adição / área habitável',35);add(newHome&&records.some(p=>/demolition/i.test(p.type)),'Demolição associada à reconstrução',35);
 add(value>=1e6,'Valor declarado ≥ US$ 1 milhão',35);add(value>=5e5&&value<1e6,'Valor declarado ≥ US$ 500 mil',25);add(conversion,'Conversão de área para uso habitável',20);add(multiConversion,'Conversão multifamily / condo',20);add(envelope,'Insulation / envelope explícito',30);
 const recent=records.some(p=>{const age=(now-Date.parse(p.issued+'T12:00:00Z'))/86400000;return age>=0&&age<=30;});add(recent,'Emissão nos últimos 30 dias',10);add(records.some(p=>p.contractor),'Empresa executora informada',5);add(tradeOnly,'Somente trade; projeto principal não verificado',-60);add(minor,'Serviço pequeno / isolado',-40);
 const score=Math.max(0,Math.min(100,reasons.reduce((s,r)=>s+r.points,0))),kind=adu?'ADU':newHome?'New house':addition?'Addition':gut?'Gut renovation':conversion||multiConversion?'Conversion':commercial?'Commercial':envelope?'Insulation':tradeKind(text);
 const master=[...basis].sort((a,b)=>b.issued.localeCompare(a.issued))[0];const inspection=records.find(p=>p.inspection);
 return {score,tier:score>=70?'HOT':score>=50?'GOOD':score>=30?'POSSIBLE':'REVIEW',kind,qualified:scope&&!tradeOnly&&score>=30,reasons,master,value,stage:inspection?'VERIFIED':'ESTIMATED STAGE',stageText:inspection?.inspection||'Sem inspeção que confirme a fase. Emissão não comprova prontidão para insulation.',potentialScope:newHome||gut||addition?['Exterior Walls','Roof / Rafters','Floors']:conversion?['Área convertida — conferir plantas']:envelope?['Conforme descrição municipal']:[]};
}
export function groupProjects(records,reviews=[],now=new Date()){
 const map=new Map(),reviewMap=new Map(reviews.map(r=>[r.projectKey,r]));for(const p of records){const k=projectKey(p);if(!map.has(k))map.set(k,[]);map.get(k).push(p);}
 return [...map].map(([key,list])=>({key,records:list,...assess(list,now),review:reviewMap.get(key)||{status:'Novo',notes:'',contactDate:''}})).sort((a,b)=>b.score-a.score||b.master.issued.localeCompare(a.master.issued));
}
export function diversify(projects){const buckets=new Map();for(const p of projects){const k=p.master.state+'|'+p.master.city;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);}const groups=[...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v),out=[];let i=0;while(groups.some(g=>g.length>i)){for(const g of groups)if(g[i])out.push(g[i]);i++;}return out;}

// Work label for everything that is not a big project, read from the permit type and the description.
export function tradeKind(text){
 const x=String(text||'').toLowerCase();
 if(/\broof|shingle|re-?roof/.test(x))return 'Roofing';
 if(/solar|photovoltaic|\bpv\b/.test(x))return 'Solar';
 if(/siding|window|\bdoors?\b|exterior trim/.test(x))return 'Siding / Windows';
 if(/hvac|heat pump|furnace|boiler|mechanical|air.?condition|mini.?split|\bduct|oil tank|gas (?:line|pipe)|fireplace|chimney/.test(x))return 'HVAC / Mechanical';
 if(/plumb|water heater|sewer|septic|water service/.test(x))return 'Plumbing';
 if(/electric|wiring|\bpanel|generator|service upgrade|ev charg/.test(x))return 'Electrical';
 if(/demoli/.test(x))return 'Demolition';
 if(/\bdeck|porch|patio|stair|retaining wall|fence|shed|garage|pool/.test(x))return 'Deck / Outdoor';
 if(/kitchen|bath|renovat|remodel|alteration|interior|finish|repair|replace|upgrade|fire damage/.test(x))return 'Renovation';
 return 'Other';
}
