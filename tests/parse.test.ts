import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, findNumber, monthlyRate, isGenericPage, isAllowedHost, clean } from '../lib/parse.ts';
import { rateLimit, resetRateLimit } from '../lib/rateLimit.ts';

test('parseNumber handles Spanish and plain formats', () => {
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('1.200'), 1200);
  assert.equal(parseNumber('18'), 18);
});

test('parseNumber rejects zero and non-numeric input', () => {
  assert.equal(parseNumber('0'), null);
  assert.equal(parseNumber('abc'), null);
});

test('findNumber extracts the available surface', () => {
  const text = 'Superficie disponible: 1.250 m² en planta';
  assert.equal(findNumber(text, [/(?:superficie disponible)[^\d]{0,100}(\d[\d.,]*)\s*m(?:2|²)/i]), 1250);
  assert.equal(findNumber('sin datos', [/(\d+)\s*m2/i]), null);
});

test('monthlyRate reads monthly and converts annual amounts', () => {
  assert.equal(monthlyRate('Renta: 25,50 €/m²/mes', ['renta']), 25.5);
  assert.equal(monthlyRate('Renta 300 €/m²/año', ['renta']), 25);
});

test('monthlyRate does not guess when the unit is missing', () => {
  assert.equal(monthlyRate('Renta: 25,50 euros', ['renta']), null);
  assert.equal(monthlyRate('Gastos de comunidad 3,10 €/m²/mes', ['renta']), null);
});

test('isGenericPage flags search pages and accepts individual listings', () => {
  assert.equal(isGenericPage(new URL('https://www.belbex.com/madrid'), 'Alquiler de oficinas en Madrid'), true);
  assert.equal(isGenericPage(new URL('https://www.belbex.com/oficinas'), ''), true);
  assert.equal(isGenericPage(new URL('https://www.belbex.com/oficina-calle-serrano-123'), 'Oficina en alquiler Serrano 123'), false);
});

test('isAllowedHost only accepts https on the exact domain or its subdomains', () => {
  assert.equal(isAllowedHost(new URL('https://belbex.com/x'), 'belbex.com'), true);
  assert.equal(isAllowedHost(new URL('https://www.belbex.com/x'), 'belbex.com'), true);
  assert.equal(isAllowedHost(new URL('http://belbex.com/x'), 'belbex.com'), false);
  assert.equal(isAllowedHost(new URL('https://belbex.com.evil.com/x'), 'belbex.com'), false);
  assert.equal(isAllowedHost(new URL('https://evilbelbex.com/x'), 'belbex.com'), false);
});

test('clean strips scripts, tags and entities', () => {
  assert.equal(clean('<p>A &amp; B</p><script>alert(1)</script>'), 'A & B');
});

test('rateLimit allows 5 requests per window then blocks, per client', () => {
  resetRateLimit();
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(rateLimit('1.2.3.4', t0 + i).ok, true);
  const blocked = rateLimit('1.2.3.4', t0 + 10);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 1);
  assert.equal(rateLimit('5.6.7.8', t0 + 10).ok, true);
  assert.equal(rateLimit('1.2.3.4', t0 + 61_000).ok, true);
});
