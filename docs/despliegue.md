# Despliegue de SIM en Internet (sim.eunomi.cl)

SIM se diseñó para un solo equipo con SQLite. Para publicarlo en Internet se
usan dos piezas de la cuenta eunomi que ya existen para otros productos:

| Pieza | Servicio | Dominio | Notas |
| --- | --- | --- | --- |
| Interfaz (React/Vite, estática) | Vercel, proyecto `sim-web`, root `frontend/` | `sim.eunomi.cl` | Variable `VITE_API_BASE=https://sim-api.eunomi.cl` |
| API (FastAPI) | Vercel, proyecto `sim-api`, root `backend/`, framework FastAPI | `sim-api.eunomi.cl` | Entrada `app.main:app` (ver `backend/pyproject.toml`) |
| Base de datos | Supabase Postgres, esquema `sim` | — | Tablas separadas del resto del proyecto Supabase |

## Variables de entorno de la API

| Variable | Obligatoria en Internet | Descripción |
| --- | --- | --- |
| `MINIMARKET_DATABASE_URL` | sí | `postgresql+psycopg://postgres.<ref>:<clave>@<host-pooler>:6543/postgres` (cadena del *transaction pooler* de Supabase; funciona desde Vercel por IPv4). |
| `SIM_DB_SCHEMA` | sí | `sim`. Todas las tablas se leen y escriben en ese esquema; en SQLite se deja vacío. |
| `SIM_ACCESS_PASSWORD` | sí | Contraseña única del administrador (mínimo 8 caracteres recomendados). Si no existe, la API queda abierta: solo para uso local. |
| `SIM_ACCESS_SESSION_HOURS` | no | Horas de vigencia de la sesión tras iniciar sesión (12 por defecto). |
| `SIM_CORS_ORIGINS` | sí | Orígenes permitidos separados por coma, p. ej. `https://sim.eunomi.cl`. |

Cambiar `SIM_ACCESS_PASSWORD` cierra todas las sesiones abiertas: el token se
firma con una clave derivada de la contraseña, no se guarda en la base y por
eso funciona igual en varias instancias de Vercel.

## Cómo funciona el acceso

1. La interfaz consulta `GET /auth/status`. Si `required` es `true` y no hay
   token válido, muestra la pantalla "Acceso al administrador".
2. `POST /auth/login {password}` devuelve un token firmado (HMAC-SHA256) con
   fecha de expiración; la interfaz lo guarda en `localStorage` y lo envía
   como `Authorization: Bearer …` en cada petición.
3. Cualquier respuesta 401 vuelve a mostrar la pantalla de acceso.
4. En el equipo local (sin `SIM_ACCESS_PASSWORD`) nada de esto se activa.

Limitación conocida: no hay límite de intentos de contraseña en la API. Si se
necesita, se puede activar en el Firewall de Vercel (rate limiting) sin tocar
el código.

## Migraciones en Supabase

Alembic crea las tablas en el esquema indicado por `SIM_DB_SCHEMA`:

```bash
cd backend
export MINIMARKET_DATABASE_URL="postgresql+psycopg://postgres.<ref>:<clave>@<host-pooler>:5432/postgres"  # session pooler
export SIM_DB_SCHEMA=sim
alembic upgrade head
python scripts/seed_market_references.py   # opcional
```

`alembic upgrade head` usa `SET search_path` sobre una conexión de sesión; no
debe ejecutarse a través del *transaction pooler* (puerto 6543). Verificado el
28-10-2026 contra PostgreSQL 16 local: subida, bajada y nueva subida de las 7
migraciones, carga de las 25 referencias y uso de la API.

## Pasos de publicación

1. Crear el esquema `sim` y correr las migraciones (sección anterior).
2. Crear el proyecto Vercel `sim-api` apuntando al repositorio, root
   `backend/`, framework FastAPI, con las variables de la tabla. Añadir el
   dominio `sim-api.eunomi.cl` (el DNS de `eunomi.cl` ya está en Vercel).
3. Crear el proyecto Vercel `sim-web`, root `frontend/`, framework Vite, con
   `VITE_API_BASE=https://sim-api.eunomi.cl`. Añadir `sim.eunomi.cl`.
4. Abrir `https://sim.eunomi.cl`, iniciar sesión con la contraseña y crear la
   primera categoría.

## Qué se pierde respecto a la versión local

- Se necesita Internet para usar SIM (la base vive en Supabase).
- La instalación local con SQLite sigue funcionando igual y sin contraseña;
  no hay sincronización entre ambas.
