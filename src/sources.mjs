import {DOCUMENT_SOURCES,PORTAL_REASONS} from './source-configs.mjs';
const BASE=[
  {
    "id": "boston",
    "city": "Boston",
    "state": "MA",
    "url": "https://data.boston.gov/dataset/approved-building-permits",
    "mode": "boston",
    "allowedHosts": []
  },
  {
    "id": "cambridge",
    "city": "Cambridge",
    "state": "MA",
    "url": "https://data.cambridgema.gov/General-Government/Cambridge-Permit-Finder/3wsm-e5jx",
    "mode": "cambridge",
    "allowedHosts": []
  },
  {
    "id": "somerville",
    "city": "Somerville",
    "state": "MA",
    "url": "https://data.somervillema.gov/Government-Finance/Applications-for-Permits-and-Licenses/nneb-s3f7",
    "mode": "somerville",
    "allowedHosts": []
  },
  {
    "id": "newton",
    "city": "Newton",
    "state": "MA",
    "url": "https://www.newtonma.gov/government/inspectional-services/building-permit-summary-report",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "needham",
    "city": "Needham",
    "state": "MA",
    "url": "https://www.needhamma.gov/5024/Building-Permits-Issued",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "milton",
    "city": "Milton",
    "state": "MA",
    "url": "https://permiteyes.us/milton/publicview.php",
    "mode": "milton",
    "allowedHosts": []
  },
  {
    "id": "wellesley",
    "city": "Wellesley",
    "state": "MA",
    "url": "https://www.wellesleyma.gov/168/Report-of-Permits-Issued",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "belmont",
    "city": "Belmont",
    "state": "MA",
    "url": "https://www.belmont-ma.gov/348/Monthly-Permit-Reports",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "arlington",
    "city": "Arlington",
    "state": "MA",
    "url": "https://www.arlingtonma.gov/departments/inspectional-services/building-permit-activity",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "lexington",
    "city": "Lexington",
    "state": "MA",
    "url": "https://www.lexingtonma.gov/1555/Building-Permit-Activity",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "sudbury",
    "city": "Sudbury",
    "state": "MA",
    "url": "https://sudbury.ma.us/building/document_categories/permits/",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "weston",
    "city": "Weston",
    "state": "MA",
    "url": "https://www.westonma.gov/",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "brookline",
    "city": "Brookline",
    "state": "MA",
    "url": "https://aca-prod.accela.com/BROOKLINE/Cap/CapHome.aspx?module=Building",
    "mode": "portal",
    "allowedHosts": []
  },
  {
    "id": "andover",
    "city": "Andover",
    "state": "MA",
    "url": "https://andoverma.gov/Archive/70",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "wakefield",
    "city": "Wakefield",
    "state": "MA",
    "url": "https://www.wakefieldma.gov/375/Monthly-Building-Reports",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "reading",
    "city": "Reading",
    "state": "MA",
    "url": "https://www.readingma.gov/959/Monthly-Building-Permit-Report",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "danvers",
    "city": "Danvers",
    "state": "MA",
    "url": "https://www.danversma.gov/351/Planning-Economic-Development",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "waltham",
    "city": "Waltham",
    "state": "MA",
    "url": "https://www.city.waltham.ma.us/1299/Permit-Reports-by-Month",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "carlisle",
    "city": "Carlisle",
    "state": "MA",
    "url": "https://www.carlislema.gov/1263/Monthly-Permit-Reports",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "worcester",
    "city": "Worcester",
    "state": "MA",
    "url": "https://www.worcesterma.gov/announcements/worcester-revamps-open-data-portal",
    "mode": "worcester",
    "allowedHosts": []
  },
  {
    "id": "hartford",
    "city": "Hartford",
    "state": "CT",
    "url": "https://www.hartfordct.gov/Government/Departments/DDS",
    "mode": "hartford",
    "allowedHosts": [
      "utility.arcgis.com",
      "gis.hartford.gov",
      "data.hartford.gov"
    ]
  },
  {
    "id": "westerly",
    "city": "Westerly",
    "state": "RI",
    "url": "https://www.westerlyri.gov/533/3397/Building-Permit-Reports",
    "mode": "westerly",
    "allowedHosts": []
  },
  {
    "id": "west-hartford",
    "city": "West Hartford",
    "state": "CT",
    "url": "https://www.westhartfordct.gov/town-departments/building/monthly-permit-reports",
    "mode": "report",
    "allowedHosts": [
      "resources.finalsite.net"
    ]
  },
  {
    "id": "milford",
    "city": "Milford",
    "state": "CT",
    "url": "https://www.milfordct.us/520/List-of-Permits-Issued-by-Month",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "newport",
    "city": "Newport",
    "state": "RI",
    "url": "https://www.newportri.gov/city-hall/departments/zoning-inspections/inspections",
    "mode": "portal",
    "allowedHosts": []
  },
  {
    "id": "warwick",
    "city": "Warwick",
    "state": "RI",
    "url": "https://www.warwickri.gov/187/Building-Department",
    "mode": "portal",
    "allowedHosts": []
  },
  {
    "id": "providence",
    "city": "Providence",
    "state": "RI",
    "url": "https://www.providenceri.gov/inspection/online-permitting/",
    "mode": "portal",
    "allowedHosts": []
  },
  {
    "id": "amesbury",
    "city": "Amesbury",
    "state": "MA",
    "url": "https://www.amesburyma.gov/203/Inspectional-Services",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "north-attleborough",
    "city": "North Attleborough",
    "state": "MA",
    "url": "https://www.northattleborough.gov/202/Monthly-List-of-Building-Permits-Issued",
    "mode": "report",
    "allowedHosts": []
  },
  {
    "id": "chatham",
    "city": "Chatham",
    "state": "MA",
    "url": "https://chatham-ma.gov/539/Building-Permits-Issued",
    "mode": "report",
    "allowedHosts": []
  }
];

const variants=u=>{const h=new URL(u).hostname;return [h.startsWith('www.')?h.slice(4):'www.'+h];};
export const SOURCES=BASE.map(s=>{
  const d=DOCUMENT_SOURCES[s.id];
  if(d)return {...s,mode:'documents',collector:d.collector,allowedHosts:[...new Set([...(s.allowedHosts||[]),...(d.allowedHosts||[]),...variants(s.url)])]};
  if(PORTAL_REASONS[s.id])return {...s,reason:PORTAL_REASONS[s.id]};
  return s;
});
export const sourceById=id=>{const s=SOURCES.find(s=>s.id===id);if(!s)throw new Error('Fonte não cadastrada.');return s;};
