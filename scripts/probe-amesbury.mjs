const home='https://www.amesburyma.gov/203/Inspectional-Services';
const res=await fetch(home,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'MoriahSystem/1.0 public source validation'}});
if(!res.ok)throw Error('Municipal landing page HTTP '+res.status);
const html=await res.text();
const links=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\\S]*?)<\\/a>/gi)]
 .map(x=>({href:new URL(x[1].replaceAll('&amp;','&'),home).href,label:x[2].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}));
const reports=links.filter(x=>/building permits? (?:october|oct\\.?|sept\\.?)/i.test(x.label));
console.log(JSON.stringify({source:'amesbury',landingStatus:res.status,candidates:reports.map(x=>({label:x.label,url:x.href}))}));
if(!reports.length)throw Error('No municipal report link discovered');
const doc=await fetch(reports[0].href,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'MoriahSystem/1.0 public source validation'}});
const bytes=new Uint8Array(await doc.arrayBuffer());
console.log(JSON.stringify({reportStatus:doc.status,contentType:doc.headers.get('content-type'),bytes:bytes.length,magic:Array.from(bytes.slice(0,8)).map(x=>x.toString(16).padStart(2,'0')).join(''),asciiHeader:new TextDecoder().decode(bytes.slice(0,60)).replace(/[^ -~]/g,' ')}));
if(!doc.ok)process.exitCode=1;
