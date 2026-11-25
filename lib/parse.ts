// Pure parsing helpers for the office search endpoint (kept separate so they can be unit-tested).

export const decode = (value: string) => value
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&#x2F;/gi, '/')
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));

export const clean = (value: string) => decode(value)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export function parseNumber(raw: string): number | null {
  const value = raw.replace(/\s/g, '');
  const normalized = value.includes(',')
    ? value.replace(/\./g, '').replace(',', '.')
    : value.replace(/\.(?=\d{3}(?:\D|$))/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function findNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = parseNumber(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
}

export function monthlyRate(text: string, labels: string[]): number | null {
  const label = labels.join('|');
  const unit = '(?:€\\s*)?[/·]\\s*m(?:2|²)\\s*[/·]\\s*(?:mes|month|año|anual|year)';
  const labelled = new RegExp('(?:' + label + ')[^0-9]{0,120}([0-9][0-9.,]*)\\s*' + unit, 'i');
  const reversed = new RegExp('([0-9][0-9.,]*)\\s*' + unit + '[^A-Za-z]{0,30}(?:' + label + ')', 'i');
  const match = text.match(labelled) || text.match(reversed);
  if (!match?.[1]) return null;
  const amount = parseNumber(match[1]);
  if (amount === null) return null;
  return /(?:año|anual|year)/i.test(match[0]) ? amount / 12 : amount;
}

export function isGenericPage(url: URL, title: string): boolean {
  const parts = url.pathname.toLowerCase().split('/').filter(Boolean);
  const last = parts.at(-1) ?? '';
  const genericSlugs = new Set([
    'madrid', 'oficina', 'oficinas', 'office', 'offices', 'alquiler', 'rent',
    'lease', 'properties', 'property', 'listado', 'listings', 'search', 'inmuebles',
  ]);
  if (!last || genericSlugs.has(last)) return true;
  if (/^(alquiler|rent|lease)\s+(de\s+)?(oficinas?|offices?)\s*(en\s+madrid)?$/i.test(title.trim())) return true;
  return false;
}

export function isAllowedHost(url: URL, domain: string): boolean {
  return url.protocol === 'https:' && (url.hostname === domain || url.hostname.endsWith('.' + domain));
}

// ---------------------------------------------------------------------------
// Listing extraction from the text that Tavily returns for each result.
// ---------------------------------------------------------------------------

export type Listing = {
  id: string;
  title: string;
  address: string;
  district: string;
  area: number | null;
  rent: number | null;
  community: number | null;
  ibi: number | null;
  url: string;
  source: string;
  status: string;
  checkedAt: string;
};

export type Rejection = { reason: string };

const DISTRICTS = [
  'Salamanca', 'Chamartín', 'Chamberí', 'Centro', 'Tetuán', 'Moncloa-Aravaca',
  'Retiro', 'Arganzuela', 'Fuencarral-El Pardo', 'Ciudad Lineal', 'Hortaleza',
  'Usera', 'Carabanchel', 'Latina', 'Puente de Vallecas', 'Moratalaz',
  'Villaverde', 'Villa de Vallecas', 'San Blas-Canillejas', 'Barajas',
];

export function extractDistrict(text: string): string {
  const lower = text.toLocaleLowerCase('es');
  return DISTRICTS.find((district) => lower.includes(district.toLocaleLowerCase('es'))) ?? 'Sin determinar';
}

/**
 * Looks for a Madrid postal code (280xx) with the word "Madrid" nearby and returns a short
 * address such as "Calle de Serrano 10, 28001 Madrid". Returns null when there is no such evidence.
 */
export function findMadridAddress(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ');
  const pattern = /(?<![\d.,€$])\b(280\d{2})\b(?!\s*(?:€|m²|m2|euros))/g;
  for (const match of flat.matchAll(pattern)) {
    const index = match.index ?? 0;
    const around = flat.slice(Math.max(0, index - 90), index + 45);
    if (!/madrid/i.test(around)) continue;
    const before = flat.slice(Math.max(0, index - 90), index);
    const cut = Math.max(
      before.lastIndexOf('. '), before.lastIndexOf(' | '), before.lastIndexOf('* '),
      before.lastIndexOf('# '), before.lastIndexOf(': '),
    );
    const street = (cut >= 0 ? before.slice(cut + 2) : before)
      .replace(/[\s,;·|*#>\-–]+$/g, '').replace(/^[\s,;·|*#>\-–]+/, '').trim();
    const address = (street ? street + ', ' : '') + match[1] + ' Madrid';
    return address.slice(-120);
  }
  return null;
}

/**
 * Builds a listing from the text of one search result. Everything not published is left null:
 * nothing is estimated. Returns a rejection reason when the result is not an individual
 * office-for-rent listing in Madrid.
 */
export function parseListingText(
  text: string,
  title: string,
  url: string,
  source: string,
  snippet: string = '',
  today: string = new Date().toISOString().slice(0, 10),
): Listing | Rejection {
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { return { reason: 'url_invalida' }; }
  const pageTitle = clean(title).slice(0, 180);
  const body = clean(text).slice(0, 30000);
  if (!body) return { reason: 'sin_texto' };

  let path = parsedUrl.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
  const head = (pageTitle + ' ' + path + ' ' + body.slice(0, 600)).toLocaleLowerCase('es');
  const titleAndPath = (pageTitle + ' ' + path).toLocaleLowerCase('es');

  if (isGenericPage(parsedUrl, pageTitle)) return { reason: 'pagina_generica' };
  if (!/(alquiler|rent|lease|arrendamiento)/i.test(head)) return { reason: 'sin_alquiler' };
  if (/(venta|for-sale|for sale|sale|coworking|centro de negocios|flexible office|puesto de trabajo)/i.test(titleAndPath)) return { reason: 'titulo_excluido' };
  if (!/(oficina|office)/i.test(head)) return { reason: 'sin_oficina' };
  if (/\b(?:local|nave|vivienda|puesto flexible)\b/i.test(pageTitle)) return { reason: 'otro_inmueble' };

  // Only admitted when the text itself shows a verifiable Madrid address.
  const address = findMadridAddress(body);
  if (!address) return { reason: 'sin_direccion_madrid' };

  const combined = [body, pageTitle, clean(snippet)].join(' ');
  const area = findNumber(combined, [
    /(?:superficie|área|area|surface|built area|lettable area|superficie disponible|available area)[^\d]{0,100}(\d[\d.,]*)\s*m(?:2|²)/i,
    /(\d[\d.,]*)\s*m(?:2|²)\s*(?:de oficina|de superficie|útiles|construidos|available)/i,
  ]);
  const rent = monthlyRate(combined, ['renta', 'alquiler', 'rent', 'asking rent', 'precio']);
  const community = monthlyRate(combined, ['gastos de comunidad', 'comunidad', 'service charge', 'maintenance charge', 'gastos de mantenimiento']);
  const ibi = monthlyRate(combined, ['ibi', 'impuesto sobre bienes inmuebles']);

  const missing: string[] = [];
  if (area === null) missing.push('superficie');
  if (rent === null) missing.push('renta');
  if (community === null) missing.push('comunidad');
  if (ibi === null) missing.push('IBI');

  return {
    id: parsedUrl.href,
    title: pageTitle,
    address,
    district: extractDistrict(address + ' ' + pageTitle),
    area,
    rent,
    community,
    ibi,
    url: parsedUrl.href,
    source,
    status: missing.length ? 'Anuncio individual verificado · pendiente: ' + missing.join(', ') : 'Datos publicados detectados',
    checkedAt: today,
  };
}
