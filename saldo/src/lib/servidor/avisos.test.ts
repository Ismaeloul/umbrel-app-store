import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { dbEnMemoria } from './esquema';
import { crearCuenta, crearSuscripcion } from './consultas';
import { marcarEnviados, revisar, sinRepetir } from './avisos';
import { guardarPreferencias } from './ajustes';

const HOY = '2026-09-05';

let conn: DatabaseSync;
let cuentaId: number;

beforeEach(() => {
  conn = dbEnMemoria();
  cuentaId = crearCuenta(conn, {
    correo: 'la-mia@ejemplo.com',
    tienda: 'App Store',
    region: 'España',
    regionId: 'es',
    divisa: 'EUR',
    locale: 'es-ES',
    saldo: 1000,
    hoy: '2026-01-01'
  });
});

/** Una mensual que se come TODO el saldo en su primer cobro. */
function mensualQueVacia(primerCobro: string) {
  crearSuscripcion(conn, {
    cuentaId,
    nombre: 'Filmin',
    periodo: 'mensual',
    importe: 1000,
    primerCobro,
    esPrueba: false,
    hoy: '2026-01-01'
  });
}

describe('aviso de poco saldo', () => {
  it('avisa cuando queda justo un mes', () => {
    // Cobra hoy y deja el saldo a cero; el del 5 de octubre ya no cabe.
    mensualQueVacia(HOY);

    const avisos = revisar(conn, HOY);
    const margen = avisos.find((a) => a.clave.startsWith('margen:'));

    // Intl separa el importe del simbolo con un espacio que no es el normal
    // (duro o fino, segun la version de ICU). Se normaliza cualquiera.
    const detalle = (margen?.detalle ?? '').replace(/\s/g, ' ');

    expect(margen?.titulo).toBe('A App Store · España le quedan 30 días de saldo');
    expect(detalle).toContain('Se queda sin saldo el 5 de octubre');
    expect(detalle).toContain('en el cobro de Filmin (10,00 €)');
    expect(detalle).toContain('Ahora mismo tiene 10,00 €');
  });

  it('con 31 dias todavia no molesta', () => {
    mensualQueVacia('2026-09-06');

    expect(revisar(conn, HOY).filter((a) => a.clave.startsWith('margen:'))).toHaveLength(0);
  });

  it('el umbral se puede cambiar desde los ajustes', () => {
    mensualQueVacia('2026-09-06'); // 31 dias

    guardarPreferencias(conn, { avisoDias: 45 });
    expect(revisar(conn, HOY).filter((a) => a.clave.startsWith('margen:'))).toHaveLength(1);
  });

  it('por defecto insiste TODOS los dias hasta que recargues', () => {
    mensualQueVacia(HOY);
    marcarEnviados(conn, sinRepetir(conn, revisar(conn, HOY), HOY), HOY);

    for (const dia of ['2026-09-06', '2026-09-07', '2026-09-08']) {
      const hoy = sinRepetir(conn, revisar(conn, dia), dia);
      expect(hoy).toHaveLength(1);
      marcarEnviados(conn, hoy, dia);
    }
  });

  it('pero no repite dentro del mismo dia, aunque reinicies la app', () => {
    mensualQueVacia(HOY);
    marcarEnviados(conn, sinRepetir(conn, revisar(conn, HOY), HOY), HOY);

    expect(sinRepetir(conn, revisar(conn, HOY), HOY)).toHaveLength(0);
  });

  it('el ritmo se puede espaciar desde los ajustes', () => {
    guardarPreferencias(conn, { recordarCada: 7 });
    mensualQueVacia(HOY);
    marcarEnviados(conn, sinRepetir(conn, revisar(conn, HOY), HOY), HOY);

    // A los seis dias se calla; al septimo vuelve.
    expect(sinRepetir(conn, revisar(conn, '2026-09-11'), '2026-09-11')).toHaveLength(0);
    expect(sinRepetir(conn, revisar(conn, '2026-09-12'), '2026-09-12')).toHaveLength(1);
  });

  it('el aviso de fin de prueba NO se repite: la ventana es corta', () => {
    crearSuscripcion(conn, {
      cuentaId,
      nombre: 'Bear Pro',
      periodo: 'mensual',
      importe: 299,
      primerCobro: '2026-09-10',
      esPrueba: true,
      hoy: '2026-01-01'
    });

    const primera = sinRepetir(conn, revisar(conn, HOY), HOY);
    expect(primera).toHaveLength(1);
    marcarEnviados(conn, primera, HOY);

    expect(sinRepetir(conn, revisar(conn, '2026-09-08'), '2026-09-08')).toHaveLength(0);
  });

  it('si el saldo aguanta de sobra, no hay aviso', () => {
    crearSuscripcion(conn, {
      cuentaId,
      nombre: 'Barata',
      periodo: 'mensual',
      importe: 10,
      primerCobro: '2026-09-20',
      esPrueba: false,
      hoy: '2026-01-01'
    });

    expect(revisar(conn, HOY)).toHaveLength(0);
  });

  it('sin suscripciones no hay nada que avisar', () => {
    expect(revisar(conn, HOY)).toHaveLength(0);
  });
});

describe('aviso de fin de prueba', () => {
  it('avisa unos dias antes de que la prueba pase a cobro', () => {
    crearSuscripcion(conn, {
      cuentaId,
      nombre: 'Bear Pro',
      periodo: 'mensual',
      importe: 299,
      primerCobro: '2026-09-10',
      esPrueba: true,
      hoy: '2026-01-01'
    });

    const aviso = revisar(conn, HOY).find((a) => a.clave.startsWith('prueba:'));
    expect(aviso?.titulo).toBe('Bear Pro pasa a cobro en 5 días');
  });

  it('si el saldo no llega a ese dia, el aviso manda sobre todo lo demas', () => {
    // Se come el saldo el dia 8; el 10 la prueba pasa a cobro y no cabe.
    mensualQueVacia('2026-09-08');
    crearSuscripcion(conn, {
      cuentaId,
      nombre: 'Bear Pro',
      periodo: 'mensual',
      importe: 299,
      primerCobro: '2026-09-10',
      esPrueba: true,
      hoy: '2026-01-01'
    });

    const avisos = revisar(conn, HOY);
    expect(avisos[0].titulo).toBe('Vas a perder la prueba de Bear Pro');
    expect(avisos[0].prioridad).toBe(0);
  });
});
