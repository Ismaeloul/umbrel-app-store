/* Vectores del dominio de @ace/shared que la app porta (b-arquitectura §1.2, M2): «Para ti»
   (packages/shared/src/domain/for-you.ts) y el emparejado de nombres de canal (domain/channels.ts).
   Ejecuta las funciones de TypeScript DE VERDAD con una batería de entradas; `VectoresDominioTests` exige
   que el port de Swift (Core/Dominio) dé exactamente lo mismo. Sustituye a generar-vectores.mjs con la
   misma salida byte a byte (salvo el aviso de la cabecera). */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Area } from '../generar-vectores.ts';
import { json, SHARED } from './_cargador.ts';

const DOMINIO = path.join(SHARED, 'src/domain');

async function generar(): Promise<unknown> {
  const paraTi = await import(pathToFileURL(path.join(DOMINIO, 'for-you.ts')).href);
  const canales = await import(pathToFileURL(path.join(DOMINIO, 'channels.ts')).href);

  // ---- Textos sueltos: claves de preferencia, de competición, de equipo y de canal ----

  const textos = [
    '',
    'LaLiga',
    '  LaLiga EA Sports ',
    'La Liga EA Sports',
    'LaLiga Hypermotion',
    'Segunda División',
    'Atlético de Madrid',
    'Atlético Madrid',
    'At. Madrid',
    'FC Barcelona',
    'Barça',
    'Barcelona SC',
    'CF Montréal',
    'Real Madrid CF',
    'Inter de Milán',
    'FC Internazionale',
    'Borussia Mönchengladbach',
    'São Paulo',
    'Ñandú FC',
    'Países Bajos',
    'U.S.A.',
    '2. Bundesliga',
    'Man. City',
    'Émile—Zola',
    'İstanbul Başakşehir',
    'Ωmega Σport',
    '東京 FC',
    'fc',
    'FC CF',
    'DAZN 1 FHD --> NEW ERA',
    'M+ LaLiga TV',
    'MOVISTAR PLUS+ 2 FHD',
    'Movistar Plus+',
    'LIGA DE CAMPEONES --> ELCANO',
    '***DAZN 1***',
    'Fox Sports 2 ⟶ Proveedor',
    'La 1 HD España',
    'beIN SPORTS 1 HD',
    'Canal+ Foot',
    'Sky Sports 1080p',
    'Real Madrid TV 4K',
    'Gol Play => Otro',
    'Teledeporte == > x',
  ];

  const claves = textos.map((texto) => ({
    texto,
    preferencia: paraTi.normalizePreferenceKey(texto),
    competicion: paraTi.competitionKey(texto),
    equipo: paraTi.footballTeamKey(texto),
    canal: canales.normalizeChannelKey(texto),
  }));

  // ---- Ligas ----

  const preferenciasDeLiga = [
    'LaLiga',
    'LaLiga Hypermotion',
    'Champions League',
    'Premier League',
    'Serie A',
    'Bundesliga',
    'Ligue 1',
    'Copa del Rey',
    'Europa League',
    'Liga MX',
    '',
  ];
  const competiciones = [
    'LaLiga',
    'LaLiga EA Sports',
    'La Liga EA Sports',
    'Primera División',
    'LaLiga Hypermotion',
    'LaLiga SmartBank',
    'Segunda División',
    'UEFA Champions League',
    'Liga de Campeones',
    'Premier League',
    'Premier League Ucrania',
    'Serie A',
    'Serie A Brasil',
    'Bundesliga',
    '2. Bundesliga',
    'Francia Ligue 1',
    'Copa del Rey',
    'Liga MX',
    'Torneo Proyección',
    '',
  ];
  const ligas = [];
  for (const preferencia of preferenciasDeLiga) {
    for (const competicion of competiciones) {
      ligas.push({ preferencia, competicion, coincide: paraTi.leagueMatches(preferencia, competicion) });
    }
  }

  // ---- Partidos × gustos ----

  const partido = (competition, home, away, channels, title) => ({
    competition,
    title: title ?? (away ? `${home} - ${away}` : home),
    home,
    away,
    channels,
  });

  const partidos = [
    partido('LaLiga EA Sports', 'Real Madrid', 'Getafe', ['M+ LaLiga TV', 'DAZN LaLiga']),
    partido('LaLiga', 'Racing de Santander', 'Sporting de Gijón', ['LaLiga TV Hypermotion']),
    partido('LaLiga Hypermotion', 'Real Zaragoza', 'Huesca', ['LaLiga TV Hypermotion 2']),
    partido('Amistoso', 'España', 'Marruecos', ['La 1']),
    partido('Amistoso', 'Marruecos Sub-23', 'Egipto Sub-23', ['beIN Sports']),
    partido('Copa del Rey', 'FC Barcelona', 'Barcelona SC', ['M+ Vamos']),
    partido('Liga Profesional Argentina', 'Boca Juniors', 'River Plate', ['ESPN Premium']),
    partido('Torneo Proyección', 'Central Córdoba Reserva', 'Atlético Tucumán Reserva', ['LPF Play']),
    partido('Serie A Brazil', 'Flamengo', 'Palmeiras', ['Premiere']),
    partido('Premier League', 'Arsenal', 'Chelsea', ['DAZN 1']),
    partido('UEFA Champions League', 'Inter de Milán', 'Barça', ['M+ Liga de Campeones']),
    partido('Eurocopa Sub-21', 'Portugal Sub 21', 'Italia Sub 21', ['Teledeporte']),
    partido('Fórmula 1', 'Gran Premio de España', '', ['DAZN F1'], 'Gran Premio de España'),
    partido('2. Bundesliga', 'Hamburgo', 'Schalke 04', ['DAZN 2']),
    partido('MLS', 'Inter Miami', 'LA Galaxy', ['Apple TV']),
    partido('', 'Estados Unidos', 'México', ['TUDN']),
    partido('Supercopa de España', 'Atlético de Madrid', 'Athletic Club', ['Movistar Plus+']),
    partido('Liga MX', 'América', 'Chivas', []),
    partido('Primeira Liga', 'Benfica', 'FC Porto', ['Sport TV 1']),
    partido('Botola Pro', 'Wydad', 'Raja', []),
  ];

  const gustos = [
    { leagues: [], teams: [], nationalities: [] },
    { leagues: ['LaLiga'], teams: [], nationalities: [] },
    { leagues: ['LaLiga Hypermotion'], teams: [], nationalities: [] },
    { leagues: [], teams: ['Barcelona'], nationalities: [] },
    { leagues: [], teams: ['Atlético de Madrid', 'Inter'], nationalities: [] },
    { leagues: [], teams: [], nationalities: ['España'] },
    { leagues: [], teams: [], nationalities: ['Argentina', 'Brasil'] },
    { leagues: [], teams: [], nationalities: ['Marruecos'] },
    {
      leagues: ['LaLiga', 'Champions League', 'Premier League', 'Serie A', 'Bundesliga'],
      teams: ['Real Madrid'],
      nationalities: ['España'],
    },
    { leagues: [], teams: [], nationalities: ['Japón'] },
    { leagues: ['Liga MX'], teams: [], nationalities: ['Estados Unidos'] },
    { leagues: [], teams: ['FC Porto', 'Benfica'], nationalities: ['Portugal'] },
    { leagues: [], teams: [], nationalities: ['??'] },
  ];

  const casosParaTi = [];
  for (const p of partidos) {
    const agenda = { ...p, channels: p.channels.map((name, i) => ({ id: `c${i}`, name })) };
    for (const g of gustos) {
      casosParaTi.push({
        partido: p,
        gustos: g,
        hypermotion: paraTi.matchIsLaLigaHypermotion(agenda),
        paraTi: paraTi.footballMatchInScope(agenda, g),
        destacado: paraTi.footballMatchHighlighted(agenda, g),
      });
    }
  }

  // ---- Emparejado de canales ----

  const pares = [
    ['DAZN', 'DAZN 1'],
    ['DAZN 1', 'DAZN 2'],
    ['DAZN 1 FHD --> NEW ERA', 'DAZN 1'],
    ['M+ LaLiga TV', 'Movistar LaLiga'],
    ['M+ Liga de Campeones', 'LIGA DE CAMPEONES --> ELCANO'],
    ['LaLiga TV Hypermotion', 'LaLiga TV'],
    ['Movistar Plus+', 'M+'],
    ['La 1 HD', 'La 1'],
    ['TVE La 1', 'La 1'],
    ['DAZN LaLiga', 'DAZN LaLiga FHD'],
    ['beIN Sports', 'BeIN SPORTS 1 HD'],
    ['Eurosport 1', 'Eurosport 2'],
    ['Canal+ Foot', 'Canal Plus Foot'],
    ['ESPN Premium', 'ESPN'],
    ['Sky Sports Arena', 'SKY SPORTS ARENA --> SPORT TV'],
    ['', 'DAZN'],
    ['***DAZN 1***', 'dazn 1'],
    ['Gol Play', 'GOL PLAY España'],
    ['Movistar Plus+ 2', 'M+ #2'],
    ['M+ Vamos', 'Vamos'],
    ['DAZN F1', 'DAZN 1'],
    ['Real Madrid TV', 'Real Madrid TV 4K'],
    ['M. Liga de Campeones 2', 'Liga de Campeones 2'],
    ['TNT Sports 1', 'TNT Sports'],
    ['Fox Sports 2 ⟶ Proveedor', 'Fox Sports'],
    ['Teledeporte', 'Tele Deporte'],
    ['Movistar Liga de Campeones 1080p', 'M+ Liga De Campeones'],
    ['Movistar Deportes 2', 'M+ Deportes 2 HD'],
    ['DAZN LaLiga 2', 'DAZN LaLiga'],
    ['Premier Sports Uno', 'Premier Sports'],
    ['Sport TV 1', 'Sport TV 1 Portugal'],
    ['LaLiga TV Hypermotion 2', 'LaLiga TV Hypermotion'],
    ['Canal Sur Andalucía', 'Canal Sur'],
    ['Movistar Plus+ Fútbol', 'M+ Futbol'],
    ['Eurosport', 'Eurosport 1 HD --> ACE'],
  ];
  const puntuaciones = pares.map(([a, b]) => ({
    a,
    b,
    puntuacion: canales.channelMatchScore(a, b),
  }));

  const salida = {
    aviso: AVISO,
    claves,
    ligas,
    casosParaTi,
    puntuaciones,
  };
  return salida;
}

const AVISO =
  'Generado por apps/ios/scripts/generar-vectores.ts (vectores/dominio.ts) desde packages/shared/src/domain. No se edita a mano.';

const area: Area = {
  destino: 'vectores-dominio.json',
  texto: async () => json(await generar()),
};
export default area;
