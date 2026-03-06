#!/usr/bin/env python3
"""
Generate characters.png sprite sheet for the social village observer.

Uses Gemini to generate 12 complete character variants (one per API call).
Each call produces a 3×2 grid of 6 poses for one character, which gets
split into 6 cells, downscaled to 32×32 each, and placed into the
variant's row in the final 384×384 sheet.

Usage:
  source /root/openclaw-cloud/.env
  python3 generate-characters.py

Cost estimate: 12 API calls × ~$0.13 = ~$1.56 total
"""

import os
import sys
import io
import time
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image

# --- Config ---
API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    print("Error: GEMINI_API_KEY not set. Run: source /root/openclaw-cloud/.env")
    sys.exit(1)

MODEL = "gemini-3-pro-image-preview"
OUTPUT_DIR = Path(__file__).parent / "assets"
PARTS_DIR = OUTPUT_DIR / "char_variants"  # intermediate variant images
OUTPUT_FILE = OUTPUT_DIR / "characters.png"
SHEET_W = 384  # 12 cols × 32px
SHEET_H = 384  # 12 rows × 32px
CELL = 32
COLS = 12
ROWS = 12

client = genai.Client(api_key=API_KEY)

# --- Shared prompt preamble ---
PREAMBLE = (
    "You are a pixel art sprite sheet artist. Generate a 3×2 grid image showing "
    "6 poses of a SINGLE CHARACTER for an RPG village game. "
    "The grid is 3 columns × 2 rows, reading left-to-right, top-to-bottom:\n"
    "  1. idle (standing still)\n"
    "  2. walk (legs spread, arms swinging)\n"
    "  3. talk (one arm raised, gesturing)\n"
    "  4. think (hand on chin)\n"
    "  5. sit (seated, legs forward)\n"
    "  6. wave (arm raised high, waving)\n\n"
    "Art style: clean retro pixel art like classic SNES RPGs. Front-facing character, "
    "2-4 shades per material, NO anti-aliasing, NO gradients. Light from top-left. "
    "Each cell should show the COMPLETE character (head, body, legs, feet) centered. "
    "Use a SOLID BRIGHT GREEN (#00ff00) background so it can be chroma-keyed. "
    "DO NOT use green anywhere on the character."
)

