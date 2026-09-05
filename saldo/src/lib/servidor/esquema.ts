import { DatabaseSync } from 'node:sqlite';

// El esquema vive aparte de `db.ts` a proposito: asi los tests pueden abrir una
// base en memoria sin arrastrar la configuracion ni las variables de entorno.

export const ESQUEMA = `
CREATE TABLE IF NOT EXISTS cuentas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- La direccion con la que entras en esa tienda. Es lo que distingue una
  -- cuenta de otra cuando tienes tres App Store distintas.
  correo        TEXT    NOT NULL DEFAULT '',
  tienda        TEXT    NOT NULL,
  region        TEXT    NOT NULL,
  region_id     TEXT    NOT NULL,
  divisa        TEXT    NOT NULL,
  locale        TEXT    NOT NULL,
  saldo         INTEGER NOT NULL DEFAULT 0,
  notas         TEXT    NOT NULL DEFAULT '',
  creada        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS suscripciones (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id      INTEGER NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre         TEXT    NOT NULL,
  periodo        TEXT    NOT NULL CHECK (periodo IN ('mensual', 'anual')),
  proximo_cobro  TEXT    NOT NULL,
  ancla_dia      INTEGER NOT NULL,
  ancla_mes      INTEGER,
  prueba_hasta   TEXT,
  estado         TEXT    NOT NULL DEFAULT 'activa'
                 CHECK (estado IN ('activa', 'perdida', 'cancelada')),
  creada         TEXT    NOT NULL
);

-- El precio JAMAS se actualiza: cambiar de precio anade una fila. Asi el
-- historial sigue cuadrando con lo que se cobro de verdad en su dia.
CREATE TABLE IF NOT EXISTS precios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  suscripcion_id  INTEGER NOT NULL REFERENCES suscripciones(id) ON DELETE CASCADE,
  importe         INTEGER NOT NULL,
  desde           TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS movimientos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id       INTEGER NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  fecha           TEXT    NOT NULL,
  tipo            TEXT    NOT NULL CHECK (tipo IN ('recarga', 'cobro', 'ajuste', 'perdida')),
  importe         INTEGER NOT NULL,
  concepto        TEXT    NOT NULL,
  suscripcion_id  INTEGER,
  saldo_despues   INTEGER NOT NULL,
  anotado         TEXT    NOT NULL
);

-- Memoria de lo ya avisado, para no mandar el mismo correo cada dia hasta que
-- recargues.
CREATE TABLE IF NOT EXISTS avisos (
  clave    TEXT PRIMARY KEY,
  enviado  TEXT NOT NULL
);

-- Ajustes que se tocan desde la app (la cuenta de correo, los umbrales) y la
-- nota suelta. Lo que hay aqui manda sobre las variables de entorno.
CREATE TABLE IF NOT EXISTS ajustes (
  clave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suscripciones_cuenta ON suscripciones(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_precios_suscripcion ON precios(suscripcion_id, desde);
CREATE INDEX IF NOT EXISTS idx_movimientos_cuenta ON movimientos(cuenta_id, fecha DESC, id DESC);
`;

/**
 * Columnas anadidas despues de la primera version. `CREATE TABLE IF NOT EXISTS`
 * no toca una tabla que ya existe, asi que las bases de datos viejas se
 * completan aqui. Es idempotente: mirar y anadir solo lo que falte.
 */
export function completarEsquema(conn: DatabaseSync): void {
  const columnas = (tabla: string) =>
    (conn.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).map((c) => c.name);

  if (!columnas('cuentas').includes('correo')) {
    conn.exec("ALTER TABLE cuentas ADD COLUMN correo TEXT NOT NULL DEFAULT ''");
  }
}

/** Una base en memoria con el esquema puesto. La usan los tests. */
export function dbEnMemoria(): DatabaseSync {
  const conexion = new DatabaseSync(':memory:');
  conexion.exec('PRAGMA foreign_keys = ON');
  conexion.exec(ESQUEMA);
  completarEsquema(conexion);
  return conexion;
}
