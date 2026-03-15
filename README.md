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

- **Docker** and **Docker Compose** (v2)
- **Ollama** running separately with the `qwen2.5vl:7b` model pulled (see [Ollama Setup](#ollama-setup))
- Network access from eBay's servers to your machine (for photo URLs in CSV) — see [Photo URL Access](#photo-url-access)

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/yourname/ebay-lister.git
cd ebay-lister
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Your server's local IP (for accessing the app)
SERVER_BASE_URL=http://192.168.1.100:8000

# Paths where photos and the database will be stored
NAS_PHOTOS_PATH=./data/photos
NAS_DB_PATH=./data/db

# Optional: eBay API keys for live price research
EBAY_APP_ID=
EBAY_CLIENT_SECRET=
```

### 3. Start the stack

```bash
docker compose up -d
```

This starts two services:
| Service | Port | Description |
|---------|------|-------------|
| `frontend` | 3000 | React web app (nginx) |
| `backend` | 8000 | FastAPI + AI pipeline |

### 4. Open the app

| Interface | URL | Device |
|-----------|-----|--------|
| Capture (take photos) | `http://YOUR_IP:3000/capture` | Phone |
| Dashboard (review queue) | `http://YOUR_IP:3000/dashboard` | Desktop |
| Settings | `http://YOUR_IP:3000/settings` | Desktop |
| API docs | `http://YOUR_IP:8000/docs` | Dev |

On first load, `/` auto-redirects: mobile → `/capture`, desktop → `/dashboard`.

**iPhone shortcut:** In Safari → Share → "Add to Home Screen" → name it "EbayLister". Opens full-screen like an app.

---

## Ollama Setup

EbayLister expects Ollama to already be running. It connects to it over HTTP.

### Pull the vision model

Run this once on your Ollama host (~5.5 GB download):

```bash
ollama pull qwen2.5vl:7b
```

### Pointing the backend at your Ollama

By default the backend uses `http://host.docker.internal:11434`, which resolves to the host machine from inside Docker. This works on **Docker Desktop** (Mac/Windows) and on **Linux with Docker Engine** (the `extra_hosts` entry in `docker-compose.yml` handles it).

If your Ollama runs on a different machine, set `OLLAMA_HOST` in `.env`:

```bash
OLLAMA_HOST=http://192.168.1.50:11434
```

You can also change it at runtime in the app at `/settings → General → Ollama Host` without restarting Docker.

### Verify the connection

```bash
curl http://localhost:11434/api/tags
```

You should see a JSON list of your pulled models. If the backend can't reach Ollama, pipeline jobs will fail with a connection error visible in the dashboard.

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
   SERVER_BASE_URL=http://192.168.1.YOUR_IP:8000
   # Point at your existing Ollama — use the host's LAN IP from inside Docker
   OLLAMA_HOST=http://192.168.1.YOUR_IP:11434
   ```
4. Start:
   ```bash
   cd /mnt/user/appdata/ebaylister/app
   docker compose up -d
   ```

> **Note:** On Unraid, `host.docker.internal` may not resolve automatically. Use your server's actual LAN IP for `OLLAMA_HOST` instead.

---

## Photo URL Access

eBay's servers need to fetch your photos when you import the CSV. Your backend (port 8000) must be reachable from the internet.

**Options (pick one):**

| Method | Difficulty | Notes |
|--------|-----------|-------|
| Port-forward | Easy | Forward port 8000 on your router to your server. Set `SERVER_BASE_URL=http://YOUR_PUBLIC_IP:8000` |
| Cloudflare Tunnel | Recommended | No open ports. Install `cloudflared`, create a tunnel → `localhost:8000`. Set `SERVER_BASE_URL=https://your-tunnel.trycloudflare.com` |
| Tailscale | Easy (if using it) | Works if you upload from a device on your Tailnet. Use your Tailscale IP. |

Set `SERVER_BASE_URL` in `.env` (or the Settings page in the app) to match.

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
| `NAS_PHOTOS_PATH` | `./data/photos` | Where uploaded photos are stored |
| `NAS_DB_PATH` | `./data/db` | Where the SQLite database lives |
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | URL of your existing Ollama instance |
| `OLLAMA_MODEL` | `qwen2.5vl:7b` | Ollama vision model to use |
| `SERVER_BASE_URL` | `http://localhost:8000` | Public URL for photo links in CSV |
| `EBAY_APP_ID` | *(empty)* | eBay Browse API app ID (enables live pricing) |
| `EBAY_CLIENT_SECRET` | *(empty)* | eBay Browse API secret |

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

If `EBAY_APP_ID` and `EBAY_CLIENT_SECRET` are set, the pipeline calls the eBay Browse API to fetch recent sold prices. Without keys, prices are a randomised placeholder ($10–$35) — you'll want to adjust them manually before approving.

Get free API credentials at [developer.ebay.com](https://developer.ebay.com/).

---

## Development

### Backend only

```bash
cd backend
pip install -r requirements.txt
# Needs a running Ollama (or set OLLAMA_HOST to point elsewhere)
uvicorn main:app --reload
```

API docs available at `http://localhost:8000/docs`.

### Frontend only

```bash
cd frontend
npm install
npm run dev   # proxies /api → localhost:8000
```

### Full stack (local, no Docker)

Run Ollama natively, then start backend and frontend as above.

### Full stack (Docker)

```bash
docker compose up --build
```

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
