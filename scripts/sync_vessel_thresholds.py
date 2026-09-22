#!/usr/bin/env python3
"""Regenerate the widgets' vessel wind/wave thresholds from the pipeline yaml.

vessel_suitability_rules.yaml is the source of truth for what "preset" means:
the pipeline classifies against it, and the widgets' custom-envelope sliders
start from (and compare against) the same numbers. The widgets can't import
that file, so each keeps a generated copy at
src/lib/vesselThresholds.generated.json. Nothing should edit those by hand.

    python3 scripts/sync_vessel_thresholds.py            # rewrite the JSON files
    python3 scripts/sync_vessel_thresholds.py --check    # exit 1 if any is stale

--rules overrides the yaml path (default: the Cook Islands pipeline's copy;
the Niue demo's copy is byte-identical, and --check against either works).
"""
import argparse
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RULES = Path(
    "/mnt/DATA/forecast_models/CIS-PAC5-Rarotonfa-Forecast-System-main/"
    "operational_v2_dev/config/vessel_suitability_rules.yaml"
)
TARGETS = [
    ROOT / "plugin/widget1/src/lib/vesselThresholds.generated.json",
    ROOT / "plugin/widget5/src/lib/vesselThresholds.generated.json",
]
FIELD_MAP = {
    "wind_caution_kt": "cautionWindKt",
    "wind_warning_kt": "maxWindKt",
    "wave_caution_m": "cautionWaveHeightM",
    "wave_warning_m": "maxWaveHeightM",
}


def build(rules_path: Path) -> str:
    vessels = yaml.safe_load(rules_path.read_text())["vessels"]
    out = {}
    for code, rule in vessels.items():
        row = {}
        for src, dst in FIELD_MAP.items():
            value = rule[src]
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise SystemExit(f"{code}.{src} must be numeric, got {value!r}")
            row[dst] = value
        if row["cautionWindKt"] >= row["maxWindKt"] or row["cautionWaveHeightM"] >= row["maxWaveHeightM"]:
            raise SystemExit(f"{code}: caution must be below warning")
        out[code] = row
    return json.dumps(out, indent=2) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true", help="report drift instead of writing")
    parser.add_argument("--rules", type=Path, default=DEFAULT_RULES)
    args = parser.parse_args()

    expected = build(args.rules)
    stale = [t for t in TARGETS if not t.exists() or t.read_text() != expected]

    if args.check:
        for t in stale:
            print(f"STALE: {t.relative_to(ROOT)}")
        if not stale:
            print("vessel thresholds match", args.rules.name)
        return 1 if stale else 0

    for t in TARGETS:
        t.write_text(expected)
        print("wrote", t.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
