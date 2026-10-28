from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models.market import (
    MarketObservation,
    MarketReference,
    MarketSource,
    ObservationStatus,
)
from app.models.product import Product
from app.schemas.market import (
    ImportResultRead,
    MarketImport,
    MarketReferenceCreate,
    MarketReferenceLink,
    MarketReferenceUpdate,
    MarketSourceCreate,
    MarketSourceRead,
    MarketSourceUpdate,
    ObservationCreate,
    ObservationInvalidate,
    SettingsRead,
    SettingsUpdate,
)
from app.schemas.pricing import MarketReferenceDetail
from app.services.market import (
    MarketError,
    get_stale_days,
    import_csv,
    set_stale_days,
    today,
)
from app.services.presenters import reference_detail

router = APIRouter(tags=["market"])


def _not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _get_source(db: Session, source_id: UUID) -> MarketSource:
    source = db.get(MarketSource, source_id)
    if source is None:
        raise _not_found("Fuente no encontrada")
    return source


def _get_reference(db: Session, reference_id: UUID) -> MarketReference:
    reference = db.get(MarketReference, reference_id)
    if reference is None:
        raise _not_found("Referencia no encontrada")
    return reference


def _detail(db: Session, reference: MarketReference) -> MarketReferenceDetail:
    db.refresh(reference)
    return reference_detail(reference, stale_days=get_stale_days(db), on=today())


def _source_name_taken(db: Session, name: str, exclude_id: UUID | None = None) -> bool:
    statement = select(MarketSource.id).where(func.lower(MarketSource.name) == name.lower())
    if exclude_id is not None:
        statement = statement.where(MarketSource.id != exclude_id)
    return db.scalar(statement) is not None


# --- Fuentes ------------------------------------------------------------------


@router.get("/market/sources", response_model=list[MarketSourceRead])
def list_sources(include_inactive: bool = False, db: Session = Depends(get_db)):
    statement = select(MarketSource)
    if not include_inactive:
        statement = statement.where(MarketSource.active.is_(True))
    return list(db.scalars(statement.order_by(MarketSource.name)).all())


@router.post(
    "/market/sources",
    response_model=MarketSourceRead,
    status_code=status.HTTP_201_CREATED,
)
def create_source(payload: MarketSourceCreate, db: Session = Depends(get_db)):
    if _source_name_taken(db, payload.name):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una fuente con ese nombre",
        )
    source = MarketSource(**payload.model_dump())
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


@router.patch("/market/sources/{source_id}", response_model=MarketSourceRead)
def update_source(
    source_id: UUID,
    payload: MarketSourceUpdate,
    db: Session = Depends(get_db),
):
    source = _get_source(db, source_id)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("name") and _source_name_taken(db, changes["name"], source.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una fuente con ese nombre",
        )
    for field, value in changes.items():
        setattr(source, field, value)
    db.commit()
    db.refresh(source)
    return source


# --- Referencias --------------------------------------------------------------


@router.get("/market/references", response_model=list[MarketReferenceDetail])
def list_references(
    search: str | None = None,
    product_id: UUID | None = None,
    unlinked: bool = False,
    source_id: UUID | None = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
):
    statement = select(MarketReference).options(
        selectinload(MarketReference.observations),
        selectinload(MarketReference.source),
    )
    if not include_inactive:
        statement = statement.where(MarketReference.active.is_(True))
    if product_id is not None:
        statement = statement.where(MarketReference.product_id == product_id)
    if unlinked:
        statement = statement.where(MarketReference.product_id.is_(None))
    if source_id is not None:
        statement = statement.where(MarketReference.source_id == source_id)
    if search is not None and search.strip():
        term = f"%{search.strip()}%"
        statement = statement.where(
            or_(
                MarketReference.product_name.ilike(term),
                MarketReference.brand.ilike(term),
                MarketReference.variant.ilike(term),
            )
        )
    references = db.scalars(statement.order_by(MarketReference.product_name)).all()
    stale_days = get_stale_days(db)
    on = today()
    return [
        reference_detail(reference, stale_days=stale_days, on=on)
        for reference in references
    ]


@router.get("/market/references/{reference_id}", response_model=MarketReferenceDetail)
def get_reference(reference_id: UUID, db: Session = Depends(get_db)):
    return _detail(db, _get_reference(db, reference_id))


