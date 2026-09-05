// Los importes se guardan SIEMPRE como entero en la unidad menor de su divisa.
// Cuantos decimales tiene cada una sale de esta tabla (ISO 4217), nunca de
// suponer dos: el yen no tiene ninguno y el dinar kuwaiti tiene tres.

const EXPONENTES: Record<string, number> = {
  BHD: 3,
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  IQD: 3,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  UGX: 0,
  UYW: 4,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0
};

/** Decimales de la divisa. Dos por defecto, que es lo que vale para la mayoria. */
export function exponente(divisa: string): number {
  return EXPONENTES[divisa.toUpperCase()] ?? 2;
}

/** Cuantas unidades menores tiene una unidad: 100 en euros, 1 en yenes. */
export function factor(divisa: string): number {
  return 10 ** exponente(divisa);
}

/**
 * Formatea un importe entero en unidad menor, con el idioma de la cuenta:
 * `12,35 €` en la espanola, `$31.00` en la americana, `￥3,200` en la japonesa.
 */
export function formatear(importe: number, divisa: string, locale = 'es-ES'): string {
  const decimales = exponente(divisa);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: divisa,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales
  }).format(importe / factor(divisa));
}

/** Solo el numero, sin simbolo: para meterlo dentro de un `<input>`. */
export function formatearLlano(importe: number, divisa: string, locale = 'es-ES'): string {
  const decimales = exponente(divisa);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
    useGrouping: false
  }).format(importe / factor(divisa));
}

/**
 * Lee lo que escribe una persona y devuelve el entero en unidad menor.
 * Acepta `12,35`, `12.35`, `1.234,56` y `1,234.56`. Lanza si no hay numero.
 */
export function parsear(texto: string, divisa: string): number {
  const limpio = String(texto).replace(/[^\d,.-]/g, '').trim();
  if (limpio === '' || limpio === '-') throw new Error('Escribe un importe.');

  const corte = Math.max(limpio.lastIndexOf(','), limpio.lastIndexOf('.'));
  const decimales = exponente(divisa);
  let normalizado: string;

  if (corte === -1) {
    normalizado = limpio;
  } else {
    // Si detras del ultimo separador hay tres cifras y la divisa no lleva tres
    // decimales, ese separador es de millares, no decimal: `3.200` en yenes son
    // tres mil doscientos, no tres. En cambio `1,234` en dinares SI son tres
    // decimales, porque el dinar los tiene.
    const cola = limpio.slice(corte + 1).replace(/[,.]/g, '');
    const esMillares = cola.length === 3 && decimales !== 3;

    if (esMillares) {
      normalizado = limpio.replace(/[,.]/g, '');
    } else {
      const entera = limpio.slice(0, corte).replace(/[,.]/g, '');
      normalizado = `${entera === '' || entera === '-' ? `${entera}0` : entera}.${cola}`;
    }
  }

  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) throw new Error('Eso no es un importe.');

  return Math.round(valor * factor(divisa));
}
