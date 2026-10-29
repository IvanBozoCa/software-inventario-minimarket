"""Categorías típicas de un minimarket chileno con expendio de alcohol.

Se precargan sin márgenes: el administrador los configura después en la
pantalla de categorías. La precarga es idempotente y no distingue mayúsculas,
así que nunca duplica una categoría que ya exista con otra capitalización.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.category import Category

DEFAULT_CATEGORIES: tuple[str, ...] = (
    # Almacén
    "Abarrotes",
    "Conservas",
    "Aceites, condimentos y salsas",
    "Desayuno y untables",
    "Panadería y pastelería",
    "Snacks y galletas",
    "Confites y chocolates",
    # Frescos y refrigerados
    "Frutas y verduras",
    "Lácteos",
    "Quesos",
    "Cecinas",
    "Huevos",
    "Carnes y pollo",
    "Congelados",
    "Helados",
    "Hielo",
    # Bebidas
    "Bebidas",
    "Aguas y jugos",
    # Bebidas alcohólicas
    "Cervezas",
    "Vinos y espumantes",
    "Destilados",
    "Licores y aperitivos",
    "Coolers y cócteles listos",
    # Hogar y otros
    "Aseo del hogar",
    "Higiene y cuidado personal",
    "Papeles y desechables",
    "Bebés",
    "Mascotas",
    "Cigarrillos",
    "Carbón y leña",
    "Bazar y librería",
)


def seed_default_categories(db: Session) -> list[str]:
    """Crea las categorías que falten y devuelve los nombres creados."""
    existing = {name.lower() for name in db.scalars(select(func.lower(Category.name)))}
    created = []
    for name in DEFAULT_CATEGORIES:
        if name.lower() in existing:
            continue
        db.add(Category(name=name))
        existing.add(name.lower())
        created.append(name)
    db.commit()
    return created
