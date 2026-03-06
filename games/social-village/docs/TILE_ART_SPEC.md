# Village Observer — Tile Art Specification

Art asset spec for upgrading the Social Village observer to sprite-based rendering.
The village world **grows infinitely** — bots build new locations at runtime, the map
expands, new paths form, more bots join. Every art decision must support a world that
could have 6 locations or 60.

## Design Principles

1. **Modular over bespoke** — buildings are assembled from reusable parts, not one-off sprites
2. **Tileable and seamless** — ground tiles work at any world size
3. **Color-tintable** — wall/roof parts drawn in neutral gray, tinted at runtime per-location
4. **Chunk-friendly** — terrain renders in chunks, not one giant canvas
5. **Small file count** — 3 sprite sheets cover everything

## General Rules

- **Tile size**: 16x16 pixels
- **Format**: PNG-32 (RGBA with transparency)
- **Perspective**: 3/4 top-down (camera looks slightly down from the south). Flat surfaces
  tilt slightly toward camera. Vertical surfaces show front face + right side face.
- **Light source**: Top-left. Highlights on top/left edges, shadows on bottom/right
- **Palette**: Earthy, warm — cozy RPG village. Muted greens, warm browns, stone grays
- **Style**: Clean pixel art, 2-4 shades per material, no anti-aliasing to background
- **Characters are 32x32** (2x2 tiles) front-facing sprites

---

## File Structure & Storage

All assets live under `village/games/social-village/assets/` in the repo:

```
village/games/social-village/
  assets/
    ground.png         256x256   Terrain + path tileset
    buildings.png      384x960   Pre-drawn building sprites (2 cols x 6 rows of 192x160)
    decor.png          256x256   Props, trees, nature, furniture
    characters.png     384x384   Character variants (12 pre-drawn characters x 6 poses x 2 frames)
  docs/
    TILE_ART_SPEC.md             This file
  observer.html                  Loads assets from ./assets/ via PIXI.Assets
```

The observer loads optional sprite sheets at startup (fallback to procedural drawing
when any sheet is missing):
```javascript
// Character sheet (optional)
let charSheet = null;
try { charSheet = await PIXI.Assets.load('./assets/characters.png'); } catch {}

// Building sheet (optional)
let buildingSheet = null;
try { buildingSheet = await PIXI.Assets.load('./assets/buildings.png'); } catch {}
```

Pre-drawn sprites when available, procedural vector fallback when not. Every character
is a pre-drawn variant from `characters.png`. Every building from `buildings.png`.

---

## 1. Ground Tileset — `ground.png` (256x256)

16 columns x 16 rows = 256 tile slots.

The world is an infinite green field with dirt paths connecting locations and special
ground surfaces at plazas/parks. Ground tiles must be **seamlessly tileable** in all
directions — any tile should look natural next to any other tile of the same type.

### Grass Tiles (row 0) — 8 tiles

The default terrain. Every pixel of the world not covered by something else is grass.

| Col | Tile | Description |
|-----|------|-------------|
| 0 | **Grass base** | The #1 most-used tile. Medium green (`#3b7d34`). Short uniform grass blades — subtle 2-shade variation, darker pixels (`#2d6b28`) scattered over lighter base. Must tile seamlessly in all 4 directions. No features near edges. |
| 1 | **Grass light** | Sun-touched variant (`#4a8b3f`). 3-4 lighter pixels suggesting a patch of sunlight. Seamless with col 0 on all sides. |
| 2 | **Grass dark** | Shaded variant (`#2d6b28`). Slightly denser/taller blades. For areas under tree shadows or variety. Seamless with col 0. |
| 3 | **Grass flowers** | Base grass + 2-3 tiny 1px flowers (yellow `#ff6`, pink `#f8f`, blue `#6ef`). Flowers stay 3px from all edges so they don't get sliced when tiling. Sparse meadow feel. |
| 4 | **Grass tall** | Taller blade marks — 2px vertical dark-green strokes. Unmowed field at map margins. |
| 5 | **Grass dirt-speck** | Base grass with a few bare-dirt pixels (`#8a7a5a`) peeking through. Transitional tile for path edges. |
| 6 | **Grass mushroom** | Base grass + tiny mushroom (2x2px tan cap, 1px brown stem) placed in lower-right quadrant. Occasional scatter variety. |
| 7 | **Grass clover** | Base grass + 3px clover cluster in slightly different green. Subtle variation. |

