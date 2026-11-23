// Collector settings for the cities that publish monthly/quarterly/annual documents instead of an open-data API.
// `verified` stays false until a real document of that city has been parsed end to end: such sources
// finish as "partial" (never "complete") so the coverage screen never over-claims.
// scope: 'month' (file named after the month), 'quarter', 'year', 'fiscal', or 'latest' (newest period on the page).
// `dateKind` says which date the document exposes: 'issued' (default), 'paid', 'submitted' or 'range'.
export const DOCUMENT_SOURCES = {
  // Needham publishes per period (quarter/half-year): take the newest year and period, all its files.
  needham: {collector: {scope: 'quarter', match: 'quarter', maxFiles: 2}},
  // Wellesley: the Archive Center category lists one item per year and type; each item is an .aspx page with the table.
  wellesley: {collector: {scope: 'year', listUrls: ['https://www.wellesleyma.gov/Archive.aspx?AMID=36', 'https://www.wellesleyma.gov/168/Report-of-Permits-Issued'], match: 'permit', dateKind: 'submitted', maxFiles: 4}},
  // Belmont: one report per month ("Permit Report - Aug 2025"); the report only exposes its date range.
  belmont: {collector: {scope: 'month', match: 'permit', crawl: true, crawlRe: 'archive|permit report|monthly', dateKind: 'range', dateFallback: 'month-start'}},
  // Arlington: two shared workbooks (SharePoint links supplied by the town). Rows are filtered by issue month.
  arlington: {
    collector: {fileUrls: [
      'https://arlingtonma-my.sharepoint.com/:x:/g/personal/kmobrien_town_arlington_ma_us/IQAgP4aQwU-TTpqxtSUbV2J9AW2drn1sP4C4ZLeXEfcU14c?rtime=ul13KbVJ30g',
      'https://arlingtonma-my.sharepoint.com/:x:/g/personal/kmobrien_town_arlington_ma_us/IQAi_y90fVULS50ipP0aMo8CAe1HsymTRr4V3Jq8muA3BTE?e=BCy5YX'
    ]},
    allowedHosts: ['arlingtonma-my.sharepoint.com']
  },
  lexington: {collector: {scope: 'month'}},
  // Sudbury: a monthly PDF in the Building Department permits category.
  sudbury: {collector: {scope: 'month', itemPages: true, listUrls: ['https://sudbury.ma.us/building/document_categories/permits/', 'https://sudbury.ma.us/building/document_categories/permits/page/2/']}},
  // Andover: the Archive Center keeps CSV/PDF files; the newest year/period is the current one.
  andover: {collector: {scope: 'latest', listUrls: ['https://andoverma.gov/Archive.aspx?AMID=70', 'https://andoverma.gov/Archive/70'], match: 'permit', rowMode: 'dated-line', maxFiles: 2}},
  wakefield: {collector: {scope: 'month', match: 'Building Permits Issued', dateKind: 'paid', columns: ['type', 'skip', 'date', 'address', 'skip', 'value', 'description', 'contractor']}},
  reading: {collector: {scope: 'month', match: 'Building-Permits-Issued|Building Permits Issued|permit'}},
  // Danvers: the planning page links to a monthly "Permitting Update"; open it and clean the permit list.
  danvers: {collector: {scope: 'month', match: 'Permitting.Update', fileLag: true, dateKind: 'submitted', crawl: true, crawlRe: 'permitting|update'}},
  waltham: {collector: {scope: 'year', textEquals: '{year}', match: 'DocumentCenter', maxFiles: 12}},
  'west-hartford': {collector: {scope: 'month'}, allowedHosts: ['resources.finalsite.net']},
  milford: {collector: {scope: 'month', match: 'permit', listUrls: ['https://www.milfordct.us/Archive.aspx?AMID=41']}},
  amesbury: {collector: {scope: 'month', match: 'permit|bldg', dateKind: 'submitted', leadDate: true, columns: ['applicant', 'address', 'description', 'value']}},
  'north-attleborough': {collector: {scope: 'month', match: 'permit|building'}, allowedHosts: ['northattleborough.gov', 'nattleboro.com']},
  chatham: {collector: {scope: 'month', match: 'Building-Permits-Issued|Building Permits Issued|permit', columns: ['date', 'streetNo', 'street', 'description', 'applicant', 'value', 'skip', 'skip']}}
};

// Accela Citizen Access portals: the collector fills the public General Search date range and pages through the results.
// The portal date is the application (opened) date, not the issue date.
export const ACCELA_SOURCES = {
};

// No scriptable bulk source yet. These stay import-only, with the reason shown in the job log.
export const PORTAL_REASONS = {
  southbury: 'Southbury publica relatórios mensais sem coleta automática validada. Importe o relatório do mês.',
  bethel: 'Bethel publica relatórios mensais sem coleta automática validada. Importe o relatório do mês.',
  springfield: 'Springfield publica os permits em um portal OpenGov sem exportação automática. Importe o relatório pela tela de importação.',
  lowell: 'Lowell guarda os relatórios mensais em pastas por ano (DocumentCenter), e ainda não há coletor para essas pastas. Importe o arquivo do mês.',
  chicopee: 'Chicopee usa o portal PermitEyes de consulta; não há exportação em massa. Importe o relatório.',
  bridgeport: 'Bridgeport só fornece permits por pedido de registros públicos (records request). Importe o arquivo recebido.',
  stamford: 'Stamford só fornece os registros por pedido ao Building Department. Importe o arquivo recebido.',
  pawtucket: 'Pawtucket não publica uma lista de permits emitidos; só informações do departamento. Importe quando houver arquivo.',
  brookline: 'Brookline usa um portal Accela que exige busca manual. Os permits são importados à mão pela tela de importação (PDF/CSV/XLSX).',
  carlisle: 'O relatório mensal de Carlisle só traz tabelas-resumo de taxas, sem número de permit nem data de emissão. Não dá para coletar com segurança; importe o arquivo se precisar.',
  newton: 'Os permits ficam em um relatório do OpenGov que só exporta CSV pelo botão Export; ainda não há coletor para isso. Importe o relatório.'
};
