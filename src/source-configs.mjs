// Collector settings for the cities that publish monthly/annual documents instead of an open-data API.
// `verified` stays false until a real document of that city has been parsed end to end: such sources
// finish as "partial" (never "complete") so the coverage screen never over-claims.
// `dateKind` says which date the document exposes: 'issued' (default), 'paid', 'submitted' or 'range'.
export const DOCUMENT_SOURCES = {
  newton: {collector: {scope: 'month', match: 'permit|building', dateWhich: 'last', crawl: true, crawlRe: 'permit|building|report|summary'}},
  needham: {collector: {scope: 'quarter', match: 'permit|building|residential|commercial', maxFiles: 4}},
  wellesley: {collector: {scope: 'year', match: 'permit', followItems: true, dateKind: 'submitted', maxFiles: 4, crawl: true, crawlRe: 'archive|permit'}},
  belmont: {collector: {scope: 'month', match: 'permit', crawl: true, crawlRe: 'archive|permit|report', dateKind: 'range', dateFallback: 'month-start', followItems: true}},
  arlington: {collector: {scope: 'fiscal', match: 'permit', maxFiles: 2}},
  lexington: {collector: {scope: 'month', match: 'permit|building|csv|excel', followItems: true}},
  sudbury: {collector: {scope: 'month', match: 'permit', listUrls: ['https://sudbury.ma.us/all-documents/archived/', 'https://sudbury.ma.us/building/document_categories/permits/'], followItems: true}},
  weston: {collector: {scope: 'month', match: 'permit|building', crawl: true, crawlRe: 'permit|building|inspection'}},
  andover: {collector: {scope: 'year', match: 'permit', followItems: true, rowMode: 'dated-line', maxFiles: 2}},
  wakefield: {collector: {scope: 'month', match: 'Building Permits Issued', dateKind: 'paid', columns: ['type', 'skip', 'date', 'address', 'skip', 'value', 'description', 'contractor']}},
  reading: {collector: {scope: 'month', match: 'Building-Permits-Issued|Building Permits Issued|permit'}},
  danvers: {collector: {scope: 'month', match: 'Permitting.Update', fileLag: true, dateKind: 'submitted', crawl: true, crawlRe: 'permit|planning|update|building'}},
  waltham: {collector: {scope: 'year', textEquals: '{year}', match: 'DocumentCenter', maxFiles: 12}},
  carlisle: {collector: {scope: 'month', match: 'DocumentCenter|permit'}},
  'west-hartford': {collector: {scope: 'month', match: 'permit|building', crawl: true, crawlRe: 'permit|building|report'}, allowedHosts: ['resources.finalsite.net']},
  milford: {collector: {scope: 'month', match: 'permit|building'}, allowedHosts: ['milfordct.gov']},
  amesbury: {collector: {scope: 'month', match: 'permit|bldg', dateKind: 'submitted', crawl: true, crawlRe: 'permit|building|inspection'}},
  'north-attleborough': {collector: {scope: 'month', match: 'permit|building'}, allowedHosts: ['northattleborough.gov', 'nattleboro.com']},
  chatham: {collector: {scope: 'month', match: 'Building-Permits-Issued|Building Permits Issued|permit', columns: ['date', 'streetNo', 'street', 'description', 'applicant', 'value', 'skip', 'skip']}}
};

// No public, scriptable bulk source was found for these. They stay import-only, with the reason shown in the job log.
export const PORTAL_REASONS = {
  brookline: 'Portal Accela exige busca por formulário. O dataset aberto (CivicData) foi atualizado pela última vez em 2023 e não cobre meses recentes. Importe o relatório.',
  providence: 'O dataset aberto vai só até 2018. Permits atuais ficam no ViewPoint Cloud, sem exportação pública verificada. Importe o relatório.',
  warwick: 'Nenhum relatório mensal ou dataset público localizado (portal OpenGov). Solicite os dados ao Building Department e importe.',
  newport: 'Nenhum relatório mensal ou dataset público localizado (portal ViewPoint Cloud). Importe o relatório.'
};
