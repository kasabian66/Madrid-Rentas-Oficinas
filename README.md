# Madrid Office Rent Market (Streamlit)

App en Streamlit para evaluar el mercado de alquiler de oficinas en Madrid a partir de una dirección.

## Qué hace
1. Geocodifica la dirección (lat/lon) usando **OpenStreetMap Nominatim**.
2. Realiza **búsqueda web multi‑fuente** (recomendado con API key) para localizar ofertas cercanas.
3. Descarga páginas candidatas y extrae (heurística) superficie, renta, disponibilidad y (si existe) comunidad/IBI.
4. Calcula distancia, deduplica, ordena por proximidad y genera tabla (hasta 20).

## Requisitos
- Python 3.10+
- Dependencias: ver `requirements.txt`

## Instalación local
```bash
pip install -r requirements.txt
streamlit run app.py
```

## Configuración de búsqueda web (recomendado)
La app funciona mejor con un **API de buscador** para obtener resultados de múltiples fuentes.

### Opción A) Serper (Google)
1. Crea una API key en serper.dev
2. En Streamlit Community Cloud: `Settings -> Secrets` añade:
```toml
SERPER_API_KEY="TU_API_KEY"
```
o en local:
```bash
export SERPER_API_KEY="TU_API_KEY"
```

### Opción B) Bing Web Search (Azure)
- Añade `BING_API_KEY` (y usa el selector de motor en la barra lateral).

## Exportación
- CSV y Excel desde la interfaz.
- PDF básico (tabla resumida).

## Notas sobre Comunidad / IBI
- Si no están publicados: por defecto **N/D**.
- Opcional: activar estimaciones con parámetros:
  - Comunidad (€/m²/mes)
  - IBI (€/m²/año) -> convertido a €/mes
- La tabla marca en `notes` cuando un valor es estimado.

## Limitaciones (importante)
- Muchos portales inmobiliarios aplican **bloqueos anti‑scraping** o requieren APIs privadas.
- La extracción es **heurística**: puede fallar o interpretar mal campos.
- La geolocalización de cada oferta depende de si la página publica coordenadas; si no, la distancia puede quedarse en N/D.

## Fuentes / estrategia
- Multi‑fuente a través de resultados de buscador (portales + consultoras/agencias).
- Dominios típicos (no exhaustivo): JLL, CBRE, Savills, Knight Frank, Cushman & Wakefield, Colliers, Idealista, Fotocasa, etc.
- Cada fila guarda **link** y **fecha de consulta** (en ejecución).

## Despliegue en Streamlit Community Cloud
1. Sube el repo a GitHub.
2. En Streamlit Community Cloud, selecciona el repo y `app.py`.
3. Configura Secrets para el buscador (recomendado).


## Geocodificación (evitar 403)
En Streamlit Cloud, algunos proveedores pueden devolver 403 en IPs compartidas.
Configura un user-agent con contacto real en Secrets:
```toml
GEOCODER_USER_AGENT="madrid-rent-app/1.0 (contact: you@company.com)"
NOMINATIM_EMAIL="you@company.com"  # opcional
```
La app intenta primero **Photon (Komoot)** y luego **Nominatim**.


## Fuente añadida: LoopNet.es
La app incluye consultas dirigidas a LoopNet usando búsquedas tipo `site:loopnet.es/anuncio ...` para localizar fichas individuales (/anuncio/), guardando el enlace por fila.


## Importante: API key del buscador (necesaria en Cloud)
En Streamlit Community Cloud, sin `SERPER_API_KEY` (recomendado) o `BING_API_KEY`, la app no puede hacer una búsqueda profunda multi-fuente de manera fiable.


## Modo sin APIs (recomendado)
Esta versión no usa Serper/Bing ni requiere tarjeta. Obtiene oportunidades desde páginas semilla de varias fuentes (LoopNet/JLL/CBRE/Savills) y extrae enlaces y datos en la medida que la web lo permita. Algunas páginas pueden bloquear descargas; en ese caso se mantiene el enlace y se marca como dato parcial.


## Cómo se mejora la cobertura sin buscadores
Cuando una fuente devuelve 403/404 en páginas de búsqueda (muy habitual en cloud), la app intenta descubrir URLs mediante `sitemap.xml` (si existe) y filtra URLs con patrones (p.ej. LoopNet /anuncio/). Esto suele aumentar mucho el número de candidatos sin usar APIs de pago.
