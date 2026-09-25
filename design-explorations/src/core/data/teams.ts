import type { Competition, Team } from '../types';

/* Equipos con sus colores (Solo prototipo). Los escudos se generan: nada
   descargado. Nombres reales; colores aproximados del club. */

const T = (
  id: string,
  name: string,
  short: string,
  primary: string,
  secondary: string,
  crest: Team['crest'] = 'shield',
): Team => ({ id, name, short, primary, secondary, crest });

export const TEAMS: Record<string, Team> = Object.fromEntries(
  [
    // LaLiga
    T('rma', 'Real Madrid', 'RMA', '#FEBE10', '#1A1A5E', 'round'),
    T('fcb', 'FC Barcelona', 'BAR', '#A50044', '#004D98', 'shield'),
    T('atm', 'Atlético de Madrid', 'ATM', '#CB3524', '#272E61', 'shield'),
    T('ath', 'Athletic Club', 'ATH', '#EE2523', '#101010', 'shield'),
    T('rso', 'Real Sociedad', 'RSO', '#0067B1', '#FFFFFF', 'round'),
    T('vil', 'Villarreal', 'VIL', '#FFE667', '#005187', 'round'),
    T('bet', 'Real Betis', 'BET', '#00954C', '#FFFFFF', 'shield'),
    T('sev', 'Sevilla', 'SEV', '#D4021D', '#FFFFFF', 'round'),
    T('val', 'Valencia', 'VAL', '#F7931E', '#1F1F1F', 'shield'),
    T('gir', 'Girona', 'GIR', '#CD2534', '#FFFFFF', 'shield'),
    T('osa', 'Osasuna', 'OSA', '#D91A21', '#0A1F5C', 'shield'),
    T('cel', 'Celta', 'CEL', '#8AC3EE', '#FFFFFF', 'round'),
    T('ray', 'Rayo Vallecano', 'RAY', '#E53027', '#FFFFFF', 'shield'),
    T('get', 'Getafe', 'GET', '#004FA3', '#FFFFFF', 'shield'),
    T('mll', 'Mallorca', 'MLL', '#E20613', '#1B1B1B', 'shield'),
    T('esp', 'Espanyol', 'ESP', '#007FC8', '#FFFFFF', 'round'),
    T('ala', 'Alavés', 'ALA', '#0761AF', '#FFFFFF', 'shield'),
    T('lev', 'Levante', 'LEV', '#0D47A1', '#B71C1C', 'shield'),
    T('elc', 'Elche', 'ELC', '#1A8F3C', '#FFFFFF', 'shield'),
    T('ovi', 'Real Oviedo', 'OVI', '#0A3D91', '#FFFFFF', 'round'),
    // Premier
    T('ars', 'Arsenal', 'ARS', '#EF0107', '#063672', 'round'),
    T('liv', 'Liverpool', 'LIV', '#C8102E', '#00B2A9', 'shield'),
    T('mci', 'Manchester City', 'MCI', '#6CABDD', '#1C2C5B', 'round'),
    T('che', 'Chelsea', 'CHE', '#034694', '#FFFFFF', 'round'),
    T('mun', 'Manchester United', 'MUN', '#DA291C', '#FBE122', 'shield'),
    T('tot', 'Tottenham', 'TOT', '#132257', '#FFFFFF', 'round'),
    T('new', 'Newcastle', 'NEW', '#241F20', '#FFFFFF', 'shield'),
    T('avl', 'Aston Villa', 'AVL', '#670E36', '#95BFE5', 'round'),
    T('bha', 'Brighton', 'BHA', '#0057B8', '#FFFFFF', 'round'),
    T('whu', 'West Ham', 'WHU', '#7A263A', '#1BB1E7', 'shield'),
    // Serie A
    T('juv', 'Juventus', 'JUV', '#101010', '#FFFFFF', 'shield'),
    T('int', 'Inter', 'INT', '#010E80', '#101010', 'round'),
    T('mil', 'Milan', 'MIL', '#FB090B', '#101010', 'shield'),
    T('nap', 'Napoli', 'NAP', '#12A0D7', '#FFFFFF', 'round'),
    T('rom', 'Roma', 'ROM', '#8E1F2F', '#F0BC42', 'round'),
    T('ata', 'Atalanta', 'ATA', '#1E71B8', '#101010', 'shield'),
    // Bundesliga
    T('bay', 'Bayern', 'BAY', '#DC052D', '#0066B2', 'round'),
    T('bvb', 'Dortmund', 'BVB', '#FDE100', '#101010', 'round'),
    T('lev4', 'Leverkusen', 'B04', '#E32221', '#101010', 'shield'),
    T('rbl', 'Leipzig', 'RBL', '#DD0741', '#FFFFFF', 'round'),
    // Ligue 1 y otros
    T('psg', 'PSG', 'PSG', '#004170', '#DA291C', 'round'),
    T('om', 'Marsella', 'OM', '#2FAEE0', '#FFFFFF', 'round'),
    T('ben', 'Benfica', 'SLB', '#E83030', '#FFFFFF', 'round'),
    T('por', 'Porto', 'FCP', '#003E7E', '#FFFFFF', 'round'),
    T('spo', 'Sporting CP', 'SCP', '#008057', '#FFFFFF', 'shield'),
    T('aja', 'Ajax', 'AJA', '#D2122E', '#FFFFFF', 'shield'),
    T('gal', 'Galatasaray', 'GAL', '#FDB912', '#A90432', 'round'),
    T('sla', 'Slavia Praga', 'SLA', '#D52B1E', '#FFFFFF', 'shield'),
    // Selecciones
    T('esp-nt', 'España', 'ESP', '#AA151B', '#F1BF00', 'shield'),
    T('mar-nt', 'Marruecos', 'MAR', '#C1272D', '#006233', 'round'),
    T('fra-nt', 'Francia', 'FRA', '#0055A4', '#EF4135', 'shield'),
    T('ale-nt', 'Alemania', 'ALE', '#101010', '#DD0000', 'shield'),
    T('por-nt', 'Portugal', 'POR', '#006600', '#FF0000', 'shield'),
    T('ita-nt', 'Italia', 'ITA', '#0066CC', '#FFFFFF', 'shield'),
    T('ing-nt', 'Inglaterra', 'ING', '#FFFFFF', '#CF081F', 'shield'),
    T('arg-nt', 'Argentina', 'ARG', '#75AADB', '#FFFFFF', 'shield'),
    T('bra-nt', 'Brasil', 'BRA', '#009C3B', '#FFDF00', 'round'),
    // Segunda / Copa
    T('rac', 'Racing', 'RAC', '#009D4E', '#FFFFFF', 'shield'),
    T('zar', 'Zaragoza', 'ZAR', '#0F4C9A', '#FFFFFF', 'shield'),
    T('cad', 'Cádiz', 'CAD', '#F2D032', '#0057A5', 'shield'),
    T('spg', 'Sporting de Gijón', 'SPG', '#D80E1E', '#FFFFFF', 'shield'),
    T('bur', 'Burgos', 'BUR', '#101010', '#FFFFFF', 'shield'),
    T('leg', 'Leganés', 'LEG', '#0B4A9B', '#FFFFFF', 'shield'),
  ].map((t) => [t.id, t]),
);

