import type { DatabaseSync } from 'node:sqlite';
import { anclaDe, type Periodo } from '$lib/motor/fechas';
import { proyectar, type Proyeccion, type SuscripcionProyectable } from '$lib/motor/proyeccion';

export interface Cuenta {
  id: number;
  /** La direccion con la que entras en esa tienda. Puede ir vacia. */
  correo: string;
  tienda: string;
  region: string;
  regionId: string;
  divisa: string;
  locale: string;
  saldo: number;
  notas: string;
  creada: string;
}

export interface Suscripcion {
  id: number;
  cuentaId: number;
  nombre: string;
  periodo: Periodo;
  proximoCobro: string;
  anclaDia: number;
  anclaMes: number | null;
  pruebaHasta: string | null;
  estado: 'activa' | 'perdida' | 'cancelada';
  importe: number;
}

export interface Movimiento {
  id: number;
  fecha: string;
  tipo: 'recarga' | 'cobro' | 'ajuste' | 'perdida';
  importe: number;
  concepto: string;
  saldoDespues: number;
}

/* ---------------------------------------------------------------- cuentas */

export function listarCuentas(conn: DatabaseSync): Cuenta[] {
  return conn
    .prepare(
      `SELECT id, correo, tienda, region, region_id AS regionId, divisa, locale, saldo, notas, creada
         FROM cuentas ORDER BY id`
    )
    .all() as unknown as Cuenta[];
}

export function cuenta(conn: DatabaseSync, id: number): Cuenta | null {
  const fila = conn
    .prepare(
      `SELECT id, correo, tienda, region, region_id AS regionId, divisa, locale, saldo, notas, creada
         FROM cuentas WHERE id = ?`
    )
    .get(id);
  return (fila as unknown as Cuenta) ?? null;
}

