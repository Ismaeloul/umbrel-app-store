import { describe, expect, it } from 'vitest';
import { proyectar, simularRecarga, type SuscripcionProyectable } from './proyeccion';

const HOY = '2026-09-05';

// El caso del diseño, con las cifras exactas que se enseñan en las pantallas.
const CUENTA: SuscripcionProyectable[] = [
  {
    id: 1,
    nombre: 'iCloud+ 2 TB',
    importe: 299,
    periodo: 'mensual',
    proximoCobro: '2026-10-03',
    anclaDia: 3,
    anclaMes: null,
    pruebaHasta: null
  },
  {
    id: 2,
    nombre: 'Filmin',
    importe: 799,
    periodo: 'mensual',
    proximoCobro: '2026-09-12',
    anclaDia: 12,
    anclaMes: null,
    pruebaHasta: null
  },
  {
    id: 3,
    nombre: 'Bear Pro',
    importe: 299,
    periodo: 'mensual',
    proximoCobro: '2026-09-19',
    anclaDia: 19,
    anclaMes: null,
    pruebaHasta: '2026-09-19'
  }
];

describe('proyectar', () => {
  it('el margen sale del primer cobro que no cabe, no de una media', () => {
    const p = proyectar({ saldo: 1235, suscripciones: CUENTA, hoy: HOY });

    expect(p.primerFallo?.nombre).toBe('iCloud+ 2 TB');
    expect(p.seAgotaEl).toBe('2026-10-03');
    expect(p.diasRestantes).toBe(28);
    expect(p.aguantaTodo).toBe(false);
  });

  it('va dejando el saldo que queda tras cada cobro', () => {
    const p = proyectar({ saldo: 1235, suscripciones: CUENTA, hoy: HOY });
    const hasta = p.cobros.slice(0, 3).map((c) => [c.fecha, c.saldoDespues, c.cabe]);

    expect(hasta).toEqual([
      ['2026-09-12', 436, true],
      ['2026-09-19', 137, true],
      ['2026-10-03', 137, false]
    ]);
  });

  it('el saldo nunca baja de cero: el cobro que no cabe no se aplica', () => {
    const p = proyectar({ saldo: 1235, suscripciones: CUENTA, hoy: HOY });
    expect(Math.min(...p.cobros.map((c) => c.saldoDespues))).toBeGreaterThanOrEqual(0);
  });

  it('marca el cobro que es fin de una prueba gratuita', () => {
    const p = proyectar({ saldo: 1235, suscripciones: CUENTA, hoy: HOY });
    const bear = p.cobros.find((c) => c.suscripcionId === 3);
    expect(bear?.finDePrueba).toBe(true);
  });

  it('una anual que no cabe recorta el margen aunque «de media» sobrara', () => {
    // 60 € dan para muchos meses de una mensual de 3 €... hasta que llega una
    // anual de 90 € dentro de tres meses.
    const p = proyectar({
      saldo: 6000,
      hoy: HOY,
      suscripciones: [
        {
          id: 1,
          nombre: 'Mensual barata',
          importe: 300,
          periodo: 'mensual',
          proximoCobro: '2026-09-20',
          anclaDia: 20,
          anclaMes: null,
          pruebaHasta: null
        },
        {
          id: 2,
          nombre: 'Anual cara',
          importe: 9000,
          periodo: 'anual',
          proximoCobro: '2026-12-01',
          anclaDia: 1,
          anclaMes: 12,
          pruebaHasta: null
        }
      ]
    });

    expect(p.primerFallo?.nombre).toBe('Anual cara');
    expect(p.seAgotaEl).toBe('2026-12-01');
  });

  it('la que falla se pierde, pero las demas siguen cobrando', () => {
    const p = proyectar({
      saldo: 1000,
      hoy: HOY,
      suscripciones: [
        {
          id: 1,
          nombre: 'Cara',
          importe: 5000,
          periodo: 'mensual',
          proximoCobro: '2026-09-10',
          anclaDia: 10,
          anclaMes: null,
          pruebaHasta: null
        },
        {
          id: 2,
          nombre: 'Barata',
          importe: 100,
          periodo: 'mensual',
          proximoCobro: '2026-09-11',
          anclaDia: 11,
          anclaMes: null,
          pruebaHasta: null
        }
      ]
    });

    expect(p.cobros[0]).toMatchObject({ nombre: 'Cara', cabe: false });
    // La cara no vuelve a aparecer; la barata sigue cobrando cada mes.
    expect(p.cobros.filter((c) => c.nombre === 'Cara')).toHaveLength(1);
    expect(p.cobros.filter((c) => c.nombre === 'Barata').length).toBeGreaterThan(5);
  });

  it('sin suscripciones, aguanta todo el horizonte', () => {
    const p = proyectar({ saldo: 1000, suscripciones: [], hoy: HOY });
    expect(p.aguantaTodo).toBe(true);
    expect(p.primerFallo).toBeNull();
  });

  it('no toca las suscripciones que le pasan', () => {
    const copia = structuredClone(CUENTA);
    proyectar({ saldo: 1235, suscripciones: CUENTA, hoy: HOY });
    expect(CUENTA).toEqual(copia);
  });
});

describe('simularRecarga', () => {
  it('40 € llevan la cuenta del 3 de octubre al 19 de diciembre', () => {
    const base = { saldo: 1235, suscripciones: CUENTA, hoy: HOY };
    const con40 = simularRecarga(base, 4000);

    expect(con40.seAgotaEl).toBe('2026-12-19');
    expect(con40.diasRestantes).toBe(105);
    expect(con40.diasRestantes - proyectar(base).diasRestantes).toBe(77);
  });
});
