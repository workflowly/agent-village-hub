# Artist Brief — Social Village Sprite Art

## Overview

You're creating pixel art for a 2D village simulation game rendered with PixiJS. The game has a top-down 3/4 isometric camera angle (looking slightly down from the south). There are **3 categories** of artwork needed: **characters**, **buildings/locations**, and **terrain/decorations**.

---

## Global Art Rules

- **Style**: Clean retro pixel art, similar to classic SNES RPGs (think Secret of Mana, Stardew Valley)
- **Shading**: 2-4 shades per material. No anti-aliasing, no gradients, no dithering to background
- **Light source**: Top-left. Highlights on top/left edges, shadows on bottom/right
- **Palette**: Earthy, warm — cozy RPG village. Muted greens, warm browns, stone grays
- **Format**: PNG-32 (RGBA with full transparency)
- **Perspective**: 3/4 top-down isometric. Camera looks slightly down from the south. You see the **front face** and **right side face** of every object. Flat surfaces tilt slightly toward camera. Every 3D object shows a front face + a right-side depth face (parallelogram, darker by ~15%)
- **Depth convention**: The right side face is a parallelogram that goes up-and-right at a 0.6 slope (for every 10px to the right, the face goes 6px up). This applies to buildings, trees, furniture, rocks — everything

---

## File 1: Character Sprite Sheet — `characters.png`

### Dimensions

**384 x 384 pixels** total

### Grid

- **Cell size**: 32 x 32 pixels
- **12 columns** x **12 rows**
- Columns = 6 poses x 2 animation frames each
- Rows = 12 unique character variants

### Column Layout (left to right)

| Columns | Pose | Description |
|---------|------|-------------|
| 0-1 | idle | Standing still. Frame 0 = normal, Frame 1 = shifted 1px up (subtle breathing bounce) |
| 2-3 | walk | Legs spread, arms swinging. Frame 0 and 1 alternate stride |
| 4-5 | talk | One arm raised, gesturing as if speaking |
| 6-7 | think | Hand on chin, contemplative |
| 8-9 | sit | Seated with legs forward (on a bench) |
| 10-11 | wave | Arm raised high, waving |

Frame 1 is always a 1px-up bounce of frame 0 for simple animation.

### Row Layout — 12 Character Variants

Each row is a **complete, unique character**. Front-facing, showing full body (head, torso, arms, legs, feet), centered in the 32x32 cell. Small elliptical ground shadow at the feet.

| Row | Personality | Description |
|-----|-------------|-------------|
| 0 | Efficient | Navy blazer, dark slacks, short dark hair, serious expression. Cool tones. Light skin. |
| 1 | Efficient | Gray sweater vest, glasses, brown hair neatly parted. Intellectual. Medium skin. |
| 2 | Efficient | Dark teal polo, khaki pants, short black hair. Practical. Dark skin. |
| 3 | Efficient | White button-down, charcoal trousers, silver hair tied back. Elegant. Medium-light skin. |
| 4 | Witty | Bright red jacket, wild spiky auburn hair, mischievous grin. Light skin. |
| 5 | Witty | Purple tie-dye shirt, orange shorts, messy pink-streaked hair. Medium skin. |
| 6 | Witty | Green hoodie, dark curly hair with blue streak, confident smirk. Dark skin. |
| 7 | Witty | Magenta vest, striped pants, dramatic wavy hair, bowtie. Medium-light skin. |
| 8 | Caring | Soft green cardigan, long brown hair with flower, warm smile. Light skin. |
| 9 | Caring | Peach apron, curly auburn hair, kind round face. Medium skin. |
| 10 | Caring | Earth-toned overalls, dark ponytail, work gloves. Dark skin. |
| 11 | Caring | Lavender robe, orange sash, long white hair, peaceful. Medium-light skin. |

### Key Requirements

