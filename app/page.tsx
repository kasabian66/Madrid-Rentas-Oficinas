'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, MapPin, Building2, ExternalLink, Download, RefreshCw, Plus, X, Info, SlidersHorizontal } from 'lucide-react';

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

type FormState = {
  title: string; address: string; district: string; area: string;
  rent: string; community: string; ibi: string; url: string;
};

const STORAGE_KEY = 'madrid-office-market:listings:v1';
const districts = [
  'Salamanca', 'Chamartín', 'Chamberí', 'Centro', 'Tetuán', 'Moncloa-Aravaca',
  'Retiro', 'Arganzuela', 'Fuencarral-El Pardo', 'Ciudad Lineal', 'Hortaleza',
  'Usera', 'Carabanchel', 'Latina', 'Puente de Vallecas', 'Moratalaz',
  'Villaverde', 'Villa de Vallecas', 'San Blas-Canillejas', 'Barajas', 'Sin determinar',
];
const emptyForm: FormState = {
  title: '', address: '', district: 'Sin determinar', area: '',
  rent: '', community: '', ibi: '', url: '',
};
const fmt = (value: number | null) => value === null
  ? 'Pendiente'
  : value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

function isListingArray(value: unknown): value is Listing[] {
  return Array.isArray(value) && value.every((item) =>
    item && typeof item === 'object' &&
    typeof item.id === 'string' && typeof item.title === 'string' &&
    typeof item.address === 'string' && typeof item.district === 'string' &&
    (item.area === null || (typeof item.area === 'number' && Number.isFinite(item.area))) &&
    (item.rent === null || (typeof item.rent === 'number' && Number.isFinite(item.rent))) &&
    (item.community === null || (typeof item.community === 'number' && Number.isFinite(item.community))) &&
    (item.ibi === null || (typeof item.ibi === 'number' && Number.isFinite(item.ibi))) &&
    typeof item.url === 'string' && typeof item.source === 'string' &&
    typeof item.status === 'string' && typeof item.checkedAt === 'string'
  );
}

