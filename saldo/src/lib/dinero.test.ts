import { describe, expect, it } from 'vitest';
import { exponente, formatear, parsear } from './dinero';

describe('exponente', () => {
  it('sale de la tabla ISO 4217, no de suponer dos decimales', () => {
    expect(exponente('EUR')).toBe(2);
    expect(exponente('USD')).toBe(2);
    expect(exponente('JPY')).toBe(0);
    expect(exponente('KRW')).toBe(0);
    expect(exponente('KWD')).toBe(3);
    expect(exponente('BHD')).toBe(3);
  });

  it('una divisa desconocida se trata como de dos decimales', () => {
    expect(exponente('XYZ')).toBe(2);
  });
});

// Intl separa el importe del simbolo con un espacio duro, no con uno normal.
const llano = (s: string) => s.replace(/ | /g, ' ');

describe('formatear', () => {
  it('cada cuenta enseña su dinero como lo enseña su tienda', () => {
    expect(llano(formatear(1235, 'EUR', 'es-ES'))).toBe('12,35 €');
    expect(llano(formatear(3100, 'USD', 'en-US'))).toBe('$31.00');
  });

  it('el yen no lleva decimales', () => {
    expect(formatear(3200, 'JPY', 'ja-JP')).not.toContain('.');
    expect(formatear(3200, 'JPY', 'ja-JP')).toContain('3,200');
  });

  it('el naira nigeriano lleva su simbolo y los separadores de alli', () => {
    expect(formatear(1234550, 'NGN', 'en-NG')).toBe('₦12,345.50');
  });

  it('el dinar lleva tres', () => {
    expect(formatear(1234, 'KWD', 'es-ES')).toContain('1,234');
  });
});

describe('parsear', () => {
  it('acepta coma o punto como decimal', () => {
    expect(parsear('12,35', 'EUR')).toBe(1235);
    expect(parsear('12.35', 'EUR')).toBe(1235);
  });

  it('entiende los millares en los dos formatos', () => {
    expect(parsear('1.234,56', 'EUR')).toBe(123456);
    expect(parsear('1,234.56', 'EUR')).toBe(123456);
  });

  it('en yenes no inventa decimales', () => {
    expect(parsear('3200', 'JPY')).toBe(3200);
    expect(parsear('3.200', 'JPY')).toBe(3200);
  });

  it('se traga el simbolo de la divisa y los espacios', () => {
    expect(parsear(' 12,35 € ', 'EUR')).toBe(1235);
    expect(parsear('$31.00', 'USD')).toBe(3100);
  });

  it('ida y vuelta con tres decimales', () => {
    expect(parsear('1,234', 'KWD')).toBe(1234);
  });

  it('protesta si no hay numero', () => {
    expect(() => parsear('', 'EUR')).toThrow();
    expect(() => parsear('nada', 'EUR')).toThrow();
  });
});
