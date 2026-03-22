import csv
import io
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.ws import manager
from models.database import Batch, Listing, Photo, Profile, Setting, get_db
from workers.pipeline import UPDATABLE_LISTING_FIELDS, run_pipeline

router = APIRouter(prefix="/api")

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


def listing_to_dict(listing: Listing) -> dict:
    return {
        "id": listing.id,
        "batch_id": listing.batch_id,
        "profile_id": listing.profile_id,
        "status": listing.status,
        "step": listing.step,
        "error": listing.error,
        "confidence": listing.confidence,
        "approved_at": listing.approved_at.isoformat() if listing.approved_at else None,
        "created_at": listing.created_at.isoformat(),
        "title": listing.title,
        "extracted_data": listing.extracted_data,
        "description": listing.description,
        "condition": listing.condition,
        "condition_note": listing.condition_note,
        "quantity": listing.quantity,
        "category_id": listing.category_id,
        "sku": listing.sku,
        "upc": listing.upc,
        "price": listing.price,
        "price_low": listing.price_low,
        "price_avg": listing.price_avg,
        "price_high": listing.price_high,
        "recent_sales": listing.recent_sales,
        "sell_through": listing.sell_through,
        "best_offer": listing.best_offer,
        "best_offer_accept": listing.best_offer_accept,
        "best_offer_decline": listing.best_offer_decline,
        "shipping": listing.shipping,
        "package_type": listing.package_type,
        "weight_grams": listing.weight_grams,
        "pkg_length_cm": listing.pkg_length_cm,
        "pkg_width_cm": listing.pkg_width_cm,
        "pkg_depth_cm": listing.pkg_depth_cm,
        "ebay_submit_status": listing.ebay_submit_status,
        "ebay_url": listing.ebay_url,
    }


def photo_to_dict(photo: Photo) -> dict:
    return {
        "id": photo.id,
        "batch_id": photo.batch_id,
        "filename": photo.filename,
        "original_name": photo.original_name,
        "order": photo.order,
    }


def batch_to_dict(batch: Batch, include_listing=False, include_photos=False) -> dict:
    d = {
        "id": batch.id,
        "label": batch.label,
        "item_hint": batch.item_hint,
        "profile": {
            "id": batch.profile.id,
            "name": batch.profile.name,
            "icon": batch.profile.icon,
            "slug": batch.profile.slug,
        } if batch.profile else None,
        "created_at": batch.created_at.isoformat(),
        "photo_count": batch.photo_count,
        "status": batch.status,
        "step": batch.step,
    }
    if batch.photos:
        first = batch.photos[0]
        d["first_photo"] = first.filename
    else:
        d["first_photo"] = None
    if batch.listing:
        listing = batch.listing
        d["listing_summary"] = {
            "id": listing.id,
            "status": listing.status,
            "title": listing.title,
            "price": listing.price,
            "confidence": listing.confidence,
            "first_field_value": next(iter(listing.extracted_data.values()), "") if listing.extracted_data else "",
        }
    else:
        d["listing_summary"] = None
    if include_listing and batch.listing:
        d["listing"] = listing_to_dict(batch.listing)
    if include_photos:
        d["photos"] = [photo_to_dict(p) for p in batch.photos]
    return d


# ── Batches ──────────────────────────────────────────────────────────────────

