import { describe, expect, it } from 'vitest';
import { anclaDe, diferenciaDias, proximoDesde, siguienteCobro, sumarDias } from './fechas';

describe('siguienteCobro, mensual', () => {
  it('el 31 se recorta en febrero y VUELVE al 31 en marzo', () => {
    // Esto es lo que se rompe si el dia sale de la fecha anterior en vez del
    // ancla: la suscripcion se quedaria en el 28 para siempre.
    expect(siguienteCobro('2026-01-31', 'mensual', 31)).toBe('2026-02-28');
    expect(siguienteCobro('2026-02-28', 'mensual', 31)).toBe('2026-03-31');
    expect(siguienteCobro('2026-03-31', 'mensual', 31)).toBe('2026-04-30');
    expect(siguienteCobro('2026-04-30', 'mensual', 31)).toBe('2026-05-31');
  });

  it('en anio bisiesto el 31 de enero cae el 29', () => {
    expect(siguienteCobro('2028-01-31', 'mensual', 31)).toBe('2028-02-29');
  });

  it('cruza el fin de anio', () => {
    expect(siguienteCobro('2026-12-15', 'mensual', 15)).toBe('2027-01-15');
  });
});

describe('siguienteCobro, anual', () => {
  it('el 29 de febrero vuelve a su sitio cada cuatro anios', () => {
    expect(siguienteCobro('2028-02-29', 'anual', 29, 2)).toBe('2029-02-28');
    expect(siguienteCobro('2029-02-28', 'anual', 29, 2)).toBe('2030-02-28');
    expect(siguienteCobro('2031-02-28', 'anual', 29, 2)).toBe('2032-02-29');
  });

  it('mantiene mes y dia', () => {
    expect(siguienteCobro('2026-03-05', 'anual', 5, 3)).toBe('2027-03-05');
  });
});

describe('anclaDe', () => {
  it('el ancla mensual solo guarda el dia', () => {
    expect(anclaDe('2026-09-12', 'mensual')).toEqual({ dia: 12, mes: null });
  });

  it('el ancla anual guarda dia y mes', () => {
    expect(anclaDe('2027-03-05', 'anual')).toEqual({ dia: 5, mes: 3 });
  });
});

describe('proximoDesde', () => {
  it('si el dia del mes ya paso, salta al mes siguiente', () => {
    expect(proximoDesde('2026-09-20', 'mensual', 12)).toBe('2026-10-12');
  });

  it('si aun no ha llegado, es este mes', () => {
    expect(proximoDesde('2026-09-05', 'mensual', 12)).toBe('2026-09-12');
  });

  it('hoy mismo no cuenta: el proximo es estrictamente posterior', () => {
    expect(proximoDesde('2026-09-12', 'mensual', 12)).toBe('2026-10-12');
  });

  it('anual salta de anio cuando la fecha ya paso', () => {
    expect(proximoDesde('2026-09-05', 'anual', 5, 3)).toBe('2027-03-05');
  });
});

describe('aritmetica de dias', () => {
  it('cuenta los dias entre dos fechas', () => {
    expect(diferenciaDias('2026-09-05', '2026-10-03')).toBe(28);
    expect(diferenciaDias('2026-09-05', '2026-12-19')).toBe(105);
    expect(diferenciaDias('2026-09-05', '2026-09-05')).toBe(0);
  });

  it('suma dias cruzando meses y anios', () => {
    expect(sumarDias('2026-12-30', 5)).toBe('2027-01-04');
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29');
  });
});
