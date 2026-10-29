import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.routers.admin_security import router as admin_security_router
from app.routers.auth import router as auth_router
from app.routers.categories import router as categories_router
from app.routers.inventory import router as inventory_router
from app.routers.market import router as market_router
from app.routers.products import router as products_router
from app.routers.sales import router as sales_router
from app.services.access import (
    access_required,
    bearer_token,
    is_public_path,
    session_expiry,
)

app = FastAPI(
    title="SIM — Inventario y Gestión de Precios",
    version="0.1.0",
)


@app.middleware("http")
async def require_access_token(request: Request, call_next):
    """Exige una sesión válida cuando el acceso está protegido."""
    if (
        access_required()
        and request.method != "OPTIONS"
        and not is_public_path(request.url.path)
        and session_expiry(bearer_token(request.headers.get("authorization")) or "") is None
    ):
        return JSONResponse(
            status_code=401,
            content={"detail": "Debes iniciar sesión para usar SIM"},
        )
    return await call_next(request)


def cors_origins() -> list[str]:
    configured = os.getenv("SIM_CORS_ORIGINS", "")
    extra = [origin.strip() for origin in configured.split(",") if origin.strip()]
    return ["http://localhost:5173", "http://127.0.0.1:5173", *extra]


# CORS se agrega al final para que quede como capa externa y responda las
# solicitudes preflight antes de la comprobación de acceso.
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(categories_router)
app.include_router(products_router)
app.include_router(inventory_router)
app.include_router(market_router)
app.include_router(sales_router)
app.include_router(admin_security_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
