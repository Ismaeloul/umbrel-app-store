import { describe, expect, it } from 'vitest';
import { escalaRecarga, gastoMensual } from './ui';

describe('la barra de «si recargo…»', () => {
  it('en la India da para unos seis meses de YouTube, de 50 en 50', () => {
    // 389 ₹ al mes → 2.334 ₹ en seis meses.
    expect(escalaRecarga(38900, 'INR')).toEqual({ max: 2350, paso: 50 });
  });

  it('en Nigeria sube a los miles, no se queda en 120', () => {
    expect(escalaRecarga(360000, 'NGN')).toEqual({ max: 22000, paso: 500 });
  });

  it('en euros con una suscripcion barata va de 2 en 2', () => {
    expect(escalaRecarga(1299, 'EUR')).toEqual({ max: 78, paso: 2 });
  });

  it('sin cobros se queda con un tope fijo', () => {
    expect(escalaRecarga(0, 'EUR')).toEqual({ max: 120, paso: 5 });
  });

  it('las anuales cuentan a doceavos', () => {
    expect(
      gastoMensual([
        { importe: 1200, periodo: 'anual' },
        { importe: 500, periodo: 'mensual' }
      ])
    ).toBe(600);
  });
});