@router.post("/batches")
async def create_batch(
    background_tasks: BackgroundTasks,
    label: Optional[str] = None,
    item_hint: Optional[str] = None,
    profile_id: Optional[str] = None,
    photos: list[UploadFile] = [],
    db: AsyncSession = Depends(get_db),
):
    if not photos or len(photos) < 1:
        raise HTTPException(400, "At least 1 photo required")
    if len(photos) > 12:
        raise HTTPException(400, "Maximum 12 photos per batch")

    for photo in photos:
        ct = photo.content_type or ""
        if ct.lower() not in ALLOWED_TYPES:
            raise HTTPException(400, f"Unsupported file type: {ct}")

    # Resolve profile
    if profile_id:
        profile = await db.get(Profile, profile_id)
        if not profile:
            raise HTTPException(404, "Profile not found")
    else:
        result = await db.execute(select(Profile).where(Profile.is_default == True))
        profile = result.scalar_one_or_none()
        if not profile:
            result = await db.execute(select(Profile).limit(1))
            profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(400, "No profile configured")

    batch_id = str(uuid.uuid4())
    batch = Batch(
        id=batch_id,
        profile_id=profile.id,
        label=label,
        item_hint=item_hint or None,
        status="queued",
        photo_count=len(photos),
    )
    db.add(batch)

    listing_id = str(uuid.uuid4())
    listing = Listing(
        id=listing_id,
        batch_id=batch_id,
        profile_id=profile.id,
        status="pending",
    )
    db.add(listing)

    photo_dir = os.path.join(settings.PHOTOS_DIR, batch_id)
    os.makedirs(photo_dir, exist_ok=True)

    for i, upload in enumerate(photos):
        ext = os.path.splitext(upload.filename or "photo.jpg")[1] or ".jpg"
        file_uuid = str(uuid.uuid4())
        rel_path = f"{batch_id}/{file_uuid}{ext}"
        full_path = os.path.join(settings.PHOTOS_DIR, rel_path)

        content = await upload.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(400, f"File {upload.filename} exceeds 20 MB limit")

        with open(full_path, "wb") as f:
            f.write(content)

        photo = Photo(
            batch_id=batch_id,
            filename=rel_path,
            original_name=upload.filename or "",
            order=i,
        )
        db.add(photo)

    await db.commit()
    background_tasks.add_task(run_pipeline, batch_id, profile.id)
    return {"batch_id": batch_id, "photo_count": len(photos), "status": "queued"}


@router.get("/batches")
async def list_batches(db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Batch)
        .options(
            selectinload(Batch.profile),
            selectinload(Batch.photos),
            selectinload(Batch.listing),
        )
        .order_by(Batch.created_at.desc())
        .limit(100)
    )
    batches = result.scalars().all()
    return [batch_to_dict(b) for b in batches]


