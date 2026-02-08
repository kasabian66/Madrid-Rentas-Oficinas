from datetime import date
from urllib.parse import urlparse

from .direct_sources import collect_candidate_urls, _get
from .parsers import extract_listing_from_html

def search_without_api(max_candidates: int = 300) -> tuple[list[dict], dict]:
    urls, diag = collect_candidate_urls(max_per_source=200, pages_loopnet=3)
    urls = urls[:max_candidates]

    diag.update({
        "urls_attempted": 0,
        "downloads_ok": 0,
        "extracted_listings": 0,
        "blocked": {},
        "kept_from_snippet_only": 0,
    })

    listings: list[dict] = []
    for url in urls:
        diag["urls_attempted"] += 1
        html, reason = _get(url)
        if not html:
            diag["blocked"][reason] = diag["blocked"].get(reason, 0) + 1
            item = extract_listing_from_html(url=url, html=f"<html><body>{url}</body></html>", title_hint="")
            if item:
                item["notes"] = (item.get("notes","") + " | No se pudo descargar (posible anti-bot).").strip(" |")
                item["consulted_on"] = str(date.today())
                item["source_domain"] = urlparse(url).netloc
                listings.append(item)
                diag["kept_from_snippet_only"] += 1
            continue

        diag["downloads_ok"] += 1
        item = extract_listing_from_html(url=url, html=html, title_hint="")
        if not item:
            continue
        item["consulted_on"] = str(date.today())
        item["source_domain"] = urlparse(url).netloc
        listings.append(item)

    diag["extracted_listings"] = len(listings)
    return listings, diag
