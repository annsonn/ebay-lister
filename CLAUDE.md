# CLAUDE.md — eBay Lister Codebase Guide

This file documents the structure, conventions, and workflows of the **ebay-lister** project for AI assistants.

---

## Project Overview

**ebay-lister** is a full-stack Docker application that automates eBay listing creation using Ollama vision AI. Users photograph items (via mobile or desktop), the backend processes them through a 6-stage AI pipeline, and the result is a reviewable draft listing that can be exported as an eBay bulk-upload CSV.

**Technology stack:**
- **Backend**: Python 3.12, FastAPI (async), SQLAlchemy 2.0 (async), SQLite via aiosqlite
- **Frontend**: React 18, Vite 5, React Router 6, plain CSS with CSS variables
- **AI**: Ollama (local vision models, default: `qwen2.5vl:7b`)
- **Deployment**: Docker Compose; Unraid NAS-friendly

---

## Repository Structure

```
ebay-lister/
├── backend/
│   ├── main.py                  # FastAPI app, CORS, lifespan, router registration
│   ├── requirements.txt         # Python dependencies
│   ├── Dockerfile
│   ├── core/
│   │   ├── config.py            # Pydantic Settings — all env vars & defaults
│   │   └── ws.py                # WebSocket ConnectionManager (broadcast)
│   ├── models/
│   │   └── database.py          # SQLAlchemy ORM models + DB init
│   ├── api/
│   │   ├── routes.py            # Batch, listing, photo, export endpoints
│   │   └── profiles.py          # Profile CRUD, settings, Ollama model listing
│   ├── workers/
│   │   └── pipeline.py          # Background 6-stage AI processing pipeline
│   └── seed/
│       └── profiles.json        # Built-in profile definitions (never delete)
├── frontend/
│   ├── package.json
│   ├── vite.config.js           # Dev proxy: /api → :8000, /ws → ws://:8000
│   ├── index.html
│   ├── nginx.conf               # SPA fallback + proxy for production container
│   ├── Dockerfile               # Multi-stage: Node build → nginx
│   └── src/
│       ├── main.jsx             # Router setup + mobile/desktop redirect
│       ├── styles.css           # Design system (CSS variables, global rules)
│       ├── lib/
│       │   └── api.js           # All fetch wrappers + WebSocket factory
│       ├── hooks/
│       │   ├── useWebSocket.js  # Persistent WS connection with ping/pong
│       │   └── useBatches.js    # Batch list state + live updates via WS
│       ├── components/          # Shared UI primitives
│       │   ├── FieldInput.jsx
│       │   ├── FieldsEditor.jsx
│       │   ├── PhotoStrip.jsx
│       │   ├── ProfilePill.jsx
│       │   ├── PromptEditor.jsx
│       │   ├── ShippingSection.jsx
│       │   ├── StatusBadge.jsx
│       │   └── Toast.jsx
│       └── views/               # Route-level page components
│           ├── CapturePage.jsx
│           ├── DashboardPage.jsx
│           ├── ReviewPage.jsx
│           ├── ReviewPanel.jsx
│           └── SettingsPage.jsx
├── docker-compose.yml
├── .env.example
├── README.md
└── TODO.md
```

---

## Database Schema

All models live in `backend/models/database.py`. PKs are UUID strings.

### `Profile`
Defines how a category of items is processed.
- `id`, `name`, `icon`, `is_builtin` (bool — built-ins cannot be deleted)
- `ocr_prompt` — first Ollama pass: raw text extraction
- `struct_prompt` — second Ollama pass: structured JSON extraction
- `fields` (JSONColumn) — ordered list of `{key, label, type}` descriptors
- `price_search_template` — URL template for eBay sold-price research
- `ebay_category_id`, `condition`
- `ship_*` — default shipping service names and prices
- `pkg_*` — default package dimensions

### `Batch`
Groups photos uploaded together in one session.
- `id`, `created_at`
- `status`: `queued` → `processing` → `done` | `error`
- Relations: one `Listing`, many `Photo`s (ordered)

### `Listing`
The core working document for a single item.
- `id`, `batch_id`, `profile_id`
- `status`: `pending` → `processing` → `needs_review` → `approved` | `error`
- `extracted_fields` (JSONColumn) — raw AI output
- `title`, `description`, `price`, `best_offer_price`
- `ebay_category_id`, `condition_id`, `condition`
- `shipping` (JSONColumn) — list of shipping option objects
- `pkg_weight_oz`, `pkg_length_in`, `pkg_width_in`, `pkg_depth_in`
- `approved_at`, `error_message`

### `Photo`
- `id`, `batch_id`, `filename`, `original_filename`, `order`

