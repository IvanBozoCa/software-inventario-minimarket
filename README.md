# SIM — Sistema de Inventario y Gestión de Precios para Minimarket

Aplicación web local para que el administrador de un minimarket (Pichilemu,
Región de O'Higgins) lleve su inventario, registre precios y costos, y decida
precios de venta con información de rentabilidad y referencias de mercado.

**SIM no es un POS.** La caja registradora, las ventas, los cobros y el escaneo
de códigos que existían en la etapa anterior del proyecto quedaron fuera del
producto actual (el código se conserva en `frontend/src/legacy/`, sin montar).

## Qué hace el MVP

| Capacidad | Dónde |
| --- | --- |
| Catálogo manual de productos (nombre, categoría, marca, variante, contenido, unidad, cantidad, precio actual, costo si se conoce) | Inventario → Nuevo producto |
| Cantidad disponible con movimientos auditables (inicial y ajustes) | Ficha del producto → Actualizar cantidad |
| Precio de venta y costo unitario con historial (anterior, nuevo, fecha, fuente, nota) | Ficha del producto |
| Costo adicional de abastecimiento por unidad, separado del costo de compra | Ficha → Registrar costo |
| Márgenes mínimo y superior por categoría, con ajuste por producto | Categorías y márgenes · ficha del producto |
| Rango de precios calculado: `costo / (1 − margen)` | Ficha del producto |
| Advertencias: precio bajo el costo, margen bajo el mínimo, costo que subió sin revisar el precio, datos faltantes | Ficha e inventario |
| Referencias de mercado con fuente, fecha, cobertura, tipo (habitual/promoción), vigencia, precio unitario normalizado | Precios de mercado |
| Coincidencia exacta vs. producto equivalente al asociar una referencia | Precios de mercado · ficha |
| Marca "Precio por verificar" a referencias con más de N días (configurable, 30 por defecto) | Precios de mercado |
| Importación CSV y precarga de referencias verificadas | `backend/scripts/seed_market_references.py` |

El sistema **nunca cambia el precio de venta por su cuenta** ni calcula un
promedio de mercado: muestra los valores más bajo y más alto observados entre
referencias del mismo producto, vigentes y con precio habitual, siempre con su
fuente. La decisión es del administrador.

## Requisitos

- Python 3.11 o superior.
- Node.js 20 o superior.
- No se necesita Internet para administrar el inventario.

## Puesta en marcha

### Backend (FastAPI + SQLite)

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate · Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head                      # crea/actualiza minimarket.db
python scripts/seed_market_references.py  # opcional: referencias verificadas
uvicorn app.main:app --host 127.0.0.1 --port 8010
```

La base de datos es `backend/minimarket.db` (configurable con la variable
`MINIMARKET_DATABASE_URL`). Documentación interactiva de la API en
`http://127.0.0.1:8010/docs`.

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev    # http://127.0.0.1:5173
```

Si el backend corre en otra dirección, define `VITE_API_BASE` (por defecto
`http://127.0.0.1:8010`).

### Publicación en Internet (opcional)

SIM puede publicarse en Vercel con Postgres de Supabase y acceso con
contraseña única (`SIM_ACCESS_PASSWORD`). Variables, migraciones y pasos en
[`docs/despliegue.md`](docs/despliegue.md). En el equipo local nada cambia:
sin contraseña y con SQLite.

## Pruebas

```bash
# Backend (94 pruebas): modelos, cálculos de rentabilidad, historial, referencias, acceso
cd backend && .venv/bin/python -m pytest        # Windows: .venv\Scripts\python -m pytest

# Frontend unitarias (Vitest)
cd frontend && npm test

# Frontend E2E (Playwright: levanta backend con base aislada y Vite)
cd frontend && npm run test:e2e

# Tipos y estilo
cd frontend && npx tsc -b && npm run lint
```

Las pruebas E2E del antiguo modo Caja están en `frontend/e2e-legacy/` y no se
ejecutan.

## Cómo usar SIM

### Crear productos

Inventario → **Nuevo producto**. Solo son obligatorios el nombre y el precio de
venta actual. Marca, variante y contenido (por ejemplo `1,5 L`) son opcionales
pero ayudan a reconocer el mismo producto en las referencias de mercado. Si no
conoces el costo, deja el campo vacío: el producto se guarda igual y la ficha
mostrará "costo pendiente".

Los productos con historial no se borran: se desactivan y reactivan desde la
ficha.

### Configurar márgenes

Categorías y márgenes → define **margen mínimo objetivo** y **margen superior
de referencia** por categoría (en porcentaje sobre el precio de venta). No hay
valores predeterminados. Un producto puede tener márgenes propios en "Editar
ficha"; si están vacíos se usan los de su categoría. Sin márgenes, la ficha
pide definirlos antes de mostrar el rango.

Fórmulas:

- Margen bruto = (precio de venta − costo unitario) / precio de venta.
- Precio calculado = costo unitario / (1 − margen objetivo).
- El recargo sobre el costo (markup) se muestra aparte y no se llama margen.

El costo unitario usado es el último costo de compra más el costo adicional de
abastecimiento, si se registró. Es un análisis comercial simplificado sobre
valores con IVA incluido, no contabilidad tributaria ni utilidad neta.

### Registrar referencias de mercado

Precios de mercado → **Registrar precio observado**: elige o crea la fuente
(negocio local de Pichilemu, sitio web, organismo), describe el producto
observado, el precio, si es habitual o promoción (con vigencia si se conoce) y
la fecha. Opcionalmente asócialo a un producto propio indicando si es el
**mismo producto** o un **producto equivalente** (similar pero de otra marca o
tamaño). Solo las coincidencias exactas entran en el resumen de la ficha; las
equivalentes se muestran como información complementaria.

Una observación no se borra: se marca como inválida (con motivo) o se corrige
con una nueva que la reemplaza, conservando el historial.

Para cargar muchas referencias usa **Importar CSV** (formato en
[`docs/referencias-mercado.md`](docs/referencias-mercado.md)).

### Fuentes externas utilizadas

No hay ninguna integración automática con fuentes externas. Las referencias
precargadas (`backend/data/referencias_mercado_2026-10-28.csv`) son 25
observaciones tomadas manualmente el 28-10-2026 de las páginas públicas de
**Lider.cl** y **Jumbo.cl**, registradas como "Precio web" porque esos sitios
no indican tienda ni comuna. El detalle de las fuentes evaluadas, incluidas las
que no se pudieron usar, está en `docs/referencias-mercado.md`.

## Limitaciones conocidas

- Las referencias de mercado se actualizan manualmente (formulario o CSV).
- No hay referencias de negocios físicos de Pichilemu precargadas: deben
  registrarse al observarlas.
- La aplicación es para un solo administrador; no hay usuarios ni roles. La
  versión publicada en Internet se protege con una contraseña única y no se
  sincroniza con una instalación local.
- El PIN administrativo de la etapa anterior sigue disponible en la API
  (`/admin/security`), pero la interfaz actual no lo exige porque ya no existe
  un modo Caja compartido.

## Funcionalidades pendientes (fuera del MVP)

Reportes de ventas, registro de compras y proveedores, recepción de
mercadería, mermas, stock objetivo y reposición, actualización automática de
referencias, OCR de facturas, integración SII/DTE, múltiples usuarios y
sucursales, caja y cobros. Ver el backlog en Jira (proyecto SIM).
