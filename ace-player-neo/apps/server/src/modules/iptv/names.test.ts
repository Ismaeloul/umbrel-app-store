/* Limpieza de nombres de la IPTV (docs/iptv.md §4.2) y redactor (§2.4). */

import { describe, expect, it } from 'vitest';
import {
  cleanIptvTitle,
  groupCountry,
  iptvAskedChannel,
  iptvSpelling,
  qualityRank,
} from './names.js';
import { IptvRedactor } from './redact.js';

describe('cleanIptvTitle', () => {
  it.each([
    ['ES: DAZN LaLiga FHD', null, 'DAZN LaLiga', 'fhd', false, 'ES'],
    ['|ES| M+ LaLiga ᴴᴰ', null, 'M+ LaLiga', 'hd', false, 'ES'],
    ['DAZN LaLiga (Backup)', null, 'DAZN LaLiga', null, true, null],
    ['UK: Sky Sports', null, 'Sky Sports', null, false, 'UK'],
    ['DAZN LaLiga 2', null, 'DAZN LaLiga 2', null, false, null],
    ['[ES] La 1 HD', null, 'La 1', 'hd', false, 'ES'],
    ['ESPAÑA - Antena 3 FHD', null, 'Antena 3', 'fhd', false, 'ES'],
    ['M+ LaLiga TV 4K', 'SPAIN SPORTS', 'M+ LaLiga TV', 'uhd', false, 'ES'],
    ['DAZN 1 1080p', 'ES | DEPORTES', 'DAZN 1', 'fhd', false, 'ES'],
    [
      '★ Movistar Liga de Campeones ★ Full HD',
      'UK| SPORTS',
      'Movistar Liga de Campeones',
      'fhd',
      false,
      'UK',
    ],
    ['⚽ LaLiga TV Hypermotion ALT 50FPS', null, 'LaLiga TV Hypermotion', null, true, null],
    ['IT: DAZN 1', null, 'DAZN 1', null, false, 'IT'],
  ])('%s', (title, group, display, quality, backup, country) => {
    const clean = cleanIptvTitle(title, group);
    expect(clean.display).toBe(display);
    expect(clean.quality).toBe(quality);
    expect(clean.backup).toBe(backup);
    expect(clean.country).toBe(country);
  });

  it('HEVC se marca y se quita', () => {
    const clean = cleanIptvTitle('ES: DAZN LaLiga HEVC FHD');
    expect(clean.hevc).toBe(true);
    expect(clean.display).toBe('DAZN LaLiga');
    expect(cleanIptvTitle('DAZN LaLiga H.265').hevc).toBe(true);
  });

  it('«DAZN LA LIGA» y «dazn la liga» dan la misma clave que «DAZN LaLiga»', () => {
    const key = cleanIptvTitle('DAZN LaLiga').key;
    expect(key).toBe('dazn laliga');
    expect(cleanIptvTitle('DAZN LA LIGA').key).toBe(key);
    expect(cleanIptvTitle('ES: dazn la liga HD').key).toBe(key);
  });

  it('alias curados: M+ Hypermotion → LaLiga TV Hypermotion; M+ LaLiga → M+ LaLiga TV', () => {
    expect(cleanIptvTitle('ES: M+ Hypermotion').base).toBe('LaLiga TV Hypermotion');
    expect(cleanIptvTitle('Movistar Hypermotion HD').base).toBe('LaLiga TV Hypermotion');
    expect(cleanIptvTitle('M+ LaLiga').base).toBe('M+ LaLiga TV');
    expect(cleanIptvTitle('M+ LaLiga FHD').display).toBe('M+ LaLiga');
    expect(iptvSpelling('M+ La Liga')).toBe('M+ LaLiga TV');
  });

  it('los números no se tocan y el grupo solo da país si lo declara', () => {
    expect(cleanIptvTitle('M+ LaLiga TV 2 FHD').key).toBe('movistar laliga tv 2');
    expect(groupCountry('DEPORTES')).toBe(null);
    expect(groupCountry('España')).toBe('ES');
    expect(groupCountry('ESP: Deportes')).toBe('ES');
  });

  it('«GEO» al final es una marca, no otro canal; con zona detrás cuenta como reserva', () => {
    const plain = cleanIptvTitle('Deportes Uno GEO');
    expect(plain.display).toBe('Deportes Uno');
    expect(plain.backup).toBe(false);
    expect(plain.key).toBe(cleanIptvTitle('Deportes Uno').key);
    const zone = cleanIptvTitle('Deportes Uno GEO CAT');
    expect(zone.display).toBe('Deportes Uno');
    expect(zone.backup).toBe(true);
    expect(cleanIptvTitle('Canal Tres GEO HD').display).toBe('Canal Tres');
    /* «Geo» como nombre, o «GEO» delante, no se toca. */
    expect(cleanIptvTitle('Geo News').display).toBe('Geo News');
    expect(cleanIptvTitle('GEO TV').display).toBe('GEO TV');
    expect(cleanIptvTitle('Canal Geo').display).toBe('Canal Geo');
  });

  it('iptvAskedChannel: sin plataformas de internet y sin la cadena del final', () => {
    expect(iptvAskedChannel('La 1 TVE')).toBe('La 1');
    expect(iptvAskedChannel('Clan RTVE')).toBe('Clan');
    expect(iptvAskedChannel('TVE')).toBe('TVE');
    expect(iptvAskedChannel('Teledeporte')).toBe('Teledeporte');
    for (const platform of [
      'RTVE Play',
      'LPF Play',
      'DAZN App Gratis',
      'Real Betis TV YouTube',
      'OneFootball PPV',
      'Twitter @Club',
      'Facebook Live Club',
    ]) {
      expect(iptvAskedChannel(platform)).toBe(null);
    }
  });

  it('orden de calidad: fhd > hd > uhd > sd > sin marca', () => {
    expect(qualityRank('fhd')).toBeGreaterThan(qualityRank('hd'));
    expect(qualityRank('hd')).toBeGreaterThan(qualityRank('uhd'));
    expect(qualityRank('uhd')).toBeGreaterThan(qualityRank('sd'));
    expect(qualityRank('sd')).toBeGreaterThan(qualityRank(null));
  });
});

