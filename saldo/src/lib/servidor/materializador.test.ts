import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { dbEnMemoria } from './esquema';
import { anotar, crearCuenta, crearSuscripcion, movimientosDe, suscripcionesDe } from './consultas';
import { materializar } from './materializador';

const HOY = '2026-09-05';

let conn: DatabaseSync;
let cuentaId: number;

function cuenta(saldo: number) {
  return crearCuenta(conn, {
    tienda: 'App Store',
    region: 'España',
    regionId: 'es',
    divisa: 'EUR',
    locale: 'es-ES',
    saldo,
    hoy: '2026-01-01'
  });
}

function saldo(): number {
  return (conn.prepare('SELECT saldo FROM cuentas WHERE id = ?').get(cuentaId) as { saldo: number })
    .saldo;
}

beforeEach(() => {
  conn = dbEnMemoria();
});

describe('materializar', () => {
  it('aplica un cobro vencido y adelanta la fecha al mes siguiente', () => {
    cuentaId = cuenta(1000);
    crearSuscripcion(conn, {
      cuentaId,
      nombre: 'Filmin',
      periodo: 'mensual',
      importe: 799,
      primerCobro: '2026-09-01',
      esPrueba: false,
      hoy: '2026-08-01'
    });

    const hechos = materializar(conn, HOY);

    expect(hechos).toHaveLength(1);
    expect(saldo()).toBe(201);
    expect(suscripciones()[0].proximoCobro).toBe('2026-10-01');
  });

  it('es idempotente: pasarlo dos veces no cobra dos veces', () => {
    cuentaId = cuenta(1000);
    crearSuscripcion(conn, {
      cuentaId,
      nombre: 'Filmin',
      periodo: 'mensual',
      importe: 799,
      primerCobro: '2026-09-01',
      esPrueba: false,
      hoy: '2026-08-01'
    });

    materializar(conn, HOY);
    const segunda = materializar(conn, HOY);

    expect(segunda).toHaveLength(0);
    expect(saldo()).toBe(201);
  });

  it('se pone al dia si el NAS ha estado meses apagado', () => {
    cuentaId = cuenta(10000);
    crearSuscripcion(conn, {
      cuentaId,
      nombre: 'iCloud+',
      periodo: 'mensual',
      importe: 299,
      primerCobro: '2026-01-03',
      esPrueba: false,
      hoy: '2026-01-01'
    });

    // De enero a septiembre son nueve cobros: 3 de enero ... 3 de septiembre.
    const hechos = materializar(conn, HOY);

    expect(hechos).toHaveLength(9);
    expect(saldo()).toBe(10000 - 9 * 299);
    expect(suscripciones()[0].proximoCobro).toBe('2026-10-03');
    // Y en orden cronologico estricto.
    expect(hechos.map((h) => h.fecha)).toEqual([...hechos.map((h) => h.fecha)].sort());
  });

  it('lo que no cabe se pierde, el saldo no baja de cero y lo demas sigue', () => {
    cuentaId = cuenta(500);
    crearSuscripcion(conn, {
      cuentaId,
      nombre: 'Cara',
      periodo: 'mensual',
      importe: 5000,
      primerCobro: '2026-09-01',
      esPrueba: false,
      hoy: '2026-08-01'
    });
    crearSuscripcion(conn, {
      cuentaId,
      nombre: 'Barata',
      periodo: 'mensual',
      importe: 100,
      primerCobro: '2026-09-02',
      esPrueba: false,
      hoy: '2026-08-01'
    });

    const hechos = materializar(conn, HOY);

    expect(hechos.find((h) => h.nombre === 'Cara')?.perdida).toBe(true);
    expect(hechos.find((h) => h.nombre === 'Barata')?.perdida).toBe(false);
    expect(saldo()).toBe(400);

    const estados = Object.fromEntries(suscripciones().map((s) => [s.nombre, s.estado]));
    expect(estados).toEqual({ Cara: 'perdida', Barata: 'activa' });
  });

  it('al cobrarse por primera vez, deja de estar en prueba', () => {
    cuentaId = cuenta(1000);
    crearSuscripcion(conn, {
      cuentaId,
      nombre: 'Bear Pro',
      periodo: 'mensual',
      importe: 299,
      primerCobro: '2026-09-01',
      esPrueba: true,
      hoy: '2026-08-01'
    });

    materializar(conn, HOY);
    expect(suscripciones()[0].pruebaHasta).toBeNull();
  });

  it('cobra con el precio que habia el dia del cobro, no con el de hoy', () => {
    cuentaId = cuenta(10000);
    const id = crearSuscripcion(conn, {
      cuentaId,
      nombre: 'Filmin',
      periodo: 'mensual',
      importe: 799,
      primerCobro: '2026-09-01',
      esPrueba: false,
      hoy: '2026-01-01'
    });
    // Sube de precio DESPUES del cobro pendiente.
    conn
      .prepare('INSERT INTO precios (suscripcion_id, importe, desde) VALUES (?, ?, ?)')
      .run(id, 999, '2026-09-03');

    const hechos = materializar(conn, HOY);
    expect(hechos[0].importe).toBe(799);
  });

  it('deja el movimiento anotado con el saldo que quedo', () => {
    cuentaId = cuenta(1000);
    crearSuscripcion(conn, {
      cuentaId,
      nombre: 'Filmin',
      periodo: 'mensual',
      importe: 799,
      primerCobro: '2026-09-01',
      esPrueba: false,
      hoy: '2026-08-01'
    });
    materializar(conn, HOY);

    const m = movimientosDe(conn, cuentaId);
    expect(m[0]).toMatchObject({ tipo: 'cobro', importe: -799, saldoDespues: 201 });
  });
});

describe('anotar', () => {
  it('el saldo nunca baja de cero', () => {
    cuentaId = cuenta(100);
    anotar(conn, {
      cuentaId,
      fecha: HOY,
      tipo: 'ajuste',
      importe: -5000,
      concepto: 'Ajuste bestia'
    });
    expect(saldo()).toBe(0);
  });
});

function suscripciones() {
  return suscripcionesDe(conn, cuentaId, HOY);
}