### Dirt Path Tiles (rows 1-2) — 18 tiles

Dirt paths connect every location. The world can have dozens of paths. Auto-tile capable.

Color: warm brown `#9a8468` base, darker edges `#6b5a40`, lighter center `#b0a080`.
Texture: tiny 1px pebble dots, subtle crack lines (1px darker).

**16-tile blob auto-tile layout** for seamless grass-to-dirt transitions:

| Slot | Tile | Description |
|------|------|-------------|
| 0,1 | **Path full** | Solid dirt, no grass edges. Warm brown with 3-4 pebble highlight pixels. Subtle horizontal crack lines. The tile for wide path centers. |
| 1,1 | **Path N-edge** | Grass creeping over top 3px. Bottom 13px solid dirt. Grass-to-dirt transition: irregular green pixels fading into brown. |
| 2,1 | **Path S-edge** | Grass on bottom 3px. |
| 3,1 | **Path E-edge** | Grass on right 3 columns. |
| 4,1 | **Path W-edge** | Grass on left 3 columns. |
| 5,1 | **Path NE outer** | Grass fills top-right corner in a curved mask. Dirt in bottom-left. |
| 6,1 | **Path NW outer** | Grass fills top-left corner. |
| 7,1 | **Path SE outer** | Grass fills bottom-right corner. |
| 0,2 | **Path SW outer** | Grass fills bottom-left corner. |
| 1,2 | **Path NE inner** | Small grass triangle (3x3) in top-right. Rest is dirt. For inner path bends. |
| 2,2 | **Path NW inner** | Grass triangle top-left. |
| 3,2 | **Path SE inner** | Grass triangle bottom-right. |
| 4,2 | **Path SW inner** | Grass triangle bottom-left. |
| 5,2 | **Path H-narrow** | Grass top + bottom edges, 10px dirt band in middle. For thinner connecting paths. |
| 6,2 | **Path V-narrow** | Grass left + right, dirt band center. |
| 7,2 | **Path end-S** | Dead end south. Dirt fades to grass in rounded shape at bottom. |
| 0,3 | **Path end-N** | Dead end north. |
| 1,3 | **Path end-E** | Dead end east. |

### Cobblestone Tiles (row 3) — 8 tiles

Used for plaza-type locations. Any future "town square" or "market" location uses these.

Color: warm gray-beige `#bab0a0` base, `#a09888` grout, `#8a8070` dark stones.
Texture: offset brick pattern — 3-4px wide stones with 1px grout lines. Each stone has
a subtle top-left highlight pixel and bottom-right shadow pixel (3/4 depth cue).

| Slot | Tile | Description |
|------|------|-------------|
| 0,3 | **Cobble full** | Full cobblestone. 4 rows of offset stones. Slight color variation per stone (some beige, some gray). |
| 1,3 | **Cobble N-border** | Top 2px: decorative carved stone band (`#7a6a5a`) with thin highlight line below. Rest: cobble. |
| 2,3 | **Cobble S-border** | Border on bottom. |
| 3,3 | **Cobble E-border** | Border on right. |
| 4,3 | **Cobble W-border** | Border on left. |
| 5,3 | **Cobble NE** | Corner borders (north + east). |
| 6,3 | **Cobble NW** | Corner borders (north + west). |
| 7,3 | **Cobble SE** | Corner borders (south + east). |

### Park Green Tiles (row 4) — 4 tiles

Maintained lawn for park-type locations. Richer than wild grass — `#4a9a50` base,
slightly blue-green. Smoother texture (fewer variation pixels). Suggests trimmed, cared-for ground.

| Slot | Tile | Description |
|------|------|-------------|
| 0,4 | **Park full** | Smooth kept-grass. Only 1-2 shade variation pixels. More saturated than wild grass. |
| 1,4 | **Park light** | Lighter patch variant. |
| 2,4 | **Park edge-N** | Transition to wild grass on top 3px. Park green fades to wilder texture. |
| 3,4 | **Park edge-E** | Transition on right edge. |

### Water Tiles (row 5) — 9 tiles

Ponds, pools, any water feature. Deep blue-teal.

