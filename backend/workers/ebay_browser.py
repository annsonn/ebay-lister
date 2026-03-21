"""
eBay listing submission via Playwright browser automation.

Opens a real Chromium window (headless=False) so the user can watch the form
being filled and intervene if needed.  Session cookies are saved to
COOKIES_PATH so the one-time manual login is only needed once.

Public API
----------
get_session_status()        -> {logged_in, username}
open_login_browser()        -> {success, username, error}
submit_listing(...)         -> {success, draft_url, error}
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)

COOKIES_PATH = Path("/data/ebay_session.json")
EBAY_HOME = "https://www.ebay.com"
EBAY_SIGNIN = "https://signin.ebay.com/ws/eBayISAPI.dll?SignIn&ru=https://www.ebay.com/"
LOGIN_WAIT_SECONDS = 300  # up to 5 minutes for the user to complete manual login

CONDITION_MAP = {"New": "1000", "Used": "3000", "Not specified": "7000"}


# ── Playwright import guard ────────────────────────────────────────────────────

def _require_playwright():
    try:
        from playwright.async_api import async_playwright  # noqa: F401
    except ImportError:
        raise RuntimeError(
            "Playwright is not installed. Run: pip install playwright && playwright install chromium"
        )


# ── Cookie helpers ─────────────────────────────────────────────────────────────

async def _load_cookies(context) -> None:
    if COOKIES_PATH.exists():
        try:
            with open(COOKIES_PATH) as f:
                cookies = json.load(f)
            await context.add_cookies(cookies)
        except Exception:
            pass  # stale or corrupt file — ignore


async def _save_cookies(context) -> None:
    COOKIES_PATH.parent.mkdir(parents=True, exist_ok=True)
    cookies = await context.cookies()
    with open(COOKIES_PATH, "w") as f:
        json.dump(cookies, f)


def _browser_options(headless: bool = False) -> dict:
    return {
        "headless": headless,
        "args": ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    }


def _context_options() -> dict:
    return {
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1280, "height": 900},
        "locale": "en-US",
    }


# ── Login state detection ──────────────────────────────────────────────────────

async def _check_logged_in(page) -> dict:
    """Navigate to ebay.com and check whether a user session is active."""
    try:
        await page.goto(EBAY_HOME, wait_until="domcontentloaded", timeout=20000)
        await page.wait_for_timeout(1500)

        # Guest indicator: sign-in link visible
        guest = page.locator(
            '[data-testid="gh-ug-guest"], a[href*="SignIn"], a:has-text("Sign in")'
        )
        if await guest.count() > 0:
            # Double-check: My eBay link means logged in despite sign-in link style
            my_ebay = page.locator('a[href*="myebay"], a:has-text("My eBay")')
            if await my_ebay.count() == 0:
                return {"logged_in": False, "username": None}

        # Try to extract username
        username: Optional[str] = None
        for sel in [
            '[data-testid="gh-ug-ms"]',
            '[data-testid="gh-ug-ms-userinfo"]',
            ".gh-ug-guest-links + span",
        ]:
            el = page.locator(sel).first
            if await el.count() > 0:
                text = (await el.text_content() or "").strip()
                if text:
                    username = text
                    break

        # Last resort: look for "Hi, <name>" text
        if not username:
            hi_el = page.locator("text=/^Hi,/")
            if await hi_el.count() > 0:
                username = (await hi_el.first.text_content() or "").strip()

        return {"logged_in": True, "username": username}

    except Exception as e:
        logger.warning("_check_logged_in error: %s", e)
        return {"logged_in": False, "username": None}


# ── Public: session status ─────────────────────────────────────────────────────

async def get_session_status() -> dict:
    """Return {logged_in: bool, username: str|None}. Uses saved cookies."""
    _require_playwright()
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(**_browser_options(headless=True))
        context = await browser.new_context(**_context_options())
        await _load_cookies(context)
        page = await context.new_page()
        try:
            return await _check_logged_in(page)
        finally:
            await browser.close()


# ── Public: one-time manual login ─────────────────────────────────────────────

async def open_login_browser() -> dict:
    """
    Open a visible Chromium window at eBay's sign-in page.
    Waits up to LOGIN_WAIT_SECONDS for the user to complete login (including 2FA).
    Saves session cookies on success.
    Returns {success, username, error}.
    """
    _require_playwright()
    from playwright.async_api import async_playwright, TimeoutError as PWTimeout

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(**_browser_options(headless=False))
        context = await browser.new_context(**_context_options())
        page = await context.new_page()
        try:
            await page.goto(EBAY_SIGNIN, wait_until="domcontentloaded", timeout=20000)

            # Wait for the user to leave the signin domain (login completed)
            try:
                await page.wait_for_url(
                    "**/ebay.com/**",
                    wait_until="domcontentloaded",
                    timeout=LOGIN_WAIT_SECONDS * 1000,
                )
                # Extra settle time for cookies to be set
                await page.wait_for_timeout(2000)
            except PWTimeout:
                return {"success": False, "username": None, "error": "Login timed out after 5 minutes."}

            # Verify the session is actually valid
            status = await _check_logged_in(page)
            if not status["logged_in"]:
                return {"success": False, "username": None, "error": "Login did not complete successfully."}

            await _save_cookies(context)
            return {"success": True, "username": status["username"], "error": None}

        except Exception as e:
            return {"success": False, "username": None, "error": str(e)}
        finally:
            await browser.close()


# ── Public: submit listing ────────────────────────────────────────────────────

async def submit_listing(
    listing: dict,
    photo_paths: list,
    on_progress: Optional[Callable] = None,
) -> dict:
    """
    Fill eBay's Create Listing form using listing data and local photo files.
    Opens a visible browser window.  Saves as draft and returns the draft URL.

    Returns {success, draft_url, error}.
    """
    _require_playwright()
    from playwright.async_api import async_playwright, TimeoutError as PWTimeout

    async def progress(msg: str):
        logger.info("eBay submit: %s", msg)
        if on_progress:
            try:
                await on_progress(msg)
            except Exception:
                pass

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(**_browser_options(headless=False))
        context = await browser.new_context(**_context_options())
        await _load_cookies(context)
        page = await context.new_page()

        try:
            # ── 1. Verify session ──────────────────────────────────────────────
            await progress("Checking eBay session…")
            status = await _check_logged_in(page)
            if not status["logged_in"]:
                return {
                    "success": False,
                    "draft_url": None,
                    "error": (
                        "Not logged in to eBay. "
                        "Go to Settings → General and click 'Connect eBay Account' first."
                    ),
                }

            # ── 2. Navigate to listing form ───────────────────────────────────
            await progress("Opening eBay listing form…")
            category_id = listing.get("category_id", "")
            sell_url = (
                f"https://www.ebay.com/sl/list?mode=AddItem"
                f"&categoryId={category_id}"
            )
            await page.goto(sell_url, wait_until="networkidle", timeout=40000)
            await page.wait_for_timeout(2000)

            # ── 3. Photos ─────────────────────────────────────────────────────
            existing_photos = [p for p in photo_paths if os.path.exists(p)]
            if existing_photos:
                await progress(f"Uploading {len(existing_photos)} photo(s)…")
                await _upload_photos(page, existing_photos)

            # ── 4. Title ──────────────────────────────────────────────────────
            await progress("Filling title…")
            await _fill_field(page, listing.get("title", ""), [
                '[data-testid="listing-title-input"]',
                'input[name="title"]',
                "#listingTitle",
                'input[placeholder*="title" i]',
                'input[aria-label*="title" i]',
            ])

            # ── 5. Condition ──────────────────────────────────────────────────
            await progress("Setting condition…")
            await _select_condition(page, listing.get("condition", "Used"))

            # ── 6. Description ────────────────────────────────────────────────
            await progress("Filling description…")
            await _fill_description(page, listing.get("description", ""))

            # ── 7. Price ──────────────────────────────────────────────────────
            await progress("Setting price…")
            price = listing.get("price") or 0
            await _fill_field(page, f"{price:.2f}", [
                '[data-testid="start-price"]',
                'input[name="BIN_PRICE"]',
                "#prcIput",
                'input[placeholder*="price" i]',
                'input[aria-label*="price" i]',
            ])

            # ── 8. Best Offer ─────────────────────────────────────────────────
            if listing.get("best_offer"):
                await progress("Enabling Best Offer…")
                await _fill_best_offer(page, listing)

            # ── 9. Quantity ───────────────────────────────────────────────────
            qty = listing.get("quantity", 1)
            if qty and qty != 1:
                await _fill_field(page, str(qty), [
                    '[data-testid="quantity-input"]',
                    'input[name="quantity"]',
                    "#qtyInput",
                ])

            # ── 10. SKU ───────────────────────────────────────────────────────
            sku = listing.get("sku", "")
            if sku:
                await _fill_field(page, sku, [
                    '[data-testid="custom-label-input"]',
                    'input[name="customLabel"]',
                    "#customLabel",
                ])

            # ── 11. Save as draft ─────────────────────────────────────────────
            await progress("Saving as draft…")
            await _save_draft(page)
            await _save_cookies(context)

            draft_url = page.url
            await progress("Draft saved! Open the link to review and publish.")
            return {"success": True, "draft_url": draft_url, "error": None}

        except PWTimeout as e:
            return {
                "success": False,
                "draft_url": None,
                "error": f"Timed out while interacting with eBay: {str(e)[:200]}",
            }
        except Exception as e:
            logger.exception("eBay submit error")
            return {
                "success": False,
                "draft_url": None,
                "error": f"Automation error: {str(e)[:300]}",
            }
        finally:
            await browser.close()


# ── Form helpers ───────────────────────────────────────────────────────────────

async def _fill_field(page, value: str, selectors: list, timeout: int = 5000) -> bool:
    """Try each selector in order; fill the first visible one. Returns True on hit."""
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if await el.count() == 0:
                continue
            await el.wait_for(state="visible", timeout=timeout)
            await el.clear()
            await el.fill(str(value))
            return True
        except Exception:
            continue
    return False


async def _upload_photos(page, photo_paths: list) -> None:
    """Upload photos via eBay's hidden file input."""
    file_selectors = [
        'input[type="file"][accept*="image"]',
        '[data-testid="photo-uploader"] input[type="file"]',
        'input[type="file"]',
    ]
    for sel in file_selectors:
        try:
            el = page.locator(sel).first
            if await el.count() == 0:
                continue
            await el.set_input_files(photo_paths[:12])  # eBay max 12
            await page.wait_for_timeout(4000)           # wait for uploads
            return
        except Exception:
            continue


