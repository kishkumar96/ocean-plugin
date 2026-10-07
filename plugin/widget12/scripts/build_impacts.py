"""Builds public/drought-impacts.json from the COSPPac impact log spreadsheet.

The drought layers' EEZ popups list each country's recent drought-related
impact entries from this file.

    python3 scripts/build_impacts.py [path/to/impact-log.xlsx] [--since 2026-01-01]

Defaults: data/Impact log - COSPPac3.xlsx (kept out of public/ and git: it is
an internal log), entries dated on or after --since (default 2026-01-01).

Only the "Outcome log" sheet is read (the Feedback sheet names people), only
entries whose "Relevant outcome" is "Impact" (not internal capability notes),
and only these fields are published per entry: title, month, source, and a link if
it is a public web address (internal documents and SharePoint links are
dropped). Entries for "All"/"Regional" are skipped (no single EEZ).

Needs openpyxl (pip install openpyxl).
"""

import argparse
import datetime as dt
import json
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_XLSX = ROOT / "data" / "Impact log - COSPPac3.xlsx"
OUT = ROOT / "public" / "drought-impacts.json"

# Country names used in the log -> codes in public/pacific-eez.json.
COUNTRIES = {
    "american samoa": "AS",
    "cook islands": "CK",
    "fiji": "FJ",
    "fsm": "FM",
    "federated states of micronesia": "FM",
    "micronesia": "FM",
    "guam": "GU",
    "kiribati": "KI",
    "rmi": "MH",
    "marshall islands": "MH",
    "northern mariana islands": "MP",
    "new caledonia": "NC",
    "nauru": "NR",
    "niue": "NU",
    "french polynesia": "PF",
    "png": "PG",
    "papua new guinea": "PG",
    "pitcairn": "PN",
    "palau": "PW",
    "solomon islands": "SB",
    "solomons": "SB",
    "tokelau": "TK",
    "tonga": "TO",
    "tuvalu": "TV",
    "vanuatu": "VU",
    "wallis and futuna": "WF",
    "samoa": "WS",
}

# What counts as drought-related (title or description).
DROUGHT = re.compile(
    r"drought|dry[- ](?:weather|season|conditions)|water shortage|water tank"
    r"|rationing|el ni[nñ]o",
    re.I,
)

# Links on these hosts are internal and never published.
PRIVATE_HOSTS = re.compile(r"sharepoint\.com|onedrive|\.local\b", re.I)


def public_link(cell):
    """The cell's public http(s) URL (hyperlink or text), else None."""
    for url in (cell.hyperlink.target if cell.hyperlink else None, cell.value):
        if isinstance(url, str):
            url = url.strip()
            if re.match(r"https?://", url) and not PRIVATE_HOSTS.search(url):
                return url
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("xlsx", nargs="?", default=str(DEFAULT_XLSX))
    parser.add_argument("--since", default="2026-01-01")
    args = parser.parse_args()
    since = dt.date.fromisoformat(args.since)

    sheet = openpyxl.load_workbook(args.xlsx)["Outcome log"]
    header = [c.value for c in sheet[1]]
    col = {name: header.index(name) for name in header if name}

    countries = {}
    skipped = 0
    for row in sheet.iter_rows(min_row=2):
        value = lambda name: row[col[name]].value  # noqa: E731
        title, when = value("Title"), value("Date")
        text = f"{title or ''} {value('Description') or ''}"
        if not title or not isinstance(when, dt.datetime) or not DROUGHT.search(text):
            continue
        if when.date() < since:
            continue
        if str(value("Relevant outcome") or "").strip().lower() != "impact":
            continue
        codes = {
            COUNTRIES.get(name.strip().lower())
            for name in str(value("Country") or "").split(",")
        } - {None}
        if not codes:
            skipped += 1  # "All", "Regional", unknown
            continue
        entry = {
            "id": value("ID"),
            "title": " ".join(str(title).split()),
            "month": when.strftime("%Y-%m"),
            "source": value("Source"),
            "link": public_link(row[col["Link to more information"]]),
        }
        for code in codes:
            countries.setdefault(code, []).append(entry)

    for entries in countries.values():
        entries.sort(key=lambda e: e["month"], reverse=True)

    OUT.write_text(
        json.dumps(
            {
                "source": "COSPPac impact log",
                "generated": dt.date.today().isoformat(),
                "since": since.isoformat(),
                "countries": dict(sorted(countries.items())),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    total = sum(len(e) for e in countries.values())
    print(f"Wrote {OUT} ({total} entries, {len(countries)} countries; {skipped} regional skipped)")
    for code, entries in sorted(countries.items()):
        print(f"  {code}: {len(entries)}")


if __name__ == "__main__":
    main()