Color: `#3a6a8a` edge shadow, `#4a8aaa` main, `#55bbcc` highlights.
Texture: subtle 1-2px horizontal ripple marks (lighter blue streaks). Edge tiles have
a 2px dark shadow line where water meets land (depth).

| Slot | Tile | Description |
|------|------|-------------|
| 0,5 | **Water full** | Open water. Base blue-teal + 2-3 white-blue ripple highlight pixels. Tiles seamlessly. |
| 1,5 | **Water N-edge** | Land on top. Top 3px: dark depth shadow + land-colored pixels. Remaining: water + ripples. |
| 2,5 | **Water S-edge** | Land on bottom. |
| 3,5 | **Water E-edge** | Land on right. |
| 4,5 | **Water W-edge** | Land on left. |
| 5,5 | **Water NE** | Outer corner — land on top + right. |
| 6,5 | **Water NW** | Land on top + left. |
| 7,5 | **Water SE** | Land on bottom + right. |
| 0,6 | **Water SW** | Land on bottom + left. |

### 3/4 Depth Edges (row 6) — 8 tiles

These tiles create the 3/4 view "thickness" on the right and top edges of elevated
ground surfaces (plazas, parks). They show the side face of a raised platform.

| Slot | Tile | Description |
|------|------|-------------|
| 0,6 | **Depth-R cobble** | Right-side parallelogram strip for cobblestone surfaces. 16px tall, shows the side face of the plaza platform. Darker cobble color `#9a9080`. Sheared upward-right — left column aligns with the ground surface right edge, right column is offset 12px up (matching the 3/4 SIDE_SLOPE of 0.6). |
| 1,6 | **Depth-T cobble** | Top-edge parallelogram for cobblestone. Shows the "away" surface. Slightly lighter than side `#a8a090`. |
| 2,6 | **Depth-R green** | Right-side depth for park green surfaces. Darker green `#2a7a30`. |
| 3,6 | **Depth-T green** | Top-edge depth for park green. `#3a9040`. |
| 4,6 | **Depth-R dirt** | Right-side depth for raised dirt surfaces. |
| 5,6 | **Depth-T dirt** | Top-edge depth for dirt. |
| 6,6 | **Depth-R stone** | Right-side depth for generic stone. For future location types. |
| 7,6 | **Depth-T stone** | Top-edge depth for stone. |

---

## 2. Building Sprite Sheet — `buildings.png` (384x960)

**Pre-drawn complete building sprites.** Each cell is a fully-rendered building or
location in 3/4 isometric pixel art style (front face + right side depth + roof).
Transparent background. The observer extracts cells by location ID and scales to fit.

When `buildings.png` is not present, the observer falls back to procedural vector
drawing (PIXI.Graphics) — the same colored rectangles, parallelograms, and
location-specific details that existed before sprites.

### Sheet Layout

2 columns x 6 rows of 192x160 cells = 384x960 total.

| Row | Col 0 | Col 1 |
|-----|-------|-------|
| 0 | central-square (plaza) | chill-zone (park) |
| 1 | coffee-hub | knowledge-corner |
| 2 | workshop | sunset-lounge |
| 3 | generic-warm (cottage, earth tones) | generic-cool (stone, blue-gray) |
| 4 | generic-rustic (timber, brown) | generic-modern (plaster, clean) |
| 5 | generic-cozy (small shop, awning) | generic-grand (tall, ornate) |

- **Rows 0-2**: Known locations — each has its specific look (chimney on coffee-hub,
  books in knowledge-corner, anvil at workshop, etc.)
- **Rows 3-5**: Generic variants for dynamic bot-built locations — each has a distinct
  architectural style

Cell size 192x160 gives enough room for the 3/4 view building with depth faces and
roof overhang.

### Known Location Details

| Location | Key Visual Elements |
|----------|-------------------|
| central-square | Cobblestone ground plane, stone fountain, two benches, raised platform with depth faces |
| chill-zone | Green lawn, wooden fence, pond, four corner trees, bench |
| coffee-hub | Brown plank walls, clay roof, brick chimney, shop door, signboard, awning |
| knowledge-corner | Stone masonry walls, slate roof, arched door/windows, visible bookshelves, ivy, globe |
| workshop | Timber-frame walls, thatch roof, barn door, anvil, workbench, hammer, barrels |
| sunset-lounge | Plaster walls (purple-mauve), clay roof, arched door, lanterns, shuttered windows, flower boxes |

