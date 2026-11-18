import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Listing = {
  id: string; title: string; address: string; district: string;
  area: number | null; rent: number | null; community: number | null; ibi: number | null;
  url: string; source: string; status: string; checkedAt: string;
};

const sources = [
  { name: 'Belbex', domain: 'belbex.com' },
  { name: 'LoopNet', domain: 'loopnet.es' },
  { name: 'JLL', domain: 'jll.es' },
  { name: 'CBRE', domain: 'cbre.es' },
  { name: 'Savills', domain: 'savills.es' },
  { name: 'Cushman & Wakefield', domain: 'cushmanwakefield.com' },
];

const decode = (value: string) => value
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&#x2F;/gi, '/');

const clean = (value: string) => decode(value)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function parseNumber(raw: string): number | null {
  const value = raw.replace(/\s/g, '');
  const normalized = value.includes(',')
    ? value.replace(/\./g, '').replace(',', '.')
    : value.replace(/\.(?=\d{3}(?:\D|$))/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function findNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = parseNumber(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
}

function monthlyRate(text: string, labels: string[]): number | null {
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

function extractDistrict(text: string): string {
  const districts = [
    'Salamanca', 'Chamartín', 'Chamberí', 'Centro', 'Tetuán', 'Moncloa-Aravaca',
    'Retiro', 'Arganzuela', 'Fuencarral-El Pardo', 'Ciudad Lineal', 'Hortaleza',
    'Usera', 'Carabanchel', 'Latina', 'Puente de Vallecas', 'Moratalaz',
    'Villaverde', 'Villa de Vallecas', 'San Blas-Canillejas', 'Barajas',
  ];
  return districts.find((district) => text.toLocaleLowerCase('es').includes(district.toLocaleLowerCase('es'))) ?? 'Sin determinar';
}

function parsePage(html: string, url: string, source: string): Listing | null {
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { return null; }
  const text = clean(html);
  const title = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '');
  if (!/(alquiler|rent|lease|arrendamiento)/i.test(title) || /(venta|sale|coworking|centro de negocios)/i.test(title) || !/(oficina|office)/i.test(title)) return null;
  if (!/\b280\d{2}\b/i.test(text) && !/\bMadrid\b/i.test(text)) return null;
  if (/\b(?:local|nave|vivienda|puesto flexible)\b/i.test(title)) return null;

  const area = findNumber(text, [
    /(?:superficie|área|area|surface|built area|lettable area|superficie disponible)[^\d]{0,80}(\d[\d.,]*)\s*m(?:2|²)/i,
    /(\d[\d.,]*)\s*m(?:2|²)\s*(?:de oficina|de superficie|útiles|construidos)/i,
  ]);
  const rent = monthlyRate(text, ['renta', 'alquiler', 'rent', 'asking rent', 'precio']);
  // Keep verified office-rental pages even when the portal does not publish
  // area or rent in machine-readable text. Missing values remain null.

  const community = monthlyRate(text, ['gastos de comunidad', 'comunidad', 'service charge', 'maintenance charge', 'gastos de mantenimiento']);
  const ibi = monthlyRate(text, ['ibi', 'impuesto sobre bienes inmuebles']);
  const addressMatch = html.match(/(?:streetAddress|address)[^>:"']{0,50}["']([^"']{8,200})["']/i);
  const address = addressMatch?.[1] ? clean(addressMatch[1]) : 'Madrid capital · dirección por confirmar';
  const complete = rent !== null && community !== null && ibi !== null;
  return {
    id: parsedUrl.href, title: title || 'Oficina en alquiler', address,
    district: extractDistrict(address), area, rent, community, ibi,
    url: parsedUrl.href, source,
    status: complete ? 'Renta, comunidad e IBI detectados' : 'Ficha localizada · datos económicos parciales o pendientes',
    checkedAt: new Date().toISOString().slice(0, 10),
  };
}

function unwrap(href: string): string {
  try {
    const url = new URL(decode(href), 'https://duckduckgo.com');
    return url.searchParams.get('uddg') || url.href;
  } catch { return href; }
}

function extractBingResultLinks(xml: string, domain: string): string[] {
  const links: string[] = [];
  const items = xml.split(/<item[^>]*>/i).slice(1);
  for (const item of items) {
    const block = item.split(/<\/item>/i)[0] || '';
    const match = block.match(/<link[^>]*>([^<]+)<\/link>/i);
    if (!match?.[1]) continue;
    const href = decode(match[1].trim());
    try {
      const parsed = new URL(href);
      if (isAllowedHost(parsed, domain) && !links.includes(parsed.href)) links.push(parsed.href);
    } catch { /* Ignore non-URL RSS links. */ }
  }
  return links.slice(0, 5);
}

function isAllowedHost(url: URL, domain: string): boolean {
  return url.protocol === 'https:' && (url.hostname === domain || url.hostname.endsWith('.' + domain));
}

function extractResultLinks(html: string, domain: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    // Do not depend on DuckDuckGo CSS classes: its result markup changes frequently.
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const target = unwrap(href);
    try {
      const parsed = new URL(target);
      if (isAllowedHost(parsed, domain) && !links.includes(parsed.href)) links.push(parsed.href);
    } catch { /* Ignore malformed search result URLs. */ }
  }
  return links.slice(0, 5);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const queryText = (searchParams.get('q') || '').trim().slice(0, 80);
  const diagnostics: { source: string; candidates: number; extracted: number; issue?: string }[] = [];

  const perSource = await Promise.all(sources.map(async (source) => {
    let candidates: string[] = [];
    try {
      const params = new URLSearchParams({
        q: 'oficinas en alquiler ' + queryText + ' Madrid site:' + source.domain + ' -venta -coworking',
        format: 'rss',
      });
      const response = await fetch('https://www.bing.com/search?' + params.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MadridOfficeMarket/2.1)', Accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.9' },
        signal: AbortSignal.timeout(10000), cache: 'no-store',
      });
      if (!response.ok) {
        diagnostics.push({ source: source.name, candidates: 0, extracted: 0, issue: 'Buscador HTTP ' + response.status });
        return [];
      }
      const searchBody = await response.text();
      candidates = extractBingResultLinks(searchBody, source.domain);
      if (candidates.length === 0) candidates = extractResultLinks(searchBody, source.domain);
      const parsed = await Promise.all(candidates.map(async (candidate) => {
        try {
          const page = await fetch(candidate, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MadridOfficeMarket/2.1)', Accept: 'text/html' },
            signal: AbortSignal.timeout(8000), redirect: 'follow', cache: 'no-store',
          });
          const finalUrl = new URL(page.url);
          if (!page.ok || !isAllowedHost(finalUrl, source.domain)) return null;
          return parsePage(await page.text(), finalUrl.href, source.name);
        } catch { return null; }
      }));
      const results = parsed.filter((item): item is Listing => item !== null);
      diagnostics.push({ source: source.name, candidates: candidates.length, extracted: results.length });
      return results;
    } catch (error) {
      diagnostics.push({
        source: source.name, candidates: candidates.length, extracted: 0,
        issue: error instanceof Error ? error.name : 'Error de consulta',
      });
      return [];
    }
  }));

  const unique = perSource.flat().filter((item, index, all) =>
    all.findIndex((other) => other.url === item.url) === index
  ).slice(0, 30);

  return NextResponse.json({
    listings: unique,
    message: unique.length
      ? 'Fichas con superficie y renta identificables. Comunidad e IBI solo se muestran cuando se detectan con una unidad y un periodo claros.'
      : 'La búsqueda se ha ejecutado, pero no se han podido extraer fichas verificables. Consulta el detalle por fuente o añade anuncios manualmente.',
    sources: sources.map((source) => source.name),
    diagnostics,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
