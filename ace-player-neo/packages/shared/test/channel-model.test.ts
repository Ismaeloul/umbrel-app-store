/* Tubería única de nombres y modelo de canal (docs/iptv.md §4.8). Los
   nombres son los de la agenda de futbolenlatv, el directorio AceStream y la
   IPTV de Isma del 2026-10-22 (anonimizados donde hacía falta). */

import { describe, expect, it } from 'vitest';
import {
  CHANNEL_FAMILY_SCORE,
  RESOLUTION_EXACT_SCORE,
  canonicalChannelKey,
  canonicalChannelName,
  canonicalMatchScore,
  channelMatchScore,
  channelModel,
  isChannelFamily,
  isUmbrellaChannel,
} from '../src/index.js';

describe('canonicalChannelName · la misma forma venga de donde venga', () => {
  it.each([
    ['LA 1 4K --> NEW ERA', 'LA 1'],
    [
      'M+ LALIGA 2 elcano.top https://x.com/ace_stream_ https://t.me/acestreamf1',
      'Movistar LaLiga 2',
    ],
    [
      'laliga tv hypermotion 2 1080 elcano.top zeronet http://127.0.0.1:43110/18D6dPcs/ https://ipfs.io/x',
      'LaLiga TV Hypermotion 2',
    ],
    ['DAZN MotoGP Shickat | shickat.online (VPN) | shickat.blog', 'DAZN MotoGP'],
    ['M+ LALIGA TV ³', 'Movistar LaLiga TV'],
    ['M+: DAZN 1', 'DAZN 1'],
    ['M+: M.LALIGA 2', 'Movistar LaLiga 2'],
    ['M+: M.LCAMPEONES 2', 'Movistar Liga de Campeones 2'],
    ['M.LIGA CAMPEONES2', 'Movistar Liga de Campeones 2'],
    ['MLIGACAMPEONEST2', 'Movistar Liga de Campeones 2'],
    ['M+ LALIGA DE CAMPEONES 10', 'Movistar Liga de Campeones 10'],
    ['M.LALIGA DE CAMPEONES 3', 'Movistar Liga de Campeones 3'],
    ['LALIGATVMULTI2', 'LaLiga TV 2'],
    ['LALIGATV', 'LaLiga TV'],
    ['LaLiga TV M2', 'LaLiga TV 2'],
    ['LALIGA TV 2 HYPERMOTION', 'LaLiga TV Hypermotion 2'],
    ['PRIME: LALIGA HYPERMOTION TV 2', 'LaLiga TV Hypermotion 2'],
    ['M+LIGA HYPERMOTIONV TV 2', 'Movistar LaLiga TV Hypermotion 2'],
    ['LIGA SMARTBANK 1', 'LaLiga TV Hypermotion 1'],
    ['HYPERMOTION SD --> NEW ERA', 'LaLiga TV Hypermotion'],
    ['M+ #Vamos Bar 2', 'Movistar Vamos 2'],
    ['#VAMOS FHD --> NEW ERA', 'VAMOS'],
    ['DAZN 1 BAR FHD --> NEW ERA', 'DAZN 1'],
    ['LaLiga TV Bar', 'LaLigaBar'],
    ['M+ LALIGA TV BAR HD', 'Movistar LaLigaBar'],
    ['LALIGATV BAR', 'LaLigaBar'],
    ['M+ LALIGA HDR', 'Movistar LaLiga'],
    ['M+ LIGA DE CAMPEONES LOW', 'Movistar Liga de Campeones'],
    ['Movistar+ Dispositivos', 'Movistar+'],
    ['Esport3', 'Esport 3'],
    ['TPA7', 'TPA 7'],
    ['LA 1 3840P', 'LA 1'],
    ['TELE DEPORTE', 'Teledeporte'],
    ['1° FEDERACION (MOVISTAR+)', 'Primera Federación (MOVISTAR+)'],
    ['Canal 1 (1RFEF) (SOLO EVENTOS) --> NEW ERA V', 'Canal 1 (Primera Federación)'],
    ['TVG', 'TV Galicia'],
    ['Barça TV', 'Barça TV'],
    ['', ''],
  ])('%s → %s', (raw, expected) => {
    expect(canonicalChannelName(raw)).toBe(expected);
  });
});

