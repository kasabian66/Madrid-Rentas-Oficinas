import re
from bs4 import BeautifulSoup
from datetime import date

# Heuristic patterns (Spanish)
RE_AREA = re.compile(r"(\d[\d\.\,]{0,10})\s*(m2|m²)\b", re.I)
RE_RENT_M2 = re.compile(r"(\d[\d\.\,]{0,10})\s*€\s*/\s*(m2|m²)\s*/\s*mes", re.I)
RE_RENT_M2_ALT = re.compile(r"(\d[\d\.\,]{0,10})\s*€/m2/mes", re.I)

RE_RENT_M2_YEAR = re.compile(r"(\d[\d\.\,]{0,10})\s*€\s*/\s*(m2|m²)\s*/\s*(año|year)", re.I)
RE_RENT_RANGE_YEAR = re.compile(r"(\d[\d\.\,]{0,10})\s*[-–]\s*(\d[\d\.\,]{0,10})\s*€\s*/\s*(m2|m²)\s*/\s*(año|year)", re.I)

RE_RENT_RANGE = re.compile(r"(\d[\d\.\,]{0,10})\s*[-–]\s*(\d[\d\.\,]{0,10})\s*€\s*/\s*(m2|m²)\s*/\s*mes", re.I)

RE_COMMUNITY = re.compile(r"(gastos\s+de\s+comunidad|comunidad)\D{0,40}(\d[\d\.\,]{0,10})\s*€", re.I)
RE_IBI = re.compile(r"\bIBI\b\D{0,40}(\d[\d\.\,]{0,10})\s*€", re.I)

RE_AVAIL = re.compile(r"(disponible\s+desde|available\s+from|availability|disponibilidad)\D{0,40}([^\n\r<]{2,40})", re.I)
RE_IMMEDIATE = re.compile(r"\b(inmediata|inmediato|immediate)\b", re.I)

def _to_float(s: str):
    if s is None:
        return None
    s = str(s).strip()
    s = s.replace(".", "").replace(",", ".")
    m = re.search(r"\d+(\.\d+)?", s)
    return float(m.group(0)) if m else None

def extract_listing_from_html(url: str, html: str, title_hint: str = "") -> dict | None:
    """
    Best-effort heuristic extractor for office rent pages.
    Returns a dict with required fields if enough signals exist.
    """
    soup = BeautifulSoup(html, "lxml")
    text = " ".join(soup.stripped_strings)
    text_l = text.lower()

    # Basic guard: must mention office/ oficina or alquiler + madrid-ish
    if ("oficina" not in text_l and "office" not in text_l and "edificio" not in text_l):
        return None
    if ("alquiler" not in text_l and "rent" not in text_l and "arrend" not in text_l):
        return None

    # Name
    h1 = soup.find("h1")
    building = (h1.get_text(" ", strip=True) if h1 else "").strip() or (title_hint or "").strip()
    building = building[:120] if building else "Oferta"

    # Location (try meta or address-like chunks)
    location = ""
    addr = soup.find("address")
    if addr:
        location = addr.get_text(" ", strip=True)
    if not location:
        # heuristic: find first occurrence of "Madrid"
        m = re.search(r"([^\.]{0,80}\bMadrid\b[^\.]{0,80})", text, flags=re.I)
        location = m.group(1).strip() if m else "Madrid (N/D)"

    # Area
    area = None
    m = RE_AREA.search(text)
    if m:
        area = _to_float(m.group(1))

    # Rent
    rent = None
    rent_basis_note = ""
    notes = ""
    m = RE_RENT_RANGE.search(text)
    if m:
        a, b = _to_float(m.group(1)), _to_float(m.group(2))
        if a is not None and b is not None:
            rent = (a + b) / 2.0
            notes = f"Renta en rango {a:g}-{b:g} €/m²/mes; calculado con media"
    else:
        m = RE_RENT_M2.search(text) or RE_RENT_M2_ALT.search(text)
        if m:
            rent = _to_float(m.group(1))


    # If not found per month, try per year and convert to month
    if rent is None:
        m = RE_RENT_RANGE_YEAR.search(text)
        if m:
            a, b = _to_float(m.group(1)), _to_float(m.group(2))
            if a is not None and b is not None:
                rent = ((a + b) / 2.0) / 12.0
                rent_basis_note = f"Renta en rango {a:g}-{b:g} €/m²/año; convertida a €/m²/mes con media/12"
        else:
            m = RE_RENT_M2_YEAR.search(text)
            if m:
                v = _to_float(m.group(1))
                if v is not None:
                    rent = v / 12.0
                    rent_basis_note = f"Renta {v:g} €/m²/año convertida a €/m²/mes (/12)"
    # Availability
    available_from = "N/D"
    if RE_IMMEDIATE.search(text):
        available_from = "Inmediato"
    else:
        m = RE_AVAIL.search(text)
        if m:
            available_from = m.group(2).strip()[:40]

    # Community / IBI
    community = None
    m = RE_COMMUNITY.search(text)
    if m:
        community = _to_float(m.group(2))
    ibi = None
    m = RE_IBI.search(text)
    if m:
        ibi = _to_float(m.group(1))

    # Minimal viability: need at least rent or area to compute something
    if area is None and rent is None:
        return None

    return {
        "building_name": building,
        "location": location,
        "area_m2": area,
        "available_from": available_from,
        "rent_eur_m2_month": rent,
        "community_eur_month": community,
        "ibi_eur_month": ibi,
        "source_url": url,
        "consulted_on": str(date.today()),
        "score": float((area is not None) + (rent is not None) + (community is not None) + (ibi is not None)),
        "notes": " | ".join([x for x in [notes.strip(), rent_basis_note.strip()] if x]).strip(),
        "lat": None,
        "lon": None,
    }
