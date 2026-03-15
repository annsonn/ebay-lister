import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import httpx
from core.config import settings
from models.database import Batch, Listing, Profile, Setting, get_db
from workers.pipeline import run_pipeline_ocr_struct, preprocess_image
import os

router = APIRouter(prefix="/api")

KNOWN_SETTINGS = {
    "ollama_model", "ollama_host", "ebay_app_id", "ebay_client_secret",
    "server_base_url", "default_profile_id",
}


def profile_to_dict(profile: Profile, include_full=False) -> dict:
    d = {
        "id": profile.id,
        "name": profile.name,
        "slug": profile.slug,
        "icon": profile.icon,
        "is_default": profile.is_default,
        "is_builtin": profile.is_builtin,
        "ebay_category_id": profile.ebay_category_id,
        "ebay_brand": profile.ebay_brand,
        "ebay_item_type": profile.ebay_item_type,
        "ebay_product_line": profile.ebay_product_line,
        "ebay_condition_default": profile.ebay_condition_default,
        "created_at": profile.created_at.isoformat(),
        "updated_at": profile.updated_at.isoformat(),
    }
    if include_full:
        d.update({
            "prompt_ocr": profile.prompt_ocr,
            "prompt_struct": profile.prompt_struct,
            "prompt_fields": profile.prompt_fields,
            "price_search_template": profile.price_search_template,
            "default_weight_g": profile.default_weight_g,
            "default_length_cm": profile.default_length_cm,
            "default_width_cm": profile.default_width_cm,
            "default_depth_cm": profile.default_depth_cm,
            "shipping_defaults": profile.shipping_defaults,
        })
    return d


@router.get("/profiles")
async def list_profiles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Profile).order_by(Profile.name))
    profiles = result.scalars().all()
    out = []
    for p in profiles:
        d = profile_to_dict(p)
        # listing count
        cnt_result = await db.execute(
            select(func.count()).select_from(Listing).where(Listing.profile_id == p.id)
        )
        d["listing_count"] = cnt_result.scalar()
        d["field_count"] = len(p.prompt_fields or [])
        out.append(d)
    return out


@router.get("/profiles/{profile_id}")
async def get_profile(profile_id: str, db: AsyncSession = Depends(get_db)):
    profile = await db.get(Profile, profile_id)
    if not profile:
        raise HTTPException(404, "Profile not found")
    return profile_to_dict(profile, include_full=True)


@router.post("/profiles")
async def create_profile(data: dict, db: AsyncSession = Depends(get_db)):
    data.pop("id", None)
    data["is_builtin"] = False
    slug = data.get("slug", "")
    if not slug:
        raise HTTPException(400, "slug is required")
    existing = await db.execute(select(Profile).where(Profile.slug == slug))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "slug already exists")
    profile = Profile(**data)
    profile.id = str(uuid.uuid4())
    db.add(profile)
    await db.commit()
    return profile_to_dict(profile, include_full=True)


@router.put("/profiles/{profile_id}")
async def update_profile(profile_id: str, data: dict, db: AsyncSession = Depends(get_db)):
    profile = await db.get(Profile, profile_id)
    if not profile:
        raise HTTPException(404, "Profile not found")
    data.pop("id", None)
    data.pop("is_builtin", None)
    data.pop("created_at", None)

    if data.get("is_default"):
        await db.execute(
            select(Profile).where(Profile.id != profile_id)
        )
        result = await db.execute(select(Profile).where(Profile.is_default == True, Profile.id != profile_id))
        for p in result.scalars().all():
            p.is_default = False

    for key, value in data.items():
        if hasattr(profile, key):
            setattr(profile, key, value)

    await db.commit()
    return profile_to_dict(profile, include_full=True)


