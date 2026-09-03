# Saldo

Control del saldo prepago y las suscripciones de varias cuentas de tiendas de
aplicaciones (App Store, Google Play…).

Si no quieres meter la tarjeta en las tiendas y recargas con saldo, el
problema no es cuánto tienes: es **cuánto te dura y cuándo hay que recargar
antes de que falle un cobro**. Eso es lo que responde esta app.

- **El margen se calcula cobro a cobro, no con una media.** La app simula los
  próximos 24 meses con las fechas reales de cada suscripción. Si tienes saldo
  para ocho cobros mensuales pero hay una anual que cae dentro de tres meses y
  no cabe, lo que te quedan son **tres** meses, no ocho.
- **Pruebas gratuitas.** Una suscripción en prueba se marca con el día en que
  pasa a cobro, y si el saldo proyectado no va a llegar a ese día el aviso
  sale con prioridad sobre el de recargar. Es el único momento en el que se
  pierde una prueba.
- **Cada cuenta, su divisa.** Los decimales salen de la tabla ISO 4217: euros
  con dos, yenes sin ninguno, dinares con tres. Nunca se suman, restan ni
  comparan importes de divisas distintas, y no hay conversión.
- **Los datos los metes tú.** La app no habla con Apple ni con Google, no pide
  credenciales de ninguna tienda y no sale a internet. Es un **simulador de
  saldo**, no un lector.

Sin usuarios ni contraseñas: está pensada para vivir en un Umbrel y entrar por
la red privada (Tailscale).

## Arrancar

```sh
docker compose up --build
```

Y abre <http://localhost:8080>. Una sola imagen, un solo contenedor, un solo
puerto: FastAPI sirve la API bajo `/api` y el frontend compilado desde el
mismo origen, así que funciona igual detrás de un proxy inverso.

Para cambiar el puerto:

```sh
PORT=9000 docker compose up --build
```

### Variables de entorno

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `PORT` | `8080` | Puerto en el que escucha la app |
| `TZ` | `Europe/Paris` | Huso del contenedor |
| `SALDO_HORA_TAREA` | `3` | Hora (0-23) a la que corre la tarea diaria |
| `SALDO_DATA_DIR` | `/app/data` | Dónde vive la base de datos |
| `SALDO_STATIC_DIR` | `/app/static` | Dónde está el frontend compilado |
| `SALDO_TAREAS_DE_FONDO` | `1` | `0` apaga el scheduler y la materialización de arranque |

### En local, sin Docker

Backend:

```sh
cd backend
python -m venv .venv
.venv/bin/activate          # en Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
SALDO_DATA_DIR=../data uvicorn app.main:app --reload --port 8080
```

Frontend, en otra terminal (Vite hace de proxy de `/api` al 8080, configurado
en `vite.config.ts`):

```sh
cd frontend
npm install
npm run dev
```

## Instalarla como app de Umbrel

Las apps de Umbrel no se construyen en el NAS: umbreld ignora `pull_policy` y
necesita resolver la imagen contra un registro. El camino es el mismo que usan
las otras apps de esta tienda (`ace-player-neo`, `ipa-station`, `trajet`):
publicar la imagen en el registro local del NAS y dejar en la carpeta de la
app un `docker-compose.yml` con el formato de Umbrel.

1. **Publica la imagen** (desde la raíz de `ismaeloul-saldo/`):

   ```sh
   ./umbrel/publicar.sh 0.1.0
   ```

   El script construye la imagen, **pasa los tests dentro de ella** y la sube
   a `localhost:5000`. Si construyes desde otro equipo, pásale la dirección
   del registro: `./umbrel/publicar.sh 0.1.0 192.168.1.188:5000`.

2. **Coloca el compose de Umbrel.** El `docker-compose.yml` de la raíz es el
   de desarrollo (construye la imagen y publica el puerto). El de Umbrel está
   en `umbrel/docker-compose.yml` y hay que copiarlo encima:

   ```sh
   cp umbrel/docker-compose.yml docker-compose.yml
   ```

   Ese compose declara el servicio `app_proxy` con `APP_HOST`
   (`ismaeloul-saldo_web_1`) y `APP_PORT` (`8080`), y monta
   `${APP_DATA_DIR}/data` en `/app/data`.

3. **Instala o actualiza la app** desde umbrelOS. `umbrel-app.yml` ya está en
   la raíz con el `id` `ismaeloul-saldo` y el puerto `7797`.

