# EbayLister — Full Implementation Plan

> A self-hosted, Docker-based eBay listing tool. Photograph items at your photobooth from your phone, let the AI identify and research them, review and approve on your desktop, export a bulk CSV for Seller Hub. Designed to start with Funko Pops and expand to any category via configurable profiles.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure](#2-project-structure)
3. [Docker & Infrastructure](#3-docker--infrastructure)
4. [Database Schema](#4-database-schema)
5. [Profile & Configuration System](#5-profile--configuration-system)
6. [Backend — FastAPI](#6-backend--fastapi)
7. [Frontend — React](#7-frontend--react)
8. [eBay CSV Export](#8-ebay-csv-export)
9. [Shipping Defaults](#9-shipping-defaults)
10. [Unraid Setup](#10-unraid-setup)
11. [Implementation Order](#11-implementation-order)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Compose Stack                     │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │  React SPA   │    │   FastAPI    │    │    Ollama     │  │
│  │  Port 3000   │◄──►│  Port 8000   │◄──►│   Port 11434  │  │
│  │  (nginx)     │    │              │    │  qwen2.5vl:7b │  │
│  │              │    │  REST API    │    └───────────────┘  │
│  │  /capture    │    │  WebSockets  │                        │
│  │  /dashboard  │    │  Bg workers  │    ┌───────────────┐  │
│  │  /review/:id │    │              │◄──►│    SQLite     │  │
│  │  /settings   │    │              │    │   /data/db    │  │
│  └──────────────┘    └──────────────┘    └───────────────┘  │
│                             │                                │
│                             ▼                                │
│                  ┌─────────────────────┐                     │
│                  │     NAS Mount       │                     │
│                  │  /data/photos       │                     │
│                  │  /data/db           │                     │
│                  └─────────────────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

### Two views, one React app

| View | URL | Optimised for |
|---|---|---|
| Capture | `/capture` | Phone browser — photo upload |
| Dashboard | `/dashboard` | Desktop — queue + review |
| Review | `/review/:listingId` | Desktop — full listing editor |
| Settings | `/settings` | Desktop — profile & prompt config |

On first load, `/` redirects to `/capture` if `window.innerWidth < 768`, otherwise `/dashboard`.

### Data flow

```
📱 Phone                    🖥 Server                        🖥 Desktop
─────────────────────────────────────────────────────────────────────
Take photos → submit
  │
  ├─ POST /api/batches ───► Save photos to NAS
  │  (multipart)             Create Batch + Listing rows
  │                          Queue background pipeline
  │◄─ {batch_id, queued} ──┤
  │                          │
"Queued!" screen             ├─ Stage 1: Preprocess images
                             ├───── WS: batch_update {processing}
                             ├─ Stage 2: Ollama vision (2-pass)  ◄── GPU
                             ├───── WS: batch_update {identifying}
                             ├─ Stage 3: Cross-reference stub
                             ├─ Stage 4: eBay price research
                             ├───── WS: batch_update {pricing}
                             ├─ Stage 5: Generate title + copy
                             ├─ Stage 6: Persist to SQLite
                             └───── WS: batch_update {done, listing}
                                                                  │
                                              Dashboard updates live ◄┘
                                              Badge flips → REVIEW
                                              User clicks → review form
                                              Edits fields if needed
                                              "Approve & Save"
                                              Badge flips → APPROVED
                                                   │
                                       GET /api/export/csv
                                       Download eBay bulk CSV
                                       Upload to Seller Hub Reports
```

---

## 2. Project Structure

```
ebaylister/
├── docker-compose.yml
├── .env.example
├── README.md
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                    # FastAPI app, lifespan, CORS, WS endpoint
│   ├── core/
│   │   ├── config.py              # Pydantic settings from env
│   │   └── ws.py                  # WebSocket connection manager
│   ├── models/
│   │   └── database.py            # SQLAlchemy models + init_db
│   ├── api/
│   │   ├── routes.py              # Batch, listing, photo, export routes
│   │   └── profiles.py            # Profile CRUD + settings routes
│   ├── workers/
│   │   └── pipeline.py            # Profile-driven AI pipeline
│   └── seed/
│       └── profiles.json          # Built-in profile definitions
│
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx               # Router + entrypoint
        ├── styles.css             # Design system + global CSS variables
        ├── lib/
        │   └── api.js             # All fetch calls + WebSocket factory
        ├── hooks/
        │   ├── useWebSocket.js    # WS connection hook
        │   └── useBatches.js      # Batch list state + live updates
        ├── components/
        │   ├── StatusBadge.jsx
        │   ├── PhotoStrip.jsx
        │   ├── FieldInput.jsx
        │   ├── ShippingSection.jsx
        │   ├── ProfilePill.jsx
        │   ├── ProfileEditor.jsx
        │   ├── PromptEditor.jsx
        │   ├── FieldsEditor.jsx
        │   └── Toast.jsx
        └── views/
            ├── CapturePage.jsx
            ├── DashboardPage.jsx
            ├── ReviewPage.jsx
            └── SettingsPage.jsx
```

---

## 3. Docker & Infrastructure

### `docker-compose.yml`

Three services on a shared `ebaylister` bridge network:

**`backend`**
- Build from `./backend`
- Port `8000:8000`
- Env vars: `DATABASE_URL`, `PHOTOS_DIR`, `OLLAMA_HOST`, `OLLAMA_MODEL`, shipping defaults, eBay API keys
- Volumes: `${NAS_PHOTOS_PATH}:/data/photos`, `${NAS_DB_PATH}:/data/db`
- Depends on `ollama`

**`frontend`**
- Build from `./frontend` (Vite build → nginx)
- Port `3000:80`
- Env vars: `VITE_API_URL`, `VITE_WS_URL`
- Depends on `backend`

**`ollama`**
- Image: `ollama/ollama:latest`
- Port `11434:11434`
- Volume: `ollama_models:/root/.ollama`
- GPU passthrough block (commented out by default — user uncomments and adds Unraid GPU UUID):

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          device_ids: ['GPU-your-uuid-here']
          capabilities: [gpu]
```

### `.env.example`

```bash
# NAS mount paths (Unraid paths)
NAS_PHOTOS_PATH=/mnt/user/appdata/ebaylister/photos
NAS_DB_PATH=/mnt/user/appdata/ebaylister/db

# Ollama
OLLAMA_MODEL=qwen2.5vl:7b

# eBay API (optional — enables live price research)
EBAY_APP_ID=
EBAY_CLIENT_SECRET=

# Your server's IP or domain (used in CSV photo URLs)
SERVER_BASE_URL=http://192.168.1.x:8000
```

### Backend `Dockerfile`

Python 3.12-slim base. Install system dep `libmagic1`. `pip install -r requirements.txt`. `CMD uvicorn main:app --host 0.0.0.0 --port 8000 --reload`.

### Frontend `Dockerfile`

Multi-stage: Node 20-alpine build stage runs `npm ci && npm run build`. nginx-alpine serve stage copies `/app/dist` to `/usr/share/nginx/html`.

### `nginx.conf`

- `try_files $uri $uri/ /index.html` for SPA fallback
- `/api/` proxied to `http://backend:8000`
- `/ws` proxied with `Upgrade` and `Connection` headers for WebSocket

---

## 4. Database Schema

All tables use UUID string primary keys. Async SQLAlchemy 2 with aiosqlite driver.

### `profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | str | e.g. "Funko Pop! Vinyl" |
| `slug` | str unique | e.g. "funko-pop" |
| `icon` | str | emoji, e.g. "🎯" |
| `is_default` | bool | only one can be true |
| `is_builtin` | bool | built-ins can't be deleted |
| `ebay_category_id` | str | e.g. "149372" |
| `ebay_brand` | str | e.g. "Funko" |
| `ebay_item_type` | str | e.g. "Vinyl Figure" |
| `ebay_product_line` | str | e.g. "Pop! Vinyl" |
| `ebay_condition_default` | str | "New" or "Used" |
| `prompt_ocr` | text | Pass-1 vision prompt |
| `prompt_struct` | text | Pass-2 structured extraction prompt preamble |
| `prompt_fields` | JSON | Ordered field definition array |
| `price_search_template` | str | e.g. `"Funko Pop {series} #{box_number} {character}"` |
| `default_weight_g` | int | |
| `default_length_cm` | int | |
| `default_width_cm` | int | |
| `default_depth_cm` | int | |
| `shipping_defaults` | JSON | `{domestic, usa, intl}` objects |
| `created_at` | datetime | |
| `updated_at` | datetime | |

### `batches`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `profile_id` | UUID FK → profiles | which profile was used |
| `label` | str nullable | optional user label from capture page |
| `status` | str | `queued` \| `processing` \| `done` \| `error` |
| `step` | str nullable | current pipeline step text |
| `photo_count` | int | |
| `created_at` | datetime | |

Relationships: `listing` (one-to-one), `photos` (one-to-many ordered by `order`)

### `listings`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `batch_id` | UUID FK unique | |
| `profile_id` | UUID FK | denormalised for easy querying |
| `status` | str | `pending` \| `processing` \| `needs_review` \| `approved` \| `error` |
| `step` | str nullable | |
| `error` | text nullable | |
| `confidence` | int nullable | 0–100 |
| `approved_at` | datetime nullable | |
| `created_at` | datetime | |
| **Identification fields** | | Stored as flat columns AND in `extracted_data` JSON |
| `title` | str | generated, editable |
| `extracted_data` | JSON | raw dict from vision model — all profile-defined fields |
| `description` | text | generated, editable |
| `condition` | str | |
| `condition_note` | text nullable | |
| `quantity` | int | default 1 |
| `category_id` | str | from profile |
| `sku` | str | auto-generated |
| `upc` | str nullable | |
| **Pricing** | | |
| `price` | float | suggested (avg × 1.1) |
| `price_low` | float | |
| `price_avg` | float | |
| `price_high` | float | |
| `recent_sales` | int | |
| `sell_through` | int | |
| **Best Offer** | | |
| `best_offer` | bool | default true |
| `best_offer_accept` | float | |
| `best_offer_decline` | float | |
| **Shipping** | | |
| `shipping` | JSON | `{domestic, usa, intl}` |
| **Package** | | |
| `package_type` | str | |
| `weight_grams` | int | |
| `pkg_length_cm` | int | |
| `pkg_width_cm` | int | |
| `pkg_depth_cm` | int | |

### `photos`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `batch_id` | UUID FK | |
| `filename` | str | relative path: `{batch_id}/{uuid}.jpg` |
| `original_name` | str | |
| `order` | int | 0 = cover photo |
| `created_at` | datetime | |

### `settings`

Single-row key-value store for app-wide settings that aren't per-profile.

| Column | Type | Notes |
|---|---|---|
| `key` | str PK | |
| `value` | JSON | |

Keys: `ollama_model`, `ollama_host`, `ebay_app_id`, `ebay_client_secret`, `server_base_url`, `default_profile_id`.

---

## 5. Profile & Configuration System

### The Mental Model

A **Profile** is a named configuration that tells the pipeline everything it needs to process a category of item. The pipeline has no hardcoded knowledge of Funko Pops — it reads from the active profile at runtime.

The three things a profile controls:

1. **Prompts** — what the vision model is asked to look for and return
2. **Field schema** — what fields exist, how they appear in the UI, how they map to eBay CSV columns
3. **Defaults** — eBay category, dimensions, shipping, price search template

### `prompt_fields` JSON Schema

Each entry in the array:

```json
{
  "key": "character",
  "label": "Character",
  "ebay_csv_col": "C: Character",
  "type": "text",
  "required": true,
  "recommended": false,
  "mono": false,
  "hint": "e.g. Spider-Man",
  "options": null,
  "default": null,
  "in_title": true,
  "title_order": 4,
  "title_suffix": null,
  "title_wrap": null,
  "in_price_search": true
}
```

**Field types:** `text`, `select` (requires `options` array), `bool`, `number`.

**Title generation** (generic, driven by field schema):
1. Filter fields where `in_title === true`
2. Sort by `title_order`
3. For each, get value from `extracted_data[key]`
4. Skip if value is empty or equals default (e.g. "Standard" edition)
5. Apply `title_suffix` (e.g. `"Exclusive"` → appends " Exclusive")
6. Apply `title_wrap` (e.g. `"()"` → wraps value in parentheses)
7. Prepend profile name prefix (e.g. "Funko Pop!")
8. Join with spaces, truncate to 80 chars

**Price search** (generic):
Interpolate `{key}` tokens in `price_search_template` using `extracted_data`. Skip tokens whose value is empty.

**Prompt auto-construction**:
The pipeline builds the Pass-2 prompt by taking `profile.prompt_struct` (the preamble) and appending an auto-generated JSON schema from `prompt_fields`:

```python
def build_json_schema(fields: list) -> str:
    schema = {f["key"]: f.get("default", "") for f in fields}
    schema["confidence"] = 85
    return json.dumps(schema, indent=2)
```

The full prompt sent to Ollama becomes:
```
{profile.prompt_struct}

Return ONLY this exact JSON object (no markdown, no explanation):
{auto-generated schema}

Rules:
- confidence: integer 0-100 indicating identification certainty
- Return empty string "" for any field you cannot determine
- Do not add fields not listed above
```

### Built-in Profiles (seed data in `seed/profiles.json`)

#### `funko-pop` — Funko Pop! Vinyl

- **eBay Category:** 149372
- **Icon:** 🎯
- **Default weight:** 450g | **Dimensions:** 23×17×12cm
- **prompt_ocr:** *"You are examining photos of a Funko Pop! vinyl figure in its original box. Read ALL text visible anywhere on the box: character name, series name, box number (the #XXX identifier), franchise or show name, exclusive retailer sticker text, edition type (Chase, Flocked, Glow in the Dark, Metallic, etc.), year of manufacture, and the UPC barcode number. List every piece of text exactly as it appears."*
- **prompt_struct preamble:** *"Based on these Funko Pop box photos and the extracted text below, identify the figurine. Brand is always Funko. box_number is only the digits. exclusive is the retailer name only (Target, Walmart, Hot Topic, etc.) or empty. edition is Standard unless visibly marked otherwise."*
- **Fields:** character (REQ), series (REQ), box_number (REC), franchise (REC), exclusive (REC), edition (select: Standard/Chase/Flocked/Glow in the Dark/Metallic/Diamond, REC), year (REC), upc (REC)
- **Price search template:** `"Funko Pop {series} #{box_number} {character} {exclusive}"`

#### `hot-wheels` — Hot Wheels Die-cast

- **eBay Category:** 31911
- **Icon:** 🚗
- **Default weight:** 100g | **Dimensions:** 15×10×6cm
- **prompt_ocr:** *"You are examining photos of a Hot Wheels die-cast vehicle. Read ALL text visible: vehicle/car name, series or collection name, series number (e.g. 3/10), year of manufacture (on the base), colour description, any Treasure Hunt or Super Treasure Hunt markings, tampo/decoration details, country of manufacture on base."*
- **prompt_struct preamble:** *"Identify this Hot Wheels car from the photos and text. vehicle_name is the car model (e.g. 'Dodge Charger'). series is the collection name. treasure_hunt is true only if explicitly marked TH or Super TH."*
- **Fields:** vehicle_name (REQ), series (REQ), series_number (REC), year (REC), colour (REC), casting (REC), treasure_hunt (bool, REC)
- **Price search template:** `"Hot Wheels {series} {vehicle_name} {year} {colour}"`

#### `trading-card` — Trading Cards (Pokémon, Sports, etc.)

- **eBay Category:** set dynamically based on sub-type (Pokémon = 183454, sports = 261328) — provide a `category_id` field the user can set
- **Icon:** 🃏
- **Default weight:** 50g | **Dimensions:** 15×11×1cm
- **ebay_condition_default:** "Used"
- **prompt_ocr:** *"You are examining photos of a trading card. Read ALL text visible: card name, player or character name, set or expansion name, card number (e.g. 025/102), rarity symbol description, year on the card, any grading label text (PSA, BGS, CGC grade and number), HP or stats if Pokémon, team name if sports card."*
- **prompt_struct preamble:** *"Identify this trading card. card_number is the number printed on the card (e.g. '025/102'). grade is the numeric grade if professionally graded (e.g. '9.5'), empty if raw. grader is PSA/BGS/CGC/etc or empty. rarity is the symbol or text (Common/Uncommon/Rare/Holo Rare/etc)."*
- **Fields:** card_name (REQ), player_or_character (REQ), set_name (REQ), card_number (REC), year (REC), rarity (REC), grade (REC), grader (select: /PSA/BGS/CGC/SGC, REC)
- **Price search template:** `"{card_name} {set_name} {card_number} {grade} {grader}"`

---

## 6. Backend — FastAPI

### `core/config.py`

`Pydantic BaseSettings` reading from env + `.env` file. Fields:

```python
DATABASE_URL: str = "sqlite:////data/db/ebaylister.db"
PHOTOS_DIR: str = "/data/photos"
OLLAMA_HOST: str = "http://ollama:11434"
OLLAMA_MODEL: str = "qwen2.5vl:7b"
EBAY_APP_ID: str = ""
EBAY_CLIENT_SECRET: str = ""
SERVER_BASE_URL: str = "http://localhost:8000"

# Canada Post shipping defaults (CAD, eff. June 26 2025, ~450g packed)
SHIP_DOMESTIC_SERVICE: str = "CanadaPostExpeditedParcel"
SHIP_DOMESTIC_PRICE: float = 16.00
SHIP_USA_SERVICE: str = "CanadaPostTrackedPacketUSA"
SHIP_USA_PRICE: float = 17.00
SHIP_INTL_SERVICE: str = "CanadaPostTrackedPacketIntl"
SHIP_INTL_PRICE: float = 35.00
```

### `core/ws.py`

`ConnectionManager` class. Internal state: `_connections: set[WebSocket]`, `_lock: asyncio.Lock`.

- `connect(ws)` — `await ws.accept()`, add to set
- `disconnect(ws)` — remove from set
- `broadcast(event, data)` — JSON-encode `{"event": event, "data": data}`, send to all, silently remove dead connections

Helper: `send_batch_update(batch_id, status, step=None, listing=None)` calls `broadcast("batch_update", {...})`.

One module-level singleton: `manager = ConnectionManager()`.

### `models/database.py`

Async engine with `sqlite+aiosqlite:///`. All models inherit `Base(DeclarativeBase)`. `init_db()` calls `create_all` then `seed_profiles()`. `get_db()` yields `AsyncSession`.

`seed_profiles()` — on startup, load `seed/profiles.json`, insert any profile whose `slug` doesn't already exist in the DB.

### `workers/pipeline.py`

#### Image preprocessing

```python
def preprocess_image(path: str, max_size: int = 1200) -> str:
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)   # fix phone rotation
    img = img.convert("RGB")
    img.thumbnail((max_size, max_size), Image.LANCZOS)
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()
```

#### Ollama call

```python
async def ollama_vision(images_b64: list[str], prompt: str) -> str:
    payload = {
        "model": settings.OLLAMA_MODEL,
        "messages": [{"role": "user", "content": prompt, "images": images_b64}],
        "stream": False,
        "options": {"temperature": 0.1},
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{settings.OLLAMA_HOST}/api/chat", json=payload)
        r.raise_for_status()
        return r.json()["message"]["content"]
```

#### JSON extraction

```python
def extract_json(raw: str) -> dict:
    clean = re.sub(r"```json?|```", "", raw).strip()
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", clean, re.DOTALL)
        return json.loads(m.group()) if m else {}
```

#### Pipeline stages

| Stage | Action | WS event |
|---|---|---|
| 1 | Preprocess images → list of b64 strings | `"Pre-processing images…"` |
| 2a | Ollama OCR pass — `profile.prompt_ocr`, up to 3 images | `"Identifying with vision model…"` |
| 2b | Ollama struct pass — `profile.prompt_struct` + auto schema, up to 4 images + OCR text | same |
| 3 | Cross-reference stub (0.5s sleep, future: external DB lookup) | `"Cross-referencing database…"` |
| 4 | Price research (eBay Browse API or fallback) | `"Researching market prices…"` |
| 5 | Generate title, description, SKU using profile field schema | `"Generating listing copy…"` |
| 6 | Persist listing, set status `needs_review`, broadcast done | `"Finalising…"` |

#### Price research

If `EBAY_APP_ID` is set:
1. Get client credentials OAuth token from `https://api.ebay.com/identity/v1/oauth2/token`
2. Call `GET https://api.ebay.com/buy/browse/v1/item_summary/search` with `q` (interpolated from `profile.price_search_template`), `category_ids` (from profile), `limit=20`, `filter=conditionIds:{1000|3000}`
3. Extract `itemSummaries[].price.value` as floats, compute low/avg/high

If no API key or request fails: return randomised fallback in $10–$35 range.

Return: `{price_low, price_avg, price_high, recent_sales, sell_through}`.

#### Error handling

Wrap entire pipeline in `try/except`. On any exception: set `batch.status = "error"`, `batch.step = str(e)`, broadcast error WS event. Log full traceback.

### `api/routes.py`

#### `POST /api/batches` (multipart)

Form fields: `label` (optional str), `profile_id` (optional str — uses default if omitted), `photos` (list of UploadFile).

Validation:
- 1–12 files
- `content_type` in `{image/jpeg, image/png, image/webp, image/heic}`
- Max 20 MB per file

Process:
1. Resolve profile (use provided `profile_id` or look up `is_default = true`)
2. Create `Batch(profile_id=..., label=..., photo_count=...)`
3. Create placeholder `Listing(batch_id=..., profile_id=..., status="pending")`
4. For each file: save to `{PHOTOS_DIR}/{batch_id}/{uuid}{ext}`, create `Photo` row
5. `background_tasks.add_task(run_pipeline, batch.id, profile.id)`
6. Return `{batch_id, photo_count, status: "queued"}`

#### `GET /api/batches`

Last 100 batches, `ORDER BY created_at DESC`. Each item includes: id, label, profile (id, name, icon), created_at, photo_count, status, step, first photo filename, listing summary (id, status, title, character or first key field, price, confidence).

#### `GET /api/batches/{id}`

Full detail: all photos, full listing object.

#### `GET /api/listings` (optional `?status=`, `?profile_id=`)

Full listing objects, `ORDER BY created_at DESC`.

#### `GET /api/listings/{id}`

Full listing detail.

#### `PATCH /api/listings/{id}`

Body: JSON object of field updates. Whitelisted updatable columns — all listing columns except `id`, `batch_id`, `profile_id`, `created_at`, `approved_at`, `status`. Persist, return updated listing.

#### `POST /api/listings/{id}/approve`

Optional body for final field updates. Sets `status = "approved"`, `approved_at = now()`. Broadcasts `listing_approved` WS event. Returns `{status: "approved"}`.

#### `POST /api/listings/{id}/reprocess`

Resets `listing.status = "processing"`, `batch.status = "processing"`. Re-runs `run_pipeline` as background task. Used after user corrects identification fields.

#### `GET /api/photos/{batch_id}/{filename}`

`FileResponse` from `{PHOTOS_DIR}/{batch_id}/{filename}`. Returns 404 if not found.

#### `GET /api/export/csv`

Queries all `approved` listings with their profiles and photos. Builds eBay bulk CSV (see Section 8). Streams as `text/csv` with timestamped filename.

### `api/profiles.py`

#### `GET /api/profiles`

All profiles ordered by `name`. Returns: id, name, slug, icon, is_default, is_builtin, ebay_category_id, field count, listing count.

#### `GET /api/profiles/{id}`

Full profile including all prompt and field data.

#### `POST /api/profiles`

Create a new profile. Body: all profile fields. `slug` must be unique. `is_builtin` always set to false.

#### `PUT /api/profiles/{id}`

Full update. Cannot modify `is_builtin`. If setting `is_default = true`, unset all other profiles' `is_default` in the same transaction.

#### `DELETE /api/profiles/{id}`

Disallowed if `is_builtin = true` (return 403). Disallowed if profile has associated batches (return 409 with count).

#### `POST /api/profiles/{id}/duplicate`

Clone profile with new id, name appended with " (Copy)", `is_builtin = false`, `is_default = false`.

#### `POST /api/profiles/{id}/test-prompt`

Body: `{batch_id: "..."}` — re-runs just Stage 2 (OCR + struct) on the given batch's photos using this profile's prompts. Returns `{ocr_text, extracted_data, confidence}`. Useful for tuning prompts without reprocessing.

#### `GET /api/settings`

Returns the `settings` key-value table as a flat object.

#### `PUT /api/settings`

Accepts partial update object. Upserts key-value pairs. Restricted to known keys only.

#### `GET /api/ollama/models`

Proxies `GET {OLLAMA_HOST}/api/tags`. Returns list of available local model names. Used to populate the model selector in settings.

### `main.py`

```python
@asynccontextmanager
async def lifespan(app):
    await init_db()        # creates tables + seeds profiles
    yield

app = FastAPI(title="EbayLister", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)
app.include_router(routes.router)
app.include_router(profiles.router)

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()   # keep-alive ping loop
    except WebSocketDisconnect:
        await manager.disconnect(websocket)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

---

## 7. Frontend — React

### Design System (`styles.css`)

**Fonts:** Bebas Neue (display/headings), DM Mono (labels/code/mono fields), DM Sans (body).

**CSS variables:**
```css
--bg: #0e0e0f          /* page background */
--surface: #161618     /* cards, sidebar */
--surface2: #1e1e21    /* inputs, inner cards */
--border: #2a2a2f
--border2: #3a3a42
--gold: #f0a500        /* primary action / price */
--gold2: #ffd166       /* hover state */
--gold-dim: rgba(240,165,0,0.12)
--red: #ff4d6d
--green: #2dd4a0
--blue: #4da6ff        /* modified fields / secondary action */
--text: #e8e8ec
--text2: #9898a8
--text3: #606070       /* labels, placeholders */
```

**Shared CSS classes:** `.btn`, `.btn-gold`, `.btn-outline`, `.btn-blue`, `.btn-ghost`, `.btn-red`, `.btn-sm`, `.btn-lg`, `.badge`, `.badge-queued`, `.badge-processing`, `.badge-needs_review`, `.badge-approved`, `.badge-error`, `.card`, `.card-header`, `.card-title`, `.field`, `.field-label`, `.field-input` (with `.mono`, `.modified` variants), `textarea.field-input`, `select.field-input`.

**Keyframes:** `spin` (spinner), `pulse` (status dot), `slideUp` (toast), `fadeIn`.

### `lib/api.js`

Thin wrapper around `fetch`. `BASE = import.meta.env.VITE_API_URL || ""`. All methods throw on non-2xx with the `detail` field from FastAPI's error JSON.

```js
export const api = {
  createBatch: (formData) => ...,
  listBatches: () => ...,
  getBatch: (id) => ...,
  listListings: (status, profileId) => ...,
  getListing: (id) => ...,
  updateListing: (id, data) => ...,
  approveListing: (id, data) => ...,
  reprocessListing: (id) => ...,
  listProfiles: () => ...,
  getProfile: (id) => ...,
  createProfile: (data) => ...,
  updateProfile: (id, data) => ...,
  deleteProfile: (id) => ...,
  duplicateProfile: (id) => ...,
  testPrompt: (profileId, batchId) => ...,
  getSettings: () => ...,
  updateSettings: (data) => ...,
  getOllamaModels: () => ...,
  exportCSV: () => window.open(`${BASE}/api/export/csv`, '_blank'),
  photoUrl: (filename) => `${BASE}/api/photos/${filename}`,
}
```

`createWS(onMessage)`: creates `WebSocket` to `/ws`, auto-reconnects after 3s on close, pings every 25s, returns cleanup function.

### `hooks/useWebSocket.js`

```js
export function useWebSocket(onMessage) {
  const cbRef = useRef(onMessage)
  useEffect(() => { cbRef.current = onMessage }, [onMessage])

  useEffect(() => {
    const cleanup = createWS((msg) => cbRef.current(msg))
    return cleanup
  }, [])
}
```

### `hooks/useBatches.js`

State: `batches` (array), `loading` (bool). On mount: `api.listBatches()`. Subscribes to WS via `useWebSocket`. On `batch_update` event: merge the event's `{status, step, listing}` into the matching batch by id. Returns `{ batches, loading, refresh }`.

### Components

#### `StatusBadge.jsx`

Props: `status`, `step` (optional). Maps status → badge class + label:

| status | class | label |
|---|---|---|
| `queued` | `badge-queued` | QUEUED |
| `processing` | `badge-processing` | `step` text or PROCESSING (animated dot) |
| `needs_review` | `badge-needs_review` | REVIEW |
| `approved` | `badge-approved` | APPROVED |
| `error` | `badge-error` | ERROR |

#### `PhotoStrip.jsx`

Props: `photos` (array of `{filename}`), `activeIndex`, `onSelect`.

Layout: vertical column of 56×56px thumbnails. First photo has "COVER" badge overlay. Active photo has gold border. On mount and when `photos` changes, auto-selects index 0.

#### `FieldInput.jsx`

Props: `label`, `value`, `onChange`, `field` (key), `modified`, `mono`, `multiline`, `type`, `required`, `recommended`, `fullWidth`, `span2`, `options` (for select), `hint`, `children` (override input element).

Renders:
- Label row with optional gold `REQ` badge or blue `REC` badge
- Input / textarea / select or `children` override
- `.modified` class applied when `modified === true`

#### `ShippingSection.jsx`

Props: `shipping` (`{domestic, usa, intl}`), `onChange`.

Three-column grid. Each column:
- Zone title + flag emoji (🇨🇦 / 🇺🇸 / 🌍)
- Service `<select>` populated from `SHIPPING_DEFAULTS` constant (same as prototype)
- Delivery time display (from selected service object)
- Price input (hidden when `free = true`) with `CA$` prefix label
- Free shipping checkbox toggle
- Red "⚠ No tracking — risky for eBay" warning when selected service has `tracked: false`

Footer note: *"Consumer prices before tax. 19.5% fuel surcharge applies. Verify at canadapost.ca/prices."*

#### `ProfilePill.jsx`

Props: `profile` (`{icon, name, slug}`), `selected`, `onClick`.

Horizontal pill button: icon + name. Gold border/background when selected. Used in CapturePage header.

#### `PromptEditor.jsx`

Props: `label`, `value`, `onChange`, `profileId`, `batchId` (for test), `showLivePreview`.

- Large monospaced textarea
- "Test with last batch" button → calls `api.testPrompt()` → shows result in an expandable panel below the textarea showing: raw OCR text, parsed JSON, confidence score
- "Live preview" toggle → shows the final prompt string that will be sent to Ollama (prompt + auto-generated schema appended)

#### `FieldsEditor.jsx`

Props: `fields` (array), `onChange`.

Drag-to-reorder list (use native HTML5 drag-and-drop with `draggable`, `onDragStart`, `onDragOver`, `onDrop`). Each row:
- Drag handle (⋮⋮)
- `key` input (mono)
- `label` input
- `type` select (text/select/bool/number)
- `ebay_csv_col` input
- Required toggle, Recommended toggle, In Title toggle
- Remove button (×)

"Add Field" button appends a blank field entry.

#### `Toast.jsx`

Props: `message`, `type` (success/error/info), `onDone`.

Fixed bottom-right, `z-index: 1000`. Auto-dismisses after 3s via `useEffect`. `slideUp` animation. Border colour driven by type.

### Views

#### `CapturePage.jsx` — `/capture`

**Layout:** `min-height: 100dvh`, `padding-bottom: env(safe-area-inset-bottom)` for iPhone notch.

**Header:** "EBAY LISTER / CAPTURE" logo left, "QUEUE →" link right.

**Profile selector:** Horizontal scrolling row of `ProfilePill` components. Fetched from `api.listProfiles()` on mount. Selected profile stored in local state. Default: the profile with `is_default = true`.

**Body — idle state:**
- Optional label `<input>` (font-size 16px to prevent iOS auto-zoom)
- Photo grid (3 columns, `aspect-ratio: 1` cells):
  - Filled cells: thumbnail image, ✕ remove button overlay, "COVER" badge on index 0
  - Empty cell (when < 12 photos): `<label>` with `📷 ADD` text, hidden `<input type="file" accept="image/*" multiple capture="environment">`
- Photo tips card (visible when 0 photos): 5 ordered tips (Front of box, Back of box, Top/box number, Exclusive sticker, Condition issues)
- Sticky bottom: "↑ Submit N Photos" gold button, full width, disabled when 0 photos or uploading

**Uploading state:** spinner in button, all inputs disabled.

**Success state:** Replace body with:
- Large success card: ✓ icon, "QUEUED!", photo count, label
- Pulsing gold banner: spinner + "AI is identifying…"
- "Next Item" button (resets state)
- "View Queue" link

**Error state:** Red banner above grid with error message. Button re-enabled.

#### `DashboardPage.jsx` — `/dashboard`

**Layout:** Two-panel — sidebar (300px fixed) + scrollable main content.

**Header:** Logo, "CAPTURE +" link opens `/capture`, approved count badge, "Export CSV" gold button (disabled when 0 approved).

**Sidebar:**
- Filter tabs: ALL | REVIEW | APPROVED | ERROR (with count badges)
- Queue list using `useBatches()` — live WS updates:
  - Each item: thumbnail, character/label/"Identifying…", `StatusBadge`, relative time
  - Selected item: gold left border highlight
- Bottom: "Refresh" button, total count

**Main panel:**

| Batch status | Panel content |
|---|---|
| Nothing selected | Centered empty state: icon + "Select an item to review" |
| `queued` / `processing` | Processing card: spinner + animated step text |
| `needs_review` | Full review form (see Review Panel below) |
| `approved` | Read-only summary with "Edit" button to re-enter edit mode |
| `error` | Error card: error message + "Retry" button |

#### Review Panel (shared between Dashboard + ReviewPage)

Receives: `listing`, `photos`, `onApprove`, `onReprocess`, `profile`.

**State:** `fields` (copy of listing data), `modified` (set of changed field keys), `activePhoto` (index).

**Modified notice bar** (visible when `modified.size > 0`):
Blue banner: "Fields modified — save as-is or re-run research." + "Re-run Research" button.

**Top section (flex row):**
- `PhotoStrip` component (left column)
- Main photo preview (170×170px, rounded)
- Meta panel (flex 1):
  - Editable title input (Bebas Neue, 22px, border-bottom focus)
  - Tag row: exclusive, edition, condition, box number
  - Confidence bar
  - Price editor: `CA$` label + large Bebas Neue price input + sold range display

**Market Research card:** 5 stat tiles — Avg Sold, Price Range, Recent Sales, Sell-through %, Your Price.

**Identification card:**

Renders dynamically from `profile.prompt_fields`. Groups fields into a CSS grid (3 columns default). Each field rendered via `FieldInput` with `required`/`recommended` from the field schema.

**Listing Details card (4-column grid):**
- Condition (select: New/Used/Not specified, REQ)
- Quantity (REQ)
- Category ID (REQ, from profile)
- Custom SKU
- UPC (REC)
- Best Offer (select: TRUE/FALSE)
- Auto-Accept amount
- Auto-Decline amount
- Condition Note (full-width textarea, only shown when condition = "Used")
- Description (full-width textarea)

**Shipping card:** `ShippingSection` component.

**Package Dimensions card (4-column grid):** Length, Width, Depth (cm), Weight (g). Pre-filled from profile defaults.

**Action bar:**
- "✓ Approve & Save" — calls `api.approveListing(id, currentFields)`, shows success toast
- "⟳ Re-run Research" — calls `api.reprocessListing(id)`, panel enters processing state
- "↺ Reset" — reverts `fields` to original listing data, clears `modified`

#### `ReviewPage.jsx` — `/review/:listingId`

Full-page standalone review. On mount: fetch `api.getListing(id)` + `api.getBatch(batchId)` for photos + `api.getProfile(profileId)`. Renders the Review Panel with a "← Dashboard" back button. Useful for deep-linking to a specific listing.

#### `SettingsPage.jsx` — `/settings`

Two-tab layout: **Profiles** | **General**.

**Profiles tab:**

Left: list of all profiles. Each row: icon, name, is_default badge, is_builtin badge, listing count. Buttons: "Set Default", "Edit", "Duplicate", "Delete" (disabled for built-ins). "New Profile" button at bottom.

Right: Profile editor panel (shown when a profile is selected):

Sections:
1. **Basic** — Name, Slug (auto-generated from name, editable), Icon (emoji input), eBay Category ID, is_default toggle
2. **Prompts** — Two `PromptEditor` components:
   - "Pass 1 — OCR Prompt": instruction for raw text extraction
   - "Pass 2 — Structured Prompt": extraction preamble (schema is auto-appended by the pipeline)
   - Both show a "Test with last batch" button when at least one batch exists
3. **Fields** — `FieldsEditor` component
4. **Defaults** — Title template (with `{field_key}` tokens, read-only display of generated example), Price search template, Package dimensions + weight (4 number inputs), `ShippingSection` component
5. **eBay Defaults** — Brand, Product Line, Item Type, Condition default (select)

Save/Cancel buttons. "Duplicate" button creates a copy. Unsaved changes: show confirmation on navigation away.

**General tab:**

- **Ollama Model** — `<select>` populated from `api.getOllamaModels()`. Shows current model, updates `settings.ollama_model`
- **Ollama Host** — text input (default `http://ollama:11434`)
- **eBay API** — App ID + Client Secret inputs with "Test Connection" button
- **Server Base URL** — used for CSV photo URLs (e.g. `http://192.168.1.100:8000`)
- Save button — calls `api.updateSettings()`

---

## 8. eBay CSV Export

### Column headers (in order)

```
Action
Custom label (SKU)
Category ID
Title
Description
Condition ID
ConditionDescription
P:UPC
Start price
Quantity
Format
Duration
C: Brand
C: Character        ← driven by profile.prompt_fields[].ebay_csv_col
C: Series
C: Product Line
C: Type
C: Number
C: Franchise
C: Edition
C: Features
C: Year Manufactured
BestOffer
BestOfferAccept
BestOfferDecline
Shipping service 1 option
Shipping service 1 cost
Shipping service 2 option
Shipping service 2 cost
Shipping service 3 option
Shipping service 3 cost
PackageType
WeightMajor
WeightMinor
PackageLength
PackageWidth
PackageDepth
Item photo URL
```

> **Note on dynamic columns:** The `C:` item specific columns are generated from `profile.prompt_fields` at export time. Each field with an `ebay_csv_col` starting with `C:` gets its own column, populated from `listing.extracted_data[field.key]`. Different profiles will produce different sets of `C:` columns — this is correct behaviour for eBay's bulk upload.

### Fixed values per row

| Column | Value |
|---|---|
| Action | `Add(SiteID=US|Country=CA|Currency=CAD|Version=1193|CC=UTF-8)` |
| Format | `FixedPrice` |
| Duration | `GTC` |
| Condition ID | `1000` (New) / `3000` (Used) / `7000` (Not specified) |
| C: Brand | From `profile.ebay_brand` |
| C: Product Line | From `profile.ebay_product_line` |
| C: Type | From `profile.ebay_item_type` |

### Photo URL

```
{settings.SERVER_BASE_URL}/api/photos/{batch_id}/{filename}
```

eBay requires a publicly accessible URL for photos. The user must ensure their server is reachable from eBay's servers (port-forward or Tailscale or Cloudflare Tunnel). The settings page has the `SERVER_BASE_URL` field for this.

---

## 9. Shipping Defaults

Based on Canada Post consumer prices, effective June 26, 2025. Assumed packed weight ~450g for a standard Funko Pop (figure + box + bubble wrap + outer shipping box).

### Domestic Canada

| Service | Code | Default Price (CAD) | Speed | Tracked |
|---|---|---|---|---|
| Expedited Parcel ★ | `CanadaPostExpeditedParcel` | $16.00 | 2–8 days | ✓ |
| Regular Parcel | `CanadaPostRegularParcel` | $12.00 | 4–10 days | ✓ |
| Xpresspost | `CanadaPostXpresspost` | $22.00 | 1–5 days guaranteed | ✓ |

### United States

| Service | Code | Default Price (CAD) | Speed | Tracked |
|---|---|---|---|---|
| Tracked Packet – USA ★ | `CanadaPostTrackedPacketUSA` | $17.00 | 6–10 days | ✓ |
| Expedited Parcel – USA | `CanadaPostExpeditedParcelUSA` | $26.00 | 4–7 days | ✓ |
| Xpresspost – USA | `CanadaPostXpresspostUSA` | $38.00 | 2–3 days | ✓ |
| Small Packet – USA Air | `CanadaPostSmallPacketUSAAir` | $11.00 | 8–12 days | ✗ |

### International

| Service | Code | Default Price (CAD) | Speed | Tracked |
|---|---|---|---|---|
| Tracked Packet – Intl ★ | `CanadaPostTrackedPacketIntl` | $35.00 | 6–10 days | ✓ |
| International Parcel – Air | `CanadaPostIntlParcelAir` | $52.00 | 4–7 days | ✓ |
| Xpresspost – International | `CanadaPostXpresspostIntl` | $70.00 | 4–7 days guaranteed | ✓ |
| Small Packet Intl – Air | `CanadaPostSmallPacketIntlAir` | $13.00 | 4–10+ weeks | ✗ |

★ = recommended default. A 19.5% fuel surcharge currently applies on top of all base rates. Prices are counter (consumer) rates — Solutions for Small Business cardholders receive lower rates. Always verify at [canadapost.ca/prices](https://www.canadapost-postescanada.ca/cpc/en/tools/find-a-rate.page) before listing.

---

## 10. Unraid Setup

### First-time setup

1. Install **Community Applications** plugin from the Unraid App Store
2. Install **Docker Compose Manager** from Community Applications
3. Create directory structure on your NAS:
   ```
   /mnt/user/appdata/ebaylister/
   ├── photos/
   ├── db/
   └── app/         ← clone the repo here
   ```
4. Copy `.env.example` to `.env` and configure:
   ```bash
   NAS_PHOTOS_PATH=/mnt/user/appdata/ebaylister/photos
   NAS_DB_PATH=/mnt/user/appdata/ebaylister/db
   SERVER_BASE_URL=http://192.168.1.YOUR_IP:8000
   ```

### GPU passthrough (recommended)

1. In Unraid web UI: go to **Settings → GPU Statistics** — note your GPU UUID (format: `GPU-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
2. In `docker-compose.yml`, uncomment the `deploy:` block under the `ollama` service and paste your UUID
3. Ensure the Nvidia plugin is installed in Unraid (Community Applications → "Nvidia Driver")

### Starting the stack

```bash
cd /mnt/user/appdata/ebaylister/app
docker compose up -d
```

### Pull the vision model

```bash
docker exec poplister-ollama ollama pull qwen2.5vl:7b
```

This downloads ~5.5 GB. Run once — the model persists in the `ollama_models` Docker volume.

### Access

| Interface | URL | Who |
|---|---|---|
| Capture (mobile) | `http://YOUR_IP:3000/capture` | Phone |
| Dashboard (desktop) | `http://YOUR_IP:3000/dashboard` | Desktop |
| Settings | `http://YOUR_IP:3000/settings` | Desktop |
| API docs | `http://YOUR_IP:8000/docs` | Dev |

### Mobile shortcut

On iPhone: open `http://YOUR_IP:3000/capture` in Safari → Share → "Add to Home Screen". Name it "EbayLister". It will open full-screen like an app.

### Making photos accessible to eBay

eBay needs to be able to fetch your photo URLs. Options (pick one):

- **Port-forward** port 8000 on your router to your Unraid server. Set `SERVER_BASE_URL=http://YOUR_PUBLIC_IP:8000`
- **Cloudflare Tunnel** (recommended — no open ports): install `cloudflared` on Unraid, create a tunnel, point it to `localhost:8000`. Set `SERVER_BASE_URL=https://your-tunnel.trycloudflare.com`
- **Tailscale**: if you access eBay Seller Hub from a device on your Tailnet, use your Tailscale IP

---

## 11. Implementation Order

Build in this sequence — each step is independently testable before moving to the next.

### Phase 1 — Data Layer

1. DB models (`profiles`, `batches`, `listings`, `photos`, `settings`)
2. `seed/profiles.json` — three built-in profiles (funko-pop, hot-wheels, trading-card)
3. `init_db()` with `seed_profiles()` — run, verify tables and seed data in SQLite
4. `core/config.py` + `.env.example`

### Phase 2 — Pipeline

5. `preprocess_image()` + `ollama_vision()` + `extract_json()` helpers
6. `run_pipeline()` — hardcode funko-pop profile first, verify end-to-end with test images
7. Refactor `run_pipeline()` to be profile-driven — verify identical output with funko-pop profile
8. `core/ws.py` — WebSocket manager

### Phase 3 — API

9. `POST /api/batches` — photo upload + pipeline trigger
10. `GET /api/batches`, `GET /api/batches/{id}`
11. `GET /api/listings`, `PATCH /api/listings/{id}`, `POST /api/listings/{id}/approve`
12. `POST /api/listings/{id}/reprocess`
13. `GET /api/photos/{batch_id}/{filename}`
14. `GET /api/export/csv`
15. `api/profiles.py` — full profile CRUD
16. Settings endpoints + Ollama model proxy

### Phase 4 — Frontend

17. Project scaffold (Vite + React Router), `styles.css`, `api.js`
18. `CapturePage` — photo grid, submit, success state
19. `useWebSocket` + `useBatches` hooks
20. `DashboardPage` — sidebar queue list with live WS updates
21. Shared Review Panel — photo strip, fields (hardcoded funko fields first)
22. Refactor Review Panel to render fields dynamically from profile schema
23. `ReviewPage` (standalone wrapper around Review Panel)
24. `SettingsPage` — General tab first (model selector, URL config)
25. `SettingsPage` — Profiles tab with `ProfileEditor`, `PromptEditor`, `FieldsEditor`

### Phase 5 — Polish & Docker

26. `frontend/Dockerfile` + `nginx.conf`
27. `backend/Dockerfile`
28. `docker-compose.yml` — full stack smoke test
29. Unraid-specific testing (GPU passthrough, NAS mounts, mobile Safari)
30. `README.md` with setup instructions

---

*Last updated: March 2026*