describe('channelModel · producto y dial', () => {
  it.each([
    ['M+ LaLiga TV 2', 'laliga', '2'],
    ['LaLiga TV Bar', 'laligabar', null],
    ['DAZN 1 Bar', 'dazn', '1'],
    ['M+ Liga de Campeones 13', 'liga campeones', '13'],
    ['LALIGA TV Hypermotion 2', 'laliga hypermotion', '2'],
    ['DAZN', 'dazn', null],
    ['DAZN F1', 'dazn f1', null],
    ['Canal 1 (1RFEF)', 'primera federacion', '1'],
    ['Liga 1 Perú', 'liga 1 peru', null],
    ['M+: 3 24', '', null],
    ['La 7 TV', '', null],
  ])('%s → producto %s, dial %s', (name, product, dial) => {
    const model = channelModel(name);
    expect(model.product).toBe(product);
    expect(model.dial).toBe(dial);
  });

  it('un nombre en árabe se queda sin letras y nunca puntúa', () => {
    expect(channelModel('باب الحارة 7').letters).toBe(false);
    expect(canonicalMatchScore('TPA7', 'باب الحارة 7')).toBe(0);
    expect(canonicalMatchScore('LaLiga TV M2', 'AR : كسر عضم 2')).toBe(0);
  });

  it('canonicalChannelKey junta las variantes de un canal', () => {
    const keys = new Set(
      ['M+ LALIGA', 'M+ LALIGA HDR', 'M+ LALIGA TV ³', 'M+: M.LALIGA'].map(canonicalChannelKey),
    );
    expect(keys.size).toBe(1);
    expect(canonicalChannelKey('M+ LALIGA 2')).not.toBe(canonicalChannelKey('M+ LALIGA'));
    /* El canal para bares de LaLiga no es M+ LaLiga TV: cada tag busca solo lo suyo. */
    expect(canonicalChannelKey('LaLiga TV Bar')).not.toBe(canonicalChannelKey('M+ LALIGA'));
    expect(canonicalMatchScore('LaLiga TV Bar', 'M+ LALIGA --> ELCANO')).toBe(0);
    expect(canonicalMatchScore('LaLiga TV Bar', 'M+ LALIGA TV ³')).toBe(0);
    expect(canonicalMatchScore('LaLiga TV Bar', 'DAZN LA LIGA 1')).toBe(0);
  });

  it('isUmbrellaChannel: la marca a secas, no su dial', () => {
    expect(isUmbrellaChannel('DAZN')).toBe(true);
    expect(isUmbrellaChannel('Primera Federación')).toBe(true);
    expect(isUmbrellaChannel('DAZN 1')).toBe(false);
    expect(isUmbrellaChannel('M+ LaLiga TV')).toBe(false);
  });
});