describe('IptvRedactor', () => {
  const U = 'usuario-e2e';
  const P = 'Cl4ve-Secreta-E2E';

  it('tapa secretos en crudo y codificados', () => {
    const redactor = new IptvRedactor();
    redactor.add(U);
    redactor.add('clave con espacios&raros');
    redactor.add('ab'); // demasiado corto: no se tapa
    const out = redactor.clean(`${U} y clave%20con%20espacios%26raros y ab`);
    expect(out).not.toContain(U);
    expect(out).not.toContain('clave%20con');
    expect(out).toContain(' ab');
  });

  it('get.php?username=&password=: la URL, su query y cada valor', () => {
    const redactor = new IptvRedactor();
    const list = `http://proveedor.example/get.php?username=${U}&password=${P}&type=m3u_plus`;
    redactor.addUrl(list);
    const text = `falló ${list} y luego /${U}/${P}/1234 con ${encodeURIComponent(P)}`;
    const out = redactor.clean(text);
    expect(out).not.toContain(U);
    expect(out).not.toContain(P);
  });

  it('la red genérica tapa /live/u/p/, la forma corta y el ticket del relé aunque no se conozcan', () => {
    const redactor = new IptvRedactor();
    const out = redactor.clean(
      'error http://x.example/live/otro/secreto/1.ts y http://x.example/otro/secreto/77 y http://127.0.0.1:4000/r/AbCdEfGhIjKlMnOpQr/in.ts',
    );
    expect(out).not.toContain('secreto');
    expect(out).not.toContain('AbCdEfGhIjKlMnOpQr');
  });
});
