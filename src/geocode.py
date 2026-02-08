import os
import time
import requests

PHOTON_URL = "https://photon.komoot.io/api"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

def _ua() -> str:
    return os.getenv("GEOCODER_USER_AGENT") or "madrid-rent-app/1.0 (contact: please-set-GEOCODER_USER_AGENT)"

def _email() -> str | None:
    return os.getenv("NOMINATIM_EMAIL")

def _contains_madrid(s: str) -> bool:
    s = (s or "").lower()
    return "madrid" in s

def _photon_geocode(address: str) -> dict | None:
    try:
        params = {"q": address, "limit": 5, "lang": "es"}
        r = requests.get(PHOTON_URL, params=params, headers={"User-Agent": _ua()}, timeout=20)
        r.raise_for_status()
        data = r.json()
        feats = data.get("features") or []
        if not feats:
            return None

        best = None
        for f in feats:
            props = f.get("properties") or {}
            cand = " ".join([str(props.get(k,"")) for k in ["name","street","city","state","country"]])
            if _contains_madrid(cand):
                best = f
                break
        if best is None:
            best = feats[0]

        coords = (best.get("geometry") or {}).get("coordinates") or []
        if len(coords) != 2:
            return None
        lon, lat = coords[0], coords[1]
        props = best.get("properties") or {}
        name = props.get("name") or address
        city = props.get("city") or ""
        state = props.get("state") or ""
        country = props.get("country") or ""
        display = ", ".join([p for p in [name, city or state, country] if p]) or address
        return {"ok": True, "lat": float(lat), "lon": float(lon), "display_name": display, "raw": data, "provider": "photon"}
    except Exception:
        return None

def _nominatim_geocode(address: str) -> dict | None:
    params = {
        "q": address,
        "format": "jsonv2",
        "addressdetails": 1,
        "limit": 3,
        "countrycodes": "es",
    }
    em = _email()
    if em:
        params["email"] = em

    headers = {"User-Agent": _ua(), "Accept-Language": "es-ES,es;q=0.9,en;q=0.7"}

    for attempt in range(3):
        try:
            r = requests.get(NOMINATIM_URL, params=params, headers=headers, timeout=20)
            if r.status_code in (429, 503):
                time.sleep(1.0 + attempt)
                continue
            if r.status_code == 403:
                return None
            r.raise_for_status()
            data = r.json()
            if not data:
                return None

            best = None
            for item in data:
                if _contains_madrid(item.get("display_name","")):
                    best = item
                    break
            if best is None:
                best = data[0]

            return {
                "ok": True,
                "lat": float(best["lat"]),
                "lon": float(best["lon"]),
                "display_name": best.get("display_name", address),
                "raw": best,
                "provider": "nominatim",
            }
        except Exception:
            time.sleep(0.5 + attempt)
            continue
    return None

def geocode_address(address: str) -> dict:
    if not address or not address.strip():
        return {"ok": False, "error": "Dirección vacía"}

    addr = address.strip()

    res = _photon_geocode(addr) or _nominatim_geocode(addr)
    if res and _contains_madrid(res.get("display_name","")):
        return res

    # Force Madrid context and retry
    if _contains_madrid(addr):
        forced = f"{addr}, España"
    else:
        forced = f"{addr}, Madrid, España"

    res2 = _nominatim_geocode(forced) or _photon_geocode(forced)
    if res2:
        return res2

    return {"ok": False, "error": "No se pudo geocodificar en Madrid. Revisa la dirección y/o configura GEOCODER_USER_AGENT."}
