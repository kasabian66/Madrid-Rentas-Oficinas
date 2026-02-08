import streamlit as st
import pandas as pd
import pydeck as pdk
from datetime import date

from src.geocode import geocode_address
from src.search import search_without_api
from src.utils import (
    haversine_km, normalize_text, deduplicate_listings, apply_filters,
    compute_cost_fields, format_currency, to_float
)
from src.exporting import export_excel_bytes, export_pdf_bytes

st.set_page_config(
    page_title="Madrid Office Rent Market",
    layout="wide"
)

st.title("Madrid Office Rent Market (alquiler oficinas)")

with st.expander("Cómo funciona", expanded=False):
    st.markdown("""
- Introduce una **dirección en Madrid** y pulsa **Buscar**.
- La app **geocodifica** la dirección (lat/lon), y luego hace una **búsqueda web multi‑fuente** (vía API de buscador si está configurada) para localizar ofertas cercanas.
- Se descargan y analizan páginas de resultados, se **extraen** superficie, renta, disponibilidad y (si existe) comunidad/IBI.
- Se calcula la **distancia** a la dirección introducida, se **deduplica**, se ordena por proximidad y se muestran las **20 más cercanas** (o las que haya).
""")

st.sidebar.header("Parámetros")
address = st.sidebar.text_input("Dirección (Madrid)", value="Calle Serrano 1, Madrid")

colA, colB = st.sidebar.columns(2)
use_top_n = colA.checkbox("Usar 20 más cercanas", value=True)
radius_km = colB.number_input("Radio (km)", min_value=0.5, max_value=25.0, value=3.0, step=0.5, disabled=use_top_n)

top_n = st.sidebar.number_input("N resultados", min_value=5, max_value=50, value=20, step=1, disabled=not use_top_n)

st.sidebar.subheader("Filtros (opcionales)")
st.sidebar.caption("Nota: si pones distrito/zona (p.ej. AZCA) y la fuente no lo menciona en texto, puede filtrar todo. Prueba sin filtros primero.")
min_area = st.sidebar.number_input("Superficie mínima (m²)", min_value=0, value=0, step=50)
district_filter = st.sidebar.text_input("Distrito/zona (contiene)", value="")
rent_min = st.sidebar.number_input("Renta mín €/m²/mes", min_value=0.0, value=0.0, step=1.0)
rent_max = st.sidebar.number_input("Renta máx €/m²/mes", min_value=0.0, value=200.0, step=1.0)
availability_now = st.sidebar.checkbox("Disponibilidad inmediata", value=False)

st.sidebar.subheader("Reglas de cálculo")
treat_nd_as_zero = st.sidebar.checkbox("Tratar N/D como 0 en Comunidad/IBI", value=False)

st.sidebar.subheader("Estimaciones (opcionales)")
enable_estimations = st.sidebar.checkbox("Permitir estimar Comunidad/IBI si N/D", value=False)
community_rate = st.sidebar.number_input("Comunidad estimada (€/m²/mes)", min_value=0.0, value=3.5, step=0.1, disabled=not enable_estimations)
ibi_rate_annual = st.sidebar.number_input("IBI estimado (€/m²/año)", min_value=0.0, value=20.0, step=1.0, disabled=not enable_estimations)

st.sidebar.subheader("Búsqueda web")
st.sidebar.caption("Para mejores resultados, configura un API key en Streamlit Secrets.")
max_pages = st.sidebar.slider("Páginas de resultados a analizar", min_value=1, max_value=5, value=2)

search_btn = st.sidebar.button("Buscar", type="primary")

