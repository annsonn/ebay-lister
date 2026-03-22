import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from core.config import settings


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_uuid():
    return str(uuid.uuid4())


# ── Engine ─────────────────────────────────────────────────────────────────────

os.makedirs(os.path.dirname(settings.DATABASE_URL.replace("sqlite+aiosqlite:////", "/")), exist_ok=True)
engine = create_async_engine(settings.DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    async with SessionLocal() as session:
        yield session


# ── Base ───────────────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


# ── JSON column helper ──────────────────────────────────────────────────────────

from sqlalchemy import TypeDecorator, TEXT as SA_TEXT

class JSONColumn(TypeDecorator):
    impl = SA_TEXT
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None:
            return json.dumps(value)
        return value

    def process_result_value(self, value, dialect):
        if value is not None:
            return json.loads(value)
        return value


# ── Models ─────────────────────────────────────────────────────────────────────

class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    icon: Mapped[str] = mapped_column(String, default="📦")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    ebay_category_id: Mapped[str] = mapped_column(String, default="")
    ebay_brand: Mapped[str] = mapped_column(String, default="")
    ebay_item_type: Mapped[str] = mapped_column(String, default="")
    ebay_product_line: Mapped[str] = mapped_column(String, default="")
    ebay_condition_default: Mapped[str] = mapped_column(String, default="Used")
    prompt_ocr: Mapped[str] = mapped_column(Text, default="")
    prompt_struct: Mapped[str] = mapped_column(Text, default="")
    prompt_fields: Mapped[Any] = mapped_column(JSONColumn, default=list)
    price_search_template: Mapped[str] = mapped_column(String, default="")
    default_weight_g: Mapped[int] = mapped_column(Integer, default=450)
    default_length_cm: Mapped[int] = mapped_column(Integer, default=23)
    default_width_cm: Mapped[int] = mapped_column(Integer, default=17)
    default_depth_cm: Mapped[int] = mapped_column(Integer, default=12)
    shipping_defaults: Mapped[Any] = mapped_column(JSONColumn, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    batches: Mapped[list["Batch"]] = relationship("Batch", back_populates="profile")
    listings: Mapped[list["Listing"]] = relationship("Listing", back_populates="profile")


class Batch(Base):
    __tablename__ = "batches"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    profile_id: Mapped[str] = mapped_column(String, ForeignKey("profiles.id"), nullable=False)
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    item_hint: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    step: Mapped[str | None] = mapped_column(String, nullable=True)
    photo_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    profile: Mapped["Profile"] = relationship("Profile", back_populates="batches")
    listing: Mapped["Listing | None"] = relationship("Listing", back_populates="batch", uselist=False)
    photos: Mapped[list["Photo"]] = relationship("Photo", back_populates="batch", order_by="Photo.order")


class Listing(Base):
    __tablename__ = "listings"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    batch_id: Mapped[str] = mapped_column(String, ForeignKey("batches.id"), unique=True, nullable=False)
    profile_id: Mapped[str] = mapped_column(String, ForeignKey("profiles.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending")
    step: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    title: Mapped[str] = mapped_column(String, default="")
    extracted_data: Mapped[Any] = mapped_column(JSONColumn, default=dict)
    description: Mapped[str] = mapped_column(Text, default="")
    condition: Mapped[str] = mapped_column(String, default="Used")
    condition_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    category_id: Mapped[str] = mapped_column(String, default="")
    sku: Mapped[str] = mapped_column(String, default="")
    upc: Mapped[str | None] = mapped_column(String, nullable=True)

    price: Mapped[float] = mapped_column(Float, default=0.0)
    price_low: Mapped[float] = mapped_column(Float, default=0.0)
    price_avg: Mapped[float] = mapped_column(Float, default=0.0)
    price_high: Mapped[float] = mapped_column(Float, default=0.0)
    recent_sales: Mapped[int] = mapped_column(Integer, default=0)
    sell_through: Mapped[int] = mapped_column(Integer, default=0)

    best_offer: Mapped[bool] = mapped_column(Boolean, default=True)
    best_offer_accept: Mapped[float] = mapped_column(Float, default=0.0)
    best_offer_decline: Mapped[float] = mapped_column(Float, default=0.0)

    shipping: Mapped[Any] = mapped_column(JSONColumn, default=dict)
    package_type: Mapped[str] = mapped_column(String, default="PackageThickEnvelope")
    weight_grams: Mapped[int] = mapped_column(Integer, default=450)
    pkg_length_cm: Mapped[int] = mapped_column(Integer, default=23)
    pkg_width_cm: Mapped[int] = mapped_column(Integer, default=17)
    pkg_depth_cm: Mapped[int] = mapped_column(Integer, default=12)

    ebay_submit_status: Mapped[str | None] = mapped_column(String, nullable=True)
    # values: None | "submitting" | "draft" | "error"
    ebay_url: Mapped[str | None] = mapped_column(String, nullable=True)

    batch: Mapped["Batch"] = relationship("Batch", back_populates="listing")
    profile: Mapped["Profile"] = relationship("Profile", back_populates="listings")


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    batch_id: Mapped[str] = mapped_column(String, ForeignKey("batches.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    original_name: Mapped[str] = mapped_column(String, default="")
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    batch: Mapped["Batch"] = relationship("Batch", back_populates="photos")


class Setting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[Any] = mapped_column(JSONColumn, nullable=True)


# ── Init ───────────────────────────────────────────────────────────────────────

async def seed_profiles(session: AsyncSession):
    seed_path = Path(__file__).parent.parent / "seed" / "profiles.json"
    if not seed_path.exists():
        return
    with open(seed_path) as f:
        profiles_data = json.load(f)

    from sqlalchemy import select
    for p_data in profiles_data:
        result = await session.execute(select(Profile).where(Profile.slug == p_data["slug"]))
        existing = result.scalar_one_or_none()
        if existing is None:
            p = Profile(**p_data)
            if not p.id:
                p.id = new_uuid()
            session.add(p)
    await session.commit()


async def init_db():
    os.makedirs(settings.PHOTOS_DIR, exist_ok=True)
    db_dir = settings.DATABASE_URL.replace("sqlite+aiosqlite:////", "/")
    db_dir = os.path.dirname(db_dir)
    os.makedirs(db_dir, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Additive migrations for columns added after initial schema
        for col, coldef in [
            ("ebay_submit_status", "TEXT"),
            ("ebay_url", "TEXT"),
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE listings ADD COLUMN {col} {coldef}"))
            except Exception:
                pass  # column already exists
    async with SessionLocal() as session:
        await seed_profiles(session)