async def _select_condition(page, condition: str) -> None:
    """Select condition via dropdown or radio buttons."""
    cond_id = CONDITION_MAP.get(condition, "3000")

    # Try select element first
    for sel in ['select[name="conditionId"]', "#condSel", 'select[id*="cond" i]']:
        try:
            el = page.locator(sel).first
            if await el.count() == 0:
                continue
            await el.select_option(value=cond_id)
            return
        except Exception:
            continue

    # Try clicking labelled radio/button
    for sel in [
        f'[data-testid*="condition"][value="{cond_id}"]',
        f'input[value="{cond_id}"]',
        f'label:has-text("{condition}")',
        f'button:has-text("{condition}")',
    ]:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.click()
                return
        except Exception:
            continue


async def _fill_description(page, description: str) -> None:
    """Fill the description field (textarea or iframe-based rich editor)."""
    # Plain textarea
    for sel in [
        'textarea[name="description"]',
        '[data-testid="description-input"]',
        "#desc",
        'textarea[placeholder*="description" i]',
    ]:
        try:
            el = page.locator(sel).first
            if await el.count() == 0:
                continue
            await el.wait_for(state="visible", timeout=5000)
            await el.fill(description)
            return
        except Exception:
            continue

    # CKEditor / TinyMCE iframe body
    try:
        frame = page.frame_locator(
            'iframe[title*="editor" i], iframe[id*="cke" i], iframe[id*="mce" i]'
        ).first
        body = frame.locator("body")
        if await body.count() > 0:
            await body.fill(description)
    except Exception:
        pass


