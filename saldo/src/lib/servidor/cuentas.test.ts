import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { completarEsquema, dbEnMemoria } from './esquema';
import { crearCuenta, cuenta, listarCuentas } from './consultas';

let conn: DatabaseSync;

const BASE = {
  tienda: 'App Store',
  region: 'España',
  regionId: 'es',
  divisa: 'EUR',
  locale: 'es-ES',
  hoy: '2026-09-05'
};

beforeEach(() => {
  conn = dbEnMemoria();
});

describe('crearCuenta', () => {
  it('guarda el correo, las notas y el saldo de partida', () => {
    const id = crearCuenta(conn, {
      ...BASE,
      correo: 'la-de-ios@ejemplo.com',
      notas: 'La recargo con la prepago azul',
      saldo: 1235
    });

    const c = cuenta(conn, id)!;
    expect(c.correo).toBe('la-de-ios@ejemplo.com');
    expect(c.notas).toBe('La recargo con la prepago azul');
    expect(c.saldo).toBe(1235);
  });

  it('el correo y las notas pueden ir vacios', () => {
    const id = crearCuenta(conn, { ...BASE, saldo: 0 });
    const c = cuenta(conn, id)!;
    expect(c.correo).toBe('');
    expect(c.notas).toBe('');
  });

  it('dos cuentas de la misma tienda se distinguen por el correo', () => {
    crearCuenta(conn, { ...BASE, correo: 'la-mia@ejemplo.com', saldo: 0 });
    crearCuenta(conn, { ...BASE, correo: 'la-otra@ejemplo.com', saldo: 0 });

    expect(listarCuentas(conn).map((c) => c.correo)).toEqual([
      'la-mia@ejemplo.com',
      'la-otra@ejemplo.com'
    ]);
  });

  it('el saldo de partida queda anotado como movimiento', () => {
    const id = crearCuenta(conn, { ...BASE, saldo: 1235 });
    const m = conn
      .prepare('SELECT tipo, importe, saldo_despues FROM movimientos WHERE cuenta_id = ?')
      .all(id) as { tipo: string; importe: number; saldo_despues: number }[];

    expect(m).toEqual([{ tipo: 'recarga', importe: 1235, saldo_despues: 1235 }]);
  });

  it('con saldo cero no se inventa un movimiento', () => {
    const id = crearCuenta(conn, { ...BASE, saldo: 0 });
    const m = conn.prepare('SELECT count(*) c FROM movimientos WHERE cuenta_id = ?').get(id) as {
      c: number;
    };
    expect(m.c).toBe(0);
  });
});

describe('completarEsquema', () => {
  it('anade el correo a una base creada antes de que existiera esa columna', () => {
    // Una base de datos «vieja»: la tabla sin la columna `correo`.
    const vieja = new DatabaseSync(':memory:');
    vieja.exec(`CREATE TABLE cuentas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tienda TEXT NOT NULL, region TEXT NOT NULL,
      region_id TEXT NOT NULL, divisa TEXT NOT NULL, locale TEXT NOT NULL,
      saldo INTEGER NOT NULL DEFAULT 0, notas TEXT NOT NULL DEFAULT '', creada TEXT NOT NULL)`);
    vieja
      .prepare(
        `INSERT INTO cuentas (tienda, region, region_id, divisa, locale, saldo, creada)
         VALUES ('App Store', 'España', 'es', 'EUR', 'es-ES', 500, '2026-01-01')`
      )
      .run();

    completarEsquema(vieja);

    const c = vieja.prepare('SELECT correo, saldo FROM cuentas').get() as {
      correo: string;
      saldo: number;
    };
    expect(c.correo).toBe('');
    expect(c.saldo).toBe(500);
  });

  it('pasarlo dos veces no rompe nada', () => {
    expect(() => {
      completarEsquema(conn);
      completarEsquema(conn);
    }).not.toThrow();
  });
});
