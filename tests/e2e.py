#!/usr/bin/env python3
"""
EbayLister E2E Test Script
---------------------------

Drives the full capture → pipeline → review → (optional) approve flow
in a real Chromium browser so you can watch it work.

Setup (first time only):
    pip install playwright httpx
    playwright install chromium

Usage:
    # Drop 1-3 photos into tests/images/, then:
    python tests/e2e.py --hint "Funko Pop Spider-Man #1"
    python tests/e2e.py --hint "Hot Wheels Camaro" --approve
    python tests/e2e.py --hint "" --headless --timeout 300
    python tests/e2e.py --hint "Trading Card" --url http://192.168.2.10:3000
"""

import argparse
import asyncio
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx
from playwright.async_api import async_playwright

TESTS_DIR = Path(__file__).parent
IMAGES_DIR = TESTS_DIR / "images"
SCREENSHOTS_DIR = TESTS_DIR / "screenshots"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


# ── Helpers ─────────────────────────────────────────────────────────────────

def find_images() -> list[Path]:
    if not IMAGES_DIR.exists():
        return []
    return sorted(p for p in IMAGES_DIR.iterdir() if p.suffix.lower() in IMAGE_EXTENSIONS)


def log(msg: str, icon: str = "→"):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"  [{ts}] {icon}  {msg}")


def step(n: int, title: str):
    print(f"\n{'─' * 52}")
    print(f"  STEP {n}: {title}")
    print(f"{'─' * 52}")


async def screenshot(page, label: str) -> Path:
    SCREENSHOTS_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = SCREENSHOTS_DIR / f"{label}_{ts}.png"
    await page.screenshot(path=str(path))
    log(f"Screenshot: {path}", "📸")
    return path


# ── Main flow ────────────────────────────────────────────────────────────────

async def run(args):
    frontend_url = args.url.rstrip("/")
    api_base = frontend_url.replace(":3000", ":8000")

    # ── Step 1: Pre-flight ───────────────────────────────────────────────────
    step(1, "Pre-flight checks")

    images = find_images()
    if not images:
        print(f"\n  ❌  No images found in {IMAGES_DIR}")
        print("      Drop .jpg / .jpeg / .png / .webp files there and re-run.\n")
        sys.exit(1)

    log(f"Found {len(images)} image(s) in tests/images/:")
    for img in images:
        log(f"  {img.name}", " ")

    log(f"Checking backend at {api_base} ...")
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{api_base}/api/profiles", timeout=5)
            r.raise_for_status()
            profiles = r.json()
        names = ", ".join(p["name"] for p in profiles)
        log(f"Backend OK — {len(profiles)} profile(s): {names}", "✓")
    except Exception as e:
        print(f"\n  ❌  Backend unreachable: {e}")
        print("      Make sure Docker is running:  docker compose up\n")
        sys.exit(1)

    # ── Step 2: Launch browser ───────────────────────────────────────────────
    step(2, "Launching browser")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=args.headless)
        # iPhone-sized viewport so the capture page looks right
        context = await browser.new_context(viewport={"width": 430, "height": 932})
        page = await context.new_page()

        try:
            batch_id = await _capture(page, frontend_url, api_base, images, args.hint)
            await _wait_pipeline(page, frontend_url, api_base, batch_id, args.timeout)
            await _review(page, api_base, batch_id)
            if args.approve:
                await _approve(page)

            elapsed = time.time() - _START
            log(f"All done in {elapsed:.1f}s", "✅")

            if not args.headless and not args.approve:
                log("Browser left open — press Ctrl+C when finished", "👀")
                try:
                    await asyncio.sleep(9999)
                except (asyncio.CancelledError, KeyboardInterrupt):
                    pass

        except Exception as exc:
            log(f"FAILED: {exc}", "❌")
            await screenshot(page, "failure")
            await browser.close()
            sys.exit(1)

        await browser.close()


_START = time.time()


# ── Sub-steps ────────────────────────────────────────────────────────────────

async def _capture(page, frontend_url: str, api_base: str, images: list[Path], hint: str) -> str:
    """Navigate to /capture, fill the form, submit, return the new batch_id."""
    step(3, "Capture page — uploading photos")

    await page.goto(f"{frontend_url}/capture")
    await page.wait_for_load_state("networkidle")
    log("Page loaded")

    if hint:
        await page.get_by_placeholder("What is this?", exact=False).fill(hint)
        log(f"Hint: {hint!r}")

    file_input = page.locator('input[type="file"]')
    await file_input.set_input_files([str(img) for img in images])
    log(f"Attached {len(images)} image(s)")

    submit_btn = page.get_by_role("button", name=re.compile(r"Submit \d+ Photo"))
    await submit_btn.wait_for(state="visible", timeout=5_000)
    await submit_btn.click()
    log("Form submitted")

    await page.get_by_text("QUEUED!", exact=False).wait_for(timeout=10_000)
    log("Got QUEUED! confirmation ✓")

    # Grab batch_id from the API — most recent batch is ours
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{api_base}/api/batches", timeout=5)
        r.raise_for_status()
        batches = r.json()

    batch_id = batches[0]["id"]
    log(f"Batch ID: {batch_id}")
    return batch_id


