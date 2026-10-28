# Decisiones técnicas del MVP de inventario y precios (28-10-2026)

## Estado comprobado al inicio

- Backend FastAPI + SQLAlchemy 2 + Alembic + SQLite con 70 pruebas en verde.
  Existían categorías, productos (con `sale_mode`, `price_mode`, código de
  barras), movimientos de stock (`INITIAL_STOCK`, etc.), ventas, pagos, PIN
  administrativo y auditoría.
- Frontend React 19 + Vite: una sola pantalla de **caja** (POS). La vista de
  administración tras el PIN era un marcador de posición sin funciones.
- Jira marcaba SIM-10, SIM-11, SIM-12, SIM-13, SIM-14 y SIM-15 como "Listo".
  Eso era cierto para la API, pero SIM-11 ("pantalla administrativa distinta
  del modo Caja") no tenía interfaz.

## Qué se reutiliza

- Toda la arquitectura (FastAPI, SQLAlchemy, Alembic, SQLite, Vite, Vitest,
  Playwright) y las tablas `categories`, `products`, `stock_movements`.
- La cantidad disponible sigue siendo la suma de movimientos; "Actualizar
  cantidad" registra un `ADJUSTMENT` (o `INITIAL_STOCK` si no hay
  movimientos), nunca sobrescribe un número.
- Ventas, pagos y PIN quedan en la API sin cambios; no se eliminó código.

## Qué cambia

- Nueva migración `3e7c2efe9da2`: columnas en `products` (marca, variante,
  contenido, unidad de control, último costo, costo adicional de
  abastecimiento, márgenes propios) y `categories` (márgenes); tablas
  `product_cost_changes`, `product_price_changes`, `market_sources`,
  `market_references`, `market_observations`, `app_settings`. Usa batch mode
  de Alembic para que SQLite conserve los datos.
- Los cambios de precio y costo pasan por `services/catalog.py`, que escribe
  el historial append-only. También el `PATCH /products/{id}` conserva el
  historial si incluye `sale_price_clp`.
- Cálculos en `services/pricing.py` con `Decimal`; márgenes como proporción
  `0 ≤ m < 1` validados en Pydantic, en el servicio y con CHECK en la base.
- Frontend: nueva aplicación de administración (`src/App.tsx`, `src/pages/`)
  con enrutado por hash sin dependencias nuevas. El POS se movió a
  `src/legacy/CajaApp.tsx` y no se monta.
- El PIN no se exige en la interfaz: hay un único usuario administrador en un
  equipo local y ya no existe un modo Caja compartido que proteger.

## Publicación en Internet (28-10-2026, tarde)

- La base puede ser Postgres (Supabase) en un esquema propio (`SIM_DB_SCHEMA`)
  sin tocar los modelos: `Base.metadata` toma el esquema de la variable y
  Alembic fija `search_path` al migrar. SQLite sigue siendo el valor por
  defecto para el uso local.
- Acceso con contraseña única y token firmado sin estado
  (`services/access.py`), porque Vercel ejecuta varias instancias y el PIN
  anterior guardaba las sesiones en memoria.
- Detalle en `despliegue.md`.

## Lo que no se hizo a propósito

- Sin redondeo de precios ni "precios psicológicos".
- Sin promedio de mercado ni recomendación automática.
- Sin integración automática con sitios externos (ver
  `referencias-mercado.md`).
- Sin compras, proveedores, ventas ni reportes.
