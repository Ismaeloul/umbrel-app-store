import type { DatabaseSync } from 'node:sqlite';
import { siguienteCobro } from '$lib/motor/fechas';
import { anotar, listarCuentas, suscripcionesDe } from './consultas';

// Convierte en movimientos reales los cobros que ya han vencido. Es
// idempotente: si el NAS ha estado tres semanas apagado, al arrancar se pone
// al dia aplicandolos en orden cronologico estricto, uno a uno, como si
// hubiera estado encendido.

export interface Aplicado {
  cuentaId: number;
  suscripcionId: number;
  nombre: string;
  fecha: string;
  importe: number;
  perdida: boolean;
}

// Un cobro mensual desde 1970 no llega a 700 iteraciones. El tope es una red
// de seguridad contra datos corruptos, no una regla de negocio.
const TOPE = 5000;

export function materializar(conn: DatabaseSync, hoy: string): Aplicado[] {
  const hechos: Aplicado[] = [];

  for (const cuenta of listarCuentas(conn)) {
    let vueltas = 0;

    while (vueltas++ < TOPE) {
      const pendientes = suscripcionesDe(conn, cuenta.id, hoy)
        .filter((s) => s.estado === 'activa' && s.proximoCobro <= hoy)
        .sort((a, b) => (a.proximoCobro === b.proximoCobro ? a.id - b.id : a.proximoCobro < b.proximoCobro ? -1 : 1));

      const sub = pendientes[0];
      if (!sub) break;

      // El precio vigente el dia del cobro, no el de hoy.
      const importe =
        (
          conn
            .prepare(
              `SELECT importe FROM precios
                WHERE suscripcion_id = ? AND desde <= ?
                ORDER BY desde DESC, id DESC LIMIT 1`
            )
            .get(sub.id, sub.proximoCobro) as { importe: number } | undefined
        )?.importe ?? sub.importe;

      const saldo =
        (conn.prepare('SELECT saldo FROM cuentas WHERE id = ?').get(cuenta.id) as
          | { saldo: number }
          | undefined)?.saldo ?? 0;

      if (importe > 0 && importe <= saldo) {
        anotar(conn, {
          cuentaId: cuenta.id,
          fecha: sub.proximoCobro,
          tipo: 'cobro',
          importe: -importe,
          concepto: sub.nombre,
          suscripcionId: sub.id
        });

        conn
          .prepare(
            `UPDATE suscripciones
                SET proximo_cobro = ?, prueba_hasta = NULL
              WHERE id = ?`
          )
          .run(siguienteCobro(sub.proximoCobro, sub.periodo, sub.anclaDia, sub.anclaMes), sub.id);

        hechos.push({
          cuentaId: cuenta.id,
          suscripcionId: sub.id,
          nombre: sub.nombre,
          fecha: sub.proximoCobro,
          importe,
          perdida: false
        });
      } else {
        // No cabe: esa suscripcion se pierde y deja de cobrar. Las demas de la
        // cuenta siguen su curso, y el saldo no baja de cero.
        conn.prepare("UPDATE suscripciones SET estado = 'perdida' WHERE id = ?").run(sub.id);
        anotar(conn, {
          cuentaId: cuenta.id,
          fecha: sub.proximoCobro,
          tipo: 'perdida',
          importe: 0,
          concepto: `${sub.nombre}: no había saldo`,
          suscripcionId: sub.id
        });

        hechos.push({
          cuentaId: cuenta.id,
          suscripcionId: sub.id,
          nombre: sub.nombre,
          fecha: sub.proximoCobro,
          importe,
          perdida: true
        });
      }
    }
  }

  return hechos;
}
