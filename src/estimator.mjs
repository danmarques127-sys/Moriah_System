const number=(v,label,min=0,max=1e9)=>{const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw new Error(label+' inválido.');return n;};
export const SECTION_TYPES=['Roof / Rafters','Slopes','Ceiling','Gable Walls','Exterior Walls','Basement Walls','Blockers','Crawl Space'];
export const DEFAULT_SETTINGS={
 company:{industry:'Insulation',name:'H&M Brothers Insulation',address:'175 Millwood Street, Framingham MA 01701',phone:'(508) 400-5407',email:'',salesperson:'Dan Marques',logoUrl:''},
 pricing:{laborPerSqft:0,overheadPct:0,marginPct:20,taxPct:0,depositPct:0,mobilization:0},
 materials:[
 {id:'cc',name:'Closed Cell Spray Foam',kind:'foam',rPerInch:7.5,yieldBFPerGallon:96,price:50,barrelGallons:45,reference:'Rendimento inicial calibrado à amostra de consumo fornecida; confirmar produto e base de medição.'},
 {id:'oc',name:'Open Cell Spray Foam',kind:'foam',rPerInch:4.2,yieldBFPerGallon:384,price:37,barrelGallons:45,reference:'Rendimento inicial calibrado à amostra fornecida; confirmar ficha técnica e consumo real.'},
 {id:'fiberglass-r15',name:'Fiberglass R15 Kraft',kind:'batt',nominalR:15,coveragePerPackage:65.67,price:0,reference:'Cobertura provisória da amostra 788 sqft / 12 bags. Substituir pela ficha do SKU comprado.'},
 {id:'fiberglass-r30',name:'Fiberglass R30 Unfaced',kind:'batt',nominalR:30,coveragePerPackage:0,price:0,reference:'Configurar cobertura e preço da embalagem do fabricante.'},
 {id:'rockwool-r23',name:'ROCKWOOL R23',kind:'batt',nominalR:23,coveragePerPackage:0,price:0,reference:'Configurar SKU, cobertura da embalagem e preço.'},
 {id:'blow-in',name:'Blown-in insulation',kind:'blow',coverageByR:{},price:0,reference:'Configurar tabela de cobertura por R da ficha, não usar cobertura única para todos os R-values.'},
 {id:'foam-board',name:'Rigid foam board',kind:'board',nominalR:13,coveragePerPackage:32,price:0,reference:'Exemplo de folha 4 x 8. Confirmar R, dimensões e preço do SKU.'},
 {id:'thermal-paint',name:'Thermal barrier coating',kind:'paint',nominalR:0,coveragePerPackage:0,price:0,reference:'Cobertura depende do sistema aprovado e espessura aplicada; não acrescenta R-value neste cálculo.'}
 ]};