@router.post(
    "/market/references",
    response_model=MarketReferenceDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_reference(payload: MarketReferenceCreate, db: Session = Depends(get_db)):
    _get_source(db, payload.source_id)
    if payload.product_id is not None and db.get(Product, payload.product_id) is None:
        raise _not_found("Producto no encontrado")

    reference = MarketReference(
        **payload.model_dump(exclude={"first_observation"}),
    )
    db.add(reference)
    db.flush()
    if payload.first_observation is not None:
        db.add(
            MarketObservation(
                reference_id=reference.id,
                **payload.first_observation.model_dump(),
            )
        )
    db.commit()
    return _detail(db, reference)


@router.patch("/market/references/{reference_id}", response_model=MarketReferenceDetail)
def update_reference(
    reference_id: UUID,
    payload: MarketReferenceUpdate,
    db: Session = Depends(get_db),
):
    reference = _get_reference(db, reference_id)
    changes = payload.model_dump(exclude_unset=True)
    next_amount = changes.get("content_amount", reference.content_amount)
    next_unit = changes.get("content_unit", reference.content_unit)
    if (next_amount is None) != (next_unit is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El contenido requiere cantidad y unidad",
        )
    for field, value in changes.items():
        setattr(reference, field, value)
    db.commit()
    return _detail(db, reference)


@router.put("/market/references/{reference_id}/link", response_model=MarketReferenceDetail)
def link_reference(
    reference_id: UUID,
    payload: MarketReferenceLink,
    db: Session = Depends(get_db),
):
    reference = _get_reference(db, reference_id)
    if payload.product_id is not None and db.get(Product, payload.product_id) is None:
        raise _not_found("Producto no encontrado")
    reference.product_id = payload.product_id
    reference.match_type = payload.match_type
    db.commit()
    return _detail(db, reference)


# --- Observaciones ------------------------------------------------------------


@router.post(
    "/market/references/{reference_id}/observations",
    response_model=MarketReferenceDetail,
    status_code=status.HTTP_201_CREATED,
)
def add_observation(
    reference_id: UUID,
    payload: ObservationCreate,
    db: Session = Depends(get_db),
):
    reference = _get_reference(db, reference_id)
    db.add(MarketObservation(reference_id=reference.id, **payload.model_dump()))
    db.commit()
    return _detail(db, reference)


def _get_valid_observation(db: Session, observation_id: UUID) -> MarketObservation:
    observation = db.get(MarketObservation, observation_id)
    if observation is None:
        raise _not_found("Observación no encontrada")
    if observation.status == ObservationStatus.INVALID:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La observación ya está marcada como inválida",
        )
    return observation


@router.post(
    "/market/observations/{observation_id}/invalidate",
    response_model=MarketReferenceDetail,
)
def invalidate_observation(
    observation_id: UUID,
    payload: ObservationInvalidate,
    db: Session = Depends(get_db),
):
    """Marca una observación como inválida sin borrarla."""
    observation = _get_valid_observation(db, observation_id)
    observation.status = ObservationStatus.INVALID
    observation.invalid_reason = payload.reason.strip()
    observation.invalidated_at = datetime.now(timezone.utc)
    db.commit()
    return _detail(db, observation.reference)


@router.post(
    "/market/observations/{observation_id}/correct",
    response_model=MarketReferenceDetail,
)
def correct_observation(
    observation_id: UUID,
    payload: ObservationCreate,
    db: Session = Depends(get_db),
):
    """Corrige una observación: la original queda inválida y enlazada a la nueva."""
    observation = _get_valid_observation(db, observation_id)
    replacement = MarketObservation(
        reference_id=observation.reference_id,
        **payload.model_dump(),
    )
    db.add(replacement)
    db.flush()
    observation.status = ObservationStatus.INVALID
    observation.invalid_reason = "Corregida"
    observation.invalidated_at = datetime.now(timezone.utc)
    observation.replaced_by_id = replacement.id
    db.commit()
    return _detail(db, observation.reference)


# --- Importación y configuración ------------------------------------------------


@router.post("/market/import", response_model=ImportResultRead)
def import_references(payload: MarketImport, db: Session = Depends(get_db)):
    """Importa observaciones desde el texto de un CSV (ver docs/referencias-mercado.md)."""
    try:
        result = import_csv(db, payload.csv.lstrip("\ufeff"))
    except MarketError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return ImportResultRead(**result.__dict__)


@router.get("/settings", response_model=SettingsRead)
def read_settings(db: Session = Depends(get_db)):
    return SettingsRead(market_stale_days=get_stale_days(db))


@router.put("/settings", response_model=SettingsRead)
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    try:
        days = set_stale_days(db, payload.market_stale_days)
    except MarketError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return SettingsRead(market_stale_days=days)
