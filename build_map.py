#!/usr/bin/env python3
"""Regenerate gw-map.json: norsu product handle -> the ONE validated GlobeWest product.

Why this exists
---------------
The ETA badge used to ask SearchSpring for the product name and trust the first
hit. SearchSpring ranks by relevance, not identity, so a norsu product whose GW
range has near-name siblings (Small vs Large, Barstool vs Dining Chair, Ottoman
vs Occasional Chair) silently picked up a DIFFERENT product's stock status.

automation/globewest-shipping/mapping.json already holds a properly validated
norsu-product -> GW-product link (sitemap match, then JSON-LD offer SKUs, then a
real guest-cart add). That is the same link the live-freight worker quotes off,
so the ETA badge should use it too rather than re-guessing.

This script joins that mapping (keyed by Shopify product id) to the published
handles from norsu's products.json and writes a compact handle -> {u,t,s} map.

Re-run after the weekly Globe West freight sync adds products:
    python3 build_map.py
"""
import json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
FREIGHT_MAP = os.path.abspath(os.path.join(
    HERE, "..", "automation", "globewest-shipping", "mapping.json"))
OUT = os.path.join(HERE, "gw-map.json")


def http(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "NorsuETAMapBuilder/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def published_gw_products():
    """Shopify product id -> handle, for every published Globe West product."""
    out, page = {}, 1
    while True:
        prods = json.loads(http(
            f"https://www.norsu.com.au/products.json?limit=250&page={page}")).get("products", [])
        if not prods:
            break
        for p in prods:
            if "globe west" in (p.get("vendor") or "").lower():
                out[p["id"]] = p["handle"]
        page += 1
        if page > 40:
            break
    return out


def main():
    if not os.path.exists(FREIGHT_MAP):
        sys.exit(f"missing freight mapping: {FREIGHT_MAP}")
    freight = json.load(open(FREIGHT_MAP))
    handles = published_gw_products()

    out, skipped = {}, []
    for pid_s, rec in freight.items():
        handle = handles.get(int(pid_s))
        if not handle:
            continue                      # mapped but no longer published
        url, title = rec.get("gw_url"), rec.get("gw_title")
        if not url or not title:
            skipped.append(handle)
            continue
        out[handle] = {"u": url, "t": title, "s": rec.get("sku")}

    json.dump(out, open(OUT, "w"), indent=0, sort_keys=True)
    print(f"freight mapping : {len(freight)} products")
    print(f"published GW    : {len(handles)} products")
    print(f"pinned to gw-map: {len(out)}")
    if skipped:
        print(f"skipped (no gw_url/title): {len(skipped)} -> {skipped[:5]}")
    unpinned = sorted(set(handles.values()) - set(out))
    print(f"published but unpinned: {len(unpinned)}")
    for h in unpinned[:10]:
        print(f"   - {h}")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