### Generic Variants

Dynamic locations built by bots at runtime get a deterministic generic building:

```javascript
const idx = Math.abs(hashStr(locationSlug)) % 6;
const col = idx % 2;
const row = 3 + Math.floor(idx / 2);
```

| Variant | Style | Description |
|---------|-------|-------------|
| generic-warm | Cottage | Earth-toned plaster, clay roof, simple wooden door |
| generic-cool | Stone | Blue-gray masonry, slate roof, arched door |
| generic-rustic | Timber | Wood plank walls, thatch roof, exposed beams |
| generic-modern | Plaster | Clean white-gray walls, slate roof, large windows |
| generic-cozy | Shop | Wood walls, awning, glass door, hanging sign |
| generic-grand | Ornate | Two-story stone+plaster, dormer, balcony, double doors |

### Generation

Generated by `generate-buildings.py` using Gemini image generation:
- 12 API calls (one per cell)
- Chroma-key green background to transparency
- Downscale to 192x160 (NEAREST)
- Composite into 384x960 sheet
- Cached intermediates for resume support

---

## 3. Decoration Tileset — `decor.png` (256x256)

16 columns x 16 rows = 256 tile slots.

Props, trees, nature, and furniture placed on the ground around buildings. All have
transparent backgrounds. All are in **actual color** (not tinted). Objects cast a small
ground shadow (2-3 semi-transparent dark pixels to the bottom-right).

### Trees (rows 0-2) — 4 types, each 2x2 tiles (32x32)

Trees are the main world filler. They're scattered procedurally across the map between
locations. Must look good at any density. 3/4 view: trunk visible at bottom, round
foliage canopy on top. Right side of foliage has side-shadow (darker parallelogram
suggesting depth).

| Slots | Tree | Description |
|-------|------|-------------|
| (0,0)-(1,1) | **Oak** | Classic round canopy. Rich green (`#2a7a2a`). Layered scalloped foliage — 2-3 overlapping rounded clumps. Lighter highlight pixels (`#4aaa4a`) top-left of each clump. Darker shadow (`#1a6a1a`) on right side as parallelogram face. Brown trunk (`#5a3a1a`, 4px wide) at bottom-center. Darker trunk side face (`#4a2a10`, 2px parallelogram) on right. Small dark oval ground shadow (semi-transparent). |
| (2,0)-(3,1) | **Pine** | Conical — 3 layered triangle tiers getting wider toward bottom. Dark green (`#1a5a2a`). Each tier: lighter left edge (`#3a8a4a`, highlight), darker right edge (shadow). Brown trunk below lowest tier. Narrower, more vertical than oak. |
| (4,0)-(5,1) | **Birch** | White-gray bark (`#d0c8b8`) with dark horizontal marks (birch lines). Lighter, airier canopy — yellow-green (`#7aaa4a`) with transparent gaps. Delicate, wispy feel. |
| (6,0)-(7,1) | **Fruit tree** | Like oak but with tiny colored dots in foliage (red `#cc4444` or orange `#ddaa44` fruit, 1px each, 4-5 scattered). Slightly rounder shape. For orchards, gardens. |

### Bushes & Small Plants (row 2, cols 8-15)

Single-tile (16x16) plants. For ground scatter and garden areas.

| Slot | Plant | Description |
|------|-------|-------------|
| 8,2 | **Bush** | Round green bush, 10x8px. Medium green. No trunk visible. Darker bottom, lighter top. Slight right-side shadow. |
| 9,2 | **Flower bush** | Bush + 3-4 colored flower pixels on top (pink, yellow). |
| 10,2 | **Tall grass** | Cluster of tall grass blades. 6x12px. Dark green, taller than regular grass tiles. Slight lean to the right (wind). |
| 11,2 | **Reed cluster** | For pond edges. 4 vertical brown-green stalks with fluffy tops. 6x14px. |
| 12,2 | **Stump** | Cut tree stump. 8x6px. Brown ring pattern visible on top (tree rings — concentric circles, 3/4 view). Bark texture on sides. |
| 13,2 | **Log** | Fallen log. 14x5px. Horizontal brown cylinder. Bark texture. Lighter cut-end visible on right (cross-section circle). |