@router.delete("/profiles/{profile_id}")
async def delete_profile(profile_id: str, db: AsyncSession = Depends(get_db)):
    profile = await db.get(Profile, profile_id)
    if not profile:
        raise HTTPException(404, "Profile not found")
    if profile.is_builtin:
        raise HTTPException(403, "Cannot delete built-in profiles")
    cnt = (await db.execute(
        select(func.count()).select_from(Batch).where(Batch.profile_id == profile_id)
    )).scalar()
    if cnt > 0:
        raise HTTPException(409, f"Profile has {cnt} associated batches")
    await db.delete(profile)
    await db.commit()
    return {"deleted": profile_id}


@router.post("/profiles/{profile_id}/duplicate")
async def duplicate_profile(profile_id: str, db: AsyncSession = Depends(get_db)):
    profile = await db.get(Profile, profile_id)
    if not profile:
        raise HTTPException(404, "Profile not found")
    new_profile = Profile(
        id=str(uuid.uuid4()),
        name=f"{profile.name} (Copy)",
        slug=f"{profile.slug}-copy-{uuid.uuid4().hex[:4]}",
        icon=profile.icon,
        is_default=False,
        is_builtin=False,
        ebay_category_id=profile.ebay_category_id,
        ebay_brand=profile.ebay_brand,
        ebay_item_type=profile.ebay_item_type,
        ebay_product_line=profile.ebay_product_line,
        ebay_condition_default=profile.ebay_condition_default,
        prompt_ocr=profile.prompt_ocr,
        prompt_struct=profile.prompt_struct,
        prompt_fields=profile.prompt_fields,
        price_search_template=profile.price_search_template,
        default_weight_g=profile.default_weight_g,
        default_length_cm=profile.default_length_cm,
        default_width_cm=profile.default_width_cm,
        default_depth_cm=profile.default_depth_cm,
        shipping_defaults=profile.shipping_defaults,
    )
    db.add(new_profile)
    await db.commit()
    return profile_to_dict(new_profile, include_full=True)


@router.post("/profiles/{profile_id}/test-prompt")
async def test_prompt(profile_id: str, data: dict, db: AsyncSession = Depends(get_db)):
    from models.database import Photo, Batch
    profile = await db.get(Profile, profile_id)
    if not profile:
        raise HTTPException(404, "Profile not found")
    batch_id = data.get("batch_id")
    if not batch_id:
        raise HTTPException(400, "batch_id required")
    photos = (await db.execute(
        select(Photo).where(Photo.batch_id == batch_id).order_by(Photo.order)
    )).scalars().all()
    if not photos:
        raise HTTPException(404, "No photos found for batch")

    images_b64 = []
    for photo in photos:
        photo_path = os.path.join(settings.PHOTOS_DIR, photo.filename)
        try:
            images_b64.append(preprocess_image(photo_path))
        except Exception:
            pass
    if not images_b64:
        raise HTTPException(400, "No processable images")

    ocr_text, extracted = await run_pipeline_ocr_struct(profile, images_b64)
    confidence = extracted.pop("confidence", None)
    return {"ocr_text": ocr_text, "extracted_data": extracted, "confidence": confidence}


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/settings")
async def get_settings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Setting))
    settings_rows = result.scalars().all()
    return {row.key: row.value for row in settings_rows}


@router.put("/settings")
async def update_settings(data: dict, db: AsyncSession = Depends(get_db)):
    for key, value in data.items():
        if key not in KNOWN_SETTINGS:
            continue
        existing = await db.get(Setting, key)
        if existing:
            existing.value = value
        else:
            db.add(Setting(key=key, value=value))
    await db.commit()
    result = await db.execute(select(Setting))
    return {row.key: row.value for row in result.scalars().all()}


@router.get("/ollama/models")
async def get_ollama_models(db: AsyncSession = Depends(get_db)):
    srv_result = await db.execute(select(Setting).where(Setting.key == "ollama_host"))
    srv_setting = srv_result.scalar_one_or_none()
    host = srv_setting.value if srv_setting else settings.OLLAMA_HOST
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{host}/api/tags")
            r.raise_for_status()
            models = [m["name"] for m in r.json().get("models", [])]
            return {"models": models}
    except Exception as e:
        return {"models": [], "error": str(e)}
