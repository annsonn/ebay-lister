# EbayLister

A self-hosted, Docker-based eBay listing tool. Photograph items at your photo booth from your phone, let the AI identify and research them, review and approve on your desktop, then export a bulk CSV for eBay Seller Hub.

Designed for Funko Pops out of the box — expandable to any category via configurable profiles.

---

## How it works

```
📱 Phone                    🖥 Server                        🖥 Desktop
────────────────────────────────────────────────────────────────────
Take photos → submit
  │
  ├─ Upload photos ───────► Save to NAS
  │                          Create batch + listing
  │                          Queue AI pipeline
  │◄─ "Queued!" ──────────┤
  │                          │
"Queued!" screen             ├─ Preprocess images
                             ├─ Ollama OCR pass
                             ├─ Ollama structured extraction
                             ├─ eBay price research
                             ├─ Generate title + copy
                             └─ Persist → "needs_review"
                                                         │
                                         Dashboard updates live ◄┘
                                         Click item → review form
                                         Edit fields if needed
                                         "Approve & Save"
                                              │
                                    Export bulk CSV
                                    Upload to Seller Hub
```

---

## Requirements

- **Docker Desktop** for Windows — [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
- **Ollama** running on your Unraid server with `qwen2.5vl:7b` pulled
- Photos are stored locally — no public hosting needed to use the app

---

## Quick Start (local desktop via Docker)

### 1. Clone the repo

```bash
git clone https://github.com/yourname/ebay-lister.git
cd ebay-lister
```

### 2. Create `.env`

Create a `.env` file in the project root:

```bash
# Point at Ollama on your Unraid server
OLLAMA_HOST=http://192.168.1.x:11434
OLLAMA_MODEL=qwen2.5vl:7b

# Local paths for photos and database (created automatically)
NAS_PHOTOS_PATH=./data/photos
NAS_DB_PATH=./data/db

# Photo hosting — leave blank for now, set when ready to publish listings
# SERVER_BASE_URL=https://your-tunnel.example.com
```

Replace `192.168.1.x` with your Unraid server's LAN IP.

### 3. Build and start

```bash
docker compose up --build
```

First build takes a few minutes. After that, `docker compose up` starts in seconds.

This starts two containers:
| Container | Port | Description |
|-----------|------|-------------|
| `backend` | 8000 | FastAPI + AI pipeline |
| `frontend` | 3000 | React app (nginx) |

### 4. Open the app

| Interface | URL | Device |
|-----------|-----|--------|
| Dashboard | `http://localhost:3000/dashboard` | Desktop |
| Capture | `http://localhost:3000/capture` | Desktop or phone (use your LAN IP) |
| Settings | `http://localhost:3000/settings` | Desktop |
| API docs | `http://localhost:8000/docs` | Dev |

On first load, `/` auto-redirects: mobile → `/capture`, desktop → `/dashboard`.

**iPhone shortcut:** Open `http://YOUR_DESKTOP_IP:3000/capture` in Safari → Share → "Add to Home Screen". Opens full-screen like an app.

### 5. Stopping and restarting

```bash
# Stop
docker compose down

# Start again (no rebuild needed)
docker compose up

# Rebuild after code changes
docker compose up --build
```

---

## Ollama Setup

EbayLister connects to your existing Ollama instance over HTTP — it does not run its own.

### Pull the vision model

Run this once on your Unraid server (~5.5 GB download):

```bash
# In a Unraid terminal or SSH session
ollama pull qwen2.5vl:7b
```

Or via the Ollama Docker container on Unraid:

```bash
docker exec <ollama-container-name> ollama pull qwen2.5vl:7b
```

### Pointing the backend at Unraid Ollama

Set `OLLAMA_HOST` in your `.env` to your Unraid server's LAN IP:

```bash
OLLAMA_HOST=http://192.168.1.x:11434
```

You can also update it at runtime without restarting Docker: open `/settings → General → Ollama Host`.

### Verify Ollama is reachable

From your desktop, run:

```bash
curl http://192.168.1.x:11434/api/tags
```

You should get a JSON list of pulled models. If this fails, check that Ollama's Docker container on Unraid has port 11434 published to the host.

---

## Unraid Setup

### First-time setup

1. Install **Docker Compose Manager** from Community Applications
2. Create directories on your NAS:
   ```
   /mnt/user/appdata/ebaylister/
   ├── photos/
   ├── db/
   └── app/          ← clone the repo here
   ```
3. Configure `.env`:
   ```bash
   NAS_PHOTOS_PATH=/mnt/user/appdata/ebaylister/photos
   NAS_DB_PATH=/mnt/user/appdata/ebaylister/db
   # Point at your Ollama — use the server's LAN IP from inside Docker
   OLLAMA_HOST=http://192.168.1.YOUR_IP:11434
   ```
4. Start:
   ```bash
   cd /mnt/user/appdata/ebaylister/app
   docker compose up -d
   ```

> **Note:** On Unraid, `host.docker.internal` may not resolve automatically. Use your server's actual LAN IP for `OLLAMA_HOST` instead.

---

## Usage

### Taking photos

1. Open `/capture` on your phone
2. Select a profile (Funko Pop, Hot Wheels, Trading Cards, or a custom one)
3. Optional: add a label (e.g. "Lot 42")
4. Take/add photos — tips shown on screen:
   - Front of box (cover photo)
   - Back of box
   - Top — shows box number
   - Exclusive sticker (if any)
   - Any condition issues
5. Tap **Submit** — you'll see "QUEUED!" and the AI starts processing

### Reviewing listings

1. Open `/dashboard` on your desktop
2. The queue updates live as items process
3. Click an item with **REVIEW** status
4. Check all fields — modified fields highlight in blue
5. Adjust price, condition, shipping, etc.
6. Click **✓ Approve & Save**

If the AI got it wrong, correct the identification fields and click **⟳ Re-run Research** to regenerate the title and fetch new prices.

### Exporting to eBay

1. In the dashboard header, click **↓ Export CSV** (enabled when you have approved listings)
2. Save the downloaded `.csv` file
3. In eBay Seller Hub: **Listings → Bulk Edit & Upload → Upload listings file**
4. Upload the CSV — eBay will preview and confirm before publishing

---

## Configuration

### Environment variables (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | URL of your Ollama instance |
| `OLLAMA_MODEL` | `qwen2.5vl:7b` | Ollama vision model to use |
| `NAS_PHOTOS_PATH` | `./data/photos` | Where uploaded photos are stored on the host |
| `NAS_DB_PATH` | `./data/db` | Where the SQLite database lives on the host |
| `SERVER_BASE_URL` | *(blank)* | Public URL for photo links in CSV — leave unset until ready to publish |

### In-app settings (`/settings → General`)

The same settings can also be changed at runtime in the Settings page without restarting Docker.

---

## Profiles

A **Profile** tells the pipeline everything it needs to process a category of item — prompts, field schema, eBay category, shipping defaults, and package dimensions.

### Built-in profiles

| Profile | eBay Category | Default weight |
|---------|--------------|----------------|
| 🎯 Funko Pop! Vinyl | 149372 | 450 g |
| 🚗 Hot Wheels Die-cast | 31911 | 100 g |
| 🃏 Trading Cards | 183454 | 50 g |

Built-in profiles cannot be deleted but can be duplicated and customised.

### Creating a custom profile

1. Go to `/settings → Profiles`
2. Click **+ New Profile** (or **Duplicate** an existing one)
3. Fill in:
   - **Basic** — name, eBay category ID, brand, condition default
   - **Pass 1 prompt** — instructions to extract all raw text from photos
   - **Pass 2 prompt** — instructions to parse the structured fields (the JSON schema is auto-appended)
   - **Fields** — drag-and-drop list of fields the AI should extract; each field maps to a `C:` column in the eBay CSV
   - **Defaults** — package dimensions, price search template, shipping defaults
4. Use **Test with last batch** on each prompt to tune without reprocessing

### eBay price research

The pipeline automatically scrapes eBay's public sold listings page for recent prices — no API key required. It searches for your item by interpolating the profile's **Price Search Template** with the extracted field values, then parses the sold prices and returns a trimmed average.

If the scrape returns no results (e.g. very obscure item or network issue), prices fall back to a randomised placeholder ($10–$35) that you can adjust manually before approving.

`EBAY_APP_ID` / `EBAY_CLIENT_SECRET` in `.env` are no longer used and can be left empty.

---

## Development

For active development with hot reload, run the backend and frontend directly instead of through Docker.

### Backend (hot reload)

```bash
source ~/venv312/Scripts/activate
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

The backend reads `backend/.env` automatically. API docs at `http://localhost:8000/docs`.

### Frontend (hot reload)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` and `/ws` to `localhost:8000` automatically — no CORS config needed.

### Docker (production-like)

```bash
docker compose up --build
```

Open `http://localhost:3000`.

---

## Project Structure

```
ebaylister/
├── docker-compose.yml
├── .env.example
│
├── backend/
│   ├── main.py                    # FastAPI app, lifespan, CORS, WS endpoint
│   ├── requirements.txt
│   ├── Dockerfile
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
        ├── styles.css             # Design system CSS variables
        ├── lib/api.js             # All fetch calls + WebSocket factory
        ├── hooks/
        │   ├── useWebSocket.js    # WS connection hook
        │   └── useBatches.js      # Batch list state + live updates
        ├── components/
        │   ├── StatusBadge.jsx
        │   ├── PhotoStrip.jsx
        │   ├── FieldInput.jsx
        │   ├── ShippingSection.jsx
        │   ├── ProfilePill.jsx
        │   ├── PromptEditor.jsx
        │   ├── FieldsEditor.jsx
        │   └── Toast.jsx
        └── views/
            ├── CapturePage.jsx
            ├── DashboardPage.jsx
            ├── ReviewPanel.jsx
            ├── ReviewPage.jsx
            └── SettingsPage.jsx
```

---

## Shipping

Defaults are Canada Post consumer rates (CAD), effective June 2025, assuming ~450 g packed weight.

| Zone | Default service | Default price |
|------|----------------|---------------|
| 🇨🇦 Domestic | Expedited Parcel | CA$16.00 |
| 🇺🇸 USA | Tracked Packet USA | CA$17.00 |
| 🌍 International | Tracked Packet Intl | CA$35.00 |

All rates can be overridden per-profile and per-listing. A 19.5% fuel surcharge currently applies on top of base rates. Verify current prices at [canadapost.ca/prices](https://www.canadapost-postescanada.ca/cpc/en/tools/find-a-rate.page).
