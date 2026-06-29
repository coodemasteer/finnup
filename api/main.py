"""
api/main.py — FinnUp FastAPI backend
"""
import sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Ensure project root is on path so src.* imports work
sys.path.insert(0, str(Path(__file__).parent.parent))

from api.routers import predict, train, batch, diagrams, templates, analysis

app = FastAPI(
    title="FinnUp MSME Lender Matching API",
    description="Engine 1 (ML) + Engine 2 (Policy Rules) for MSME loan decisions",
    version="1.0.0",
    # Serve docs under /api/ so Next.js proxy (/api/:path*) can forward them
    # in production (HF Space). Without this, /docs hits Next.js → 404.
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(predict.router,    prefix="/api", tags=["Predict"])
app.include_router(train.router,      prefix="/api", tags=["Train"])
app.include_router(batch.router,      prefix="/api", tags=["Batch"])
app.include_router(diagrams.router,   prefix="/api", tags=["Diagrams"])
app.include_router(templates.router,  prefix="/api", tags=["Templates"])
app.include_router(analysis.router,   prefix="/api", tags=["Analysis"])


@app.on_event("startup")
async def _warmup():
    """Kick off model loading in a background thread immediately on startup.
    The server accepts connections right away; first request is instant if the
    background load finishes first, otherwise it waits for load to complete."""
    import asyncio, concurrent.futures

    async def _load_in_bg():
        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            try:
                await loop.run_in_executor(pool, predict._load_all)
            except Exception:
                pass  # models not trained yet — safe to ignore

    asyncio.create_task(_load_in_bg())


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "FinnUp API"}