### Rocks (row 3, cols 0-3)

| Slot | Rock | Description |
|------|------|-------------|
| 0,3 | **Small rock** | 8x6px. Two stones — one larger oval, one smaller. Gray (`#7a7a6a`). Top highlight, right shadow. 2px ground shadow. |
| 1,3 | **Medium rock** | 10x7px. Single angular boulder. Flat top visible (3/4 view). Moss pixel (dark green) on top-left. |
| 2,3 | **Rock cluster** | 12x8px. 3-4 pebbles grouped. Varying grays. For path edges. |
| 3,3 | **Large boulder** | 14x10px. Dominant landscape rock. Crack line across face. Moss on top. |

### Fence Pieces (row 3, cols 4-9)

Wooden fence for park perimeters, any enclosed area. Warm brown `#8a6030`.
3/4 view: posts have visible top face.

| Slot | Piece | Description |
|------|-------|-------------|
| 4,3 | **Post** | Single vertical post. 3px wide, 10px tall. Top: 2x1 lighter brown (visible top surface). Front face medium brown. Right edge 1px darker (side). |
| 5,3 | **Rail horizontal** | 16px wide, rails at y=4 and y=8. Posts at edges. Seamless tiling. |
| 6,3 | **Corner NE** | Post + rails ending from west. |
| 7,3 | **Corner NW** | Post + rails ending from east. |
| 8,3 | **Rail vertical** | Vertical rail + posts for left/right edges. |
| 9,3 | **Gate** | Gap in fence — two posts, no rail between. 8px opening. |

### Furniture & Props (rows 4-5)

Items placed in and around buildings. Actual colors.

| Slot | Prop | Description |
|------|------|-------------|
| 0,4 | **Bench L** | Left half of park bench. Wooden seat (warm brown `#7a5030`). Visible top surface (`#8a6040`, lighter). Two legs on left. Backrest behind. |
| 1,4 | **Bench R** | Right half. Two legs on right. Forms 32x16 bench together with L. |
| 2,4 | **Lantern** | Standing lantern. Black iron pole (`#2a2a2a`), 12px tall. Warm yellow-orange glow housing at top (`#ffcc66` center, `#ffaa44` edges). Semi-transparent yellow glow pixels around. |
| 3,4 | **Signboard** | Wooden post + hanging sign. Sign is 6x4 brown rectangle. Code stamps a per-location icon. |
| 4,4 | **Anvil** | Blacksmith anvil. 8x6px. Dark iron (`#556666`). Classic anvil shape. Top lighter (`#778888`), right side darker (`#445555`). Ground shadow. |
| 5,4 | **Workbench** | 10x6px wooden table. Top surface lighter, front face medium, right side darker. Tool pixels on top. |
| 6,4 | **Barrel** | 6x8px. Oval top (lighter wood). Dark iron band stripes. Right side face darker. |
| 7,4 | **Crate** | 7x7px. Top/front/side faces. X-plank pattern on front. |
| 0,5 | **Flower pot** | 4x6px. Terra cotta pot with green sprout + tiny flower pixel. |
| 1,5 | **Well** | 2x2 tile prop (32x32). Stone circular well with roof frame. Bucket hanging from crossbeam. Dark water visible inside. |
| 3,5 | **Cart** | 2x1 tile prop (32x16). Wooden handcart with wheel. For markets, workshop areas. |
| 5,5 | **Fountain** | 2x2 tile prop (32x32). Stone basin, octagonal. Water inside with central pillar and spray. 3/4 view — front basin face + right side face (darker). |
| 7,5 | **Market stall** | 2x2 tile prop (32x32). Wooden frame + canvas canopy (striped). Counter with goods (colored pixel dots). For future market/bazaar locations. |

### Nature Details (row 6)

Small scatter elements for making the world feel alive.

