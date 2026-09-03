# Saldo

Control del saldo prepago y las suscripciones de varias cuentas de tiendas de
aplicaciones (App Store, Google Play...). Un solo usuario, sin autenticacion,
pensada para vivir en un Umbrel y entrar por Tailscale.

Todos los datos se meten **a mano**. La app no habla con Apple ni con Google:
es un **simulador de saldo**, no un lector. No anadas integraciones, scraping
ni credenciales de tiendas.

## Stack

| Capa | Tecnologia |
| --- | --- |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, SQLite, APScheduler |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, React Router |
| Empaquetado | Dockerfile multi-stage, un unico contenedor y un unico puerto |

Sin libreria de estado global: un cliente `fetch` propio y hooks.

## Estructura

```
ismaeloul-saldo/
  CLAUDE.md              este fichero
  README.md              arranque, instalacion en Umbrel, copia de seguridad
  Dockerfile             multi-stage: Vite compila, Python sirve
  docker-compose.yml     desarrollo/local, publica el puerto y monta ./data
  umbrel-app.yml         manifiesto de la app de Umbrel (id ismaeloul-saldo)
  umbrel/
    docker-compose.yml   formato de app de Umbrel (app_proxy). Para instalar
                         la app hay que copiarlo sobre el de la raiz: son dos
                         formatos incompatibles y solo cabe uno.
    publicar.sh          construye, pasa los tests y publica al registro
  icon.svg
  backend/
    requirements.txt     dependencias de produccion
    requirements-dev.txt  + pytest y httpx
    pytest.ini
    app/
      config.py          settings del entorno (PORT, rutas, huso)
      clock.py           UNICO sitio que mira el reloj real
      logging_conf.py    logging estructurado JSON a stdout
      db.py              engine, sesiones, creacion idempotente del esquema
      models.py          esquema SQLAlchemy
      schemas.py         modelos Pydantic de entrada/salida
      mapping.py         puente filas -> motor (un solo lector de precios)
      operations.py      operaciones de dominio (reactivar, cancelar)
      presenter.py       filas y metricas -> modelos de salida
      deps.py            dependencias de FastAPI (sesion, "hoy", 404)
      errors.py          errores 422 con la forma de FastAPI (loc/msg/type)
      money.py           exponentes ISO 4217, formateo y parseo
      dates.py           reglas de fechas de cobro (anchors)
      projection.py      MOTOR DE PROYECCION: Python puro, sin BD ni FastAPI
      metrics.py         metricas derivadas por cuenta
      materializer.py    convierte cobros vencidos en transacciones reales
      notify.py          notify(mensaje): punto de extension, sin integraciones
      scheduler.py       tarea diaria con APScheduler
      static.py          sirve el build del frontend con fallback de SPA
      main.py            crea la app y monta /api
      api/               routers REST
    tests/               pytest
  frontend/
    src/                 React + TypeScript
```

## Invariantes que no se negocian

1. **Dinero entero.** Todo importe se guarda como entero en la unidad menor de
   su divisa. El numero de decimales sale de la tabla de exponentes ISO 4217 de
   `money.py` (EUR/USD 2, JPY/KRW 0, KWD/BHD 3). **Nunca** asumas 2 decimales.
2. **Una divisa por cuenta.** Prohibido sumar, restar o comparar importes de
   divisas distintas. No hay vista de total agregado.
3. **El saldo nunca es negativo.** Si un cargo no cabe, no se aplica.
4. **El precio se lee de `subscription_prices`**, jamas de `subscriptions`.
   Cambiar de precio anade una fila; no actualiza ninguna.
5. **`proximo_cobro` es siempre la fecha del proximo cobro futuro.**
   `anchor_dia` / `anchor_mes` se derivan de ella al crear (o al reactivar una
   suscripcion perdida) y no se mueven dentro de un mismo ciclo: son lo que
   evita la deriva de fechas.
6. **`hoy` se inyecta.** La logica de negocio recibe la fecha por parametro.
   `date.today()` solo aparece en `clock.py`.
7. **El frontend llama a rutas relativas `/api/...`.** Ni una URL absoluta, ni
   un `localhost`, ni un puerto a mano.

## Arrancar

### Con Docker (lo que corre en el NAS)

```sh
docker compose up --build
# http://localhost:8080
```

La base de datos queda en `./data/saldo.db`.

### En local, sin Docker

Backend:

```sh
cd backend
python -m venv .venv && .venv/Scripts/activate    # Linux/macOS: .venv/bin/activate
pip install -r requirements-dev.txt
SALDO_DATA_DIR=../data uvicorn app.main:app --reload --port 8080
```

Frontend (proxy a /api hacia el 8080, configurado en `vite.config.ts`):

```sh
cd frontend
npm install
npm run dev
```

## Tests

```sh
cd backend
pytest
```

Dentro del contenedor:

```sh
docker compose run --rm saldo pytest -q
```

Los tests viajan dentro de la imagen a proposito: pasar pytest dentro del
contenedor es un criterio de aceptacion de la app, y asi no hace falta ni red
ni instalar nada.

Los tests congelan "hoy" con una fecha fija. Si escribes logica nueva que
necesita saber que dia es, recibe la fecha por parametro; no llames al reloj.
