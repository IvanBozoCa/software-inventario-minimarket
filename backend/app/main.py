from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.categories import router as categories_router
from app.routers.inventory import router as inventory_router
from app.routers.products import router as products_router

app = FastAPI(
    title="Software Inventario Minimarket",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(categories_router)
app.include_router(products_router)
app.include_router(inventory_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