Sin modo privilegiado, sin `network_mode: host` y sin depender de ninguna ruta
absoluta del anfitrión.

## La base de datos y la copia de seguridad

Todo vive en **un solo fichero SQLite**:

- Con `docker compose`: `./data/saldo.db`
- En Umbrel: `<APP_DATA_DIR>/data/saldo.db`, normalmente
  `~/umbrel/app-data/ismaeloul-saldo/data/saldo.db`

El esquema se crea solo al arrancar y es idempotente: no hay migraciones que
lanzar a mano.

Para respaldar, con la app parada basta con copiar el fichero:

```sh
docker compose down
cp data/saldo.db copias/saldo-$(date +%F).db
docker compose up -d
```

Si prefieres no pararla, usa el respaldo en caliente de SQLite, que respeta el
modo WAL:

```sh
docker compose exec saldo \
  python -c "import sqlite3;o=sqlite3.connect('/app/data/saldo.db');d=sqlite3.connect('/app/data/copia.db');o.backup(d);d.close();o.close()"
```

Para restaurar, para la app, pon el fichero en su sitio con el nombre
`saldo.db` y vuelve a arrancarla. Borra también `saldo.db-wal` y
`saldo.db-shm` si estuvieran.

## Los avisos: cómo enchufar `notify()`

Una vez al día (y también al arrancar) la app aplica los cobros vencidos y
anota lo que hay que mirar: las cuentas con 30 días o menos de margen, las
pruebas que vencen en 7 días y las suscripciones perdidas ese día. Cada aviso
pasa por `notify()`, en `backend/app/notify.py`.

**A propósito no hay ninguna integración externa**: la app no manda nada a
ningún sitio. `notify()` deja el aviso en el log estructurado, que se lee con
`docker compose logs -f saldo`.

Para mandarlos a algún sitio de verdad, registra un canal al arrancar. Un
canal es cualquier función que reciba el mensaje:

```python
# backend/app/main.py, dentro de crear_app()
import urllib.request
from .notify import registrar_canal

def a_ntfy(mensaje: str) -> None:
    urllib.request.urlopen(
        urllib.request.Request(
            "http://ntfy_web_1/saldo",
            data=mensaje.encode("utf-8"),
            method="POST",
        ),
        timeout=5,
    )

registrar_canal(a_ntfy)
```

Se pueden registrar varios, y si uno falla se registra la excepción y la tarea
diaria sigue: un canal caído no puede tumbar la materialización de los cobros.

## Tests

```sh
cd backend
pytest
```

Dentro del contenedor (los tests viajan en la imagen a propósito, así que no
hace falta ni red ni instalar nada):

```sh
docker compose run --rm saldo pytest -q
```

Los tests congelan «hoy» con una fecha fija que se inyecta. Cubren el formateo
y el parseo de divisas con 0, 2 y 3 decimales, las reglas de fechas (el 31 en
febrero que vuelve al 31 en marzo, el 29 de febrero proyectado cuatro años),
el motor de proyección con sus pérdidas parciales, el materializador con su
idempotencia y su puesta al día, y la API completa.

## Cómo está montada

| Capa | Tecnología |
| --- | --- |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, SQLite, APScheduler |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, React Router |
| Imagen | Dockerfile multi-stage: Vite compila, Python sirve |

```
ismaeloul-saldo/
  Dockerfile              multi-stage
  docker-compose.yml      desarrollo y local
  umbrel-app.yml          manifiesto de la app de Umbrel
  umbrel/
    docker-compose.yml    formato de Umbrel (app_proxy)
    publicar.sh           construye, pasa los tests y publica la imagen
  backend/
    app/                  API, motor de proyección y materializador
    tests/                pytest
  frontend/
    src/                  React + TypeScript
```

El motor de proyección (`backend/app/projection.py`) es Python puro: no
importa SQLAlchemy ni FastAPI y no mira el reloj. Todo lo que necesita entra
por parámetro, «hoy» incluido.

Hay más detalle sobre los invariantes que no se negocian en
[CLAUDE.md](CLAUDE.md).

## Qué no hace

Ni autenticación, ni usuarios, ni integración o scraping de ninguna tienda, ni
tipos de cambio, ni conversión entre divisas, ni un total agregado
multidivisa, ni notificaciones externas, ni categorías, ni estadísticas de
gasto, ni exportación, ni temas claro/oscuro.