| Slot | Element | Description |
|------|---------|-------------|
| 0,6 | **Lily pad** | 3x2px green oval for pond surfaces. |
| 1,6 | **Stepping stone** | 4px gray circle. For garden paths. |
| 2,6 | **Puddle** | 6x3px dark blue-gray oval. After-rain detail. |
| 3,6 | **Leaf pile** | 6x4px. Autumn leaves — orange, brown, yellow pixel mix. |
| 4,6 | **Campfire** | 6x8px. Log ring with orange-yellow flame center. Warm glow pixels. For future campsite locations. |
| 5,6 | **Grave marker** | 4x8px. Gray stone cross/headstone. For future cemetery/spooky locations. |
| 6,6 | **Mailbox** | 3x8px. Post with box on top. Red or blue. For residential areas. |
| 7,6 | **Streetlamp** | 2x14px. Tall iron pole with light at top. Warm glow. For paths at night. |

---

## 4. How Buildings Are Rendered at Runtime

The observer uses a **sprite-first, vector-fallback** pattern for buildings:

### When `buildings.png` is available

```javascript
function drawLocationGraphics(id, L) {
  if (buildingSheet) {
    // Look up cell coordinates from BUILDING_MAP (known locations)
    // or hash the slug into the generic pool (rows 3-5)
    const tex = getBuildingTexture(id);
    const sprite = new PIXI.Sprite(tex);
    // Scale to fit location dimensions
    sprite.width = L.w + DEPTH + ROOF_OVERHANG;
    sprite.height = L.h + DEPTH;
    sprite.position.set(-ROOF_OVERHANG, -DEPTH);
    container.addChild(sprite);
  } else {
    // Vector fallback (existing PIXI.Graphics code)
  }
}
```

Textures are cached by location ID — each cell is extracted once from the sheet
and reused for the lifetime of the session.

### When `buildings.png` is NOT available

The observer falls back to the existing procedural vector drawing:
- Colored rectangles (front wall), parallelograms (side wall, roof side)
- Triangular roof front face
- Location-specific details: chimney, bookshelf, anvil, lanterns, etc.
- Uses `L.c` (wall color), `L.r` (roof color), `L.w`/`L.h` (dimensions)

### Dynamic Location Assignment

Dynamic locations built by bots at runtime get a deterministic generic building
from the pool of 6 generic variants (rows 3-5):

```javascript
const GENERIC_BUILDINGS = 6; // 2 cols x 3 rows
const idx = Math.abs(hashStr(slug)) % GENERIC_BUILDINGS;
const col = idx % 2;
const row = 3 + Math.floor(idx / 2);
```

Same slug always produces the same building — consistent across sessions.

---

## 5. Chunk-Based Terrain Rendering

The world grows as new locations are built. Terrain must render efficiently at any size.

### Chunk System

- **Chunk size**: 512x512 px (32x32 tiles)
- Chunks render on demand when they enter the camera viewport
- Each chunk is a canvas/texture cached until the world layout changes
- A chunk contains: grass base + any path segments passing through + any ground features

### Chunk Rendering Procedure

```
For each visible chunk (cx, cy):
  1. If cached and not dirty, use cached texture
  2. Else: create 512x512 canvas
  3. Fill with grass tiles (stamp base + random variants using seeded RNG from chunk coords)
  4. For each path passing through this chunk: stamp path auto-tiles along the curve
  5. For each location overlapping this chunk: stamp ground surface tiles (cobble/green)
  6. Cache as PIXI.Texture
  7. Mark clean
```

Dirty flags set when: new location added, world bounds change, path added.

### Why Not One Giant Canvas

At 50 locations, the world might be 6000x4000+ pixels. A single canvas that size
uses ~96MB of GPU memory and takes seconds to re-render. Chunks use only ~3-6MB
for the visible area and update incrementally.

---

## 6. Character Variant Sheet — `characters.png` (384x384)

**Pre-drawn full character variants.** Each bot is assigned a variant index (0–11)
based on personality type and name hash. Each variant is a complete, fully-drawn
character — no layered assembly required.

The observer loads the sheet and extracts animation frames by row (variant) and
column (pose × frame). If `characters.png` is not found, the observer falls back
to procedural canvas-drawn sprites.

### File location

```
village/games/social-village/
  assets/
    characters.png    384x384   Character variant sprite sheet
```

### Sheet Dimensions

- **Cell size**: 32x32 pixels
- **Columns**: 12 (6 poses × 2 frames = 384px wide)
- **Rows**: 12 (12 character variants = 384px tall)

### Column Layout

