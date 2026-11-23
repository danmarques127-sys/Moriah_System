import {monthsBetween} from './radar.mjs';
export const NATIVE_MODES=['boston','cambridge','somerville','milton','worcester','hartford','westerly'];
const clean=v=>String(v??'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const amount=v=>Math.max(0,Number(String(v??0).replace(/[$,]/g,''))||0);
function issueDate(v){if(typeof v==='number')return new Date(v).toISOString().slice(0,10);const s=String(v??''),iso=s.match(/^\d{4}-\d{2}-\d{2}/);if(iso)return iso[0];const m=s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);return m?(m[3].length===2?'20'+m[3]:m[3])+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0'):'';}
async function http(url,options={}){
 const initial=new URL(url);if(initial.protocol!=='https:')throw new Error('Fonte deve usar HTTPS.');
 let target=url;for(let i=0;i<4;i++){const r=await fetch(target,{...options,redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'User-Agent':'PermitFinder/1.0 municipal public records',...(options.headers||{})}});
 if(r.status>=300&&r.status<400&&r.headers.get('location')){const next=new URL(r.headers.get('location'),target);if(next.protocol!=='https:'||next.hostname.replace(/^www\./,'')!==initial.hostname.replace(/^www\./,''))throw new Error('Redirecionamento para outro domínio exige revisão da fonte.');target=next.href;continue;}
 if(!r.ok)throw new Error('Fonte respondeu HTTP '+r.status+'. Não houve tentativa de contornar a restrição.');
 if(Number(r.headers.get('content-length')||0)>12000000)throw new Error('Documento excede o limite de coleta.');
 const body=await r.text();if(Buffer.byteLength(body)>12000000)throw new Error('Documento muito grande.');return body;}throw new Error('Redirecionamentos excessivos.');
}
async function json(url,options){const j=JSON.parse(await http(url,options));if(j.error||j.success===false)throw new Error('Consulta municipal não disponível.');return j;}
function record(s,key,issued,address,number,description,type,value,contractor='',applicant='',sourceUrl=s.url,status=''){
 if(key===undefined||key===null||!String(key).trim())throw new Error('Estrutura municipal mudou: identificador ausente.');
 return {id:s.id+':'+key,sourceId:s.id,city:s.city,state:s.state,address:clean(address),number:clean(number),issued:issueDate(issued),description:clean(description)||'Descrição não disponibilizada; conferir o documento municipal.',type:clean(type),value:amount(value),contractor:clean(contractor)==='N/A'?'':clean(contractor),applicant:clean(applicant),sourceUrl,status:clean(status)};
}
export function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}if(quoted)throw new Error('CSV incompleto.');if(cell||row.length){row.push(cell);rows.push(row);}if(!rows.length)return [];const headers=rows.shift().map(h=>h.replace(/^\uFEFF/,'').trim());return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));}
export async function collect(source,month){
 monthsBetween(month,month);const start=month+'-01',[y,m]=month.split('-').map(Number),end=new Date(Date.UTC(y,m,1)).toISOString().slice(0,10),records=[];let complete=true;
 if(!NATIVE_MODES.includes(source.mode))return {status:'pending',records:[],message:'Sem coletor automático validado para esta fonte. Importe CSV/JSON ou use o parser determinístico de relatório. Nenhuma emissão foi presumida.'};
 if(source.mode==='boston'){
 const meta=await json('https://data.boston.gov/api/3/action/package_show?id=approved-building-permits'),resource=meta.result.resources.find(r=>r.datastore_active);
 if(!resource||!/^[-a-f0-9]+$/.test(resource.id))throw new Error('Dataset ativo não encontrado.');
 for(let offset=0;offset<20000;offset+=500){const sql='SELECT * FROM "'+resource.id+'" WHERE issued_date >= \''+start+'\' AND issued_date < \''+end+'\' ORDER BY issued_date DESC,_id LIMIT 500 OFFSET '+offset;
 const page=(await json('https://data.boston.gov/api/3/action/datastore_search_sql?'+new URLSearchParams({sql}))).result.records;
 for(const r of page)records.push(record(source,r.permitnumber,r.issued_date,r.address,r.permitnumber,[r.description,r.comments].filter(Boolean).join(' — '),r.permittypedescr,r.declared_valuation,'',r.applicant,source.url,r.status));
 if(page.length<500)break;if(offset===19500)complete=false;}
 }else if(source.mode==='cambridge'){
 for(const feed of ['9qm7-wbdc','qu2z-8suj','ex75-8iwq','kcfi-ackv','tdg3-whvc'])for(let offset=0;offset<10000;offset+=500){
 const page=await json('https://data.cambridgema.gov/resource/'+feed+'.json?'+new URLSearchParams({$where:"issue_date >= '"+start+"T00:00:00' AND issue_date < '"+end+"T00:00:00'",$limit:'500',$offset:String(offset),$order:'issue_date,id'}));
 for(const r of page)records.push(record(source,feed+':'+r.id,r.issue_date,r.full_address,'',[r.detailed_description_of_work||r.description_of_work||r.description,r.isd_approved_description].filter(Boolean).join(' — '),r.permit_type||(feed==='9qm7-wbdc'?'Building: New Construction':'Building Permit'),r.total_cost_of_construction||r.total_cost||r.building_cost,'',[r.applicant_name,r.firm_name?'Empresa associada: '+r.firm_name:''].filter(Boolean).join(' • '),'https://data.cambridgema.gov/resource/'+feed+'.json?'+new URLSearchParams({$where:"id='"+r.id+"'"}),r.status));
 if(page.length<500)break;if(offset===9500)complete=false;}
 }else if(source.mode==='somerville'){
 for(let offset=0;offset<10000;offset+=500){const page=await json('https://data.somervillema.gov/resource/nneb-s3f7.json?'+new URLSearchParams({$where:"application_type in ('Building Permit','Demolition Permit') AND issue_date >= '"+start+"' AND issue_date < '"+end+"'",$limit:'500',$offset:String(offset),$order:'issue_date,application_id'}));
 for(const r of page)records.push(record(source,r.application_id,r.issue_date,r.application_address,r.application_number,r.project_description_or_business_name,r.application_type+' '+(r.application_subtype||''),r.estimated_construction_cost,r.contractor_company||r.contractor_name,r.applicant_company_name,'https://data.somervillema.gov/resource/nneb-s3f7.json?'+new URLSearchParams({$where:"application_id='"+r.application_id+"'"}),r.status));
 if(page.length<500)break;if(offset===9500)complete=false;}
 }else if(['hartford','worcester'].includes(source.mode)){
 const hart=source.mode==='hartford',endpoint=hart?'https://utility.arcgis.com/usrsvcs/servers/d595ae995fb049d3ac54919ebf24b1ac/rest/services/HartfordOpenDataTables/FeatureServer/0/query':'https://services1.arcgis.com/j8dqo2DJE7mVUBU1/arcgis/rest/services/Building_Permits/FeatureServer/0/query';
 let previousPageKey='';for(let offset=0;offset<20000;offset+=1000){const where=hart?"DateIssued >= TIMESTAMP '"+start+" 00:00:00' AND DateIssued < TIMESTAMP '"+end+" 00:00:00'":"Permit_License_Issued_Date LIKE '"+m+"/%/"+y+"'";
 const page=await json(endpoint+'?'+new URLSearchParams({f:'json',where,outFields:'*',returnGeometry:'false',resultRecordCount:'1000',resultOffset:String(offset),orderByFields:hart?'DateIssued DESC,OBJECTID ASC':'ObjectId'}));
 if(!Array.isArray(page.features))throw new Error('Resposta ArcGIS sem lista de registros; cobertura não certificada.');
 const pageKey=page.features.map(f=>String(f.attributes?.OBJECTID??f.attributes?.ObjectId??'')).join('|');
 if(offset>0&&page.features.length&&pageKey===previousPageKey)throw new Error('Paginação ArcGIS repetiu registros; cobertura não certificada.');
 previousPageKey=pageKey;
 for(const feature of page.features){const r=feature.attributes,type=hart?[r.RECORD_TYPE_TYPE,r.B1_APP_TYPE_ALIAS].filter(Boolean).join(' '):r.Record_Type;if(/certificate|occupancy|completion|complaint|zoning/i.test(type)&&!/building|construction|addition|alteration/i.test(type))continue;
 records.push(record(source,r.OBJECTID??r.ObjectId,hart?r.DateIssued:r.Permit_License_Issued_Date,hart?r.PROPERTY_ADDRESS:r.Address,hart?r.RECORD_ID:r.Record__,hart?r.DESCRIPTION:r.Permit_For==='N/A'?'Descrição não disponibilizada; escopo desconhecido.':r.Permit_For,type,hart?r.Total_Construction_Cost:0,hart?'':r.Contractor_Name,'',source.url,hart?r.RECORD_STATUS:r.Record_Status));}
 if(page.features.length<1000&&page.exceededTransferLimit!==true)break;
 if(offset===19000)complete=false;}
 }else if(source.mode==='milton'){
 const last=new Date(Date.parse(end+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 for(let offset=0;offset<10000;offset+=200){const form=new URLSearchParams({draw:'1',start:String(offset),length:'200','order[0][column]':'5','order[0][dir]':'desc','search[value]':'','search[regex]':'false'});
 for(let i=0;i<14;i++){for(const [k,v] of Object.entries({data:String(i),name:'',searchable:'true',orderable:'true'}))form.set('columns['+i+']['+k+']',v);form.set('columns['+i+'][search][regex]','false');form.set('columns['+i+'][search][value]',i===5?start+' | '+last:'');}
 const page=await json('https://permiteyes.us/milton/ajax/getpublichome.php',{method:'POST',body:form,headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest',Referer:source.url}});
 if(!Array.isArray(page.data))throw new Error('Formato PermitEyes mudou.');
 for(const r of page.data){const issued=issueDate(clean(r[5]));if(issued>=start&&issued<end)records.push(record(source,clean(r[3])||clean(r[11]),issued,r[6],r[11],clean(r[9])+' [Resumo do portal; conferir descrição integral]',String(r[10]).match(/title=["']([^"']+)/)?.[1]||r[10],0,'',r[7],source.url,r[12]));}
 if(offset+page.data.length>=page.recordsFiltered||!page.data.length)break;if(offset===9800)complete=false;}
 }else if(source.mode==='westerly'){
 const html=await http(source.url),name=['January','February','March','April','May','June','July','August','September','October','November','December'][m-1];
 const links=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)],match=links.find(x=>new RegExp(name+'[ -]+'+y,'i').test(clean(x[2])+' '+x[1])&&/csv/i.test(x[1]+' '+x[2]));
 if(!match)return {status:'pending',records:[],message:'Relatório '+name+' '+y+' não publicado/localizado. Isso não significa zero permits.'};
 const url=new URL(match[1].replace(/&amp;/g,'&'),source.url);if(url.hostname.replace(/^www[.]/,'')!=='westerlyri.gov')throw new Error('CSV fora do domínio municipal.');
 const rows=parseCsv(await http(url.href));if(rows.length&&!('Date Issued' in rows[0]))throw new Error('Colunas do relatório mudaram.');
 for(const r of rows){if(r.Title!=='Building Permit'||r.Type!=='Permit/License')continue;const issued=issueDate(r['Date Issued']);if(!issued)throw new Error('Data não reconhecida no CSV.');if(issued<start||issued>=end)continue;
 const p=record(source,r['Record #'],issued,r['Full Address'],r['Record #'],'Categoria municipal: '+r['Type of Improvement']+'. Descrição integral ausente no CSV.','Building Permit',r['Estimated cost of Labor and Materials'],r['GC Name'],r['Applicant Name'],url.href);if(r['GC Phone #'])p.phone=r['GC Phone #'];records.push(p);}
 }
 const unique=[...new Map(records.map(p=>[p.id,p])).values()];return {status:complete?'complete':'partial',records:unique,message:(complete?'Período coletado com paginação.':'Limite de segurança atingido; cobertura parcial.')+(['worcester','westerly','milton'].includes(source.mode)?' A fonte contém descrições ausentes ou resumidas; revisar escopo.':'')};
}
