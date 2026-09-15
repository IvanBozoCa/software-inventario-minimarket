from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.category import Category
from app.schemas.category import CategoryCreate, CategoryRead, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])


def _get_category_or_404(db: Session, category_id: UUID) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Categoría no encontrada",
        )
    return category


def _name_exists(
    db: Session,
    name: str,
    *,
    exclude_id: UUID | None = None,
) -> bool:
    statement = select(Category.id).where(
        func.lower(Category.name) == name.lower(),
    )
    if exclude_id is not None:
        statement = statement.where(Category.id != exclude_id)
    return db.scalar(statement) is not None


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    db: Session = Depends(get_db),
) -> Category:
    if _name_exists(db, payload.name):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una categoría con ese nombre",
        )

    category = Category(name=payload.name)
    db.add(category)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una categoría con ese nombre",
        ) from exc

    db.refresh(category)
    return category


@router.get("", response_model=list[CategoryRead])
def list_categories(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
) -> list[Category]:
    statement = select(Category)
    if not include_inactive:
        statement = statement.where(Category.active.is_(True))
    statement = statement.order_by(Category.name)
    return list(db.scalars(statement).all())


@router.get("/{category_id}", response_model=CategoryRead)
def get_category(
    category_id: UUID,
    db: Session = Depends(get_db),
) -> Category:
    return _get_category_or_404(db, category_id)


@router.patch("/{category_id}", response_model=CategoryRead)
def update_category(
    category_id: UUID,
    payload: CategoryUpdate,
    db: Session = Depends(get_db),
) -> Category:
    category = _get_category_or_404(db, category_id)
    changes = payload.model_dump(exclude_unset=True)

    new_name = changes.get("name")
    if new_name is not None and _name_exists(
        db,
        new_name,
        exclude_id=category.id,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una categoría con ese nombre",
        )

    for field, value in changes.items():
        setattr(category, field, value)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una categoría con ese nombre",
        ) from exc

    db.refresh(category)
    return category