export function feet(value){
 if(typeof value==='number')return number(value,'Medida',0,100000);
 const text=String(value??'').trim();if(!text)return 0;
 if(/^\d+(?:\.\d+)?$/.test(text))return number(text,'Medida',0,100000);
 const m=text.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)(?:\s*(\d+(?:\.\d+)?)\s*(?:"|in|inches)?)?$/i);
 if(!m)throw new Error('Use pés decimais ou formato 12\' 6".');
 const inches=Number(m[2]||0);if(inches>=12)throw new Error('Polegadas devem ser menores que 12.');return number(Number(m[1])+inches/12,'Medida',0,100000);
}
export function settingsFrom(raw={}){
 const base=structuredClone(DEFAULT_SETTINGS);const company=raw.company||{},pricing=raw.pricing||{};
 for(const key of Object.keys(base.company)){if(company[key]!==undefined){if(typeof company[key]!=='string'||company[key].length>1000)throw new Error('Perfil inválido.');base.company[key]=company[key];}}
 if(!['Insulation','Painting','Flooring','General Contracting','Other'].includes(base.company.industry))throw new Error('Unsupported business type.');
 if(base.company.logoUrl){const u=new URL(base.company.logoUrl);if(u.protocol!=='https:')throw new Error('Logo deve usar HTTPS.');}
 for(const key of Object.keys(base.pricing))if(pricing[key]!==undefined)base.pricing[key]=number(pricing[key],key,0,key==='marginPct'?95:key.endsWith('Pct')?100:1e6);
 if(raw.materials!==undefined){if(!Array.isArray(raw.materials)||!raw.materials.length||raw.materials.length>100)throw new Error('Catálogo inválido.');
 const ids=new Set();base.materials=raw.materials.map(m=>{if(!m||!/^[a-z0-9-]{1,60}$/.test(m.id)||ids.has(m.id)||!['foam','batt','blow','board','paint'].includes(m.kind)||typeof m.name!=='string'||!m.name.trim()||m.name.length>150)throw new Error('Material inválido.');ids.add(m.id);
 const x={id:m.id,name:m.name.trim(),kind:m.kind,price:number(m.price??0,'Preço'),reference:String(m.reference||'').slice(0,1000)};
 if(m.kind==='foam'){x.rPerInch=number(m.rPerInch,'R/in',0.1,30);x.yieldBFPerGallon=number(m.yieldBFPerGallon,'Rendimento BF/gal',0.1,5000);x.barrelGallons=number(m.barrelGallons??45,'Volume do barril',1,1000);}
 else if(m.kind==='blow'){x.coverageByR={};for(const [r,c] of Object.entries(m.coverageByR||{})){const R=number(r,'R-value',1,200);x.coverageByR[String(R)]=number(c,'Cobertura por R',0.01,100000);}}
 else{x.nominalR=number(m.kind==='paint'?0:m.nominalR??0,'R nominal',0,200);x.coveragePerPackage=number(m.coveragePerPackage??0,'Cobertura',0,100000);}
 return x;});}
 return base;
}
export function sectionArea(s){
 const geometry=s.geometry||'rectangle';if(!['rectangle','triangle','roof-plan','direct'].includes(geometry))throw new Error('Geometria inválida.');
 const qty=number(s.quantity??1,'Quantidade',1,1000),sides=number(s.sides??1,'Lados',1,2);if(!Number.isInteger(qty)||![1,2].includes(sides))throw new Error('Quantidade ou lados inválidos.');
 let gross=geometry==='direct'?number(s.directArea,'Área direta',0,1e7):feet(s.length)*feet(s.width)*(geometry==='triangle'?0.5:1);
 if(geometry==='roof-plan'){const pitch=number(s.pitchRise??0,'Inclinação x/12',0,36);gross*=Math.sqrt(1+(pitch/12)**2);}
 gross*=qty*sides;const openings=number(s.openings??0,'Descontos totais');if(openings>gross)throw new Error('Descontos excedem a área contada.');
 return {gross,openings,net:gross-openings};
}
export function calculateEstimate(input,settings=DEFAULT_SETTINGS){
 const cfg=settingsFrom(settings);if(!input||!Array.isArray(input.sections)||!input.sections.length||input.sections.length>200)throw new Error('Informe entre 1 e 200 seções.');
 const totals=new Map(),warnings=[],missing=new Set();let totalArea=0,totalLabor=0;
 const sections=input.sections.map((s,index)=>{
  const area=sectionArea(s);if(area.net<=0)throw new Error('Seção '+(index+1)+': informe área maior que zero.');
  const targetR=number(s.targetR??0,'R alvo',0,200),waste=number(s.wastePct??0,'Perdas',0,100)/100,cavity=number(s.cavityDepth??0,'Profundidade',0,100);
  if(!Array.isArray(s.layers)||!s.layers.length||s.layers.length>8)throw new Error('Configure a montagem da seção '+(index+1)+'.');
  if(s.layers.filter(l=>l.mode==='fill').length>1||s.layers.some((l,i)=>l.mode==='fill'&&i!==s.layers.length-1))throw new Error('O preenchimento automático deve ser a última e única camada de fill.');
  let installedR=0,depth=0,materialCost=0;const layers=[];
  for(const layer of s.layers){
   const m=cfg.materials.find(x=>x.id===layer.materialId);if(!m)throw new Error('Material não encontrado.');
   let inches=0,R=0,bf=0,units=0;
   if(m.kind==='foam'){inches=layer.mode==='fill'?Math.max(0,targetR-installedR)/m.rPerInch:number(layer.inches??0,'Espessura',0,100);R=inches*m.rPerInch;bf=area.net*inches;units=bf*(1+waste)/m.yieldBFPerGallon;}
   else{if(layer.mode==='fill')throw new Error('Fill automático só se aplica a spray foam.');
    R=m.kind==='blow'?Math.max(0,targetR-installedR):m.nominalR;
    const coverage=m.kind==='blow'?m.coverageByR[String(R)]:m.coveragePerPackage;
    if(!coverage)throw new Error('Configure a cobertura do produto '+m.name+(m.kind==='blow'?' para R-'+R:'')+' na ficha de materiais.');
    units=area.net*(1+waste)/coverage;inches=number(layer.inches??0,'Espessura do produto',0,100);
   }
   installedR+=R;depth+=inches;materialCost+=units*m.price;
   if(units>0&&!m.price)missing.add(m.name);
   const aggregate=totals.get(m.id)||{id:m.id,name:m.name,kind:m.kind,units:0,boardFeet:0,price:m.price,barrelGallons:m.barrelGallons||0};
   aggregate.units+=units;aggregate.boardFeet+=bf;totals.set(m.id,aggregate);
   layers.push({materialId:m.id,name:m.name,kind:m.kind,inches,R,boardFeet:bf,units,cost:units*m.price});
  }
  if(installedR+0.01<targetR)warnings.push('Seção '+(index+1)+': montagem R-'+installedR.toFixed(1)+' abaixo do alvo R-'+targetR+'.');
  if(cavity&&depth>cavity+0.01)warnings.push('Seção '+(index+1)+': espessura '+depth.toFixed(2)+'" excede a cavidade '+cavity+'".');
  totalArea+=area.net;const labor=area.net*cfg.pricing.laborPerSqft;totalLabor+=labor;
  return {id:String(s.id||index+1),name:String(s.name||s.type||'Seção '+(index+1)).slice(0,200),type:String(s.type||'Other'),...area,targetR,installedR,depth,wastePct:waste*100,layers,materialCost,labor,cost:materialCost+labor};
 });
 const materials=[...totals.values()].filter(m=>m.units>0).map(m=>({...m,purchaseUnits:Math.ceil(m.units-1e-9),barrelEquivalents:m.kind==='foam'?m.units/m.barrelGallons:0,purchaseCost:Math.ceil(m.units-1e-9)*m.price,unitLabel:m.kind==='foam'?'galão de referência':'embalagem'}));
 const materialCost=materials.reduce((n,m)=>n+m.purchaseCost,0),mobilization=number(input.mobilization??cfg.pricing.mobilization,'Mobilização'),otherCost=number(input.otherCost??0,'Outros custos');
 const directCost=materialCost+totalLabor+mobilization+otherCost,overhead=directCost*cfg.pricing.overheadPct/100,cost=directCost+overhead;
 const manual=input.manualSubtotal===''||input.manualSubtotal===undefined||input.manualSubtotal===null?null:number(input.manualSubtotal,'Preço manual',0.01);
 const cents=v=>Math.round((v+Number.EPSILON)*100)/100;const subtotal=cents(manual??cost/(1-cfg.pricing.marginPct/100)),discount=cents(number(input.discount??0,'Desconto',0,subtotal)),taxable=cents(subtotal-discount),tax=cents(taxable*cfg.pricing.taxPct/100),total=cents(taxable+tax);
 if(missing.size)warnings.push('Preço de material não configurado: '+[...missing].join(', ')+'.');
 const sumWeight=sections.reduce((n,s)=>n+s.cost,0);
 let remaining=Math.round(subtotal*100);for(let i=0;i<sections.length;i++){const s=sections[i],allocated=i===sections.length-1?remaining:Math.min(remaining,Math.round(subtotal*100*(sumWeight?s.cost/sumWeight:s.net/totalArea)));s.saleAmount=allocated/100;remaining-=allocated;}
 return {sections,materials,totalArea,materialCost,laborCost:totalLabor,mobilization,otherCost,overhead,cost,subtotal,discount,tax,total,deposit:cents(total*cfg.pricing.depositPct/100),profit:taxable-cost,marginPct:taxable?(taxable-cost)/taxable*100:0,warnings,pricingComplete:missing.size===0,canPropose:missing.size===0||manual!==null,gallonNote:'Galões seguem o rendimento calibrado do seu fluxo. Barris são equivalentes de volume de 45 gal, não pares A/B nem kits de compra. Confirme a base de consumo do produto.',codeNote:'R-values são alvos definidos pelo estimador; não são uma determinação automática de conformidade com código.'};
}
