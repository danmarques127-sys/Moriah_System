const home='https://www.amesburyma.gov/203/Inspectional-Services';
const res=await fetch(home,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'MoriahSystem/1.0 municipal public records'}});
if(!res.ok)throw Error('Municipal page HTTP '+res.status);
const html=await res.text();
const links=[...html.matchAll(/href=["']([^"']+)["']/gi)]
 .map(x=>new URL(x[1].replaceAll('&amp;','&'),home).href)
 .filter(url=>url.startsWith('https://www.amesburyma.gov/'));
const reports=[...new Set(links.filter(x=>/permit|building|documentcenter/i.test(x)))];
console.log(JSON.stringify({source:'amesbury',status:res.status,possibleReportLinks:reports.slice(0,40)}));
const known='https://www.amesburyma.gov/DocumentCenter/View/6385/Building-Permits-October-2026';
const doc=await fetch(known,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'MoriahSystem/1.0 municipal public records'}});
const bytes=new Uint8Array(await doc.arrayBuffer());
console.log(JSON.stringify({reportStatus:doc.status,contentType:doc.headers.get('content-type'),bytes:bytes.length,magic:Array.from(bytes.slice(0,8)).map(x=>x.toString(16).padStart(2,'0')).join(''),header:new TextDecoder().decode(bytes.slice(0,120)).replace(/[^ -~]/g,' ')}));
if(!doc.ok)process.exitCode=1;
