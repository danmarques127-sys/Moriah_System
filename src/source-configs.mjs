// Collector settings for the cities that publish monthly/quarterly/annual documents instead of an open-data API.
// `verified` stays false until a real document of that city has been parsed end to end: such sources
// finish as "partial" (never "complete") so the coverage screen never over-claims.
// scope: 'month' (file named after the month), 'quarter', 'year', 'fiscal', or 'latest' (newest period on the page).
// `dateKind` says which date the document exposes: 'issued' (default), 'paid', 'submitted' or 'range'.
// Column layouts read from the real reports (x as a fraction of the page width unless noted).
const WEST_HARTFORD_BBOX = {relX: true,
  anchor: {number: [0.25, 0.33], pattern: '^[A-Z]{3,6}\\d{9,16}$', splitHead: '^[A-Z]{3,6}\\d{9,16}$', assign: 'above'},
  columns: {address: [0.09, 0.249], value: {x: [0.333, 0.406], maxDy: 16}, class: {x: [0.408, 0.466], maxDy: 16}, type: {x: [0.466, 0.54], maxDy: 16}, applied: {x: [0.65, 0.72], maxDy: 16}, description: [0.2545, 0.69], ctype: [0.72, 0.81], contacts: [0.81, 1]}};
const BETHEL_BBOX = {
    anchor: {number: [100, 135], pattern: '^[A-Z]{1,3}-\\d{2}-\\d+$', headerBottom: 140, footerTop: 548},
    columns: {issued: [72, 100], type: [155, 205], owner: [205, 250], address: [250, 290], company: [360, 405], contractor: [405, 440], description: [522, 575], value: [600, 636]},
  };
const MILFORD_BBOX = {relX: true,
  anchor: {number: [0.045, 0.112], pattern: '^B-\\d{2}-\\d{3,5}$', splitHead: '^[A-Z]{1,5}-\\d{2}-$', assign: 'above'},
  columns: {owner: [0.113, 0.209], type: [0.21, 0.295], issued: [0.296, 0.375], address: [0.375, 0.495], description: [0.495, 0.688], contractor: [0.688, 0.808], value: [0.808, 0.887]}};
