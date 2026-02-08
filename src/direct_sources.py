import time
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

from .utils import canonical_url

DEFAULT_SOURCES = {
    "LoopNet": "https://www.loopnet.es/buscar/oficinas/madrid--madrid--espana/en-alquiler/",
    "JLL": "https://www.jll.es/es/alquiler/oficinas/madrid",
    "CBRE": "https://www.cbre.es/oficinas/alquiler/madrid",
    # Savills URL changed at times; try several
    "Savills": "https://www.savills.es/es/lista/oficinas-para-alquiler/espana/madrid",
}

SOURCE_PATTERNS = {
    "LoopNet": ["loopnet.es/anuncio/"],
    "JLL": ["/es/", "ofic", "alquiler"],
    "CBRE": ["cbre.es", "oficin", "alquiler"],
    "Savills": ["savills.es", "oficin", "alquiler"],
}

def _headers():
    return {
        "User-Agent": "Mozilla/5.0 (compatible; madrid-office-rent-market/1.0; +https://streamlit.io/)",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.7",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

def _get(url: str, timeout=(7, 15)) -> tuple[str|None, str|None]:
    try:
        r = requests.get(url, headers=_headers(), timeout=timeout, allow_redirects=True)
        if r.status_code >= 400:
            return None, f"http_{r.status_code}"
        txt = r.text or ""
        low = txt.lower()
        if "cloudflare" in low and "attention required" in low:
            return None, "blocked_cloudflare"
        if "enable javascript" in low and "cookies" in low:
            return None, "blocked_js_cookies"
        if len(txt) > 3_000_000:
            return None, "too_large"
        return txt, None
    except Exception:
        return None, "timeout_or_error"

def _extract_links(base_url: str, html: str, must_contain: list[str] | None = None) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    links = []
    for a in soup.find_all("a"):
        href = a.get("href")
        if not href:
            continue
        u = urljoin(base_url, href)
        u = canonical_url(u)
        if not u:
            continue
        if must_contain:
            ok = True
            for token in must_contain:
                if token not in u:
                    ok = False
                    break
            if not ok:
                continue
        links.append(u)
    out = []
    seen = set()
    for u in links:
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out

def _sitemap_urls(root_url: str, max_sitemaps: int = 8, max_urls: int = 600) -> tuple[list[str], dict]:
    """
    Best-effort sitemap discovery:
    - tries /sitemap.xml and /sitemap_index.xml
    - supports sitemap indexes (nested sitemaps)
    """
    diag = {"sitemaps_fetched": [], "sitemap_errors": []}
    base = root_url.split("/")[0] + "//" + root_url.split("/")[2]

    candidates = []
    to_fetch = [base + "/sitemap.xml", base + "/sitemap_index.xml"]

    fetched = 0
    while to_fetch and fetched < max_sitemaps and len(candidates) < max_urls:
        sm = to_fetch.pop(0)
        xml_txt, reason = _get(sm, timeout=(7, 20))
        if not xml_txt:
            diag["sitemap_errors"].append({sm: reason})
            continue
        diag["sitemaps_fetched"].append(sm)
        fetched += 1

        try:
            # Some sitemaps have namespaces; ignore by stripping
            root = ET.fromstring(xml_txt.encode("utf-8", errors="ignore"))
            tag = root.tag.lower()

            # Detect sitemap index
            if "sitemapindex" in tag:
                for loc in root.findall(".//{*}loc"):
                    if loc.text and loc.text.strip():
                        u = loc.text.strip()
                        if u not in to_fetch and len(to_fetch) < max_sitemaps:
                            to_fetch.append(u)
                continue

            # URL set
            if "urlset" in tag:
                for loc in root.findall(".//{*}loc"):
                    if loc.text and loc.text.strip():
                        u = canonical_url(loc.text.strip())
                        if u:
                            candidates.append(u)
                            if len(candidates) >= max_urls:
                                break
        except Exception:
            diag["sitemap_errors"].append({sm: "parse_error"})
            continue

        time.sleep(0.2)

    # de-dup
    out, seen = [], set()
    for u in candidates:
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out, diag

def _filter_urls(urls: list[str], contains_tokens: list[str], max_keep: int) -> list[str]:
    out = []
    for u in urls:
        low = u.lower()
        ok = True
        for t in contains_tokens:
            if t.lower() not in low:
                ok = False
                break
        if ok:
            out.append(u)
        if len(out) >= max_keep:
            break
    return out

def collect_candidate_urls(max_per_source: int = 150, pages_loopnet: int = 3) -> tuple[list[str], dict]:
    diag = {
        "mode": "direct_sources_plus_sitemap",
        "sources": list(DEFAULT_SOURCES.keys()),
        "seed_fetch": {},
        "sitemap": {},
        "candidates_by_source": {},
        "total_candidates": 0,
    }

    candidates = []

    # 1) Try seed pages (fast)
    for name, seed in DEFAULT_SOURCES.items():
        html, reason = _get(seed)
        diag["seed_fetch"][seed] = "ok" if html else reason
        urls = []
        if html:
            must = ["loopnet.es/anuncio"] if name == "LoopNet" else None
            urls = _extract_links(seed, html, must_contain=must)
        urls = urls[:max_per_source]
        diag["candidates_by_source"][name] = len(urls)
        candidates += urls
        time.sleep(0.25)

    # 2) If a source is blocked (403/404) or yields too few, try sitemap discovery
    for name, seed in DEFAULT_SOURCES.items():
        current = diag["candidates_by_source"].get(name, 0)
        seed_status = None
        for k, v in diag["seed_fetch"].items():
            if k == seed:
                seed_status = v
                break

        if current >= 25:
            continue  # already enough

        # sitemap discovery
        urls, smdiag = _sitemap_urls(seed, max_sitemaps=10, max_urls=1000)
        diag["sitemap"][name] = smdiag

        tokens = SOURCE_PATTERNS.get(name, [])
        filtered = _filter_urls(urls, tokens, max_keep=max_per_source)
        # For LoopNet we specifically want /anuncio/
        if name == "LoopNet":
            filtered = _filter_urls(urls, ["loopnet.es/anuncio/"], max_keep=max_per_source)

        diag["candidates_by_source"][name] = max(diag["candidates_by_source"].get(name, 0), len(filtered))
        candidates += filtered
        time.sleep(0.25)

    # de-dup preserve order
    out, seen = [], set()
    for u in candidates:
        if u in seen:
            continue
        seen.add(u)
        out.append(u)

    diag["total_candidates"] = len(out)
    return out, diag
