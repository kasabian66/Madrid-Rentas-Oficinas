import { NextResponse } from 'next/server';
import { clean, findNumber, monthlyRate, isGenericPage, isAllowedHost } from '../../../lib/parse';
import { rateLimit } from '../../../lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Listing = {
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

type TavilyResult = { url?: string; title?: string; content?: string };

const sources = [
  { name: 'Belbex', domain: 'belbex.com' },
  { name: 'LoopNet', domain: 'loopnet.es' },
  { name: 'JLL', domain: 'jll.es' },
  { name: 'CBRE', domain: 'cbre.es' },
  { name: 'Savills', domain: 'savills.es' },
  { name: 'Cushman & Wakefield', domain: 'cushmanwakefield.com' },
];

function extractDistrict(text: string): string {
  const districts = [
    'Salamanca', 'Chamartín', 'Chamberí', 'Centro', 'Tetuán', 'Moncloa-Aravaca',
    'Retiro', 'Arganzuela', 'Fuencarral-El Pardo', 'Ciudad Lineal', 'Hortaleza',
    'Usera', 'Carabanchel', 'Latina', 'Puente de Vallecas', 'Moratalaz',
    'Villaverde', 'Villa de Vallecas', 'San Blas-Canillejas', 'Barajas',
  ];
  return districts.find((district) => text.toLocaleLowerCase('es').includes(district.toLocaleLowerCase('es'))) ?? 'Sin determinar';
}

function getJsonLdAddress(html: string): { street: string; locality: string; postalCode: string } | null {
  const scripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const addresses: { street: string; locality: string; postalCode: string }[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    if (obj.address && typeof obj.address === 'object') {
      const address = obj.address as Record<string, unknown>;
      const street = typeof address.streetAddress === 'string' ? address.streetAddress : '';
      const locality = typeof address.addressLocality === 'string' ? address.addressLocality : '';
      const postalCode = typeof address.postalCode === 'string' ? address.postalCode : '';
      if (street || locality || postalCode) addresses.push({ street, locality, postalCode });
    }
    Object.values(obj).forEach(visit);
  };

  for (const script of scripts) {
    const raw = script.replace(/^[\\s\\S]*?>/, '').replace(/<\/script>\s*$/i, '');
    try { visit(JSON.parse(raw)); } catch { /* Ignore malformed structured data. */ }
  }
  return addresses.find((item) =>
    /madrid/i.test(item.locality) || /^280\d{2}$/.test(item.postalCode)
  ) ?? null;
}

function getPageTitle(html: string, fallback: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return clean(og || title || fallback).slice(0, 180);
}

function parsePage(html: string, url: string, source: string, searchResult: TavilyResult): Listing | null {
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { return null; }
  const title = getPageTitle(html, searchResult.title || '');
  const combinedText = [clean(html), searchResult.title || '', searchResult.content || ''].join(' ');
  const normalizedTitle = title.toLocaleLowerCase('es');

  if (!/(alquiler|rent|lease|arrendamiento)/i.test(normalizedTitle)) return null;
  if (/(venta|sale|coworking|centro de negocios|flexible office|puesto de trabajo)/i.test(normalizedTitle)) return null;
  if (!/(oficina|office)/i.test(normalizedTitle)) return null;
  if (/\b(?:local|nave|vivienda|puesto flexible)\b/i.test(normalizedTitle)) return null;
  if (isGenericPage(parsedUrl, title)) return null;

  // A result is only admitted when the page itself provides a verifiable Madrid address.
  const structuredAddress = getJsonLdAddress(html);
  if (!structuredAddress) return null;
  const addressParts = [structuredAddress.street, structuredAddress.postalCode, structuredAddress.locality].filter(Boolean);
  const address = addressParts.join(', ');
  if (!address || !(/madrid/i.test(structuredAddress.locality) || /^280\d{2}$/.test(structuredAddress.postalCode))) return null;

  const area = findNumber(combinedText, [
    /(?:superficie|área|area|surface|built area|lettable area|superficie disponible|available area)[^\d]{0,100}(\d[\d.,]*)\s*m(?:2|²)/i,
    /(\d[\d.,]*)\s*m(?:2|²)\s*(?:de oficina|de superficie|útiles|construidos|available)/i,
  ]);
  const rent = monthlyRate(combinedText, ['renta', 'alquiler', 'rent', 'asking rent', 'precio']);
  const community = monthlyRate(combinedText, ['gastos de comunidad', 'comunidad', 'service charge', 'maintenance charge', 'gastos de mantenimiento']);
  const ibi = monthlyRate(combinedText, ['ibi', 'impuesto sobre bienes inmuebles']);

  const missing: string[] = [];
  if (area === null) missing.push('superficie');
  if (rent === null) missing.push('renta');
  if (community === null) missing.push('comunidad');
  if (ibi === null) missing.push('IBI');

  return {
    id: parsedUrl.href,
    title,
    address,
    district: extractDistrict(address),
    area,
    rent,
    community,
    ibi,
    url: parsedUrl.href,
    source,
    status: missing.length ? 'Anuncio individual verificado · pendiente: ' + missing.join(', ') : 'Datos publicados detectados',
    checkedAt: new Date().toISOString().slice(0, 10),
  };
}

