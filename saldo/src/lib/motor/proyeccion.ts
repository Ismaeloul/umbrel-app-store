// EL MOTOR. Es TypeScript puro: no toca la base de datos, no mira el reloj y
// no importa nada de SvelteKit. Todo entra por parametro, «hoy» incluido.
// Por eso puede correr igual en el servidor y en el navegador, que es lo que
// hace instantaneo el simulador de recargas.

import { diferenciaDias, siguienteCobro, sumarDias, type Periodo } from './fechas';

export interface SuscripcionProyectable {
  id: number;
  nombre: string;
  /** Entero en la unidad menor de la divisa de la cuenta. */
  importe: number;
  periodo: Periodo;
  proximoCobro: string;
  anclaDia: number;
  anclaMes: number | null;
  /** Si esta en prueba, el dia en que pasa a cobro. */
  pruebaHasta: string | null;
}

export interface Cobro {
  fecha: string;
  suscripcionId: number;
  nombre: string;
  importe: number;
  /** false = no habia saldo. Ese es el cobro que se pierde. */
  cabe: boolean;
  saldoDespues: number;
  finDePrueba: boolean;
}

export interface Proyeccion {
  cobros: Cobro[];
  /** El primer cobro que no cabe. Es lo que fija el margen de verdad. */
  primerFallo: Cobro | null;
  diasRestantes: number;
  seAgotaEl: string | null;
  horizonte: string;
  /** true si el saldo aguanta todo el horizonte sin perder nada. */
  aguantaTodo: boolean;
}

const MESES_HORIZONTE = 24;

/**
 * Simula cobro a cobro hasta el horizonte.
 *
 * El margen NO es una media: si hay saldo para ocho mensualidades pero una
 * anual cae dentro de tres meses y no cabe, lo que quedan son tres meses.
 *
 * Reglas que no se negocian:
 *  - El saldo nunca baja de cero: un cobro que no cabe simplemente no se aplica.
 *  - La suscripcion cuyo cobro falla se da por perdida y deja de cobrar, pero
 *    las demas siguen su curso.
 */
export function proyectar(opciones: {
  saldo: number;
  suscripciones: SuscripcionProyectable[];
  hoy: string;
  meses?: number;
}): Proyeccion {
  const { saldo: saldoInicial, suscripciones, hoy } = opciones;
  const meses = opciones.meses ?? MESES_HORIZONTE;
  const horizonte = sumarDias(hoy, Math.round(meses * 30.44));

  // Copia de trabajo: el motor no toca lo que le pasan.
  const vivas = suscripciones
    .filter((s) => s.importe > 0)
    .map((s) => ({ ...s, fecha: s.proximoCobro < hoy ? hoy : s.proximoCobro }));

  let saldo = saldoInicial;
  const cobros: Cobro[] = [];

  while (vivas.length > 0) {
    // El siguiente cobro es el mas temprano; a igualdad de fecha, el de id
    // menor, para que dos ejecuciones den siempre lo mismo.
    let i = 0;
    for (let j = 1; j < vivas.length; j++) {
      if (
        vivas[j].fecha < vivas[i].fecha ||
        (vivas[j].fecha === vivas[i].fecha && vivas[j].id < vivas[i].id)
      ) {
        i = j;
      }
    }

    const sub = vivas[i];
    if (sub.fecha > horizonte) break;

    const cabe = sub.importe <= saldo;
    if (cabe) saldo -= sub.importe;

    cobros.push({
      fecha: sub.fecha,
      suscripcionId: sub.id,
      nombre: sub.nombre,
      importe: sub.importe,
      cabe,
      saldoDespues: saldo,
      finDePrueba: sub.pruebaHasta !== null && sub.pruebaHasta === sub.fecha
    });

    if (cabe) {
      sub.fecha = siguienteCobro(sub.fecha, sub.periodo, sub.anclaDia, sub.anclaMes);
    } else {
      // Se pierde: deja de cobrar. Las demas siguen.
      vivas.splice(i, 1);
    }
  }

  const primerFallo = cobros.find((c) => !c.cabe) ?? null;

  return {
    cobros,
    primerFallo,
    diasRestantes: diferenciaDias(hoy, primerFallo ? primerFallo.fecha : horizonte),
    seAgotaEl: primerFallo ? primerFallo.fecha : null,
    horizonte,
    aguantaTodo: primerFallo === null
  };
}

/** Cuanto aguantaria la cuenta si le metieras `extra` ahora mismo. */
export function simularRecarga(
  opciones: { saldo: number; suscripciones: SuscripcionProyectable[]; hoy: string; meses?: number },
  extra: number
): Proyeccion {
  return proyectar({ ...opciones, saldo: opciones.saldo + extra });
}