### `Setting`
- `key` / `value` — persistent key-value store for runtime configuration

### Custom `JSONColumn`
A `TypeDecorator` that transparently serializes Python dicts/lists to JSON text in SQLite. Used for `extracted_fields`, `fields`, `shipping`, etc.

---

## API Endpoints

All backend routes are prefixed with `/api`.

### Batches (`api/routes.py`)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/batches` | Create batch, upload photos, trigger pipeline |
| `GET` | `/api/batches` | List 100 most recent with summaries |
| `GET` | `/api/batches/{id}` | Full batch detail with photos + listing |

### Listings (`api/routes.py`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/listings` | List, optional `?status=` / `?profile_id=` filters |
| `GET` | `/api/listings/{id}` | Full listing detail |
| `PATCH` | `/api/listings/{id}` | Update editable fields |
| `POST` | `/api/listings/{id}/approve` | Mark approved, set timestamp |
| `POST` | `/api/listings/{id}/reprocess` | Re-run full pipeline |

### Photos & Export (`api/routes.py`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/photos/{batch_id}/{filename}` | Serve photo file |
| `GET` | `/api/export/csv` | Download eBay bulk-upload CSV of approved listings |

### Profiles (`api/profiles.py`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/profiles` | List all with listing counts |
| `GET` | `/api/profiles/{id}` | Full profile |
| `POST` | `/api/profiles` | Create custom profile |
| `PUT` | `/api/profiles/{id}` | Update (built-ins allowed) |
| `DELETE` | `/api/profiles/{id}` | Delete custom only |
| `POST` | `/api/profiles/{id}/duplicate` | Clone |
| `POST` | `/api/profiles/{id}/test-prompt` | Run prompts on last batch photos |

### Settings & Ollama (`api/profiles.py`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | All settings |
| `PUT` | `/api/settings` | Update `ollama_host`, `ollama_model`, `server_base_url` |
| `GET` | `/api/ollama/models` | List models from configured Ollama host |

### WebSocket
- `ws://host/ws` — Real-time pipeline updates; messages are JSON with `type` and payload. Client sends `ping`, server replies `pong`.

---

## AI Pipeline (`backend/workers/pipeline.py`)

The pipeline runs as a FastAPI `BackgroundTask` triggered by `POST /api/batches`.

**Stages:**
1. **Preprocess images** — Resize to ≤1920px, correct EXIF rotation, encode as base64 JPEG
2. **Vision OCR** — Send all photos to Ollama with `ocr_prompt`; collect raw text
3. **Structured extraction** — Send OCR text + photos to Ollama with `struct_prompt`; parse JSON matching profile's `fields` schema
4. **Price research** — Scrape eBay sold listings using `price_search_template`; set `price` and `best_offer_price`; falls back to a random value on failure
5. **Generate copy** — Build `title` from extracted fields; compose `description`
6. **Persist** — Write listing to DB, broadcast WebSocket update to all clients

WebSocket messages are broadcast at each stage transition so the frontend can show live progress.

---

## Frontend Architecture

### Routing (`src/main.jsx`)
- `/` — Redirects to `/capture` on mobile (≤768 px), `/dashboard` on desktop
- `/capture` — `CapturePage`: photo upload form, profile selector
- `/dashboard` — `DashboardPage`: live batch queue, listing status grid
- `/review/:listingId` — `ReviewPage` + `ReviewPanel`: editable listing form
- `/settings` — `SettingsPage`: profile manager, Ollama config

### Data fetching (`src/lib/api.js`)
All HTTP calls are wrapped in named functions. WebSocket connections are created via `createWebSocket(onMessage)`. Do not use `fetch` directly in components — add a helper to `api.js` instead.

### Custom Hooks
- `useWebSocket(onMessage)` — Manages a single persistent WS connection with automatic ping/pong.
- `useBatches()` — Fetches batch list on mount and subscribes to WS updates.

### CSS conventions (`src/styles.css`)
Design tokens are defined as CSS custom properties at `:root`:
```css
--bg, --bg-card, --bg-input
--border
--text, --text-muted
--gold, --gold-hover        /* primary accent */
--green, --green-bg         /* success/approved */
--red, --red-bg             /* error */
--radius, --radius-sm
```
Use these variables everywhere; do not hardcode color values.

---

## Configuration & Environment

