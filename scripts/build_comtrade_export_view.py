"""Build the exporter-reported product view from the validated Comtrade caches.

Importer- and exporter-reported observations are mirror reporting views. This
script preserves exporter reporters and their partners separately and never
adds them to the importer-reported dataset.
"""

from __future__ import annotations

import gzip
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
IMPORT_SOURCE = (
    PROJECT_ROOT
    / "data"
    / "private-publication-source"
    / "trade-flows-comtrade.full.json"
)
OUTPUT_PATH = (
    PROJECT_ROOT
    / "data"
    / "private-publication-source"
    / "trade-flows-comtrade-exports.full.json"
)
CACHE_DIRECTORIES = (
    PROJECT_ROOT / "outputs" / "comtrade_trade_explorer",
    PROJECT_ROOT / "outputs" / "comtrade_additional_vehicle_types",
    PROJECT_ROOT / "outputs" / "comtrade_ice_passenger_vehicles",
    PROJECT_ROOT / "outputs" / "comtrade_ev_product_exports",
)


def normalized_iso(value: object) -> str:
    return str(value or "").strip().upper()


def normalized_m49(value: object) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def main() -> int:
    source = json.loads(IMPORT_SOURCE.read_text(encoding="utf-8"))
    years = [int(year) for year in source["years"]]
    year_indexes = {year: index for index, year in enumerate(years)}
    products = source["products"]
    product_indexes = {
        str(product["code"]): index for index, product in enumerate(products)
    }
    economies = source["economies"]
    economy_by_iso = {
        normalized_iso(economy.get("iso3")): index
        for index, economy in enumerate(economies)
        if normalized_iso(economy.get("iso3"))
    }
    economy_by_m49 = {}
    for index, economy in enumerate(economies):
        code = normalized_m49(economy.get("m49"))
        if code is not None:
            economy_by_m49[code] = index

    chunk_by_code: dict[str, Path] = {}
    for cache in CACHE_DIRECTORIES:
        for code in product_indexes:
            candidate = cache / "raw" / str(years[-1]) / "exports" / f"{code}.json.gz"
            if candidate.exists():
                if code in chunk_by_code:
                    raise RuntimeError(
                        f"Exporter cache for HS {code} occurs in both "
                        f"{chunk_by_code[code].parents[3]} and {cache}"
                    )
                chunk_by_code[code] = cache

    missing_products = sorted(set(product_indexes) - set(chunk_by_code))
    if missing_products:
        raise RuntimeError(
            "Missing exporter caches for: " + ", ".join(missing_products)
        )

    series: dict[tuple[int, int, int], list[float | None]] = {}
    source_rows = 0
    duplicate_rows = 0
    missing_economies: defaultdict[tuple[int | None, str, str], int] = defaultdict(int)

    def economy_index(code_value: object, iso_value: object, name: str) -> int | None:
        code = normalized_m49(code_value)
        iso = normalized_iso(iso_value)
        if code == 0 or name.strip().casefold() == "world":
            return economy_by_m49.get(0)
        if iso and iso in economy_by_iso:
            return economy_by_iso[iso]
        if code is not None and code in economy_by_m49:
            return economy_by_m49[code]
        missing_economies[(code, iso, name)] += 1
        return None

    for code, cache in sorted(chunk_by_code.items()):
        product_index = product_indexes[code]
        for year in years:
            chunk = cache / "raw" / str(year) / "exports" / f"{code}.json.gz"
            if not chunk.exists():
                # EV-only products begin in 2022.
                if year < int(products[product_index].get("availableFrom") or years[0]):
                    continue
                raise RuntimeError(f"Missing exporter chunk: {chunk}")
            with gzip.open(chunk, "rt", encoding="utf-8") as handle:
                payload = json.load(handle)
                for row in payload.get("data") or []:
                    source_rows += 1
                    if row.get("flowCode") != "X":
                        raise RuntimeError(f"Unexpected reporting side in {chunk}")
                    exporter_index = economy_index(
                        row.get("reporterCode"),
                        row.get("reporterISO"),
                        row.get("reporterDesc") or "",
                    )
                    importer_index = economy_index(
                        row.get("partnerCode"),
                        row.get("partnerISO"),
                        row.get("partnerDesc") or "",
                    )
                    if exporter_index is None or importer_index is None:
                        continue
                    try:
                        value = float(row["primaryValue"]) / 1000
                    except (KeyError, TypeError, ValueError):
                        continue
                    key = (product_index, exporter_index, importer_index)
                    values = series.setdefault(key, [None] * len(years))
                    year_index = year_indexes[year]
                    if values[year_index] is None:
                        values[year_index] = round(value, 3)
                    else:
                        values[year_index] = round(values[year_index] + value, 3)
                        duplicate_rows += 1

    missing_economy_rows = sum(missing_economies.values())

    records = [
        [product, exporter, importer, values]
        for (product, exporter, importer), values in series.items()
        if any(value is not None for value in values)
    ]
    records.sort(key=lambda record: (record[0], record[1], record[2]))
    output = {
        "meta": {
            "title": "ATO product trade flows",
            "source": "UN Comtrade",
            "sourceEndpoint": "https://comtradeapi.un.org/data/v1/get/C/A/HS",
            "sourceMode": "Exporter-reported annual trade, HS as reported",
            "reportingSide": "exporter-reported",
            "unit": "current US dollar thousand",
            "builtUtc": datetime.now(timezone.utc).isoformat(),
            "startYear": years[0],
            "endYear": years[-1],
            "rowCount": len(records),
            "sourceObservationRows": source_rows,
            "note": (
                "World totals and bilateral destinations are exporter-reported. "
                "They are an alternative view and are not added to importer-reported values."
            ),
        },
        "years": years,
        "products": products,
        "economies": economies,
        "records": records,
    }
    temporary = OUTPUT_PATH.with_suffix(OUTPUT_PATH.suffix + ".tmp")
    temporary.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary.replace(OUTPUT_PATH)
    print(f"Exporter records: {len(records):,}")
    print(f"Exporter source rows: {source_rows:,}")
    print(f"Duplicate rows combined: {duplicate_rows:,}")
    print(f"Rows skipped for unmapped special areas: {missing_economy_rows:,}")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