describe('canonicalMatchScore · lo que fallaba el 2026-10-22', () => {
  it.each([
    ['LaLiga TV Bar', 'M+ LALIGA TV BAR'],
    ['LaLiga TV Bar', 'LALIGATV BAR HD'],
    ['LaLiga TV M2', 'M+ LALIGA 2 --> ELCANO'],
    ['LaLiga TV M2', 'LALIGATVMULTI2'],
    ['LaLiga TV M2', 'MOVISTAR LALIGA 2'],
    ['LaLiga TV M2', 'M+: M.LALIGA 2'],
    ['M+ #Vamos Bar', 'MOVISTAR VAMOS --> ELCANO'],
    ['M+ #Vamos Bar', 'VAMOS'],
    ['M+ #Vamos Bar 2', 'VAMOS 2'],
    ['DAZN 1 Bar', 'DAZN 1 --> ELCANO'],
    ['DAZN 1', 'DAZN 1 BAR FHD --> NEW ERA'],
    ['M+ Liga de Campeones 2', 'M.LIGA CAMPEONES2'],
    ['M+ Liga de Campeones 2', 'MLIGACAMPEONEST2'],
    ['M+ Liga de Campeones 2', 'M+: M.LCAMPEONES 2'],
    ['M+ Liga de Campeones 10', 'M+ LALIGA DE CAMPEONES 10'],
    ['M+ Liga de Campeones 3', 'M.LALIGA DE CAMPEONES 3'],
    ['M+ Liga de Campeones', 'M. LIGA DE CAMPEONES 1'],
    ['M+ Liga de Campeones', 'M+ LIGA DE CAMPEONES LOW'],
    ['LALIGA TV Hypermotion 2', 'LALIGA TV 2 HYPERMOTION'],
    ['LALIGA TV Hypermotion 2', 'PRIME: LALIGA HYPERMOTION TV 2'],
    ['LALIGA TV Hypermotion 2', 'M+LIGA HYPERMOTIONV TV 2'],
    ['LALIGA TV Hypermotion 2', 'LIGA SMARTBANK 2'],
    ['LALIGA TV Hypermotion 2', 'HYPERMOTION 2 --> ELCANO'],
    ['LALIGA TV Hypermotion', 'LALIGATV HYPERMOTION'],
    ['LALIGA TV Hypermotion', 'HYPERMOTION SD --> NEW ERA'],
    ['M+ LALIGA', 'LA LIGA 1'],
    ['M+ LALIGA HDR', 'M+ LALIGA --> ELCANO'],
    ['M+ LALIGA HDR 2', 'M+ LALIGA 2 --> ELCANO'],
    ['M+ LALIGA 2', 'M+ LALIGA 2 elcano.top https://x.com/ace_stream_ https://t.me/acestreamf1'],
    ['LALIGA TV Hypermotion 2', 'Laliga Hypermotion 2 720 elcano.top https://x.com/ace_stream_'],
    ['Esport3', 'ESPORT 3 FHD --> NEW ERA'],
    ['TPA7', 'M+: TPA 7'],
    ['Teledeporte', 'TELE DEPORTE'],
    ['TVG', 'M+: GALICIA TV'],
    ['DAZN LaLiga', 'DAZN LA LIGA 1 --> ELCANO'],
    ['DAZN LaLiga 2', 'M+: DAZN LA LIGA 2'],
    ['Movistar+', 'M+: M.PLUS'],
    ['Movistar+ Dispositivos', 'MOVISTAR PLUS+'],
    ['Movistar Plus+', 'Movistar+ --> NEW LOOP'],
    ['Real Madrid TV', 'M+: REAL MADRID TV'],
    ['À Punt', 'M+: A PUNT'],
    ['La 1', 'LA 1 3840P'],
  ])('%s ⇄ %s es el mismo canal', (a, b) => {
    expect(canonicalMatchScore(a, b)).toBeGreaterThanOrEqual(RESOLUTION_EXACT_SCORE);
  });

  it.each([
    ['DAZN', 'DAZN 1 --> ELCANO'],
    ['DAZN', 'M+: DAZN 1'],
    ['DAZN LaLiga', 'DAZN LA LIGA 2'],
    ['M+ LALIGA', 'M+ LALIGA 2'],
    ['M+ Liga de Campeones', 'LIGA DE CAMPEONES 2 --> ELCANO'],
    ['Primera Federación', 'Canal 1 (1RFEF) (SOLO EVENTOS) --> NEW ERA V'],
    ['Movistar+', 'MOVISTAR PLUS+ 2'],
  ])('%s ⇄ %s es familia (78)', (a, b) => {
    expect(canonicalMatchScore(a, b)).toBe(CHANNEL_FAMILY_SCORE);
    expect(isChannelFamily(a, b)).toBe(true);
  });

  it.each([
    ['DAZN 1', 'DAZN 2'],
    ['M+ Liga de Campeones 2', 'M+ LIGA DE CAMPEONES 3'],
    ['LaLiga TV M2', 'M+ LALIGA 3'],
    ['Eurosport 1', 'Eurosport 2'],
    ['M+ LALIGA', 'DAZN LA LIGA 1 --> ELCANO'],
    ['M+ LALIGA', 'Sky Sports LaLiga HD --> NEW ERA'],
    ['Movistar Plus+', 'M+: 3 24'],
    ['Orange Fútbol 2', 'LALIGATV HYPERMOTION 2'],
  ])('%s ⇄ %s no es el mismo canal (0)', (a, b) => {
    expect(canonicalMatchScore(a, b)).toBe(0);
  });

  it('la protección Hypermotion y las variantes por palabra siguen topadas en 58', () => {
    expect(canonicalMatchScore('M+ LALIGA', 'LALIGA TV Hypermotion')).toBeLessThan(70);
    expect(canonicalMatchScore('LaLiga TV', 'LaLiga TV Hypermotion')).toBeLessThan(70);
    expect(canonicalMatchScore('DAZN', 'DAZN Eventos')).toBeLessThan(70);
    expect(canonicalMatchScore('DAZN 1', 'DAZN F1')).toBeLessThan(70);
    expect(canonicalMatchScore('DAZN 1', 'ELEVEN DAZN 1 --> SPORT TV')).toBeLessThan(70);
    expect(canonicalMatchScore('M+ Liga de Campeones', 'UCL Principal --> ELCANO')).toBe(0);
  });

  it('nunca baja de lo que daba el emparejador clásico en lo que ya acertaba', () => {
    const pairs: [string, string][] = [
      ['M+ Liga de Campeones 3', 'LIGA DE CAMPEONES 3 FHD --> NEW ERA'],
      ['DAZN 2', 'DAZN 2 --> ELCANO'],
      ['Teledeporte', 'TELEDEPORTE FHD --> NEW ERA'],
      ['M+ Vamos', 'MOVISTAR VAMOS --> ELCANO'],
      ['GOL Play', 'GOL Play HD'],
      ['M+ LaLiga TV', 'Movistar LaLiga TV'],
      ['Eurosport 1', 'Eurosport 1 HD'],
    ];
    for (const [a, b] of pairs) {
      expect(canonicalMatchScore(a, b)).toBeGreaterThanOrEqual(channelMatchScore(a, b));
      expect(canonicalMatchScore(a, b)).toBe(100);
    }
  });
});