| Cols | Pose | Frames |
|------|------|--------|
| 0-1 | idle | f0, f1 |
| 2-3 | walk | f0, f1 |
| 4-5 | talk | f0, f1 |
| 6-7 | think | f0, f1 |
| 8-9 | sit | f0, f1 |
| 10-11 | wave | f0, f1 |

Frame 1 is a 1px-up bounce of frame 0 for simple animation.

### Row Layout — Character Variants

| Rows | Personality | Description |
|------|-------------|-------------|
| 0 | Efficient | Navy blazer, dark slacks, short dark hair, serious expression. Cool tones. |
| 1 | Efficient | Gray sweater vest, glasses, brown hair neatly parted. Intellectual. |
| 2 | Efficient | Dark teal polo, khaki pants, short black hair. Practical. |
| 3 | Efficient | White button-down, charcoal trousers, silver hair tied back. Elegant. |
| 4 | Witty | Bright red jacket, wild spiky auburn hair, mischievous grin. Bold. |
| 5 | Witty | Purple tie-dye shirt, orange shorts, messy pink-streaked hair. Quirky. |
| 6 | Witty | Green hoodie, dark curly hair with blue streak, confident smirk. Urban. |
| 7 | Witty | Magenta vest, striped pants, dramatic wavy hair, bowtie. Theatrical. |
| 8 | Caring | Soft green cardigan, long brown hair with flower, warm smile. Gentle. |
| 9 | Caring | Peach apron, curly auburn hair, kind round face. Warm cook. |
| 10 | Caring | Earth-toned overalls, dark ponytail, work gloves. Grounded gardener. |
| 11 | Caring | Lavender robe, orange sash, long white hair, peaceful. Wise sage. |

### Personality-to-Variant Mapping

```javascript
const PERSONALITY_RANGES = {
  efficient: [0, 3],   // rows 0–3
  witty:     [4, 7],   // rows 4–7
  caring:    [8, 11],  // rows 8–11
};
```

Each bot's variant is deterministic: `personality range + seeded RNG from name hash`.

### Appearance Config (sent from server per bot)

```javascript
{ variant: 7 }  // index 0–11, maps directly to a sheet row
```

### Rendering

No compositing needed. For a given variant and pose:

```javascript
const col = poseIndex * 2 + frame;  // 0–11
const row = variant;                 // 0–11
// Extract 32×32 cell at (col * 32, row * 32) from characters.png
```

### Fallback

When `characters.png` is not available, the observer uses `drawSocialChar()` —
a procedural canvas-drawing function that renders simple colored characters.
The variant index maps to a color via `BCOLORS[variant % BCOLORS.length]`.

### Adding New Variants

1. Add rows to the bottom of the sheet (row 12+)
2. Update `VARIANT_COUNT` in `appearance.js`
3. Update `PERSONALITY_RANGES` if adding to a personality group
4. Regenerate with `generate-characters.py`

### Adding New Poses

1. Add 2 columns to the right of the sheet (new-pose-f0, new-pose-f1)
2. Draw all 12 variants for the new pose in those columns
3. Add the pose name to `ANIM_POSES` in `observer.html`

---

## 7. Future-Proofing Checklist

When drawing tiles, keep these expansion scenarios in mind:

- [ ] **New building variants**: add rows to buildings.png (row 6+), update `GENERIC_BUILDINGS` count
- [ ] **New known locations**: add to `BUILDING_MAP` in observer.html, add cell to buildings.png
- [ ] **New ground types**: sand, snow, brick road — add rows 7+ in ground.png
- [ ] **New tree types**: cherry blossom, palm, dead tree — add at rows 3+ in decor.png
- [ ] **Seasonal variants**: autumn trees (orange foliage), snow-covered buildings — add as extra rows/sheets
- [ ] **Interior tiles**: if buildings become enterable, add floor/furniture tiles as new sheet
- [ ] **Night variants**: window glow brighter at night, lamp tiles lit — code-side tinting or overlay
- [ ] **Biome support**: desert village, snow village — new ground.png variants, alternate buildings.png
- [ ] **New character poses**: add 2 columns per pose to characters.png, add name to `ANIM_POSES`
- [ ] **New character variants**: add rows to characters.png, update `VARIANT_COUNT` and `PERSONALITY_RANGES` in appearance.js
- [ ] **Character emotes**: overlay particle effects per expression — code-side only, no art needed
