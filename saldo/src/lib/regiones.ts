// Al crear una cuenta se elige la region de la tienda, y de ahi salen la
// divisa y el idioma con que se enseña el dinero. Una cuenta NUNCA cambia de
// divisa: lo que hay guardado son enteros en su unidad menor.

export interface Region {
  id: string;
  nombre: string;
  divisa: string;
  locale: string;
}

export const REGIONES: Region[] = [
  { id: 'es', nombre: 'España', divisa: 'EUR', locale: 'es-ES' },
  { id: 'pt', nombre: 'Portugal', divisa: 'EUR', locale: 'pt-PT' },
  { id: 'fr', nombre: 'Francia', divisa: 'EUR', locale: 'fr-FR' },
  { id: 'de', nombre: 'Alemania', divisa: 'EUR', locale: 'de-DE' },
  { id: 'it', nombre: 'Italia', divisa: 'EUR', locale: 'it-IT' },
  { id: 'us', nombre: 'Estados Unidos', divisa: 'USD', locale: 'en-US' },
  { id: 'gb', nombre: 'Reino Unido', divisa: 'GBP', locale: 'en-GB' },
  { id: 'jp', nombre: 'Japón', divisa: 'JPY', locale: 'ja-JP' },
  { id: 'kr', nombre: 'Corea del Sur', divisa: 'KRW', locale: 'ko-KR' },
  { id: 'mx', nombre: 'México', divisa: 'MXN', locale: 'es-MX' },
  { id: 'ar', nombre: 'Argentina', divisa: 'ARS', locale: 'es-AR' },
  { id: 'br', nombre: 'Brasil', divisa: 'BRL', locale: 'pt-BR' },
  { id: 'ca', nombre: 'Canadá', divisa: 'CAD', locale: 'en-CA' },
  { id: 'ch', nombre: 'Suiza', divisa: 'CHF', locale: 'de-CH' },
  { id: 'ma', nombre: 'Marruecos', divisa: 'MAD', locale: 'ar-MA' },
  { id: 'ng', nombre: 'Nigeria', divisa: 'NGN', locale: 'en-NG' },
  { id: 'tr', nombre: 'Turquía', divisa: 'TRY', locale: 'tr-TR' },
  { id: 'in', nombre: 'India', divisa: 'INR', locale: 'hi-IN' }
];

export function region(id: string): Region | undefined {
  return REGIONES.find((r) => r.id === id);
}
