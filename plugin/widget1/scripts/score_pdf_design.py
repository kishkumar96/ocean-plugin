#!/usr/bin/env python3
"""
Score PDF page design from rendered page images.

The scorer renders each PDF page with pdftoppm, then estimates:
  - contrast/readability
  - visual density
  - whitespace balance
  - clutter risk
  - palette consistency with the widget hazard colours

This is a heuristic QA tool, not a replacement for human review.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


HAZARD_RGB = np.array(
    [
        [42, 157, 143],   # suitable
        [244, 162, 97],   # caution
        [231, 111, 81],   # avoid
        [30, 58, 138],    # header blue
        [248, 249, 250],  # page background
    ],
    dtype=np.float32,
)


@dataclass
class PageScore:
    page: int
    contrast: float
    density: float
    whitespace: float
    clutter: float
    palette: float
    overall: float
    notes: list[str]


def clamp_score(value: float) -> float:
    return round(max(0.0, min(100.0, value)), 1)


def render_pdf(pdf_path: Path, output_dir: Path, dpi: int) -> list[Path]:
    if not shutil.which("pdftoppm"):
        raise RuntimeError("pdftoppm was not found. Install poppler-utils first.")

    prefix = output_dir / "page"
    cmd = ["pdftoppm", "-png", "-r", str(dpi), str(pdf_path), str(prefix)]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return sorted(output_dir.glob("page-*.png"))


def luminance(rgb: np.ndarray) -> np.ndarray:
    srgb = rgb / 255.0
    linear = np.where(srgb <= 0.03928, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear[..., 0] + 0.7152 * linear[..., 1] + 0.0722 * linear[..., 2]


def edge_density(gray_img: Image.Image) -> float:
    edges = gray_img.filter(ImageFilter.FIND_EDGES)
    arr = np.asarray(edges, dtype=np.float32)
    return float(np.mean(arr > 32))


def block_occupancy(gray: np.ndarray, rows: int = 12, cols: int = 16) -> np.ndarray:
    h, w = gray.shape
    occ = np.zeros((rows, cols), dtype=np.float32)
    for r in range(rows):
        y0 = int(r * h / rows)
        y1 = int((r + 1) * h / rows)
        for c in range(cols):
            x0 = int(c * w / cols)
            x1 = int((c + 1) * w / cols)
            block = gray[y0:y1, x0:x1]
            # Treat non-background pixels as occupied.
            occ[r, c] = float(np.mean(block < 242))
    return occ


def palette_score(rgb: np.ndarray) -> float:
    pixels = rgb.reshape(-1, 3).astype(np.float32)
    sample_step = max(1, len(pixels) // 200_000)
    pixels = pixels[::sample_step]

    distances = np.sqrt(((pixels[:, None, :] - HAZARD_RGB[None, :, :]) ** 2).sum(axis=2))
    nearest = distances.min(axis=1)

    colored = np.max(pixels, axis=1) - np.min(pixels, axis=1) > 18
    if not np.any(colored):
      return 75.0

    # Coloured pixels close to the approved palette score well.
    mean_distance = float(np.mean(nearest[colored]))
    return clamp_score(100 - mean_distance * 0.9)


def score_page(image_path: Path, page_num: int) -> PageScore:
    img = Image.open(image_path).convert("RGB")
    rgb = np.asarray(img, dtype=np.float32)
    gray_img = img.convert("L")
    gray = np.asarray(gray_img, dtype=np.float32)
    lum = luminance(rgb)

    edges = edge_density(gray_img)
    occ = block_occupancy(gray)
    occupied_blocks = occ[occ > 0.08]

    darkish = lum < 0.45
    lightish = lum > 0.78
    if np.any(darkish) and np.any(lightish):
        dark_l = float(np.percentile(lum[darkish], 20))
        light_l = float(np.percentile(lum[lightish], 80))
        contrast_ratio = (light_l + 0.05) / (dark_l + 0.05)
    else:
        contrast_ratio = 1.0

    contrast = clamp_score((contrast_ratio / 7.0) * 100)

    density_raw = float(np.mean(gray < 242))
    # Best range is informative but not packed: roughly 18-46% occupied.
    if density_raw < 0.18:
        density = 65 + density_raw / 0.18 * 20
    elif density_raw <= 0.46:
        density = 95
    else:
        density = 95 - (density_raw - 0.46) / 0.28 * 65
    density = clamp_score(density)

    blank_blocks = float(np.mean(occ < 0.04))
    if blank_blocks < 0.12:
        whitespace = 45 + blank_blocks / 0.12 * 35
    elif blank_blocks <= 0.45:
        whitespace = 95
    else:
        whitespace = 95 - (blank_blocks - 0.45) / 0.45 * 45
    whitespace = clamp_score(whitespace)

    dense_block_ratio = float(np.mean(occ > 0.55))
    occ_variance = float(np.std(occupied_blocks)) if len(occupied_blocks) else 0.0
    clutter_risk = edges * 155 + dense_block_ratio * 70 + occ_variance * 45
    clutter = clamp_score(100 - clutter_risk)

    palette = palette_score(rgb)

    overall = clamp_score(
        contrast * 0.30
        + density * 0.20
        + whitespace * 0.15
        + clutter * 0.20
        + palette * 0.15
    )

    notes: list[str] = []
    if contrast < 75:
        notes.append("low contrast risk")
    if density < 70:
        notes.append("page may be too sparse or too crowded")
    if whitespace < 70:
        notes.append("weak whitespace balance")
    if clutter < 70:
        notes.append("high visual clutter risk")
    if palette < 75:
        notes.append("colours drift from expected palette")
    if not notes:
        notes.append("no major heuristic flags")

    return PageScore(
        page=page_num,
        contrast=contrast,
        density=density,
        whitespace=whitespace,
        clutter=clutter,
        palette=palette,
        overall=overall,
        notes=notes,
    )


def print_table(scores: list[PageScore]) -> None:
    headers = ["Page", "Overall", "Contrast", "Density", "Whitespace", "Clutter", "Palette", "Notes"]
    widths = [5, 8, 9, 8, 11, 8, 8, 0]
    print(
        f"{headers[0]:>{widths[0]}}  {headers[1]:>{widths[1]}}  "
        f"{headers[2]:>{widths[2]}}  {headers[3]:>{widths[3]}}  "
        f"{headers[4]:>{widths[4]}}  {headers[5]:>{widths[5]}}  "
        f"{headers[6]:>{widths[6]}}  {headers[7]}"
    )
    print("-" * 96)
    for s in scores:
        print(
            f"{s.page:>{widths[0]}}  {s.overall:>{widths[1]}.1f}  "
            f"{s.contrast:>{widths[2]}.1f}  {s.density:>{widths[3]}.1f}  "
            f"{s.whitespace:>{widths[4]}.1f}  {s.clutter:>{widths[5]}.1f}  "
            f"{s.palette:>{widths[6]}.1f}  {', '.join(s.notes)}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Score PDF page design and colour heuristics.")
    parser.add_argument("pdf", type=Path, help="PDF file to score")
    parser.add_argument("--dpi", type=int, default=150, help="render DPI, default: 150")
    parser.add_argument("--json", type=Path, help="optional path to write JSON results")
    parser.add_argument("--keep-images", type=Path, help="optional folder to keep rendered PNG pages")
    parser.add_argument("--fail-under", type=float, help="exit 2 if any page overall score is below this value")
    args = parser.parse_args()

    if not args.pdf.exists():
        parser.error(f"PDF not found: {args.pdf}")

    if args.keep_images:
        args.keep_images.mkdir(parents=True, exist_ok=True)
        image_dir = args.keep_images
        cleanup = None
    else:
        cleanup = tempfile.TemporaryDirectory(prefix="pdf-design-score-")
        image_dir = Path(cleanup.name)

    try:
        page_images = render_pdf(args.pdf, image_dir, args.dpi)
        if not page_images:
            raise RuntimeError("No page images were rendered.")

        scores = [score_page(path, i + 1) for i, path in enumerate(page_images)]
        print_table(scores)

        if args.json:
            args.json.write_text(json.dumps([asdict(s) for s in scores], indent=2) + "\n")
            print(f"\nWrote JSON: {args.json}")

        if args.keep_images:
            print(f"Kept rendered images in: {args.keep_images}")

        if args.fail_under is not None:
            low_pages = [s.page for s in scores if s.overall < args.fail_under]
            if low_pages:
                print(f"\nPages below {args.fail_under:g}: {', '.join(map(str, low_pages))}")
                return 2
        return 0
    except subprocess.CalledProcessError as exc:
        print(exc.stderr or str(exc), file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        if cleanup:
            cleanup.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
