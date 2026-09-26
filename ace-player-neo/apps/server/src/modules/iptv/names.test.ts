/* Limpieza de nombres de la IPTV (docs/iptv.md §4.2) y redactor (§2.4). */

import { describe, expect, it } from 'vitest';
import {
  cleanIptvTitle,
  groupCountry,
  iptvAskedChannel,
  iptvSpelling,
  qualityFromHeight,
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

  it('orden de las variantes (§16): 1080p > 4K > 720p > SD > sin marca', () => {
    expect(qualityRank('fhd')).toBeGreaterThan(qualityRank('uhd'));
    expect(qualityRank('uhd')).toBeGreaterThan(qualityRank('hd'));
    expect(qualityRank('hd')).toBeGreaterThan(qualityRank('sd'));
    expect(qualityRank('sd')).toBeGreaterThan(qualityRank(null));
  });

  it('calidad por la altura real: 2160 → 4K, 1080 → 1080p, 720 → 720p, 576 → SD', () => {
    expect(qualityFromHeight(2160)).toBe('uhd');
    expect(qualityFromHeight(1080)).toBe('fhd');
    expect(qualityFromHeight(1440)).toBe('fhd');
    expect(qualityFromHeight(720)).toBe('hd');
    expect(qualityFromHeight(576)).toBe('sd');
    expect(qualityFromHeight(0)).toBe(null);
    expect(qualityFromHeight(null)).toBe(null);
  });

  it.each([
    /* título, display, calidad, reserva, país, hevc */
    ['DAZN 1 FHD', 'DAZN 1', 'fhd', false, null, false],
    ['DAZN 1 HD', 'DAZN 1', 'hd', false, null, false],
    ['DAZN 1 SD', 'DAZN 1', 'sd', false, null, false],
    ['DAZN 1 4K', 'DAZN 1', 'uhd', false, null, false],
    ['DAZN 1 UHD', 'DAZN 1', 'uhd', false, null, false],
    ['DAZN 1 (backup)', 'DAZN 1', null, true, null, false],
    ['DAZN 1 [BK]', 'DAZN 1', null, true, null, false],
    ['DAZN 1 bk2', 'DAZN 1', null, true, null, false],
    ['DAZN 1 ALT', 'DAZN 1', null, true, null, false],
    ['DAZN 1 (1)', 'DAZN 1', null, false, null, false],
    ['DAZN 1 (2)', 'DAZN 1', null, true, null, false],
    ['DAZN 1 FHD [3]', 'DAZN 1', 'fhd', true, null, false],
    ['ES: DAZN 1 1080p', 'DAZN 1', 'fhd', false, 'ES', false],
    ['ES: DAZN 1 720p', 'DAZN 1', 'hd', false, 'ES', false],
    ['ES | DAZN 1', 'DAZN 1', null, false, 'ES', false],
    ['|ES| DAZN 1', 'DAZN 1', null, false, 'ES', false],
    ['[ES] DAZN 1', 'DAZN 1', null, false, 'ES', false],
    ['ES • DAZN 1 HD', 'DAZN 1', 'hd', false, 'ES', false],
    ['DAZN 1 [ES]', 'DAZN 1', null, false, 'ES', false],
    ['DAZN 1 |ES|', 'DAZN 1', null, false, 'ES', false],
    ['DAZN 1 (ESP)', 'DAZN 1', null, false, 'ES', false],
    ['DAZN 1 HEVC', 'DAZN 1', null, false, null, true],
    ['DAZN 1 H265 FHD', 'DAZN 1', 'fhd', false, null, true],
    ['DAZN 1 50FPS', 'DAZN 1', null, false, null, false],
    ['DAZN 1 1080p50', 'DAZN 1', 'fhd', false, null, false],
    ['DAZN 1 720p60', 'DAZN 1', 'hd', false, null, false],
    ['DAZN 1 VIP', 'DAZN 1', null, false, null, false],
    ['VIP | ES: DAZN 1 FHD', 'DAZN 1', 'fhd', false, 'ES', false],
    ['FHD | ES: DAZN 1', 'DAZN 1', 'fhd', false, 'ES', false],
    ['DAZN 1 HD+', 'DAZN 1', 'hd', false, null, false],
    ['DAZN 1 H264 HDR', 'DAZN 1', null, false, null, false],
    ['DE: DAZN 1 HD', 'DAZN 1', 'hd', false, 'DE', false],
    ['DAZN 12', 'DAZN 12', null, false, null, false],
    ['M+ LaLiga 2 FHD', 'M+ LaLiga 2', 'fhd', false, null, false],
    ['Canal Tres (Andalucía)', 'Canal Tres (Andalucía)', null, false, null, false],
    ['DAZN 1 FHD50', 'DAZN 1', 'fhd', false, null, false],
    ['DAZN 1 HD50', 'DAZN 1', 'hd', false, null, false],
    ['DAZN 1 1080 50', 'DAZN 1', 'fhd', false, null, false],
    ['ES DAZN 1', 'DAZN 1', null, false, 'ES', false],
    ['ES » DAZN 1', 'DAZN 1', null, false, 'ES', false],
    ['ES ➤ DAZN 1', 'DAZN 1', null, false, 'ES', false],
    ['DAZN 1 ES', 'DAZN 1', null, false, 'ES', false],
    ['DAZN 1 - ES', 'DAZN 1', null, false, 'ES', false],
    ['DAZN 1 BK 2', 'DAZN 1', null, true, null, false],
    ['DAZN 1 HD 2', 'DAZN 1', 'hd', true, null, false],
    ['DAZN F1 FHD 2', 'DAZN F1', 'fhd', true, null, false],
    ['LaLiga TV HD 2', 'LaLiga TV 2', 'hd', false, null, false],
    ['DAZN 1 ⁴ᴷ', 'DAZN 1', 'uhd', false, null, false],
    ['DE PELICULA', 'DE PELICULA', null, false, null, false],
  ])('variante: %s', (title, display, quality, backup, country, hevc) => {
    const clean = cleanIptvTitle(title);
    expect([clean.display, clean.quality, clean.backup, clean.country, clean.hevc]).toEqual([
      display,
      quality,
      backup,
      country,
      hevc,
    ]);
  });

  it('el grupo «XXX | ADULTOS» o «VIP | DEPORTES» no es un país', () => {
    expect(groupCountry('XXX | ADULTOS')).toBe(null);
    expect(groupCountry('VIP | DEPORTES')).toBe(null);
    expect(groupCountry('DE | SPORT')).toBe('DE');
  });

  it('con 3 letras solo es país una sigla de país («TDT», «DOC», «NBA», «CAT» no)', () => {
    expect(groupCountry('TDT | NACIONALES')).toBe(null);
    expect(groupCountry('DOC | DOCUMENTALES')).toBe(null);
    expect(groupCountry('CAT | AUTONOMICAS')).toBe(null);
    expect(groupCountry('USA | SPORTS')).toBe('USA');
    expect(groupCountry('ESP | DEPORTES')).toBe('ES');
    expect(groupCountry('EU | TDT | NACIONALES')).toBe(null);
    expect(cleanIptvTitle('NBA: Lakers').country).toBe(null);
    expect(cleanIptvTitle('RAI - 1').display).toBe('RAI - 1');
    expect(cleanIptvTitle('TVE - La 1').display).toBe('La 1');
    expect(cleanIptvTitle('GER: DAZN 1').country).toBe('GER');
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
