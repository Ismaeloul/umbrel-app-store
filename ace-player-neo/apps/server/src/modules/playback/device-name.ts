/* Nombre legible de un visor para «Dónde se está reproduciendo»
   (GET /api/v1/playback y el evento `playback.sessions`).

   - iOS (origen native): el nombre del dispositivo emparejado.
   - Web: uno sacado del User-Agent, "Navegador · Sistema" ("Chrome ·
     Windows", "Safari · iPhone"); "Navegador" si no se reconoce nada.
   - Apps 0.6.x: "App antigua (0.6)".

   Funciones puras (sin Fastify): las prueba device-name.test.ts. */

import { DEVICE_NAME_MAX, UNKNOWN_BROWSER_NAME } from '@ace/shared';

/* El orden importa: Edge, Opera y Samsung Internet también dicen "Chrome" y
   "Safari"; Chrome dice "Safari"; en iOS todos son WebKit y se delatan con
   CriOS, FxiOS o EdgiOS. */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b|\bOPT\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\/|\bChrome\/|\bChromium\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

/* iPad antes que Mac: el de iPadOS 13+ en modo escritorio dice "Macintosh" y
   no se distingue (sale "Mac", que es lo que dice ser). Android antes que
   Linux. */
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\biPhone\b|\biPod\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bSMART-TV\b|\bSmartTV\b|\bTizen\b|\bWeb0S\b|\bwebOS\b/i, 'Smart TV'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMacintosh\b|\bMac OS X\b/, 'Mac'],
  [/\bLinux\b|\bX11\b/, 'Linux'],
];

function first(table: readonly (readonly [RegExp, string])[], ua: string): string | null {
  for (const [pattern, name] of table) if (pattern.test(ua)) return name;
  return null;
}

/** Recorta y limpia un nombre (espacios y caracteres de control fuera); `fallback` si queda vacío. */
export function cleanDeviceName(value: unknown, fallback: string): string {
  const name = Array.from(String(value ?? ''), (char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? ' ' : char;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return (name || fallback).slice(0, DEVICE_NAME_MAX);
}

/** "Chrome · Windows", "Safari · iPhone", "Navegador · Linux" o "Navegador". */
export function browserDeviceName(userAgent: unknown): string {
  const ua = (typeof userAgent === 'string' ? userAgent : '').slice(0, 512);
  if (!ua.trim()) return UNKNOWN_BROWSER_NAME;
  let browser = first(BROWSERS, ua);
  const system = first(SYSTEMS, ua);
  /* En iPhone y iPad, sin otra marca, es Safari (o una web app de la
     pantalla de inicio, que no dice "Safari/"). */
  if (!browser && (system === 'iPhone' || system === 'iPad') && /AppleWebKit\//.test(ua)) {
    browser = 'Safari';
  }
  if (browser && system) return `${browser} · ${system}`;
  if (browser) return browser;
  if (system) return `${UNKNOWN_BROWSER_NAME} · ${system}`;
  return UNKNOWN_BROWSER_NAME;
}
