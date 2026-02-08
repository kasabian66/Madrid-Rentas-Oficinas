import math
import re
from datetime import date
from urllib.parse import urlparse, urlunparse

def normalize_text(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s

def canonical_url(url: str) -> str:
    try:
        p = urlparse(url)
        # drop fragments, keep query (some portals rely on it) but remove common tracking
        q = re.sub(r"(&?)(utm_[^=]+=[^&]+)", "", p.query, flags=re.I)
        q = q.strip("&")
        return urlunparse((p.scheme, p.netloc, p.path.rstrip("/"), "", q, ""))
    except Exception:
        return url

def haversine_km(lat1, lon1, lat2, lon2) -> float:
    # handle None
    if lat2 is None or lon2 is None:
        return None
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(a))

def to_float(x):
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x)
    s = s.replace(".", "").replace(",", ".")
    m = re.search(r"-?\d+(\.\d+)?", s)
    return float(m.group(0)) if m else None

def format_currency(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "N/D"
    try:
        return f"{float(x):,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return "N/D"

def deduplicate_listings(listings: list[dict]) -> list[dict]:
    """
    Deduplicate by canonical URL first, then by (normalized building/location + area + rent).
    """
    seen_url = set()
    out = []
    for it in listings:
        url = canonical_url(it.get("source_url",""))
        if url and url in seen_url:
            continue
        if url:
            seen_url.add(url)
        out.append(it)

    # secondary de-dup
    seen_key = set()
    final = []
    for it in out:
        key = (
            normalize_text(it.get("building_name","")),
            normalize_text(it.get("location","")),
            round(to_float(it.get("area_m2")) or 0, 1),
            round(to_float(it.get("rent_eur_m2_month")) or 0, 2),
        )
        if key in seen_key:
            continue
        seen_key.add(key)
        final.append(it)
    return final

def apply_filters(listings, min_area=0, district_contains="", rent_min=0.0, rent_max=200.0, availability_now=False):
    dc = normalize_text(district_contains)
    out = []
    for it in listings:
        area = to_float(it.get("area_m2"))
        rent = to_float(it.get("rent_eur_m2_month"))
        loc = normalize_text(it.get("location",""))
        avail = normalize_text(it.get("available_from",""))
        if min_area and area is not None and area < float(min_area):
            continue
        if dc and dc not in loc:
            continue
        if rent is not None:
            if rent < float(rent_min) or rent > float(rent_max):
                continue
        if availability_now and not ("inmedi" in avail or "immediate" in avail):
            continue
        out.append(it)
    return out

def compute_cost_fields(it: dict, treat_nd_as_zero: bool, enable_estimations: bool, community_rate: float, ibi_rate_annual: float):
    """
    Compute totals according to required rules.
    - If rent is in range, parser should already have converted to midpoint and stored note.
    - If community/IBI missing:
        - by default totals that include them -> N/D
        - if treat_nd_as_zero -> use 0
        - if enable_estimations -> estimate and mark as estimated
    """
    area = to_float(it.get("area_m2"))
    rent_m2 = to_float(it.get("rent_eur_m2_month"))
    if area is not None and rent_m2 is not None:
        it["rent_total_eur_month"] = area * rent_m2
    else:
        it["rent_total_eur_month"] = None

    # community
    com = to_float(it.get("community_eur_month"))
    ibi = to_float(it.get("ibi_eur_month"))

    if com is None and enable_estimations and area is not None:
        com = float(community_rate) * area
        it["community_eur_month"] = com
        it["notes"] = (it.get("notes","") + " | Comunidad estimada").strip(" |")
        it["community_is_estimated"] = True

    if ibi is None and enable_estimations and area is not None:
        ibi = (float(ibi_rate_annual) * area) / 12.0
        it["ibi_eur_month"] = ibi
        it["notes"] = (it.get("notes","") + " | IBI estimado").strip(" |")
        it["ibi_is_estimated"] = True

    # Totals with N/D handling
    rent_total = to_float(it.get("rent_total_eur_month"))

    def add_or_nd(a, b):
        if a is None or b is None:
            if treat_nd_as_zero:
                return (a or 0.0) + (b or 0.0)
            return None
        return a + b

    it["total_1_rent_plus_community"] = add_or_nd(rent_total, com)
    it["total_2_rent_plus_ibi"] = add_or_nd(rent_total, ibi)
    it["total_3_community_plus_ibi"] = add_or_nd(com, ibi)

    # Final requires all three; else N/D unless treat as zero
    if rent_total is None or com is None or ibi is None:
        if treat_nd_as_zero:
            it["total_final"] = (rent_total or 0.0) + (com or 0.0) + (ibi or 0.0)
        else:
            it["total_final"] = None
    else:
        it["total_final"] = rent_total + com + ibi

    it["consulted_on"] = it.get("consulted_on") or str(date.today())
