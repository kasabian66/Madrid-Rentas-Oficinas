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