@router.get("/batches/{batch_id}")
async def get_batch(batch_id: str, db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Batch)
        .where(Batch.id == batch_id)
        .options(
            selectinload(Batch.profile),
            selectinload(Batch.photos),
            selectinload(Batch.listing),
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(404, "Batch not found")
    return batch_to_dict(batch, include_listing=True, include_photos=True)


# ── Listings ──────────────────────────────────────────────────────────────────

@router.get("/listings")
async def list_listings(
    status: Optional[str] = None,
    profile_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Listing).order_by(Listing.created_at.desc())
    if status:
        q = q.where(Listing.status == status)
    if profile_id:
        q = q.where(Listing.profile_id == profile_id)
    result = await db.execute(q)
    listings = result.scalars().all()
    return [listing_to_dict(l) for l in listings]


@router.get("/listings/{listing_id}")
async def get_listing(listing_id: str, db: AsyncSession = Depends(get_db)):
    listing = await db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")
    return listing_to_dict(listing)


@router.patch("/listings/{listing_id}")
async def update_listing(listing_id: str, updates: dict, db: AsyncSession = Depends(get_db)):
    listing = await db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")
    for key, value in updates.items():
        if key in UPDATABLE_LISTING_FIELDS:
            setattr(listing, key, value)
    await db.commit()
    return listing_to_dict(listing)


@router.post("/listings/{listing_id}/approve")
async def approve_listing(listing_id: str, updates: dict = {}, db: AsyncSession = Depends(get_db)):
    listing = await db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")
    for key, value in updates.items():
        if key in UPDATABLE_LISTING_FIELDS:
            setattr(listing, key, value)
    listing.status = "approved"
    listing.approved_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    await manager.broadcast("listing_approved", {"listing_id": listing_id})
    return {"status": "approved"}


@router.post("/listings/{listing_id}/reprocess")
async def reprocess_listing(
    listing_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    listing = await db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")
    batch = await db.get(Batch, listing.batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")
    listing.status = "processing"
    listing.step = "Queued for reprocessing…"
    listing.error = None
    batch.status = "processing"
    batch.step = "Queued for reprocessing…"
    await db.commit()
    background_tasks.add_task(run_pipeline, batch.id, batch.profile_id)
    return {"status": "processing"}


# ── eBay browser automation ───────────────────────────────────────────────────

@router.get("/ebay/session")
async def ebay_session_status():
    """Return whether a saved eBay session cookie is still valid."""
    from workers.ebay_browser import get_session_status
    return await get_session_status()


@router.post("/ebay/login")
async def ebay_login():
    """
    Open a visible Chromium window so the user can log into eBay manually.
    Blocks until login completes (up to 5 min) then saves session cookies.
    """
    from workers.ebay_browser import open_login_browser
    return await open_login_browser()


async def _run_ebay_submit(listing_id: str):
    """Background task: load listing data, call Playwright automation, persist result."""
    from sqlalchemy.orm import selectinload
    from workers.ebay_browser import submit_listing

    async with SessionLocal() as db:
        result_obj = await db.execute(
            select(Listing)
            .where(Listing.id == listing_id)
            .options(selectinload(Listing.batch))
        )
        listing = result_obj.scalar_one_or_none()
        if not listing:
            return

        batch = listing.batch
        # Build absolute photo paths from stored relative filenames
        photo_paths = []
        if batch and batch.photos:
            for photo in sorted(batch.photos, key=lambda p: p.order):
                full = os.path.join(settings.PHOTOS_DIR, photo.filename)
                photo_paths.append(full)

        listing_data = listing_to_dict(listing)

        async def on_progress(step: str):
            await manager.broadcast("ebay_submit_progress", {
                "listing_id": listing_id,
                "step": step,
            })

        result = await submit_listing(listing_data, photo_paths, on_progress=on_progress)

        if result["success"]:
            listing.ebay_submit_status = "draft"
            listing.ebay_url = result["draft_url"]
        else:
            listing.ebay_submit_status = "error"
            listing.error = result["error"]

        await db.commit()
        await manager.broadcast(
            "ebay_submit_done" if result["success"] else "ebay_submit_error",
            {
                "listing_id": listing_id,
                "draft_url": result.get("draft_url"),
                "error": result.get("error"),
            },
        )


@router.post("/listings/{listing_id}/submit-to-ebay")
async def submit_listing_to_ebay(
    listing_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Trigger eBay browser automation to pre-fill a draft listing."""
    listing = await db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")
    if listing.status != "approved":
        raise HTTPException(400, "Listing must be approved before submitting to eBay")
    if listing.ebay_submit_status == "submitting":
        raise HTTPException(409, "Already submitting this listing")

    listing.ebay_submit_status = "submitting"
    await db.commit()
    await manager.broadcast("ebay_submit_started", {"listing_id": listing_id})
    background_tasks.add_task(_run_ebay_submit, listing_id)
    return {"status": "submitting"}


# ── Photos ────────────────────────────────────────────────────────────────────

@router.get("/photos/{batch_id}/{filename}")
async def get_photo(batch_id: str, filename: str):
    path = os.path.join(settings.PHOTOS_DIR, batch_id, filename)
    if not os.path.exists(path):
        raise HTTPException(404, "Photo not found")
    return FileResponse(path)


# ── Export CSV ────────────────────────────────────────────────────────────────

CONDITION_MAP = {"New": "1000", "Used": "3000", "Not specified": "7000"}

CSV_FIXED_COLS = [
    "Action", "Custom label (SKU)", "Category ID", "Title", "Description",
    "Condition ID", "ConditionDescription", "P:UPC", "Start price", "Quantity",
    "Format", "Duration", "C: Brand", "C: Product Line", "C: Type",
    "BestOffer", "BestOfferAccept", "BestOfferDecline",
    "Shipping service 1 option", "Shipping service 1 cost",
    "Shipping service 2 option", "Shipping service 2 cost",
    "Shipping service 3 option", "Shipping service 3 cost",
    "PackageType", "WeightMajor", "WeightMinor",
    "PackageLength", "PackageWidth", "PackageDepth",
    "Item photo URL",
]


@router.get("/export/csv")
async def export_csv(db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Listing)
        .where(Listing.status == "approved")
        .options(selectinload(Listing.profile), selectinload(Listing.batch))
        .order_by(Listing.approved_at)
    )
    listings = result.scalars().all()

    # Get server base URL from settings
    srv_result = await db.execute(select(Setting).where(Setting.key == "server_base_url"))
    srv_setting = srv_result.scalar_one_or_none()
    _raw_url = (srv_setting.value if srv_setting else None) or settings.SERVER_BASE_URL
    # Only embed photo URLs if a real public base URL is configured
    _is_public = _raw_url and not _raw_url.startswith("http://localhost") and not _raw_url.startswith("http://127.")
    base_url = _raw_url if _is_public else ""

    # Collect all dynamic C: columns across profiles
    dynamic_cols: list[str] = []
    seen_cols: set[str] = set()
    for listing in listings:
        profile = listing.profile
        if profile and profile.prompt_fields:
            for f in profile.prompt_fields:
                col = f.get("ebay_csv_col", "")
                if col.startswith("C:") and col not in seen_cols:
                    dynamic_cols.append(col)
                    seen_cols.add(col)

    all_cols = CSV_FIXED_COLS[:13] + dynamic_cols + CSV_FIXED_COLS[13:]
    # Remove duplicates from fixed cols that might also be in dynamic
    final_cols = list(dict.fromkeys(all_cols))

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=final_cols, extrasaction="ignore")
    writer.writeheader()

    for listing in listings:
        profile = listing.profile
        batch = listing.batch
        extracted = listing.extracted_data or {}
        shipping = listing.shipping or {}

        domestic = shipping.get("domestic", {})
        usa = shipping.get("usa", {})
        intl = shipping.get("intl", {})

        # Build photo URL from first photo
        photo_url = ""
        if base_url and batch and batch.photos:
            photo_url = f"{base_url}/api/photos/{batch.photos[0].filename}"

        row = {
            "Action": "Add(SiteID=US|Country=CA|Currency=CAD|Version=1193|CC=UTF-8)",
            "Custom label (SKU)": listing.sku,
            "Category ID": listing.category_id,
            "Title": listing.title,
            "Description": listing.description,
            "Condition ID": CONDITION_MAP.get(listing.condition, "3000"),
            "ConditionDescription": listing.condition_note or "",
            "P:UPC": listing.upc or "",
            "Start price": listing.price,
            "Quantity": listing.quantity,
            "Format": "FixedPrice",
            "Duration": "GTC",
            "C: Brand": profile.ebay_brand if profile else "",
            "C: Product Line": profile.ebay_product_line if profile else "",
            "C: Type": profile.ebay_item_type if profile else "",
            "BestOffer": "TRUE" if listing.best_offer else "FALSE",
            "BestOfferAccept": listing.best_offer_accept or "",
            "BestOfferDecline": listing.best_offer_decline or "",
            "Shipping service 1 option": domestic.get("service", ""),
            "Shipping service 1 cost": "" if domestic.get("free") else domestic.get("price", ""),
            "Shipping service 2 option": usa.get("service", ""),
            "Shipping service 2 cost": "" if usa.get("free") else usa.get("price", ""),
            "Shipping service 3 option": intl.get("service", ""),
            "Shipping service 3 cost": "" if intl.get("free") else intl.get("price", ""),
            "PackageType": listing.package_type,
            "WeightMajor": listing.weight_grams // 1000,
            "WeightMinor": listing.weight_grams % 1000,
            "PackageLength": listing.pkg_length_cm,
            "PackageWidth": listing.pkg_width_cm,
            "PackageDepth": listing.pkg_depth_cm,
            "Item photo URL": photo_url,
        }

        # Dynamic C: columns from extracted_data
        if profile and profile.prompt_fields:
            for f in profile.prompt_fields:
                col = f.get("ebay_csv_col", "")
                if col.startswith("C:") and col in final_cols:
                    row[col] = extracted.get(f["key"], "")

        writer.writerow(row)

    output.seek(0)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=ebay_listings_{ts}.csv"},
    )