export function crearCuenta(
  conn: DatabaseSync,
  datos: {
    correo?: string;
    tienda: string;
    region: string;
    regionId: string;
    divisa: string;
    locale: string;
    saldo: number;
    notas?: string;
    hoy: string;
  }
): number {
  const r = conn
    .prepare(
      `INSERT INTO cuentas (correo, tienda, region, region_id, divisa, locale, saldo, notas, creada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      datos.correo ?? '',
      datos.tienda,
      datos.region,
      datos.regionId,
      datos.divisa,
      datos.locale,
      datos.saldo,
      datos.notas ?? '',
      datos.hoy
    );

  const id = Number(r.lastInsertRowid);
  if (datos.saldo > 0) {
    conn
      .prepare(
        `INSERT INTO movimientos (cuenta_id, fecha, tipo, importe, concepto, saldo_despues, anotado)
         VALUES (?, ?, 'recarga', ?, 'Saldo inicial', ?, ?)`
      )
      .run(id, datos.hoy, datos.saldo, datos.saldo, new Date().toISOString());
  }
  return id;
}

export function borrarCuenta(conn: DatabaseSync, id: number): void {
  conn.prepare('DELETE FROM cuentas WHERE id = ?').run(id);
}

export function guardarNotas(conn: DatabaseSync, id: number, notas: string): void {
  conn.prepare('UPDATE cuentas SET notas = ? WHERE id = ?').run(notas, id);
}

/* ---------------------------------------------------------- suscripciones */

/**
 * El precio se lee SIEMPRE de `precios`, nunca de `suscripciones`: se coge la
 * fila vigente en la fecha pedida, que es la de `desde` mas alto que no sea
 * posterior.
 */
const SUSCRIPCIONES = `
  SELECT s.id, s.cuenta_id AS cuentaId, s.nombre, s.periodo,
         s.proximo_cobro AS proximoCobro, s.ancla_dia AS anclaDia,
         s.ancla_mes AS anclaMes, s.prueba_hasta AS pruebaHasta, s.estado,
         COALESCE((SELECT p.importe FROM precios p
                    WHERE p.suscripcion_id = s.id AND p.desde <= ?
                    ORDER BY p.desde DESC, p.id DESC LIMIT 1), 0) AS importe
    FROM suscripciones s
   WHERE s.cuenta_id = ?`;

export function suscripcionesDe(
  conn: DatabaseSync,
  cuentaId: number,
  hoy: string
): Suscripcion[] {
  return conn
    .prepare(`${SUSCRIPCIONES} ORDER BY s.proximo_cobro, s.id`)
    .all(hoy, cuentaId) as unknown as Suscripcion[];
}

export function proyectablesDe(
  conn: DatabaseSync,
  cuentaId: number,
  hoy: string
): SuscripcionProyectable[] {
  return suscripcionesDe(conn, cuentaId, hoy)
    .filter((s) => s.estado === 'activa')
    .map((s) => ({
      id: s.id,
      nombre: s.nombre,
      importe: s.importe,
      periodo: s.periodo,
      proximoCobro: s.proximoCobro,
      anclaDia: s.anclaDia,
      anclaMes: s.anclaMes,
      pruebaHasta: s.pruebaHasta
    }));
}

export function crearSuscripcion(
  conn: DatabaseSync,
  datos: {
    cuentaId: number;
    nombre: string;
    periodo: Periodo;
    importe: number;
    primerCobro: string;
    esPrueba: boolean;
    hoy: string;
  }
): number {
  // El ancla se deriva de la fecha del primer cobro y ya no se mueve: es lo
  // que evita que las fechas vayan derivando mes a mes.
  const ancla = anclaDe(datos.primerCobro, datos.periodo);

  const r = conn
    .prepare(
      `INSERT INTO suscripciones
         (cuenta_id, nombre, periodo, proximo_cobro, ancla_dia, ancla_mes, prueba_hasta, creada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      datos.cuentaId,
      datos.nombre,
      datos.periodo,
      datos.primerCobro,
      ancla.dia,
      ancla.mes,
      datos.esPrueba ? datos.primerCobro : null,
      datos.hoy
    );

  const id = Number(r.lastInsertRowid);
  conn
    .prepare('INSERT INTO precios (suscripcion_id, importe, desde) VALUES (?, ?, ?)')
    .run(id, datos.importe, datos.hoy);
  return id;
}

export function cambiarPrecio(
  conn: DatabaseSync,
  suscripcionId: number,
  importe: number,
  desde: string
): void {
  conn
    .prepare('INSERT INTO precios (suscripcion_id, importe, desde) VALUES (?, ?, ?)')
    .run(suscripcionId, importe, desde);
}

export function cancelarSuscripcion(conn: DatabaseSync, id: number): void {
  conn.prepare("UPDATE suscripciones SET estado = 'cancelada' WHERE id = ?").run(id);
}

export function borrarSuscripcion(conn: DatabaseSync, id: number): void {
  conn.prepare('DELETE FROM suscripciones WHERE id = ?').run(id);
}

/** Reactivar una perdida vuelve a anclarla al proximo cobro que le toque. */
export function reactivarSuscripcion(
  conn: DatabaseSync,
  id: number,
  proximoCobro: string
): void {
  const periodo = (
    conn.prepare('SELECT periodo FROM suscripciones WHERE id = ?').get(id) as
      | { periodo: Periodo }
      | undefined
  )?.periodo;
  if (!periodo) return;

  const ancla = anclaDe(proximoCobro, periodo);
  conn
    .prepare(
      `UPDATE suscripciones
          SET estado = 'activa', proximo_cobro = ?, ancla_dia = ?, ancla_mes = ?
        WHERE id = ?`
    )
    .run(proximoCobro, ancla.dia, ancla.mes, id);
}

/* ------------------------------------------------------------ movimientos */

/**
 * Anota un movimiento y deja el saldo al dia. El saldo NUNCA baja de cero:
 * si te piden restar mas de lo que hay, se queda en cero.
 */
export function anotar(
  conn: DatabaseSync,
  datos: {
    cuentaId: number;
    fecha: string;
    tipo: Movimiento['tipo'];
    importe: number;
    concepto: string;
    suscripcionId?: number | null;
  }
): number {
  const actual =
    (conn.prepare('SELECT saldo FROM cuentas WHERE id = ?').get(datos.cuentaId) as
      | { saldo: number }
      | undefined)?.saldo ?? 0;

  const despues = Math.max(0, actual + datos.importe);
  conn.prepare('UPDATE cuentas SET saldo = ? WHERE id = ?').run(despues, datos.cuentaId);
  conn
    .prepare(
      `INSERT INTO movimientos
         (cuenta_id, fecha, tipo, importe, concepto, suscripcion_id, saldo_despues, anotado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      datos.cuentaId,
      datos.fecha,
      datos.tipo,
      datos.importe,
      datos.concepto,
      datos.suscripcionId ?? null,
      despues,
      new Date().toISOString()
    );
  return despues;
}

export function movimientosDe(
  conn: DatabaseSync,
  cuentaId: number,
  limite = 30
): Movimiento[] {
  return conn
    .prepare(
      `SELECT id, fecha, tipo, importe, concepto, saldo_despues AS saldoDespues
         FROM movimientos WHERE cuenta_id = ?
        ORDER BY fecha DESC, id DESC LIMIT ?`
    )
    .all(cuentaId, limite) as unknown as Movimiento[];
}

/* --------------------------------------------------------------- resumen */

export interface Resumen {
  cuenta: Cuenta;
  proyeccion: Proyeccion;
  activas: number;
}

export function resumenDe(conn: DatabaseSync, c: Cuenta, hoy: string): Resumen {
  const suscripciones = proyectablesDe(conn, c.id, hoy);
  return {
    cuenta: c,
    proyeccion: proyectar({ saldo: c.saldo, suscripciones, hoy }),
    activas: suscripciones.length
  };
}

/** Todas las cuentas, ordenadas por la que antes se queda sin saldo. */
export function panel(conn: DatabaseSync, hoy: string): Resumen[] {
  return listarCuentas(conn)
    .map((c) => resumenDe(conn, c, hoy))
    .sort((a, b) => a.proyeccion.diasRestantes - b.proyeccion.diasRestantes);
}
