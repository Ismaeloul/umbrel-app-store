# Una sola imagen y un solo puerto: FastAPI sirve la API y el build de Vite
# como estaticos desde el mismo origen.

# --- Etapa 1: compilar el frontend -----------------------------------------
FROM node:22-alpine AS frontend

WORKDIR /frontend

# Las dependencias van antes que el codigo para que su capa se reaproveche
# mientras solo cambien los fuentes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# `npm run build` pasa primero tsc: un error de tipos rompe la imagen aqui,
# que es donde tiene que romperse.
RUN npm run build

# --- Etapa 2: la imagen final ----------------------------------------------
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080 \
    SALDO_DATA_DIR=/app/data \
    SALDO_STATIC_DIR=/app/static \
    TZ=Europe/Paris

WORKDIR /app

# requirements-dev incluye a requirements. Los tests viajan dentro de la
# imagen a proposito: uno de los criterios de la app es poder pasar pytest
# dentro del contenedor, sin red y sin instalar nada mas.
COPY backend/requirements.txt backend/requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt

COPY backend/app ./app
COPY backend/tests ./tests
COPY backend/pytest.ini ./pytest.ini
COPY --from=frontend /frontend/dist ./static

# El volumen se monta encima, pero el directorio tiene que existir para que
# la app arranque tambien sin volumen.
RUN mkdir -p /app/data

EXPOSE 8080

# Sin curl en la imagen slim: la sonda la hace el propio Python.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request;urllib.request.urlopen(f\"http://127.0.0.1:{os.environ.get('PORT','8080')}/api/health\").read()"

# --proxy-headers: detras del app_proxy de Umbrel, para que la app vea el
# esquema y el host reales.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips '*'"]
