#!/usr/bin/env python3
"""
Generate buildings.png sprite sheet for the social village observer.

Uses Gemini to generate 12 pre-drawn building sprites (one per API call).
Each call produces a single complete building in 3/4 isometric pixel art
style on a chroma-key green background. The result is cropped, downscaled
to 192x160, and placed into the final 384x960 sheet.

Layout (2 cols x 6 rows of 192x160 cells):
  Row 0: central-square (plaza), chill-zone (park)
  Row 1: coffee-hub, knowledge-corner
  Row 2: workshop, sunset-lounge
  Row 3: generic-warm (cottage), generic-cool (stone)
  Row 4: generic-rustic (timber), generic-modern (plaster)
  Row 5: generic-cozy (small shop), generic-grand (tall, ornate)

Usage:
  source /root/openclaw-cloud/.env
  python3 generate-buildings.py

Cost estimate: 12 API calls x ~$0.13 = ~$1.56 total
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
PARTS_DIR = OUTPUT_DIR / "buildings"  # intermediate building images
OUTPUT_FILE = OUTPUT_DIR / "buildings.png"
CELL_W = 192
CELL_H = 160
COLS = 2
ROWS = 6
SHEET_W = COLS * CELL_W   # 384
SHEET_H = ROWS * CELL_H   # 960

client = genai.Client(api_key=API_KEY)

# --- Shared prompt preamble ---
PREAMBLE = (
    "You are a pixel art building artist for an RPG village game. "
    "Generate a SINGLE building or location in 3/4 isometric pixel art style. "
    "The view shows the front face, right side depth face, and roof from a "
    "slightly elevated camera angle (looking south-west).\n\n"
    "Art style: clean retro pixel art like classic SNES RPGs. "
    "2-4 shades per material, NO anti-aliasing, NO gradients. "
    "Light source from top-left (highlights on top/left edges, shadows on bottom/right). "
    "The building should be centered in the image with transparent space around it.\n\n"
    "Use a SOLID BRIGHT GREEN (#00ff00) background so it can be chroma-keyed. "
    "DO NOT use green anywhere on the building or ground details.\n\n"
    "The building should include: front wall, right side wall (darker, showing depth), "
    "roof with overhang, door, windows, and any specified details. "
    "Include a small ground shadow to the bottom-right."
)

# --- 12 building descriptions ---
BUILDINGS = [
    # Row 0: Known locations — plaza and park
    (0, 0, "central_square.png",
     "CENTRAL SQUARE (Plaza): A cobblestone town square with a stone fountain in the center. "
     "3/4 isometric view. The ground is warm gray-beige cobblestone with a decorative stone "
     "border. A circular stone fountain sits in the middle with water (blue) and a central "
     "pillar. Two small wooden benches on opposite sides. Cobblestone has subtle stone pattern. "
     "Show the raised platform with side depth face (darker stone) on the right edge and "
     "top edge (parallelogram faces). No building — this is an open plaza."),

    (1, 0, "chill_zone.png",
     "CHILL ZONE (Park): A fenced green park area in 3/4 isometric view. "
     "Rich green maintained lawn (slightly blue-green, trimmer than wild grass). "
     "Wooden fence posts with horizontal rails around the perimeter. "
     "A small blue pond in the upper-right area with dark edge shadows. "
     "Four trees in the corners — round green canopy with brown trunk, each tree shows "
     "a side shadow face (darker green parallelogram on right side of foliage). "
     "One wooden bench in the middle area. Show the raised ground platform with "
     "side depth face on right and top edges."),

    # Row 1: Known buildings
    (0, 1, "coffee_hub.png",
     "COFFEE HUB: A cozy coffee shop building in 3/4 isometric view. "
     "Warm brown wood plank walls with horizontal plank lines. Clay tile roof (warm red-brown) "
     "with triangular front face and side parallelogram. A brick chimney on the right side wall "
     "with visible front, side, and top faces (red-brown brick with mortar lines). "
     "A glass shop door at center bottom with warm interior glow. Two windows with cross-bar "
     "muntins and warm yellow glow inside. A wooden signboard above the door reading 'COFFEE'. "
     "Small striped awning over the door. Door step at ground level."),

    (1, 1, "knowledge_corner.png",
     "KNOWLEDGE CORNER (Library): A scholarly stone masonry building in 3/4 isometric view. "
     "Cut stone block walls in blue-gray tones with visible mortar lines. Slate roof (dark gray, "
     "flat rectangular tiles in neat rows). Arched door with glass pane and warm interior glow. "
     "Arched windows — through the left window, colorful book spines are visible (red, blue, "
     "green, yellow horizontal bands). Ivy patch climbing on the right wall corner (dark green). "
     "A small globe on a stand beside the building. Wall-mounted lamp near the door. "
     "Flower box under one window."),

    # Row 2: Known buildings
    (0, 2, "workshop.png",
     "WORKSHOP: A rugged timber-frame building in 3/4 isometric view. "
     "Half-timbered walls — dark timber beams over lighter plaster fill. Thatch roof "
     "(rough straw bundles, uneven texture, slightly jagged edges). A wide barn-style sliding "
     "door with X-brace pattern, slightly open showing dark interior. Basic windows. "
     "An iron anvil beside the building (classic anvil shape, dark iron with lighter top). "
     "A wooden workbench nearby. A hammer leaning against the wall. Stone chimney "
     "(rougher than coffee hub's). A few wooden barrels and crates near the entrance."),

    (1, 2, "sunset_lounge.png",
     "SUNSET LOUNGE: An elegant plaster building in 3/4 isometric view. "
     "Smooth plaster walls in warm purple-mauve tones. Clay tile roof in deep purple-brown. "
     "An arched door with ornate frame and glass pane showing warm golden interior glow. "
     "Shuttered windows with decorative wooden shutters on both sides. "
     "Two warm lanterns flanking the door (iron poles with orange-yellow glow). "
     "Flower boxes under windows with green foliage and tiny pink flowers. "
     "A hanging banner on the side wall. Clean, refined aesthetic."),

    # Rows 3-5: Generic variants for dynamic bot-built locations
    (0, 3, "generic_warm.png",
     "GENERIC COTTAGE: A small warm cottage in 3/4 isometric view. "
     "Earth-toned plaster walls in warm beige-tan. Clay tile roof in russet-brown. "
     "Simple wooden paneled door. Basic windows with warm glow and cross-bar muntins. "
     "A small flower pot beside the door. Cozy, humble dwelling. Clean and simple. "
     "No special details — just a pleasant generic cottage."),

    (1, 3, "generic_cool.png",
     "GENERIC STONE HOUSE: A stone masonry house in 3/4 isometric view. "
     "Blue-gray cut stone walls with visible mortar between blocks. Slate roof in charcoal gray "
     "with neat rectangular tiles. Simple arched door in dark wood. Tall windows with "
     "thin frames and bright interior glow. Sturdy, dignified appearance. "
     "No special details — a solid, well-built stone dwelling."),

    (0, 4, "generic_rustic.png",
     "GENERIC TIMBER HOUSE: A rustic timber-frame house in 3/4 isometric view. "
     "Wood plank walls in warm brown with visible horizontal plank lines. Thatch roof "
     "with rough texture. Simple wooden door with iron handle. Basic windows. "
     "Exposed timber beams at corners. Woodsy, frontier feel. "
     "No special details — a straightforward wooden building."),

    (1, 4, "generic_modern.png",
     "GENERIC PLASTER BUILDING: A clean modern-looking plaster building in 3/4 isometric view. "
     "Smooth white-gray plaster walls with minimal texture. Slate roof in dark gray. "
     "Clean rectangular door with glass panel. Large tall windows with thin frames. "
     "Geometric, tidy appearance. Slightly taller than other generic buildings. "
     "No special details — a crisp, contemporary-styled building."),

    (0, 5, "generic_cozy.png",
     "GENERIC SMALL SHOP: A small shop building with an awning in 3/4 isometric view. "
     "Wood plank walls in medium brown. Clay tile roof. A shop-style glass door showing "
     "interior warmth. A striped canvas awning extending over the front (alternating "
     "warm-colored stripes). Small display window beside the door. A hanging wooden sign "
     "from an iron bracket. Welcoming, commercial feel. Compact building."),

    (1, 5, "generic_grand.png",
     "GENERIC GRAND BUILDING: A tall, ornate building in 3/4 isometric view. "
     "Stone masonry lower walls transitioning to smooth plaster on upper level. "
     "Slate roof with a decorative roof dormer (small window protruding from roof with "
     "its own mini roof). Double doors at ground level. Multiple arched windows. "
     "Balcony railing on upper level (thin iron bars). Taller than other buildings — "
     "at least two visible floors. Imposing but welcoming. Weather vane on roof peak."),
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
            if g > 180 and r < 100 and b < 100:
                pixels[x, y] = (0, 0, 0, 0)
    return img


def generate_building(prompt, filename, retries=2):
    """Generate a single building via Gemini API, with retry."""
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


def process_to_cell(img):
    """Downscale a building image to CELL_W x CELL_H using nearest neighbor."""
    return img.resize((CELL_W, CELL_H), Image.NEAREST)


def generate_sheet():
    """Generate all buildings and composite into final sheet."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PARTS_DIR.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (SHEET_W, SHEET_H), (0, 0, 0, 0))

    total_calls = len(BUILDINGS)
    cost_per_call = 0.13
    total_cost = total_calls * cost_per_call
    print(f"=== Building Sprite Sheet Generator ===")
    print(f"Model: {MODEL}")
    print(f"Buildings to generate: {total_calls}")
    print(f"Estimated cost: {total_calls} x ${cost_per_call} = ${total_cost:.2f}")
    print(f"Output: {OUTPUT_FILE}")
    print(f"Sheet: {SHEET_W}x{SHEET_H} ({COLS} cols x {ROWS} rows of {CELL_W}x{CELL_H})")
    print()

    successes = 0
    failures = 0

    for col, row, filename, prompt in BUILDINGS:
        cell_key = f"cell_{row}_{col}"

        # Check for cached processed cell
        cached_cell = PARTS_DIR / f"{cell_key}.png"
        if cached_cell.exists():
            print(f"  [{cell_key}] Using cached cell")
            cell_img = Image.open(cached_cell)
            sheet.paste(cell_img, (col * CELL_W, row * CELL_H), cell_img)
            successes += 1
            continue

        # Check for cached raw image (resume support)
        cached_raw = PARTS_DIR / filename
        if cached_raw.exists():
            print(f"  [{filename}] Using cached intermediate, processing...")
            img = Image.open(cached_raw)
        else:
            img = generate_building(prompt, filename)

        if img:
            cell_img = process_to_cell(img)
            cell_img.save(cached_cell)  # cache processed cell
            sheet.paste(cell_img, (col * CELL_W, row * CELL_H), cell_img)
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
    print(f"Dimensions: {SHEET_W}x{SHEET_H}")
    print(f"Buildings: {successes} OK, {failures} failed")
    print(f"Actual cost: ~${actual_cost:.2f}")

    if failures > 0:
        print(f"\nTo retry failed buildings, just run the script again (cached cells are reused).")


if __name__ == "__main__":
    generate_sheet()