export const DOCUMENT_SOURCES = {
  // Needham publishes per period (quarter/half-year): take the newest year and period, all its files.
  needham: {collector: {verified: true, scope: 'quarter', match: 'quarter', maxFiles: 2, parser: 'cards'}},
  // Wellesley: the Archive Center category lists one item per year and type; each item is an .aspx page with the table.
  wellesley: {collector: {verified: true, scope: 'year', listUrls: ['https://www.wellesleyma.gov/Archive.aspx?AMID=36', 'https://www.wellesleyma.gov/168/Report-of-Permits-Issued'], match: 'permit', dateKind: 'submitted', maxFiles: 4}},
  // Arlington: two shared workbooks (SharePoint links supplied by the town). Rows are filtered by issue month.
  arlington: {
    collector: {fileUrls: [
      'https://arlingtonma-my.sharepoint.com/:x:/g/personal/kmobrien_town_arlington_ma_us/IQAgP4aQwU-TTpqxtSUbV2J9AW2drn1sP4C4ZLeXEfcU14c?rtime=ul13KbVJ30g',
      'https://arlingtonma-my.sharepoint.com/:x:/g/personal/kmobrien_town_arlington_ma_us/IQAi_y90fVULS50ipP0aMo8CAe1HsymTRr4V3Jq8muA3BTE?e=BCy5YX'
    ]},
    allowedHosts: ['arlingtonma-my.sharepoint.com']
  },
  lexington: {collector: {verified: true, scope: 'month'}},
  // Sudbury: a monthly PDF in the Building Department permits category.
  sudbury: {collector: {verified: true, scope: 'month', itemPages: true, listUrls: ['https://sudbury.ma.us/building/document_categories/permits/', 'https://sudbury.ma.us/building/document_categories/permits/page/2/']}},
  // Andover: the Archive Center keeps CSV/PDF files; the newest year/period is the current one.
  andover: {collector: {verified: true, scope: 'latest', listUrls: ['https://andoverma.gov/Archive.aspx?AMID=70', 'https://andoverma.gov/Archive/70'], match: 'permit', rowMode: 'dated-line', maxFiles: 2}},
  wakefield: {collector: {verified: true, scope: 'month', match: 'Building Permits Issued', dateKind: 'paid', columns: ['type', 'skip', 'date', 'address', 'skip', 'value', 'description', 'contractor']}},
  reading: {collector: {verified: true, scope: 'month', match: 'Building-Permits-Issued|Building Permits Issued|permit'}},
  waltham: {collector: {verified: true, scope: 'month', monthHeading: true, textEquals: '{year}', match: 'DocumentCenter', maxFiles: 2}},
  'west-hartford': {collector: {verified: true, scope: 'month', inferYear: true, dateKind: 'submitted', parser: 'bbox', bbox: WEST_HARTFORD_BBOX}, allowedHosts: ['resources.finalsite.net']},
  milford: {collector: {scope: 'month', match: 'permit', parser: 'bbox', bbox: MILFORD_BBOX, listUrls: ['https://www.milfordct.us/Archive.aspx?AMID=41&Type=Recent', 'https://www.milfordct.us/Archive.aspx?AMID=41', 'https://www.milfordct.us/520/List-of-Permits-Issued-by-Month']}},
  amesbury: {collector: {verified: true, scope: 'month', match: 'permit|bldg', dateKind: 'submitted', leadDate: true, columns: ['applicant', 'address', 'description', 'value']}},
  'north-attleborough': {collector: {verified: true, scope: 'month', match: 'permit|building'}, allowedHosts: ['northattleborough.gov', 'nattleboro.com']},
  // Barnstable: one PDF per month with a predictable name (Record #, Date Issued, Project Cost, Work Description, Full Address).
  // Southbury: "M5 Permit Report" PDF per month (wide table, read by column position).
  southbury: {collector: {verified: true, scope: 'month', fileTemplates: ['https://www.southbury-ct.org/filestorage/20556/20567/20573/39794/Building_Permit_Report-{Month}_{year}.pdf']}, allowedHosts: ['southbury-ct.org']},
  // Bethel: the town changes the file name from month to month, so both known names are tried.
  bethel: {collector: {scope: 'month', parser: 'bbox', bbox: BETHEL_BBOX, fileTemplates: ['https://bethel-ct.gov/vertical/sites/%7B90B1B948-C443-4CA6-8B88-90B1EEA9B1E2%7D/uploads/{Month}_{year}_Permit_Report.pdf', 'https://bethel-ct.gov/vertical/sites/%7B90B1B948-C443-4CA6-8B88-90B1EEA9B1E2%7D/uploads/{Month}_{year}_Permits_Issued.pdf']}},
  chatham: {collector: {scope: 'month', match: 'Building-Permits-Issued|Building Permits Issued|permit', columns: ['date', 'streetNo', 'street', 'description', 'applicant', 'value', 'skip', 'skip']}}
};

// Accela Citizen Access portals: the collector fills the public General Search date range and pages through the results.
// The portal date is the application (opened) date, not the issue date.
export const ACCELA_SOURCES = {
};

// No scriptable bulk source yet. These stay import-only, with the reason shown in the job log.
export const PORTAL_REASONS = {
  danvers: 'O site de Danvers bloqueia acesso automático (HTTP 403) e a lista só chega até dezembro de 2025. Não há tentativa de contornar. Baixe o relatório pelo navegador e importe.',
  springfield: 'Springfield publica os permits em um portal OpenGov sem exportação automática. Importe o relatório pela tela de importação.',
  chicopee: 'Chicopee usa o portal PermitEyes de consulta; não há exportação em massa. Importe o relatório.',
  bridgeport: 'Bridgeport só fornece permits por pedido de registros públicos (records request). Importe o arquivo recebido.',
  stamford: 'Stamford só fornece os registros por pedido ao Building Department. Importe o arquivo recebido.',
  pawtucket: 'Pawtucket não publica uma lista de permits emitidos; só informações do departamento. Importe quando houver arquivo.',
  brookline: 'Brookline usa um portal Accela que exige busca manual. Os permits são importados à mão pela tela de importação (PDF/CSV/XLSX).',
  carlisle: 'O relatório mensal de Carlisle só traz tabelas-resumo de taxas, sem número de permit nem data de emissão. Não dá para coletar com segurança; importe o arquivo se precisar.',
  newton: 'Os permits ficam em um relatório do OpenGov que só exporta CSV pelo botão Export; ainda não há coletor para isso. Importe o relatório.'
};

// Parsers used only by the manual file import for cities that have no automatic collector.
// bbox: the PDF is a wide table; columns are x ranges (PDF points) read from word positions.
export const UPLOAD_CONFIGS = {
  bethel: {parser: 'bbox', bbox: BETHEL_BBOX},
};