- Each character must be visually **distinct at 32x32** — recognizable silhouette, unique color scheme
- **No green (#00ff00)** on any character (used for chroma key in generation pipeline)
- Transparent background
- Characters face **forward** (toward the camera/south)
- All 6 poses must be clearly the **same character** — consistent outfit, hair, skin tone across all poses

---

## File 2: Building Sprite Sheet — `buildings.png`

### Dimensions

**384 x 960 pixels** total

### Grid

- **Cell size**: 192 x 160 pixels
- **2 columns** x **6 rows**
- Each cell is one **complete building or location**

### Perspective Details

Every building is drawn in the same 3/4 isometric view:
- **Front wall**: flat rectangle facing the camera
- **Right side wall**: parallelogram going up-right at 0.6 slope, ~15% darker than front
- **Roof**: triangular front face + parallelogram side face, slight overhang (~8px) past the walls
- **Ground shadow**: subtle dark shadow to the bottom-right

The building should be **centered** in the 192x160 cell with transparent space around it. The building itself (walls + roof + depth) should fill roughly 140-170px wide and 120-150px tall, leaving breathing room.

### Sheet Layout

| Row | Col 0 | Col 1 |
|-----|-------|-------|
| 0 | Central Square (plaza) | Chill Zone (park) |
| 1 | Coffee Hub | Knowledge Corner |
| 2 | Workshop | Sunset Lounge |
| 3 | Generic Warm (cottage) | Generic Cool (stone house) |
| 4 | Generic Rustic (timber house) | Generic Modern (plaster building) |
| 5 | Generic Cozy (small shop) | Generic Grand (tall, ornate) |

### Detailed Building Descriptions

**Row 0, Col 0 — Central Square (Plaza)**
Open cobblestone town square (NOT a building). Warm gray-beige cobblestone ground with decorative stone border. Raised platform showing the right-side depth face (darker stone parallelogram) and top depth face. A circular stone fountain in the center with blue water and a central pillar. Two small wooden park benches on opposite sides. Each bench shows front face + right-side depth face.

**Row 0, Col 1 — Chill Zone (Park)**
Fenced green park area. Rich maintained lawn (slightly blue-green, trimmer than wild grass). Wooden fence posts with horizontal rails around perimeter. A small blue pond in upper-right with dark edge shadows. Four trees in corners — each tree has a round green canopy (front face) with a darker green parallelogram side-shadow on the right, and a brown trunk with darker trunk side face. One wooden bench in the middle.

**Row 1, Col 0 — Coffee Hub**
Cozy coffee shop. Brown horizontal wood plank walls with visible plank lines. Warm red-brown clay tile roof (semi-circular overlapping scalloped rows). Brick chimney on right side wall — showing front, side, and top faces (red-brown with mortar lines). Glass shop door at center bottom with warm yellow interior glow. Two windows with cross-bar muntins and yellow glow. Wooden signboard above door. Small striped awning over door. Door step.

**Row 1, Col 1 — Knowledge Corner (Library)**
Scholarly stone building. Blue-gray cut stone block walls with visible mortar lines. Dark gray slate roof (flat rectangular tiles in neat rows). Arched door with glass pane and warm glow. Arched windows — through the left window, colorful horizontal book spines visible (red, blue, green, yellow). Dark green ivy climbing the right wall corner. Small globe on a stand beside building. Wall lamp near door. Flower box under one window.

**Row 2, Col 0 — Workshop**
Rugged timber-frame building. Half-timbered walls — dark timber beams over lighter plaster fill, with diagonal cross-braces. Rough thatch roof (straw bundles, jagged edges). Wide barn-style sliding door with X-brace pattern, slightly open showing dark interior. Iron anvil beside building (classic shape, dark iron). Wooden workbench. Hammer leaning on wall. Rougher stone chimney. Barrels and crates near entrance.

**Row 2, Col 1 — Sunset Lounge**
Elegant plaster building. Smooth walls in warm purple-mauve tones. Deep purple-brown clay tile roof. Arched door with ornate frame and golden interior glow. Shuttered windows with decorative wooden shutters on both sides. Two warm lanterns flanking the door (iron poles with orange-yellow glow). Flower boxes under windows with green foliage and tiny pink flowers. Hanging banner on side wall.

**Row 3, Col 0 — Generic Warm (Cottage)**
Small humble cottage. Warm beige-tan plaster walls. Russet-brown clay tile roof. Simple wooden paneled door. Basic windows with warm glow and cross-bar muntins. Small flower pot beside door. Cozy and simple — no special details.

**Row 3, Col 1 — Generic Cool (Stone House)**
Sturdy stone house. Blue-gray cut stone walls with visible mortar. Charcoal gray slate roof with neat tiles. Simple arched door in dark wood. Tall windows with thin frames. Dignified, well-built — no special details.

**Row 4, Col 0 — Generic Rustic (Timber House)**
Frontier-style wooden house. Warm brown wood plank walls with horizontal plank lines. Rough thatch roof. Simple wooden door with iron handle. Basic windows. Exposed timber beams at corners. Woodsy feel — no special details.

**Row 4, Col 1 — Generic Modern (Plaster Building)**
Clean contemporary building. Smooth white-gray plaster walls with minimal texture. Dark gray slate roof. Rectangular door with glass panel. Large tall windows with thin frames. Slightly taller than other generics. Geometric and tidy — no special details.

**Row 5, Col 0 — Generic Cozy (Small Shop)**
Compact commercial building. Medium brown wood plank walls. Clay tile roof. Glass shop door with interior warmth. Striped canvas awning over front (alternating warm-colored stripes). Small display window. Hanging wooden sign from iron bracket.

**Row 5, Col 1 — Generic Grand (Ornate)**
Tall, imposing building (at least two visible floors). Stone masonry lower walls, plaster upper level. Slate roof with a roof dormer (small window protruding with mini roof). Double doors at ground. Multiple arched windows. Iron balcony railing on upper level. Weather vane on roof peak.

---

## File 3: Terrain Tileset — `ground.png` (future)

### Dimensions

**256 x 256 pixels** total

### Grid

- **Tile size**: 16 x 16 pixels
- **16 columns** x **16 rows**
- Each tile must be **seamlessly tileable** with adjacent tiles of the same type

### What's Needed

**Grass tiles** (row 0, 8 tiles): Base grass, light variant, dark variant, flowers, tall, dirt-speck, mushroom, clover. Base color `#3b7d34`. Must tile seamlessly in all 4 directions.

**Dirt path tiles** (rows 1-2, 18 tiles): Full dirt, N/S/E/W edges, outer corners, inner corners, narrow paths, dead ends. Warm brown `#9a8468`. For auto-tiling paths connecting locations.

**Cobblestone tiles** (row 3, 8 tiles): Full cobble, N/S/E/W borders, corners. For plaza ground. Gray-beige `#bab0a0` with offset brick stone pattern.

**Park green tiles** (row 4, 4 tiles): Maintained lawn, light variant, edge transitions. Richer than wild grass `#4a9a50`.

**Water tiles** (row 5, 9 tiles): Full water, N/S/E/W edges, corners. Blue-teal `#4a8aaa` with subtle ripple highlights.

---

## File 4: Decoration Tileset — `decor.png` (future)

### Dimensions

**256 x 256 pixels** total

### Grid

- **Tile size**: 16 x 16 pixels (single-tile items) or 32 x 32 (2x2 multi-tile items)

### What's Needed

**Trees** (rows 0-2): Oak, Pine, Birch, Fruit tree. Each is 32x32 (2x2 tiles). Round canopy with front face + right-side darker parallelogram shadow. Brown trunk with side face.

**Bushes & plants** (row 2, cols 8-15): Small bush, flower bush, tall grass, reed cluster, stump, log. 16x16 each.

**Rocks** (row 3, cols 0-3): Small rock, medium rock, rock cluster, large boulder. Various sizes.

**Fence pieces** (row 3, cols 4-9): Post, horizontal rail, corners, vertical rail, gate. Brown wood `#8a6030`. For park boundaries.

**Furniture** (rows 4-5): Bench (L+R halves), lantern, signboard, anvil, workbench, barrel, crate, flower pot, well (32x32), cart, fountain (32x32), market stall (32x32).

**Nature scatter** (row 6): Lily pad, stepping stone, puddle, leaf pile, campfire, grave marker, mailbox, streetlamp.

All decorations have transparent backgrounds and include a small ground shadow to the bottom-right.

---

## Delivery Format

| File | Dimensions | Cell Size | Format |
|------|-----------|-----------|--------|
| `characters.png` | 384 x 384 | 32 x 32 | PNG-32, transparent bg |
| `buildings.png` | 384 x 960 | 192 x 160 | PNG-32, transparent bg |
| `ground.png` | 256 x 256 | 16 x 16 | PNG-32, transparent bg |
| `decor.png` | 256 x 256 | 16 x 16 | PNG-32, transparent bg |

**Priority order**: buildings.png and characters.png first (these replace procedural drawing immediately). Ground and decor tiles are future upgrades.

**Reference**: The current game uses simple colored vector shapes — rectangles for walls, parallelograms for depth faces, triangles for roofs. The sprites should match this same 3/4 perspective but look like proper pixel art instead of flat geometry.
