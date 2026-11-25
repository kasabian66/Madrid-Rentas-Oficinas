import { NextResponse } from 'next/server';
import { isGenericPage, isAllowedHost, parseListingText } from '../../../lib/parse';
import type { Listing, Rejection } from '../../../lib/parse';
import { rateLimit } from '../../../lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type TavilyResult = { url?: string; title?: string; content?: string; raw_content?: string | null };

const sources = [
  { name: 'Belbex', domain: 'belbex.com' },
  { name: 'LoopNet', domain: 'loopnet.es' },
  { name: 'JLL', domain: 'jll.es' },
  { name: 'CBRE', domain: 'cbre.es' },
  { name: 'Savills', domain: 'savills.es' },
  { name: 'Cushman & Wakefield', domain: 'cushmanwakefield.com' },
];

async function searchTavily(query: string, domain: string): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('Falta configurar TAVILY_API_KEY en Vercel');

  // Tavily returns the page text itself (include_raw_content), so the portals' pages are never
  // downloaded from here: this avoids the HTTP 403 blocks many portals apply to server-side requests.
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      topic: 'general',
      max_results: 5,
      include_domains: [domain],
      include_answer: false,
      include_raw_content: true,
    }),
    signal: AbortSignal.timeout(25000),
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
  const diagnostics: { source: string; candidates: number; extracted: number; issue?: string; rejected?: Record<string, number> }[] = [];

  const perSource = await Promise.all(sources.map(async (source) => {
    let candidates: TavilyResult[] = [];
    try {
      candidates = await searchTavily(
        'anuncio individual oficina en alquiler ' + queryText +
        ' Madrid capital. Dirección postal en Madrid, superficie disponible, renta de alquiler. Excluir páginas de búsqueda, venta, coworking y centros de negocios.',
        source.domain,
      );
      const parsed: (Listing | Rejection)[] = candidates.map((candidate) => {
        try {
          const candidateUrl = new URL(candidate.url!);
          if (isGenericPage(candidateUrl, candidate.title || '')) return { reason: 'pagina_generica' };
          const text = candidate.raw_content || candidate.content || '';
          return parseListingText(text, candidate.title || '', candidateUrl.href, source.name, candidate.content || '');
        } catch { return { reason: 'error_proceso' }; }
      });
      const results = parsed.filter((item): item is Listing => !('reason' in item));
      const rejected: Record<string, number> = {};
      for (const item of parsed) if ('reason' in item) rejected[item.reason] = (rejected[item.reason] ?? 0) + 1;
      diagnostics.push({ source: source.name, candidates: candidates.length, extracted: results.length, rejected });
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
