import { DEVICE_NAME_MAX } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { browserDeviceName, cleanDeviceName } from './device-name.js';

/* User-Agents reales (2025-2026) de los navegadores que usa Isma y de los habituales. */
const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  webAppIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1',
  firefoxIpad:
    'Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/142.0 Mobile/15E148 Safari/605.1.15',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  samsungAndroid:
    'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 OPR/124.0.0.0',
  chromeOs:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  tizen:
    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) 120.0.0.0/8.0 TV Safari/537.36',
};

describe('browserDeviceName', () => {
  it.each([
    [UA.chromeWindows, 'Chrome · Windows'],
    [UA.edgeWindows, 'Edge · Windows'],
    [UA.firefoxLinux, 'Firefox · Linux'],
    [UA.safariMac, 'Safari · Mac'],
    [UA.safariIphone, 'Safari · iPhone'],
    [UA.webAppIphone, 'Safari · iPhone'],
    [UA.chromeIphone, 'Chrome · iPhone'],
    [UA.firefoxIpad, 'Firefox · iPad'],
    [UA.chromeAndroid, 'Chrome · Android'],
    [UA.samsungAndroid, 'Samsung Internet · Android'],
    [UA.operaWindows, 'Opera · Windows'],
    [UA.chromeOs, 'Chrome · ChromeOS'],
    [UA.tizen, 'Navegador · Smart TV'],
  ])('%s → %s', (ua, expected) => {
    expect(browserDeviceName(ua)).toBe(expected);
  });

  it('sin User-Agent o con uno desconocido dice «Navegador»', () => {
    expect(browserDeviceName(undefined)).toBe('Navegador');
    expect(browserDeviceName(null)).toBe('Navegador');
    expect(browserDeviceName('')).toBe('Navegador');
    expect(browserDeviceName('   ')).toBe('Navegador');
    expect(browserDeviceName('curl/8.9.1')).toBe('Navegador');
    expect(browserDeviceName(['Chrome/1'])).toBe('Navegador');
  });

  it('con solo el navegador, sin sistema', () => {
    expect(browserDeviceName('Firefox/142.0')).toBe('Firefox');
  });

  it('nunca pasa del tope', () => {
    expect(browserDeviceName(`${UA.chromeWindows} ${'x'.repeat(5000)}`).length).toBeLessThanOrEqual(
      DEVICE_NAME_MAX,
    );
  });
});

describe('cleanDeviceName', () => {
  it('limpia espacios y caracteres de control', () => {
    expect(cleanDeviceName('  iPhone\n de\tIsma  ', 'x')).toBe('iPhone de Isma');
  });

  it('vacío → el de respaldo', () => {
    expect(cleanDeviceName('   ', 'iPhone')).toBe('iPhone');
    expect(cleanDeviceName(null, 'iPhone')).toBe('iPhone');
  });

  it('recorta al tope', () => {
    expect(cleanDeviceName('a'.repeat(500), 'x')).toHaveLength(DEVICE_NAME_MAX);
  });
});