if search_btn:
    with st.status("Geocodificando dirección…", expanded=False) as status:
        geo = geocode_address(address)
        if not geo["ok"]:
            st.error(f"No se pudo geocodificar: {geo['error']}\n\nSugerencia: en Streamlit Cloud añade en Secrets `GEOCODER_USER_AGENT` con un contacto real (email/empresa).")
            st.stop()
        lat, lon = geo["lat"], geo["lon"]
        status.update(label=f"Dirección geocodificada ({geo.get('provider','geocoder')}): {geo['display_name']}", state="complete")

    st.subheader("Ubicación")
    st.write(geo["display_name"])
    st.caption(f"Lat/Lon: {lat:.6f}, {lon:.6f}")

    if "madrid" not in (geo.get("display_name","").lower()):
        st.warning("⚠️ La dirección geocodificada no parece estar en Madrid. Revisa la dirección (añade \", Madrid\") o prueba otra.")

    # Map
    input_point = pd.DataFrame([{"name": "Dirección", "lat": lat, "lon": lon, "type": "input"}])
    layer = pdk.Layer(
        "ScatterplotLayer",
        data=input_point,
        get_position="[lon, lat]",
        get_radius=70,
        pickable=True,
    )
    deck = pdk.Deck(
        map_style=None,
        initial_view_state=pdk.ViewState(latitude=lat, longitude=lon, zoom=13),
        layers=[layer],
        tooltip={"text": "{name}"}
    )
    st.pydeck_chart(deck, use_container_width=True)

    with st.status("Buscando ofertas en la web…", expanded=True) as status:
        listings, diag = search_without_api(max_candidates=400)
        status.update(label=f"Extracción completada (modo sin APIs): {len(listings)} candidatos", state="complete")

    with st.expander("Diagnóstico de búsqueda", expanded=False):
        st.json(diag)


    if not listings:
        st.warning("No se encontraron ofertas con extracción automática. Prueba a aumentar páginas o configurar el API key del buscador.")
        st.stop()

    # Add distance + compute
    for it in listings:
        it["dist_km"] = haversine_km(lat, lon, it.get("lat", lat), it.get("lon", lon)) if it.get("lat") is not None else None

    # Deduplicate
    listings = deduplicate_listings(listings)

    # Sort by distance if present, else by relevance score
    listings = sorted(listings, key=lambda x: (x.get("dist_km") is None, x.get("dist_km", 1e9), -x.get("score", 0)))

    # Apply radius/top_n
    if use_top_n:
        listings = listings[: int(top_n)]
    else:
        listings = [x for x in listings if x.get("dist_km") is not None and x["dist_km"] <= float(radius_km)]
        listings = listings[:20]  # cap for UI

    if not listings:
        st.warning("No hay resultados tras aplicar radio/selección.")
        st.stop()

    # Apply optional filters
    listings = apply_filters(
        listings,
        min_area=min_area,
        district_contains=district_filter,
        rent_min=rent_min,
        rent_max=rent_max,
        availability_now=availability_now
    )

    if not listings:
        st.warning("No hay resultados tras aplicar filtros.")
        st.stop()

    # Compute costs and totals
    for it in listings:
        compute_cost_fields(
            it,
            treat_nd_as_zero=treat_nd_as_zero,
            enable_estimations=enable_estimations,
            community_rate=community_rate,
            ibi_rate_annual=ibi_rate_annual
        )

    df = pd.DataFrame(listings)

    # Build required columns (keep extra columns hidden)
    required_cols = [
        "building_name",
        "location",
        "dist_km",
        "area_m2",
        "available_from",
        "rent_eur_m2_month",
        "rent_total_eur_month",
        "community_eur_month",
        "ibi_eur_month",
        "total_1_rent_plus_community",
        "total_2_rent_plus_ibi",
        "total_3_community_plus_ibi",
        "total_final",
        "source_url",
        "source_domain",
        "consulted_on",
        "notes",
    ]
    for c in required_cols:
        if c not in df.columns:
            df[c] = None
    df = df[required_cols]

    st.subheader("Resultados")
    st.caption("N/D se mantiene por defecto en los totales si Comunidad/IBI no están publicados. Activa 'Tratar N/D como 0' si quieres sumar con 0.")

    # Nicely format for display
    display_df = df.copy()
    display_df["dist_km"] = display_df["dist_km"].map(lambda x: f"{x:.2f}" if isinstance(x, (int, float)) else "N/D")
    money_cols = [
        "rent_eur_m2_month","rent_total_eur_month","community_eur_month","ibi_eur_month",
        "total_1_rent_plus_community","total_2_rent_plus_ibi","total_3_community_plus_ibi","total_final"
    ]
    for c in money_cols:
        display_df[c] = display_df[c].map(format_currency)

    st.dataframe(
        display_df,
        use_container_width=True,
        hide_index=True,
        column_config={
            "source_url": st.column_config.LinkColumn("Fuente", display_text="abrir"),
        }
    )

    if len(df) < 20:
        st.info(f"Se muestran {len(df)} resultados (menos de 20 disponibles con extracción automática).")

    # Listings map
    st.subheader("Mapa de ofertas")
    pts = []
    for _, row in df.iterrows():
        if pd.notna(row.get("source_url")):
            # listing lat/lon not in df; pull from original data if present
            pass
    # show approximate points if we have lat/lon in original listings
    map_points = []
    for it in listings:
        if it.get("lat") is not None and it.get("lon") is not None:
            map_points.append({"name": it.get("building_name","Oferta"), "lat": it["lat"], "lon": it["lon"], "dist": it.get("dist_km")})
    if map_points:
        mp = pd.DataFrame(map_points)
        layers = [
            pdk.Layer("ScatterplotLayer", data=input_point, get_position="[lon, lat]", get_radius=90, pickable=True),
            pdk.Layer("ScatterplotLayer", data=mp, get_position="[lon, lat]", get_radius=60, pickable=True),
        ]
        deck2 = pdk.Deck(
            map_style=None,
            initial_view_state=pdk.ViewState(latitude=lat, longitude=lon, zoom=13),
            layers=layers,
            tooltip={"text": "{name}\nDist: {dist} km"}
        )
        st.pydeck_chart(deck2, use_container_width=True)
    else:
        st.caption("No se pudieron inferir coordenadas de las ofertas (se muestran solo en tabla).")

    st.subheader("Exportación")
    col1, col2, col3 = st.columns(3)
    csv_bytes = df.to_csv(index=False).encode("utf-8")
    col1.download_button("Descargar CSV", data=csv_bytes, file_name="madrid_alquiler_oficinas.csv", mime="text/csv")

    xlsx_bytes = export_excel_bytes(df)
    col2.download_button("Descargar Excel", data=xlsx_bytes, file_name="madrid_alquiler_oficinas.xlsx", mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    pdf_bytes = export_pdf_bytes(df, title="Madrid Office Rent Market")
    col3.download_button("Descargar PDF", data=pdf_bytes, file_name="madrid_alquiler_oficinas.pdf", mime="application/pdf")

    with st.expander("Fuentes usadas y trazabilidad", expanded=False):
        st.markdown("""
La app intenta localizar ofertas mediante **búsqueda web** (motor configurable) y analiza páginas de distintos dominios.
- Cada fila incluye **Fuente (link)** y **fecha de consulta**.
- Se **deduplican** activos repetidos entre fuentes (por URL canónica y normalización de ubicación/título).
- Comunidad e IBI: se muestran **publicados** si aparecen en la fuente. Si no aparecen:
  - Por defecto: **N/D**.
  - Opcional: permitir **estimación** (marcada como *estimado*) con parámetros ajustables en la barra lateral.
""")
else:
    st.info("Introduce una dirección y pulsa **Buscar** en la barra lateral.")
