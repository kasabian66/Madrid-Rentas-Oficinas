import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

const clean = (value: string) => value
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

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

// Only accept explicit €/m² rates; ambiguous total amounts are not guessed.
function monthlyRate(text: string, labels: string[]): number | null {
  const label = labels.join('|');
  const monthly = findNumber(text, [
    new RegExp('(?:' + label + ')[^\\d]{0,90}(\\d[\\d.,]*)\\s*€?\\s*[/·]\\s*m(?:2|²)\\s*[/·]\\s*(?:mes|month)', 'i'),
    new RegExp('(\\d[\\d.,]*)\\s*€\\s*[/·]\\s*m(?:2|²)\\s*[/·]\\s*(?:mes|month)[^\\w]{0,20}(?:' + label + ')', 'i'),
  ]);
  if (monthly !== null) return monthly;
  const annual = findNumber(text, [
    new RegExp('(?:' + label + ')[^\\d]{0,90}(\\d[\\d.,]*)\\s*€?\\s*[/·]\\s*m(?:2|²)\\s*[/·]\\s*(?:año|anual|year)', 'i'),
    new RegExp('(\\d[\\d.,]*)\\s*€\\s*[/·]\\s*m(?:2|²)\\s*[/·]\\s*(?:año|anual|year)[^\\w]{0,20}(?:' + label + ')', 'i'),
  ]);
  return annual === null ? null : annual / 12;
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
  if (!/(alquiler|rent|lease)/i.test(title) || /(venta|sale|coworking|centro de negocios)/i.test(title) || !/(oficina|office)/i.test(title)) return null;
  if (!/\b280\d{2}\b/.test(text) || /\b(?:local|nave|vivienda|puesto flexible)\b/i.test(title)) return null;

  const area = findNumber(text, [
    /(?:superficie|área|area|surface|built area|lettable area)[^\d]{0,45}(\d[\d.,]*)\s*m(?:2|²)/i,
  ]);
  const rent = monthlyRate(text, ['renta', 'alquiler', 'rent']);
  if (!area || rent === null) return null;

  const community = monthlyRate(text, ['gastos de comunidad', 'comunidad', 'service charge', 'maintenance charge', 'gastos de mantenimiento']);
  const ibi = monthlyRate(text, ['ibi', 'impuesto sobre bienes inmuebles']);
  const addressMatch = html.match(/(?:streetAddress|address)[^>:"']{0,30}["']([^"']{8,160})["']/i);
  const address = addressMatch?.[1] ? clean(addressMatch[1]) : 'Madrid capital · dirección por confirmar';
  const complete = community !== null && ibi !== null;
  return {
    id: parsedUrl.href, title: title || 'Oficina en alquiler', address,
    district: extractDistrict(address), area, rent, community, ibi,
    url: parsedUrl.href, source,
    status: complete ? 'Renta, comunidad e IBI detectados' : 'Datos parciales · importes no publicados pendientes',
    checkedAt: new Date().toISOString().slice(0, 10),
  };
}

function unwrap(href: string): string {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    return url.searchParams.get('uddg') || url.href;
  } catch { return href; }
}

function isAllowedHost(url: URL, domain: string): boolean {
  return url.protocol === 'https:' && (url.hostname === domain || url.hostname.endsWith('.' + domain));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const queryText = (searchParams.get('q') || '').trim().slice(0, 80);
  const query = encodeURIComponent('oficinas en alquiler ' + queryText + ' Madrid site:');
  const perSource = await Promise.all(sources.map(async (source) => {
    try {
      const response = await fetch('https://html.duckduckgo.com/html/?q=' + query + source.domain + ' -venta -coworking', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MadridOfficeMarket/2.0)' },
        signal: AbortSignal.timeout(8000), cache: 'no-store',
      });
      if (!response.ok) return [];
      const html = await response.text();
      const candidates = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
        .map((match) => ({ url: unwrap(match[1]) }))
        .filter((item) => {
          try { return isAllowedHost(new URL(item.url), source.domain); } catch { return false; }
        }).slice(0, 3);

      const parsed = await Promise.all(candidates.map(async (candidate) => {
        try {
          const page = await fetch(candidate.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MadridOfficeMarket/2.0)' },
            signal: AbortSignal.timeout(6000), redirect: 'follow', cache: 'no-store',
          });
          const finalUrl = new URL(page.url);
          if (!page.ok || !isAllowedHost(finalUrl, source.domain)) return null;
          return parsePage(await page.text(), finalUrl.href, source.name);
        } catch { return null; }
      }));
      return parsed.filter((item): item is Listing => item !== null);
    } catch { return []; }
  }));

  const unique = perSource.flat().filter((item, index, all) =>
    all.findIndex((other) => other.url === item.url) === index
  ).slice(0, 30);

  return NextResponse.json({
    listings: unique,
    message: unique.length
      ? 'Fichas con superficie y renta expresada explícitamente por m² y mes. Los gastos solo se muestran si el anuncio publica una tarifa identificable.'
      : 'No se han podido extraer fichas verificables en esta búsqueda. Los portales pueden limitar consultas automatizadas; prueba otra zona o añade anuncios manualmente.',
    sources: sources.map((source) => source.name),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