async function searchTavily(query: string, domain: string): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('Falta configurar TAVILY_API_KEY en Vercel');

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      topic: 'general',
      max_results: 5,
      include_domains: [domain],
      include_answer: false,
    }),
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });

  if (!response.ok) throw new Error('Tavily HTTP ' + response.status);
  const data = await response.json() as { results?: TavilyResult[] };
  return (data.results ?? []).filter((item) => {
    if (!item.url) return false;
    try { return isAllowedHost(new URL(item.url), domain); } catch { return false; }
  }).slice(0, 5);
}

export async function GET(request: Request) {
  const client = (request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim() || 'unknown';
  const limit = rateLimit(client);
  if (!limit.ok) {
    return NextResponse.json(
      { listings: [], message: 'Demasiadas búsquedas seguidas. Espera ' + limit.retryAfter + ' s y vuelve a intentarlo.', sources: [], diagnostics: [] },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter), 'Cache-Control': 'no-store' } },
    );
  }
  const { searchParams } = new URL(request.url);
  const queryText = (searchParams.get('q') || '').trim().slice(0, 80);
  const diagnostics: { source: string; candidates: number; extracted: number; issue?: string }[] = [];

  const perSource = await Promise.all(sources.map(async (source) => {
    let candidates: TavilyResult[] = [];
    try {
      candidates = await searchTavily(
        'anuncio individual oficina en alquiler ' + queryText +
        ' Madrid capital. Dirección postal en Madrid, superficie disponible, renta de alquiler. Excluir páginas de búsqueda, venta, coworking y centros de negocios.',
        source.domain,
      );
      const parsed = await Promise.all(candidates.map(async (candidate) => {
        try {
          const candidateUrl = new URL(candidate.url!);
          if (isGenericPage(candidateUrl, candidate.title || '')) return null;
          const page = await fetch(candidateUrl.href, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MadridOfficeMarket/2.2)', Accept: 'text/html' },
            signal: AbortSignal.timeout(8000),
            redirect: 'follow',
            cache: 'no-store',
          });
          const finalUrl = new URL(page.url);
          if (!page.ok || !isAllowedHost(finalUrl, source.domain) || isGenericPage(finalUrl, candidate.title || '')) return null;
          return parsePage(await page.text(), finalUrl.href, source.name, candidate);
        } catch { return null; }
      }));
      const results = parsed.filter((item): item is Listing => item !== null);
      diagnostics.push({ source: source.name, candidates: candidates.length, extracted: results.length });
      return results;
    } catch (error) {
      diagnostics.push({
        source: source.name,
        candidates: candidates.length,
        extracted: 0,
        issue: error instanceof Error ? error.message : 'Error de consulta',
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
      ? 'Anuncios individuales con dirección de Madrid verificada. Los datos económicos no publicados aparecen como pendientes y no se estiman.'
      : diagnostics.some((item) => item.issue?.includes('TAVILY_API_KEY'))
        ? 'Falta configurar la clave gratuita de Tavily en Vercel.'
        : 'No se han encontrado anuncios individuales con dirección de Madrid verificable. No se muestran páginas generales ni resultados sin ubicación confirmada.',
    sources: sources.map((source) => source.name),
    diagnostics,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
