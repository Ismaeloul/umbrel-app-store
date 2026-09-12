import type { DatabaseSync } from 'node:sqlite';
import { diferenciaDias } from '$lib/motor/fechas';
import { formatear } from '$lib/dinero';
import { fechaLarga } from '$lib/ui';
import { preferencias } from './ajustes';
import { listarCuentas, resumenDe, suscripcionesDe } from './consultas';
import type { Aplicado } from './materializador';

/**
 * Como se llama la cuenta en un correo. Con tres App Store de la India, «App
 * Store · India» no dice cual es: la direccion con la que entras si. Si la
 * cuenta no tiene correo apuntado, se queda con tienda y region.
 */
export function nombreDe(cuenta: { correo: string; tienda: string; region: string }): string {
  const tienda = `${cuenta.tienda} · ${cuenta.region}`;
  return cuenta.correo ? `${cuenta.correo} (${tienda})` : tienda;
}

export interface Aviso {
  clave: string;
  /** 0 lo mas urgente. Una prueba a punto de perderse manda sobre el resto. */
  prioridad: number;
  titulo: string;
  detalle: string;
  /**
   * Cada cuantos dias volver a insistir mientras la cosa siga igual. `null` es
   * avisar una sola vez y callarse. Lo de «poco saldo» insiste hasta que
   * recargues, al ritmo que digan los ajustes.
   */
  repetirCada: number | null;
}


/**
 * Que hay que mirar hoy. Devuelve TODO lo que pasa, sin filtrar por lo ya
 * avisado: de eso se encarga `sinRepetir`.
 */
export function revisar(conn: DatabaseSync, hoy: string, aplicados: Aplicado[] = []): Aviso[] {
  const avisos: Aviso[] = [];
  const prefs = preferencias(conn);

  for (const cuenta of listarCuentas(conn)) {
    const nombre = nombreDe(cuenta);
    const { proyeccion } = resumenDe(conn, cuenta, hoy);

    // 1. Pruebas gratuitas que pasan a cobro pronto. Si ademas el saldo no va
    //    a llegar a ese dia, es el unico momento en que se pierde una prueba.
    for (const sub of suscripcionesDe(conn, cuenta.id, hoy)) {
      if (sub.estado !== 'activa' || !sub.pruebaHasta) continue;
      const faltan = diferenciaDias(hoy, sub.pruebaHasta);
      if (faltan < 0 || faltan > prefs.avisoPruebaDias) continue;

      const cobro = proyeccion.cobros.find((c) => c.suscripcionId === sub.id);
      const noLlega = cobro ? !cobro.cabe : false;

      avisos.push({
        clave: `prueba:${sub.id}:${sub.pruebaHasta}`,
        prioridad: noLlega ? 0 : 2,
        repetirCada: null,
        titulo: noLlega
          ? `Vas a perder la prueba de ${sub.nombre}`
          : `${sub.nombre} pasa a cobro en ${faltan} días`,
        detalle: noLlega
          ? `${nombre}: el ${fechaLarga(sub.pruebaHasta, hoy)} se cobran ${formatear(sub.importe, cuenta.divisa, cuenta.locale)} y el saldo proyectado no llega. Recarga antes de esa fecha o cancélala.`
          : `${nombre}: el ${fechaLarga(sub.pruebaHasta, hoy)} empieza a cobrar ${formatear(sub.importe, cuenta.divisa, cuenta.locale)}.`
      });
    }

    // 2. Cuentas con poco margen.
    if (proyeccion.primerFallo && proyeccion.diasRestantes <= prefs.avisoDias) {
      avisos.push({
        clave: `margen:${cuenta.id}:${proyeccion.seAgotaEl}`,
        prioridad: 1,
        repetirCada: prefs.recordarCada,
        titulo: `A ${nombre} le quedan ${proyeccion.diasRestantes} días de saldo`,
        detalle: `Se queda sin saldo el ${fechaLarga(proyeccion.seAgotaEl!, hoy)}, en el cobro de ${proyeccion.primerFallo.nombre} (${formatear(proyeccion.primerFallo.importe, cuenta.divisa, cuenta.locale)}). Ahora mismo tiene ${formatear(cuenta.saldo, cuenta.divisa, cuenta.locale)}.`
      });
    }
  }

  // 3. Lo que se ha perdido hoy de verdad, al aplicar los cobros vencidos.
  for (const a of aplicados.filter((x) => x.perdida)) {
    const cuenta = listarCuentas(conn).find((c) => c.id === a.cuentaId);
    if (!cuenta) continue;
    avisos.push({
      clave: `perdida:${a.suscripcionId}:${a.fecha}`,
      prioridad: 0,
      repetirCada: null,
      titulo: `Se ha perdido ${a.nombre}`,
      detalle: `${nombreDe(cuenta)}: el cobro del ${fechaLarga(a.fecha, hoy)} por ${formatear(a.importe, cuenta.divisa, cuenta.locale)} no cabía en el saldo.`
    });
  }

  return avisos.sort((a, b) => a.prioridad - b.prioridad);
}

/**
 * Quita lo ya avisado, para no mandar el mismo correo todos los dias. Lo que
 * tiene `repetirCada` vuelve a salir pasados esos dias: el de poco saldo
 * insiste cada semana mientras no recargues, porque un aviso que se dice una
 * sola vez y hace un mes se olvida.
 */
export function sinRepetir(conn: DatabaseSync, avisos: Aviso[], hoy: string): Aviso[] {
  const consulta = conn.prepare('SELECT enviado FROM avisos WHERE clave = ?');

  return avisos.filter((a) => {
    const fila = consulta.get(a.clave) as { enviado: string } | undefined;
    if (fila === undefined) return true;
    if (a.repetirCada === null) return false;
    return diferenciaDias(fila.enviado, hoy) >= a.repetirCada;
  });
}

export function marcarEnviados(conn: DatabaseSync, avisos: Aviso[], hoy: string): void {
  const insertar = conn.prepare(
    'INSERT OR REPLACE INTO avisos (clave, enviado) VALUES (?, ?)'
  );
  for (const a of avisos) insertar.run(a.clave, hoy);
}
