import os

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.admin_security import router as admin_security_router
from app.routers.auth import router as auth_router
from app.routers.categories import router as categories_router
from app.routers.inventory import router as inventory_router
from app.routers.market import router as market_router
from app.routers.products import router as products_router
from app.routers.sales import router as sales_router
from app.dependencies import authorize_request
from app.routers.users import router as users_router
from app.routers.pos import router as pos_router

# Cada ruta exige sesión (salvo las públicas) y respeta el rol del usuario.
app = FastAPI(
    title="SIM — Inventario y Gestión de Precios",
    version="0.1.0",
    dependencies=[Depends(authorize_request)],
)


def cors_origins() -> list[str]:
    configured = os.getenv("SIM_CORS_ORIGINS", "")
    extra = [origin.strip() for origin in configured.split(",") if origin.strip()]
    return ["http://localhost:5173", "http://127.0.0.1:5173", *extra]


# CORS responde las solicitudes preflight antes de la comprobación de acceso.
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
app.include_router(users_router)
app.include_router(pos_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