export const COMPETITIONS: Record<string, Competition> = Object.fromEntries(
  (
    [
      ['laliga', 'LaLiga', 'España', 1, 'LaLiga'],
      ['ucl', 'Liga de Campeones', 'Europa', 0, 'UCL'],
      ['uel', 'Europa League', 'Europa', 2, 'UEL'],
      ['epl', 'Premier League', 'Inglaterra', 3, 'PL'],
      ['sea', 'Serie A', 'Italia', 4, 'Serie A'],
      ['bun', 'Bundesliga', 'Alemania', 5, 'Bundesliga'],
      ['l1', 'Ligue 1', 'Francia', 6, 'Ligue 1'],
      ['cdr', 'Copa del Rey', 'España', 7, 'Copa'],
      ['hyp', 'LaLiga Hypermotion', 'España', 8, 'Hypermotion'],
      ['nat', 'Clasificación Mundial', 'Selecciones', 9, 'Mundial'],
      ['ami', 'Amistoso', 'Internacional', 10, 'Amistoso'],
    ] as const
  ).map(([id, name, country, rank, short]) => [id, { id, name, country, rank, short }]),
);

export function team(id: string): Team {
  return TEAMS[id] ?? { id, name: id, short: id.slice(0, 3).toUpperCase(), primary: '#888', secondary: '#fff', crest: 'round' };
}
export function competition(id: string): Competition {
  return COMPETITIONS[id] ?? { id, name: 'Fútbol', country: '', rank: 99, short: 'Fútbol' };
}