async def _fill_best_offer(page, listing: dict) -> None:
    """Enable Best Offer toggle and optionally fill auto-accept/decline thresholds."""
    try:
        toggle = page.locator(
            '[data-testid="best-offer-toggle"], '
            'input[name="bestOfferEnabled"], '
            "#bestOfferCheck"
        ).first
        if await toggle.count() > 0:
            if not await toggle.is_checked():
                await toggle.click()
            await page.wait_for_timeout(500)

        accept = listing.get("best_offer_accept")
        if accept:
            await _fill_field(page, f"{accept:.2f}", [
                '[data-testid="best-offer-accept-input"]',
                'input[name="bestOfferAutoAcceptPrice"]',
            ])

        decline = listing.get("best_offer_decline")
        if decline:
            await _fill_field(page, f"{decline:.2f}", [
                '[data-testid="best-offer-decline-input"]',
                'input[name="bestOfferAutoDeclinePrice"]',
            ])
    except Exception:
        pass


async def _save_draft(page) -> bool:
    """Click the 'Save for later' / 'Save as draft' button."""
    for sel in [
        'button:has-text("Save for later")',
        'button:has-text("Save as draft")',
        '[data-testid="save-draft-btn"]',
        '[data-testid="save-for-later"]',
        'a:has-text("Save for later")',
    ]:
        try:
            btn = page.locator(sel).first
            if await btn.count() > 0:
                await btn.click()
                await page.wait_for_timeout(3000)
                return True
        except Exception:
            continue
    return False