function csvCell(value: string | number) {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export default function Home() {
  const [q, setQ] = useState('');
  const [district, setDistrict] = useState('Todos');
  const [minArea, setMinArea] = useState('');
  const [maxRent, setMaxRent] = useState('');
  const [items, setItems] = useState<Listing[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Busca exclusivamente oficinas en alquiler en Madrid capital.');
  const [manual, setManual] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (isListingArray(parsed)) setItems(parsed);
      }
    } catch {
      setMessage('No se pudieron recuperar los datos guardados en este navegador.');
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      setMessage('No se han podido guardar los cambios en el almacenamiento del navegador.');
    }
  }, [items, hydrated]);

  const filtered = useMemo(() => items.filter((item) => {
    if (district !== 'Todos' && item.district !== district) return false;
    if (minArea !== '' && (item.area === null || item.area < Number(minArea))) return false;
    if (maxRent !== '' && (item.rent === null || item.rent > Number(maxRent))) return false;
    return true;
  }), [items, district, minArea, maxRent]);

  const cost = (item: Listing) => {
    const total = item.rent !== null && item.community !== null && item.ibi !== null
      ? item.rent + item.community + item.ibi
      : null;
    return { total };
  };

  async function search() {
    if (loading) return;
    setLoading(true);
    setMessage('Consultando portales y validando fichas de oficinas…');
    try {
      const response = await fetch('/api/search?q=' + encodeURIComponent(q.trim()), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data: { listings?: unknown; message?: string } = await response.json();
      if (!isListingArray(data.listings)) throw new Error('Respuesta de búsqueda no válida');
      setItems(data.listings);
      setMessage(data.message || 'Búsqueda terminada.');
    } catch {
      setMessage('No se pudo completar la búsqueda. Se mantienen los datos guardados; inténtalo de nuevo más tarde.');
    } finally {
      setLoading(false);
    }
  }

  function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    const parse = (value: string) => value.trim() === '' ? null : Number(value.replace(',', '.'));
    const area = parse(form.area);
    const rent = parse(form.rent);
    const community = parse(form.community);
    const ibi = parse(form.ibi);
    if (!form.title.trim() || !form.address.trim()) {
      setFormError('Indica el nombre del inmueble y su dirección.');
      return;
    }
    if (area === null || !Number.isFinite(area) || area <= 0) {
      setFormError('La superficie debe ser un número mayor que cero.');
      return;
    }
    if (rent === null || !Number.isFinite(rent) || rent <= 0) {
      setFormError('La renta debe ser un importe mayor que cero.');
      return;
    }
    if ([community, ibi].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) {
      setFormError('Los gastos deben ser números iguales o mayores que cero.');
      return;
    }
    let url = '';
    if (form.url.trim()) {
      try {
        const parsedUrl = new URL(form.url.trim());
        if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') throw new Error();
        url = parsedUrl.href;
      } catch {
        setFormError('Introduce una URL válida que comience por http:// o https://.');
        return;
      }
    }
    const listing: Listing = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(36).slice(2),
      title: form.title.trim(),
      address: form.address.trim(),
      district: form.district,
      area,
      rent,
      community,
      ibi,
      url,
      source: 'Introducción manual',
      status: 'Datos introducidos manualmente',
      checkedAt: new Date().toISOString().slice(0, 10),
    };
    setItems((previous) => [listing, ...previous]);
    setManual(false);
    setForm(emptyForm);
    setFormError('');
    setMessage('Oferta añadida y guardada en este navegador.');
  }

  function exportCsv() {
    const rows: (string | number)[][] = [
      ['Inmueble', 'Dirección', 'Distrito', 'Superficie m²', 'Renta €/m²/mes', 'Comunidad €/m²/mes', 'IBI €/m²/mes', 'Coste total €/m²/mes', 'Fuente', 'Fecha de consulta', 'URL'],
      ...filtered.map((item) => [
        item.title, item.address, item.district, item.area ?? '',
        item.rent ?? '', item.community ?? '', item.ibi ?? '',
        cost(item).total ?? '', item.source, item.checkedAt, item.url,
      ]),
    ];
    const csv = '\ufeff' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = 'oficinas-alquiler-madrid.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  return (
    <main>
      <header className="top">
        <div className="brand"><div className="mark">M</div><div><b>MADRID OFFICE MARKET</b><small>ALQUILER DE OFICINAS · MADRID CAPITAL</small></div></div>
        <span className="live">OFFICE LEASING</span>
      </header>
      <section className="hero">
        <div className="eyebrow">MADRID · COMMERCIAL REAL ESTATE</div>
        <h1>Oficinas en alquiler.<br /><em>Comparadas con criterio.</em></h1>
        <p>Renta, comunidad e IBI en una misma unidad de comparación. Solo oficinas en alquiler; se excluyen venta, coworking y puestos flexibles.</p>
        <div className="searchbar">
          <MapPin size={19} />
          <input aria-label="Zona, barrio, calle o edificio" value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="Zona, barrio, calle o edificio (ej. AZCA, Salamanca)…" />
          <button onClick={search} disabled={loading}>{loading ? <RefreshCw className="spin" size={17} /> : <Search size={17} />} {loading ? 'Buscando' : 'Buscar oficinas'}</button>
        </div>
        <div className="scope"><span>Madrid capital</span><span>Fuentes gratuitas</span><span>Solo alquiler de oficinas</span></div>
      </section>
      <section className="metrics">
        <div><small>OFERTAS EN RESULTADOS</small><strong>{filtered.length.toString().padStart(2, '0')}</strong></div>
        <div><small>CON RENTA DETECTADA</small><strong>{filtered.filter((item) => item.rent !== null).length.toString().padStart(2, '0')}</strong></div>
        <div><small>GASTOS COMPLETOS</small><strong>{filtered.filter((item) => cost(item).total !== null).length.toString().padStart(2, '0')}</strong></div>
        <div><small>ÁMBITO</small><strong className="scopebig">MADRID</strong></div>
      </section>
      <section className="results">
        <div className="sectionhead">
          <div><div className="eyebrow">COMPARATIVA</div><h2>Ofertas localizadas</h2><p aria-live="polite">{message}</p></div>
          <div className="actions">
            <button className="secondary" onClick={() => { setManual(true); setFormError(''); }}><Plus size={16} /> Añadir oferta</button>
            <button className="secondary" onClick={exportCsv} disabled={!filtered.length}><Download size={16} /> Exportar CSV</button>
          </div>
        </div>
        <div className="filters">
          <div><SlidersHorizontal size={16} /><b>Filtros</b></div>
          <select aria-label="Filtrar por distrito" value={district} onChange={(event) => setDistrict(event.target.value)}>
            <option value="Todos">Todos los distritos</option>
            {districts.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input aria-label="Superficie mínima en metros cuadrados" type="number" min="1" step="1" placeholder="Superficie mín. m²" value={minArea} onChange={(event) => setMinArea(event.target.value)} />
          <input aria-label="Renta máxima por metro cuadrado y mes" type="number" min="0" step="0.01" placeholder="Renta máx. €/m²/mes" value={maxRent} onChange={(event) => setMaxRent(event.target.value)} />
          <span className="count">{filtered.length} resultados</span>
        </div>
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="emptyicon"><Building2 size={27} /></div>
            <h3>Sin ofertas verificadas por ahora</h3>
            <p>Busca una zona concreta o añade una ficha de oficina. Los resultados automáticos solo se incorporan cuando se pueden identificar datos fiables; no se generan ofertas ficticias.</p>
            <button onClick={search} disabled={loading}><Search size={16} /> Iniciar búsqueda</button>
          </div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead><tr><th>INMUEBLE / UBICACIÓN</th><th>SUPERFICIE</th><th>RENTA<br />€/m²/MES</th><th>COMUNIDAD<br />€/m²/MES</th><th>IBI<br />€/m²/MES</th><th>COSTE TOTAL<br />€/m²/MES</th><th>FUENTE</th></tr></thead>
              <tbody>{filtered.map((item) => (
                <tr key={item.id}>
                  <td><b>{item.title}</b><small>{item.address} · {item.district}</small><span className="tag">{item.status}</span></td>
                  <td>{item.area ? item.area.toLocaleString('es-ES') + ' m²' : 'Pendiente'}</td>
                  <td className="num">{fmt(item.rent)}</td>
                  <td className="num">{fmt(item.community)}</td>
                  <td className="num">{fmt(item.ibi)}</td>
                  <td className="num total">{fmt(cost(item).total)}</td>
                  <td>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">Ver anuncio <ExternalLink size={12} /></a> : item.source}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="footnote"><Info size={15} /> Coste total mensual por m² = renta + comunidad/mantenimiento + IBI. Solo se calcula cuando están disponibles los tres importes; los datos no publicados quedan pendientes, nunca se consideran cero.</div>
      </section>
      <section className="method">
        <div><div className="eyebrow">CRITERIO DE COMPARACIÓN</div><h2>Una unidad común<br />para cada coste.</h2></div>
        <div className="methodgrid">
          <article><b>01 / Renta</b><p>Renta mensual por m². Las rentas anuales se convierten dividiendo entre 12.</p></article>
          <article><b>02 / Comunidad</b><p>Gastos de comunidad o mantenimiento (*Service Charge*) en €/m²/mes.</p></article>
          <article><b>03 / IBI</b><p>Importe anual dividido entre 12 y entre la superficie, expresado en €/m²/mes.</p></article>
          <article><b>04 / Coste total</b><p>Suma de renta + comunidad/mantenimiento + IBI, expresada en €/m²/mes.</p></article>
        </div>
      </section>
      <footer>MADRID OFFICE MARKET <span>Herramienta de análisis · Versión 2.1</span></footer>
      {manual && (
        <div className="modalbg" onClick={() => setManual(false)}>
          <form className="modal" onClick={(event) => event.stopPropagation()} onSubmit={add}>
            <button type="button" className="close" aria-label="Cerrar formulario" onClick={() => setManual(false)}><X /></button>
            <div className="eyebrow">INCORPORAR ANUNCIO</div><h2>Completar ficha de oficina</h2>
            <p>Introduce los importes directamente en €/m²/mes y la superficie en m². Los campos de comunidad e IBI son opcionales.</p>
            <label>Nombre del inmueble<input required maxLength={120} value={form.title} onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))} /></label>
            <label>Dirección<input required maxLength={180} value={form.address} onChange={(event) => setForm((previous) => ({ ...previous, address: event.target.value }))} /></label>
            <label>Distrito<select value={form.district} onChange={(event) => setForm((previous) => ({ ...previous, district: event.target.value }))}>{districts.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Superficie m²<input required type="number" min="1" step="0.01" value={form.area} onChange={(event) => setForm((previous) => ({ ...previous, area: event.target.value }))} /></label>
            <label>Renta €/m²/mes<input required type="number" min="0.01" step="0.01" value={form.rent} onChange={(event) => setForm((previous) => ({ ...previous, rent: event.target.value }))} /></label>
            <label>Comunidad / Service Charge €/m²/mes<input type="number" min="0" step="0.01" value={form.community} onChange={(event) => setForm((previous) => ({ ...previous, community: event.target.value }))} /></label>
            <label>IBI €/m²/mes<input type="number" min="0" step="0.01" value={form.ibi} onChange={(event) => setForm((previous) => ({ ...previous, ibi: event.target.value }))} /></label>
            <label>URL del anuncio<input type="url" maxLength={500} placeholder="https://" value={form.url} onChange={(event) => setForm((previous) => ({ ...previous, url: event.target.value }))} /></label>
            {formError && <p className="formerror" role="alert">{formError}</p>}
            <button type="submit" className="primary">Guardar oferta</button>
          </form>
        </div>
      )}
    </main>
  );
}