# --- 12 character variant descriptions ---
VARIANTS = [
    # Rows 0-3: "efficient" personality — neat clothing, cool tones
    (0, "variant_00.png",
     "VARIANT 0 (Efficient): A tidy professional in a navy blue blazer and dark slacks. "
     "Short cropped dark hair, serious expression. Cool-toned palette: navy, charcoal, white shirt underneath. "
     "Clean-cut, organized look. Light skin tone."),

    (1, "variant_01.png",
     "VARIANT 1 (Efficient): A sharp analyst with rectangular glasses and a gray sweater vest "
     "over a light blue shirt. Medium-length brown hair, neatly parted. Dark pants. "
     "Intellectual but approachable. Medium skin tone."),

    (2, "variant_02.png",
     "VARIANT 2 (Efficient): A practical engineer in a dark teal polo shirt and khaki pants. "
     "Black hair in a short neat style. Carries a small tool or clipboard. "
     "Functional, no-nonsense look. Dark skin tone."),

    (3, "variant_03.png",
     "VARIANT 3 (Efficient): A composed planner in a crisp white button-down and charcoal trousers. "
     "Silver/gray hair tied back neatly. Minimal accessories. "
     "Elegant efficiency. Medium-light skin tone."),

    # Rows 4-7: "witty" personality — colorful, expressive
    (4, "variant_04.png",
     "VARIANT 4 (Witty): A bold character in a bright red jacket with yellow accents. "
     "Wild spiky auburn hair. Mischievous grin. Colorful sneakers. "
     "Energetic and eye-catching. Light skin tone."),

    (5, "variant_05.png",
     "VARIANT 5 (Witty): A quirky artist in a purple tie-dye shirt and orange shorts. "
     "Messy pink-streaked hair. Expressive face. Bright mismatched socks visible. "
     "Creative chaos personified. Medium skin tone."),

    (6, "variant_06.png",
     "VARIANT 6 (Witty): A streetwise joker in a green hoodie with a funny graphic. "
     "Dark curly hair with a bright blue streak. Confident smirk. "
     "Jeans with patches. Urban cool. Dark skin tone."),

    (7, "variant_07.png",
     "VARIANT 7 (Witty): A theatrical character in a magenta vest and striped pants. "
     "Dramatic wavy dark hair. Bowtie. Animated expression. "
     "Showmanship and flair. Medium-light skin tone."),

    # Rows 8-11: "caring" personality — warm tones, soft look
    (8, "variant_08.png",
     "VARIANT 8 (Caring): A gentle healer in a soft green cardigan over a cream top. "
     "Long flowing brown hair with a small flower tucked behind the ear. Warm smile. "
     "Comfortable brown boots. Nurturing presence. Light skin tone."),

    (9, "variant_09.png",
     "VARIANT 9 (Caring): A warm cook in a peach apron over a light yellow shirt. "
     "Short curly auburn hair. Kind round face. Flour-dusted look. "
     "Cozy and welcoming. Medium skin tone."),

    (10, "variant_10.png",
     "VARIANT 10 (Caring): A patient gardener in earth-toned overalls and a rust-colored shirt. "
     "Dark hair in a loose ponytail. Gentle eyes. Work gloves. "
     "Grounded and dependable. Dark skin tone."),

    (11, "variant_11.png",
     "VARIANT 11 (Caring): A soft-spoken sage in a lavender robe with a warm orange sash. "
     "Long white/silver hair. Peaceful expression. Simple sandals. "
     "Wisdom and warmth. Medium-light skin tone."),
]


def extract_image(response):
    """Extract PIL Image from a Gemini API response."""
    for part in response.candidates[0].content.parts:
        if hasattr(part, "inline_data") and part.inline_data and part.inline_data.data:
            data = part.inline_data.data
            if isinstance(data, str):
                import base64
                data = base64.b64decode(data)
            return Image.open(io.BytesIO(data))
    return None


def chromakey_to_alpha(img):
    """Replace bright green (#00ff00) background with transparency."""
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            # Generous green screen detection
            if g > 180 and r < 100 and b < 100:
                pixels[x, y] = (0, 0, 0, 0)
    return img


def generate_variant(prompt, filename, retries=2):
    """Generate a single variant's 3×2 grid via Gemini API, with retry."""
    full_prompt = f"{PREAMBLE}\n\n{prompt}"

    for attempt in range(retries + 1):
        try:
            print(f"  [{filename}] Calling API (attempt {attempt + 1})...")
            response = client.models.generate_content(
                model=MODEL,
                contents=full_prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                ),
            )

            img = extract_image(response)
            if not img:
                print(f"  [{filename}] No image in response")
                continue

            print(f"  [{filename}] Got {img.size[0]}x{img.size[1]} ({img.mode})")

            # Chroma key green background to alpha
            img = chromakey_to_alpha(img)

            # Save intermediate (full resolution)
            img.save(PARTS_DIR / filename)
            return img

        except Exception as e:
            print(f"  [{filename}] Error: {e}")
            if attempt < retries:
                time.sleep(2)

    print(f"  [{filename}] FAILED after {retries + 1} attempts")
    return None


