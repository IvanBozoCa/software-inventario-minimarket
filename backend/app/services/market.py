"""Referencias de precios de mercado.

Las referencias se mantienen separadas del inventario propio. Este módulo no
calcula promedios de mercado ni sugiere precios: solo organiza observaciones
con su fuente, fecha, tipo de precio y vigencia para que el administrador
decida.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.market import (
    AppSetting,
    MarketObservation,
    MarketReference,
    MarketScope,
    MarketSource,
    MarketSourceType,
    MatchType,
    ObservationStatus,
    PriceType,
)
from app.models.product import ContentUnit
from app.schemas.limits import MAX_PRICE_CLP

STALE_DAYS_KEY = "market_stale_days"
DEFAULT_STALE_DAYS = 30


class MarketError(ValueError):
    pass


def get_stale_days(db: Session) -> int:
    setting = db.get(AppSetting, STALE_DAYS_KEY)
    if setting is None:
        return DEFAULT_STALE_DAYS
    try:
        return int(setting.value)
    except ValueError:
        return DEFAULT_STALE_DAYS


def set_stale_days(db: Session, days: int) -> int:
    if days < 1 or days > 3650:
        raise MarketError("El plazo debe estar entre 1 y 3650 días")
    setting = db.get(AppSetting, STALE_DAYS_KEY)
    if setting is None:
        db.add(AppSetting(key=STALE_DAYS_KEY, value=str(days)))
    else:
        setting.value = str(days)
    db.commit()
    return days


def today() -> date:
    return datetime.now(timezone.utc).astimezone().date()


# --- Normalización de precios unitarios -------------------------------------

_BASE_UNITS = {
    ContentUnit.G: ("kg", Decimal("0.001")),
    ContentUnit.KG: ("kg", Decimal("1")),
    ContentUnit.ML: ("L", Decimal("0.001")),
    ContentUnit.L: ("L", Decimal("1")),
    ContentUnit.UNIT: ("unidad", Decimal("1")),
}


def normalized_unit_price(
    price_clp: int,
    content_amount: Decimal | None,
    content_unit: ContentUnit | None,
) -> tuple[Decimal, str] | None:
    """Precio por kg, litro o unidad. Devuelve None si falta la presentación."""
    if content_amount is None or content_unit is None:
        return None
    base_label, factor = _BASE_UNITS[content_unit]
    base_amount = Decimal(str(content_amount)) * factor
    if base_amount <= 0:
        return None
    value = (Decimal(price_clp) / base_amount).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )
    return value, base_label


# --- Estado de una observación ----------------------------------------------


@dataclass
class ObservationView:
    observation: MarketObservation
    age_days: int
    stale: bool
    promo_expired: bool
    promo_current: bool


def observation_view(
    observation: MarketObservation,
    *,
    stale_days: int,
    on: date,
) -> ObservationView:
    age = (on - observation.observed_on).days
    expired = (
        observation.price_type == PriceType.PROMO
        and observation.promo_valid_until is not None
        and observation.promo_valid_until < on
    )
    stale = age > stale_days
    return ObservationView(
        observation=observation,
        age_days=age,
        stale=stale,
        promo_expired=expired,
        promo_current=(
            observation.price_type == PriceType.PROMO and not expired and not stale
        ),
    )


def latest_valid(
    reference: MarketReference,
    price_type: PriceType,
) -> MarketObservation | None:
    candidates = [
        observation
        for observation in reference.observations
        if observation.status == ObservationStatus.VALID
        and observation.price_type == price_type
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item.observed_on, item.created_at))


def last_observed_on(reference: MarketReference) -> date | None:
    dates = [
        observation.observed_on
        for observation in reference.observations
        if observation.status == ObservationStatus.VALID
    ]
    return max(dates) if dates else None


@dataclass
class ComparableExtreme:
    price_clp: int
    reference_id: UUID
    source_name: str
    scope: MarketScope
    observed_on: date


@dataclass
class ProductMarketSummary:
    references: list[MarketReference] = field(default_factory=list)
    has_references: bool = False
    has_stale: bool = False
    exact_regular_low: ComparableExtreme | None = None
    exact_regular_high: ComparableExtreme | None = None


def product_references(db: Session, product_id: UUID) -> list[MarketReference]:
    return list(
        db.scalars(
            select(MarketReference)
            .where(MarketReference.product_id == product_id)
            .where(MarketReference.active.is_(True))
            .order_by(MarketReference.match_type, MarketReference.product_name)
        ).all()
    )


def summarize_for_product(
    references: list[MarketReference],
    *,
    stale_days: int,
    on: date,
) -> ProductMarketSummary:
    """Resume referencias de un producto sin promediar.

    Los valores más bajo y más alto se calculan solo entre referencias de
    coincidencia exacta, con precio habitual vigente (no vencido según el
    plazo configurado). Se informan con su fuente; no son recomendaciones.
    """
    summary = ProductMarketSummary(references=references)
    summary.has_references = any(
        last_observed_on(reference) is not None for reference in references
    )

    extremes: list[ComparableExtreme] = []
    for reference in references:
        latest_date = last_observed_on(reference)
        if latest_date is not None and (on - latest_date).days > stale_days:
            summary.has_stale = True

        if reference.match_type != MatchType.EXACT:
            continue
        regular = latest_valid(reference, PriceType.REGULAR)
        if regular is None:
            continue
        if (on - regular.observed_on).days > stale_days:
            continue
        extremes.append(
            ComparableExtreme(
                price_clp=regular.price_clp,
                reference_id=reference.id,
                source_name=reference.source.name,
                scope=reference.source.scope,
                observed_on=regular.observed_on,
            )
        )

    if extremes:
        summary.exact_regular_low = min(extremes, key=lambda item: item.price_clp)
        summary.exact_regular_high = max(extremes, key=lambda item: item.price_clp)
    return summary


def reference_counts_by_product(
    db: Session,
    product_ids: list[UUID],
    *,
    stale_days: int,
    on: date,
) -> dict[UUID, tuple[int, bool]]:
    """Por producto: (n.º de referencias con observaciones, alguna desactualizada)."""
    if not product_ids:
        return {}
    rows = db.execute(
        select(MarketReference.product_id, func.max(MarketObservation.observed_on))
        .join(MarketObservation, MarketObservation.reference_id == MarketReference.id)
        .where(MarketReference.product_id.in_(product_ids))
        .where(MarketReference.active.is_(True))
        .where(MarketObservation.status == ObservationStatus.VALID)
        .group_by(MarketReference.id, MarketReference.product_id)
    ).all()
    result: dict[UUID, tuple[int, bool]] = {}
    for product_id, latest in rows:
        count, stale = result.get(product_id, (0, False))
        is_stale = latest is not None and (on - latest).days > stale_days
        result[product_id] = (count + 1, stale or is_stale)
    return result


# --- Importación CSV ----------------------------------------------------------

CSV_COLUMNS = [
    "fuente",
    "tipo_fuente",
    "cobertura",
    "localidad",
    "url_fuente",
    "producto",
    "marca",
    "variante",
    "contenido",
    "unidad_contenido",
    "precio_clp",
    "tipo_precio",
    "promo_desde",
    "promo_hasta",
    "fecha_observacion",
    "url",
    "notas",
]

REQUIRED_CSV_COLUMNS = {
    "fuente",
    "tipo_fuente",
    "cobertura",
    "producto",
    "precio_clp",
    "tipo_precio",
    "fecha_observacion",
}


@dataclass
class ImportResult:
    sources_created: int = 0
    references_created: int = 0
    observations_created: int = 0
    duplicates_skipped: int = 0
    errors: list[str] = field(default_factory=list)


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def fold_text(value: str) -> str:
    """Minúsculas y sin tildes, para comparar textos escritos a mano."""
    decomposed = unicodedata.normalize("NFKD", value.strip().lower())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


# Valores en español aceptados en el CSV, además de los códigos internos.
_SPANISH_VALUES: dict[type, dict[str, str]] = {
    MarketSourceType: {
        "negocio local": "LOCAL_STORE",
        "negocio": "LOCAL_STORE",
        "almacen": "LOCAL_STORE",
        "supermercado": "SUPERMARKET_WEB",
        "supermercado (sitio web)": "SUPERMARKET_WEB",
        "supermercado web": "SUPERMARKET_WEB",
        "sitio web": "SUPERMARKET_WEB",
        "organismo publico": "PUBLIC_AGENCY",
        "otra": "OTHER",
        "otro": "OTHER",
    },
    MarketScope: {
        "pichilemu": "PICHILEMU",
        "region de o'higgins": "OHIGGINS",
        "o'higgins": "OHIGGINS",
        "ohiggins": "OHIGGINS",
        "region": "OHIGGINS",
        "nacional": "NATIONAL",
        "web": "WEB",
        "precio web": "WEB",
    },
    PriceType: {
        "habitual": "REGULAR",
        "normal": "REGULAR",
        "regular": "REGULAR",
        "promocion": "PROMO",
        "promo": "PROMO",
        "oferta": "PROMO",
    },
    ContentUnit: {
        "gr": "G",
        "gramos": "G",
        "kilo": "KG",
        "kilos": "KG",
        "lt": "L",
        "litro": "L",
        "litros": "L",
        "cc": "ML",
        "un": "UNIT",
        "un.": "UNIT",
        "unidad": "UNIT",
        "unidades": "UNIT",
    },
}

_SPANISH_HINT: dict[type, str] = {
    MarketSourceType: "Negocio local, Supermercado, Organismo público u Otra",
    MarketScope: "Pichilemu, Región de O'Higgins, Nacional o Web",
    PriceType: "Habitual o Promoción",
    ContentUnit: "g, kg, ml, L o unidad",
}


def _parse_enum(enum_cls, raw: str, label: str):
    try:
        return enum_cls(raw.strip().upper())
    except ValueError:
        pass
    alias = _SPANISH_VALUES.get(enum_cls, {}).get(fold_text(raw))
    if alias is not None:
        return enum_cls(alias)
    allowed = _SPANISH_HINT.get(enum_cls) or ", ".join(item.value for item in enum_cls)
    raise MarketError(f"{label} no reconocido: '{raw.strip()}'. Usa {allowed}")


def _parse_date(raw: str | None, label: str) -> date | None:
    raw = _blank_to_none(raw)
    if raw is None:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        pass
    try:
        return datetime.strptime(raw.replace("/", "-"), "%d-%m-%Y").date()
    except ValueError as exc:
        raise MarketError(f"{label} debe ser una fecha como 27-10-2026") from exc


def _parse_price(raw: str) -> int:
    """Precio en pesos enteros: acepta 1990, 1.990 y $1.990."""
    text = raw.strip().replace("$", "").replace(" ", "")
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", text):
        text = text.replace(".", "")
    if not text.isdigit():
        raise MarketError("precio_clp debe ser un número entero en pesos, por ejemplo 1990")
    return int(text)


def _detect_delimiter(content: str) -> str:
    """Excel en Chile guarda los CSV con punto y coma."""
    first_line = content.split("\n", 1)[0]
    return ";" if first_line.count(";") > first_line.count(",") else ","


def _find_or_create_source(db: Session, row: dict, result: ImportResult) -> MarketSource:
    name = row["fuente"].strip()
    source = db.scalar(
        select(MarketSource).where(func.lower(MarketSource.name) == name.lower())
    )
    if source is not None:
        return source
    source = MarketSource(
        name=name,
        source_type=_parse_enum(MarketSourceType, row["tipo_fuente"], "tipo_fuente"),
        scope=_parse_enum(MarketScope, row["cobertura"], "cobertura"),
        locality=_blank_to_none(row.get("localidad")),
        url=_blank_to_none(row.get("url_fuente")),
    )
    db.add(source)
    db.flush()
    result.sources_created += 1
    return source


def _find_or_create_reference(
    db: Session,
    source: MarketSource,
    row: dict,
    result: ImportResult,
) -> MarketReference:
    name = row["producto"].strip()
    brand = _blank_to_none(row.get("marca"))
    variant = _blank_to_none(row.get("variante"))
    amount_raw = _blank_to_none(row.get("contenido"))
    unit_raw = _blank_to_none(row.get("unidad_contenido"))
    amount = None
    if amount_raw is not None:
        try:
            amount = Decimal(amount_raw.replace(",", "."))
            if not amount.is_finite() or amount <= 0:
                raise InvalidOperation
        except InvalidOperation as exc:
            raise MarketError("contenido debe ser numérico") from exc
    unit = _parse_enum(ContentUnit, unit_raw, "unidad_contenido") if unit_raw else None

    statement = select(MarketReference).where(
        MarketReference.source_id == source.id,
        func.lower(MarketReference.product_name) == name.lower(),
    )
    for candidate in db.scalars(statement).all():
        same_amount = (candidate.content_amount is None and amount is None) or (
            candidate.content_amount is not None
            and amount is not None
            and Decimal(candidate.content_amount) == amount
        )
        if (
            (candidate.brand or "").lower() == (brand or "").lower()
            and (candidate.variant or "").lower() == (variant or "").lower()
            and same_amount
            and candidate.content_unit == unit
        ):
            return candidate

    reference = MarketReference(
        source_id=source.id,
        product_name=name,
        brand=brand,
        variant=variant,
        content_amount=amount,
        content_unit=unit,
        product_url=_blank_to_none(row.get("url")),
    )
    db.add(reference)
    db.flush()
    result.references_created += 1
    return reference


def import_csv(db: Session, content: str) -> ImportResult:
    """Importa observaciones desde CSV. Es idempotente: no duplica una
    observación con la misma referencia, fecha, tipo y precio."""
    result = ImportResult()
    reader = csv.DictReader(io.StringIO(content), delimiter=_detect_delimiter(content))
    reader.fieldnames = [fold_text(name) for name in reader.fieldnames or []]
    header = set(reader.fieldnames)
    missing = REQUIRED_CSV_COLUMNS - header
    if missing:
        raise MarketError(
            "Faltan columnas obligatorias: "
            + ", ".join(sorted(missing))
            + ". La primera línea debe tener los nombres de las columnas (descarga la plantilla)."
        )

    for line_number, row in enumerate(reader, start=2):
        try:
            with db.begin_nested():
                for column in REQUIRED_CSV_COLUMNS:
                    if not _blank_to_none(row.get(column)):
                        raise MarketError(f"La columna '{column}' está vacía")
                price = _parse_price(row["precio_clp"])
                if price <= 0:
                    raise MarketError("precio_clp debe ser mayor que cero")
                if price > MAX_PRICE_CLP:
                    raise MarketError("precio_clp es demasiado alto; revisa que no sobre un dígito")
                price_type = _parse_enum(PriceType, row["tipo_precio"], "tipo_precio")
                observed_on = _parse_date(row["fecha_observacion"], "fecha_observacion")
                promo_from = _parse_date(row.get("promo_desde"), "promo_desde")
                promo_until = _parse_date(row.get("promo_hasta"), "promo_hasta")
                if observed_on > today():
                    raise MarketError("la fecha de observación está en el futuro")
                if price_type == PriceType.REGULAR and (promo_from or promo_until):
                    raise MarketError("Las fechas de promoción solo aplican a precios promocionales")
                if promo_from and promo_until and promo_until < promo_from:
                    raise MarketError("la promoción termina antes de comenzar")
                if promo_until and promo_until < observed_on:
                    raise MarketError("la promoción termina antes de la fecha de observación")

                source = _find_or_create_source(db, row, result)
                reference = _find_or_create_reference(db, source, row, result)

                duplicate = db.scalar(
                    select(MarketObservation.id).where(
                        MarketObservation.reference_id == reference.id,
                        MarketObservation.observed_on == observed_on,
                        MarketObservation.price_type == price_type,
                        MarketObservation.price_clp == price,
                    )
                )
                if duplicate is not None:
                    result.duplicates_skipped += 1
                    continue

                db.add(
                    MarketObservation(
                        reference_id=reference.id,
                        price_clp=price,
                        price_type=price_type,
                        promo_valid_from=promo_from,
                        promo_valid_until=promo_until,
                        observed_on=observed_on,
                        url=_blank_to_none(row.get("url")),
                        notes=_blank_to_none(row.get("notas")),
                    )
                )
                result.observations_created += 1
        except MarketError as exc:
            result.errors.append(f"Línea {line_number}: {exc}")

    db.commit()
    return result
