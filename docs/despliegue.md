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
| `SIM_SUPABASE_URL` | sí (enlace mágico) | URL del proyecto Supabase, p. ej. `https://<ref>.supabase.co`. Activa el acceso por enlace mágico. |
| `SIM_ALLOWED_EMAILS` | sí (enlace mágico) | Correos autorizados separados por coma. Cualquier otro correo recibe el enlace pero la API lo rechaza. |
| `SIM_SUPABASE_ANON_KEY` | sí (enlace mágico) | Clave pública (*publishable* o *anon*) del proyecto; la interfaz la usa para pedir el enlace. |
| `SIM_ACCESS_PASSWORD` | alternativa | Contraseña única del administrador. Solo se usa si no está configurado el enlace mágico. Si no existe ninguna de las dos, la API queda abierta: solo para uso local. |
| `SIM_ACCESS_SESSION_HOURS` | no | Horas de vigencia de la sesión con contraseña (12 por defecto). |
| `SIM_CORS_ORIGINS` | sí | Orígenes permitidos separados por coma, p. ej. `https://sim.eunomi.cl`. |

## Cómo funciona el acceso

La API expone `GET /auth/status` con `mode`: `none` (abierta, equipo local),
`supabase` (enlace mágico) o `password` (contraseña única). La interfaz guarda
el token en `localStorage` y lo envía como `Authorization: Bearer …`; cualquier
401 vuelve a mostrar la pantalla de acceso.

### Enlace mágico (Supabase Auth)

1. La interfaz recibe en `/auth/status` la URL y la clave pública del proyecto
   y pide a Supabase un enlace con `signInWithOtp` para el correo escrito.
2. El administrador abre el enlace **en el mismo dispositivo** (flujo PKCE);
   supabase-js obtiene la sesión y su JWT pasa a ser el token de la API.
3. La API verifica el JWT con las claves públicas del proyecto
   (`/auth/v1/.well-known/jwks.json`, ES256), la audiencia `authenticated`,
   el emisor y la expiración, y exige que `email` esté en `SIM_ALLOWED_EMAILS`.
   Un correo no autorizado ve el aviso y queda fuera.
4. supabase-js renueva el token solo; "Cerrar sesión" cierra la sesión en
   Supabase y borra el token.

Configuración en Supabase (Authentication → URL Configuration): *Site URL*
`https://sim.eunomi.cl` y esa misma dirección en *Redirect URLs*. El envío de
correos usa el SMTP integrado de Supabase (límite bajo de correos por hora,
suficiente para un administrador).

### Contraseña única

`POST /auth/login {password}` devuelve un token firmado (HMAC-SHA256) con fecha
de expiración. Cambiar `SIM_ACCESS_PASSWORD` cierra todas las sesiones: el token
se firma con una clave derivada de la contraseña y no se guarda en la base.
Limitación conocida: no hay límite de intentos; puede activarse en el Firewall
de Vercel (rate limiting) sin tocar el código.

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
