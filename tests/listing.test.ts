import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMadridAddress, parseListingText, extractDistrict } from '../lib/parse.ts';
import type { Listing } from '../lib/parse.ts';

const GOOD_TEXT = 'Oficina en alquiler en Calle de Serrano 10, 28001 Madrid. Superficie disponible: 450 m². '
  + 'Renta: 28,50 €/m²/mes. Gastos de comunidad: 4,20 €/m²/mes.';

test('findMadridAddress returns street and postal code when Madrid is nearby', () => {
  const address = findMadridAddress('Descripción. Oficina en Calle de Serrano 10, 28001 Madrid. Más info');
  assert.ok(address);
  assert.match(address!, /Serrano 10/);
  assert.match(address!, /28001 Madrid$/);
});

test('findMadridAddress ignores other cities and prices that look like postal codes', () => {
  assert.equal(findMadridAddress('Oficina en Passeig de Gràcia 1, 08007 Barcelona'), null);
  assert.equal(findMadridAddress('Precio total 28001 € en Madrid centro'), null);
  assert.equal(findMadridAddress('Código 28010 sin ciudad conocida'), null);
});

test('parseListingText builds a listing and leaves unpublished data as null', () => {
  const result = parseListingText(GOOD_TEXT, 'Oficina en alquiler Serrano 10 - Salamanca', 'https://www.belbex.com/oficina-serrano-10', 'Belbex', '', '2026-11-25') as Listing;
  assert.ok(!('reason' in result));
  assert.equal(result.area, 450);
  assert.equal(result.rent, 28.5);
  assert.equal(result.community, 4.2);
  assert.equal(result.ibi, null);
  assert.equal(result.district, 'Salamanca');
  assert.match(result.status, /pendiente: IBI/);
  assert.equal(result.checkedAt, '2026-11-25');
});

test('parseListingText rejects sale, coworking and non-office results', () => {
  const url = 'https://www.belbex.com/oficina-serrano-10';
  assert.deepEqual(parseListingText(GOOD_TEXT, 'Oficina en venta Serrano 10', 'https://www.belbex.com/oficina-en-venta-serrano', 'Belbex'), { reason: 'titulo_excluido' });
  assert.deepEqual(parseListingText(GOOD_TEXT, 'Coworking en alquiler Serrano', 'https://www.belbex.com/coworking-serrano', 'Belbex'), { reason: 'titulo_excluido' });
  assert.deepEqual(parseListingText('Local en alquiler, Calle Serrano 10, 28001 Madrid', 'Local en alquiler Serrano', url, 'Belbex'), { reason: 'otro_inmueble' });
  assert.deepEqual(parseListingText('Inmueble en alquiler, Calle Serrano 10, 28001 Madrid', 'Inmueble en alquiler Serrano', 'https://www.belbex.com/inmueble-serrano-10', 'Belbex'), { reason: 'sin_oficina' });
});

test('parseListingText rejects results without a verifiable Madrid address', () => {
  const noAddress = 'Oficina en alquiler muy luminosa. Superficie 300 m². Renta 20 €/m²/mes.';
  assert.deepEqual(parseListingText(noAddress, 'Oficina en alquiler luminosa', 'https://www.jll.es/oficina-luminosa', 'JLL'), { reason: 'sin_direccion_madrid' });
});

test('parseListingText rejects generic listing pages and empty text', () => {
  assert.deepEqual(parseListingText(GOOD_TEXT, 'Alquiler de oficinas en Madrid', 'https://www.belbex.com/madrid', 'Belbex'), { reason: 'pagina_generica' });
  assert.deepEqual(parseListingText('', 'Oficina en alquiler', 'https://www.belbex.com/oficina-x', 'Belbex'), { reason: 'sin_texto' });
});

test('parseListingText strips markdown images and links from the address', () => {
  const text = '![](https://img.loopnet.es/x/image.jpg) [Calle de Alcalá, 96](https://www.loopnet.es/anuncio/calle-de-alcala-96-madrid/1/) Salamanca, Madrid, 28009 Madrid. Oficina en alquiler. Superficie 295 m².';
  const result = parseListingText(text, 'Oficinas en alquiler en Goya', 'https://www.loopnet.es/anuncio/calle-de-alcala-96-madrid/1/', 'LoopNet') as Listing;
  assert.ok(!('reason' in result));
  assert.ok(!/[\]\[()]|http/.test(result.address), result.address);
  assert.match(result.address, /28009 Madrid$/);
});

test('LoopNet listing: street from the first line and rent computed from the monthly total', () => {
  const text = 'Calle de Diego de León, 21\n\n## Aspectos destacados\n\n- Zona consolidada.\n\n## 1 espacio disponible\n\n'
    + 'Planta baja, Planta 1\n\nOficina\n\n·\n\n3.999 m²\n\n·\n\n103.974 € /mes EXCL\n\n· Disponibilidad inmediata. Oficina en alquiler.';
  const result = parseListingText(text, '', 'https://www.loopnet.es/anuncio/calle-de-diego-de-leon-21-madrid/35884463', 'LoopNet') as Listing;
  assert.ok(!('reason' in result), JSON.stringify(result));
  assert.equal(result.address, 'Calle de Diego de León, 21, Madrid');
  assert.equal(result.area, 3999);
  assert.equal(result.rent, 26);
});

test('search pages and coworking centres are rejected', () => {
  assert.deepEqual(parseListingText(GOOD_TEXT, 'Oficinas en alquiler en Recoletos', 'https://www.loopnet.es/buscar/oficinas/recoletos__madrid/en-alquiler', 'LoopNet'), { reason: 'pagina_generica' });
  const cowork = 'Oficinas Coworking/Espacio Flex. María de Molina 54 Madrid, 28006. Oficina en alquiler.';
  assert.deepEqual(parseListingText(cowork, 'Alquiler de Oficina en María de Molina', 'https://inmuebles.jll.es/alquiler-oficinas/oficinas-9143', 'JLL'), { reason: 'coworking' });
});

test('findMadridAddress keeps a repeated street name only once', () => {
  assert.equal(findMadridAddress('Referencia 9143. María de Molina María de Molina 54 Madrid, 28006'), 'María de Molina 54 Madrid, 28006 Madrid'.replace('54 Madrid, ', '54 Madrid, '));
});

test('extractDistrict finds known districts and defaults to undetermined', () => {
  assert.equal(extractDistrict('Calle Goya, Salamanca'), 'Salamanca');
  assert.equal(extractDistrict('Calle sin distrito'), 'Sin determinar');
});