def split_grid_to_row(img):
    """
    Split a 3×2 grid image into 12 cells (6 poses × 2 frames) for one row.
    Returns a 384×32 RGBA image.

    Grid layout (3 cols × 2 rows):
      idle, walk, talk
      think, sit, wave

    Output columns (6 poses × 2 frames):
      idle-f0, idle-f1, walk-f0, walk-f1, talk-f0, talk-f1,
      think-f0, think-f1, sit-f0, sit-f1, wave-f0, wave-f1

    Frame 0 = downscaled pose, Frame 1 = shifted 1px up (bounce).
    """
    w, h = img.size
    cell_w = w // 3
    cell_h = h // 2

    row = Image.new("RGBA", (SHEET_W, CELL), (0, 0, 0, 0))

    # Grid positions: (grid_col, grid_row) for each pose
    grid_positions = [
        (0, 0),  # idle
        (1, 0),  # walk
        (2, 0),  # talk
        (0, 1),  # think
        (1, 1),  # sit
        (2, 1),  # wave
    ]

    for pose_idx, (gc, gr) in enumerate(grid_positions):
        # Crop the cell from the grid
        cell = img.crop((gc * cell_w, gr * cell_h, (gc + 1) * cell_w, (gr + 1) * cell_h))

        # Downscale to 32×32 (nearest neighbor for pixel art)
        cell_32 = cell.resize((CELL, CELL), Image.NEAREST)

        # Frame 0: normal
        col_f0 = pose_idx * 2
        row.paste(cell_32, (col_f0 * CELL, 0))

        # Frame 1: bounce (shift 1px up, wrap bottom)
        bounce = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        bounce.paste(cell_32.crop((0, 1, CELL, CELL)), (0, 0))
        col_f1 = pose_idx * 2 + 1
        row.paste(bounce, (col_f1 * CELL, 0))

    return row


def generate_sheet():
    """Generate all variants and composite into final sheet."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PARTS_DIR.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (SHEET_W, SHEET_H), (0, 0, 0, 0))

    total_calls = len(VARIANTS)
    cost_per_call = 0.13
    total_cost = total_calls * cost_per_call
    print(f"=== Character Sprite Sheet Generator (Variant Mode) ===")
    print(f"Model: {MODEL}")
    print(f"Variants to generate: {total_calls}")
    print(f"Estimated cost: {total_calls} × ${cost_per_call} = ${total_cost:.2f}")
    print(f"Output: {OUTPUT_FILE}")
    print(f"Sheet: {SHEET_W}×{SHEET_H} ({COLS} cols × {ROWS} rows of {CELL}×{CELL})")
    print()

    successes = 0
    failures = 0

    for row_idx, filename, prompt in VARIANTS:
        # Check for cached processed row
        cached_row = PARTS_DIR / f"row_{row_idx:02d}.png"
        if cached_row.exists():
            print(f"  [row_{row_idx:02d}] Using cached row")
            row_img = Image.open(cached_row)
            sheet.paste(row_img, (0, row_idx * CELL), row_img)
            successes += 1
            continue

        # Check for cached raw variant (resume support)
        cached_raw = PARTS_DIR / filename
        if cached_raw.exists():
            print(f"  [{filename}] Using cached intermediate, processing...")
            img = Image.open(cached_raw)
        else:
            img = generate_variant(prompt, filename)

        if img:
            row_img = split_grid_to_row(img)
            row_img.save(cached_row)  # cache processed row
            sheet.paste(row_img, (0, row_idx * CELL), row_img)
            successes += 1
        else:
            failures += 1

        # Brief pause between API calls to avoid rate limiting
        if not cached_raw.exists():
            time.sleep(1)

    # Save final composite sheet
    sheet.save(OUTPUT_FILE)
    actual_cost = successes * cost_per_call
    print(f"\n=== Done ===")
    print(f"Sheet saved to: {OUTPUT_FILE}")
    print(f"Dimensions: {SHEET_W}×{SHEET_H}")
    print(f"Variants: {successes} OK, {failures} failed")
    print(f"Actual cost: ~${actual_cost:.2f}")

    if failures > 0:
        print(f"\nTo retry failed variants, just run the script again (cached rows are reused).")


if __name__ == "__main__":
    generate_sheet()