All configuration is in `backend/core/config.py` using **Pydantic Settings**. Values come from environment variables with fallbacks:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `sqlite+aiosqlite:////data/db/ebaylister.db` | DB path |
| `PHOTOS_DIR` | `/data/photos` | Photo storage root |
| `OLLAMA_HOST` | `http://ollama:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `qwen2.5vl:7b` | Default vision model |
| `SHIP_DOMESTIC_SERVICE` | `CanadaPostExpeditedParcel` | eBay service name |
| `SHIP_DOMESTIC_PRICE` | `16.00` | CAD |
| `SHIP_USA_SERVICE` | `CanadaPostTrackedPacketUSA` | eBay service name |
| `SHIP_USA_PRICE` | `17.00` | CAD |
| `SHIP_INTL_SERVICE` | `CanadaPostTrackedPacketIntl` | eBay service name |
| `SHIP_INTL_PRICE` | `35.00` | CAD |
| `SERVER_BASE_URL` | `""` | Public URL for photo links in CSV |

`NAS_PHOTOS_PATH` and `NAS_DB_PATH` are Docker Compose host-side volume mounts (set in `.env`), not read by the Python app directly.

---

## Development Workflows

### Local dev (without Docker)
```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev          # Vite dev server on :5173 with proxy to :8000
```

### Docker Compose (full stack)
```bash
cp .env.example .env   # Set NAS_PHOTOS_PATH and NAS_DB_PATH
docker compose up --build
# Frontend: http://localhost:3000
# Backend API docs: http://localhost:8000/docs
```

### Adding a new API endpoint
1. Choose the appropriate file: `api/routes.py` (listings/batches) or `api/profiles.py` (profiles/settings)
2. Define an async function with FastAPI decorators
3. Use `Depends(get_db)` for DB sessions
4. Broadcast via `ws_manager.broadcast(...)` if clients need live updates
5. Add a corresponding wrapper in `frontend/src/lib/api.js`

### Adding a new profile field
1. Update `seed/profiles.json` for built-in profiles (new `fields` entry)
2. The `struct_prompt` must instruct Ollama to return that key
3. The field will automatically appear in `FieldsEditor` on the review page

### Modifying the pipeline
All 6 stages are sequential async functions in `workers/pipeline.py`. Each stage updates the listing status and broadcasts a WS message. Follow the existing pattern: update DB → broadcast → proceed.

---

## Key Conventions

### Backend
- **Async throughout**: All DB calls use `await session.execute(...)`. Never use sync SQLAlchemy calls.
- **Dependency injection**: DB sessions via `async def get_db()` with `Depends`.
- **Background tasks**: Expensive work (pipeline) uses FastAPI `BackgroundTasks`, not threads.
- **UUIDs as strings**: `str(uuid.uuid4())` for all PKs.
- **JSONColumn**: Use for any field that is a dict or list; never manually serialize to JSON string in route code.
- **Built-in profiles**: `is_builtin=True` profiles in `seed/profiles.json` are seeded at startup and cannot be deleted via API.

### Frontend
- **All API calls through `src/lib/api.js`**: No raw `fetch` in components.
- **CSS variables only**: Reference `--gold`, `--bg`, etc. from `styles.css`; no hardcoded colors.
- **Mobile-first routing**: The root `/` redirect checks `window.innerWidth` and routes accordingly.
- **WebSocket state**: Live state is managed in `useBatches`; don't create additional WS connections.
- **No TypeScript**: The project uses plain JavaScript/JSX throughout.
- **No test framework**: No unit or integration tests currently exist. Test manually via UI or `/docs`.

### Git
- Main branch: `master`
- Feature development: use `claude/` prefixed branches as directed

---

## Built-in Profiles

Three profiles are seeded from `backend/seed/profiles.json`:

| Profile | Icon | eBay Category ID |
|---------|------|-----------------|
| Funko Pop! Vinyl | 🎯 | 149372 |
| Hot Wheels Die-cast | 🚗 | 31911 |
| Trading Cards | 🃏 | 183454 |

These are `is_builtin=True` and cannot be deleted, but can be edited and duplicated.

---

## CSV Export Format

`GET /api/export/csv` produces an eBay File Exchange / Bulk Listing format:

- Fixed columns: `Action`, `Category`, `Title`, `Description`, `StartPrice`, `BestOfferPrice`, `BestOfferEnabled`, `Condition`, `ConditionDescription`, `Quantity`, `Format`, `Duration`, `PicURL`, `GalleryType`
- Shipping columns: `ShippingService-1:Option`, `ShippingService-1:Cost`, etc.
- Package columns: `WeightMajor`, `WeightMinor`, `PackageDepth`, `PackageWidth`, `PackageLength`
- Dynamic profile field columns: prefixed `C:` (e.g., `C:Series`, `C:Character`)

Condition ID mapping: `New` → `1000`, `Used` → `3000`, otherwise `7000`.

Photo URLs are included only when `SERVER_BASE_URL` is configured.