async def _wait_pipeline(page, frontend_url: str, api_base: str, batch_id: str, timeout: int):
    """Click 'View Queue', then poll the API until the pipeline finishes."""
    step(4, "Dashboard — waiting for pipeline")

    await page.get_by_text("View Queue").click()
    await page.wait_for_url(f"{frontend_url}/dashboard", timeout=8_000)
    await page.wait_for_load_state("networkidle")
    log("Dashboard loaded")

    log(f"Polling pipeline (up to {timeout}s) ...")
    last_step = None
    deadline = time.time() + timeout

    async with httpx.AsyncClient() as client:
        while time.time() < deadline:
            r = await client.get(f"{api_base}/api/batches/{batch_id}", timeout=5)
            r.raise_for_status()
            batch = r.json()

            current_step = batch.get("step") or batch.get("status", "")
            if current_step != last_step:
                log(current_step)
                last_step = current_step

            if batch["status"] == "done":
                elapsed = time.time() - _START
                log(f"Pipeline complete in {elapsed:.1f}s ✓")
                return

            if batch["status"] == "error":
                listing = batch.get("listing_summary") or {}
                err = listing.get("error") or batch.get("step") or "unknown error"
                raise RuntimeError(f"Pipeline error: {err}")

            await asyncio.sleep(3)

    raise TimeoutError(f"Pipeline did not complete within {timeout}s")


async def _review(page, api_base: str, batch_id: str):
    """Click the batch card in the sidebar and print extracted results."""
    step(5, "Review panel")

    # Wait for the REVIEW badge, then click its parent batch-card button
    review_badge = page.locator(".badge-needs_review").first()
    await review_badge.wait_for(state="visible", timeout=10_000)
    log("REVIEW badge visible ✓")

    batch_card = page.locator("button:has(.badge-needs_review)").first()
    await batch_card.click()
    log("Batch card clicked")

    # Wait for review panel
    approve_btn = page.get_by_role("button", name=re.compile(r"Approve", re.IGNORECASE))
    await approve_btn.wait_for(state="visible", timeout=10_000)
    log("Review panel loaded ✓")

    # Pull full listing data from API and print a summary
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{api_base}/api/batches/{batch_id}", timeout=5)
        r.raise_for_status()
        batch = r.json()

    listing = batch.get("listing") or {}
    if listing:
        print()
        print(f"  {'Title':<14} {listing.get('title', '—')}")
        print(f"  {'Price':<14} CA${listing.get('price', 0):.2f}")
        print(f"  {'Confidence':<14} {listing.get('confidence', '—')}%")
        print(f"  {'Condition':<14} {listing.get('condition', '—')}")
        extracted = listing.get("extracted_data") or {}
        if extracted:
            print(f"  {'Extracted':<14}")
            for k, v in extracted.items():
                if v:
                    print(f"    {k}: {v}")
        print()


async def _approve(page):
    """Click Approve & Save and wait for the APPROVED badge."""
    step(6, "Approving listing")

    approve_btn = page.get_by_role("button", name=re.compile(r"Approve", re.IGNORECASE))
    await approve_btn.click()
    log("Approve clicked")

    approved_badge = page.locator(".badge-approved").first()
    await approved_badge.wait_for(state="visible", timeout=10_000)
    log("Listing approved ✓", "✅")


# ── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="EbayLister E2E test — reads images from tests/images/",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--hint", default="", metavar="TEXT",
                        help="Item hint for the AI (e.g. 'Funko Pop Spider-Man #1')")
    parser.add_argument("--url", default="http://localhost:3000", metavar="URL",
                        help="Frontend base URL (default: http://localhost:3000)")
    parser.add_argument("--timeout", type=int, default=180, metavar="SECS",
                        help="Pipeline timeout in seconds (default: 180)")
    parser.add_argument("--approve", action="store_true",
                        help="Auto-approve the listing after review")
    parser.add_argument("--headless", action="store_true",
                        help="Run without a visible browser window")

    args = parser.parse_args()

    global _START
    _START = time.time()

    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        print("\n  Interrupted.")


if __name__ == "__main__":
    main()
