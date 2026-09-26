/* La tabla de alias del buscador (docs/iptv.md §20): que se pueda editar sin
   romper nada. Cada nombre en un solo grupo, el primero siempre «de verdad»,
   y los grupos que Isma pidió por su nombre. */

import { describe, expect, it } from 'vitest';
import {
  SEARCH_ALIASES,
  aliasDisplayName,
  aliasOf,
  searchFold,
  searchWords,
} from '../src/index.js';

describe('SEARCH_ALIASES', () => {
  it('ids únicos y cada grupo con al menos dos nombres', () => {
    const ids = SEARCH_ALIASES.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of SEARCH_ALIASES) expect(group.names.length).toBeGreaterThanOrEqual(2);
  });

  it('el primer nombre es «de verdad» (se manda al motor) y ninguno queda vacío', () => {
    for (const group of SEARCH_ALIASES) {
      expect(group.names[0]?.startsWith('~'), group.id).toBe(false);
      for (const name of group.names)
        expect(searchWords(aliasDisplayName(name)).length).toBeGreaterThan(0);
    }
  });

  it('un nombre (ya plegado) está en un solo grupo', () => {
    const owner = new Map<string, string>();
    for (const group of SEARCH_ALIASES) {
      for (const name of group.names) {
        const folded = searchFold(aliasDisplayName(name));
        const other = owner.get(folded);
        if (other && other !== group.id)
          throw new Error(`«${name}» está en ${other} y en ${group.id}`);
        owner.set(folded, group.id);
      }
    }
  });

  it.each([
    ['ING', 'inglaterra'],
    ['ESP', 'espana'],
    ['RMA', 'real-madrid'],
    ['FCB', 'barcelona'],
    ['ATM', 'atletico-madrid'],
    ['Barça', 'barcelona'],
    ['Barca', 'barcelona'],
    ['Barsa', 'barcelona'],
    ['Atleti', 'atletico-madrid'],
    ['Madrid', 'real-madrid'],
    ['Betis', 'betis'],
    ['la Real', 'real-sociedad'],
    ['el Submarino', 'villarreal'],
    ['la Roja', 'espana'],
    ['Champions', 'ucl'],
    ['Liga de Campeones', 'ucl'],
    ['UCL', 'ucl'],
    ['Europa League', 'uel'],
    ['UEL', 'uel'],
    ['Conference', 'uecl'],
    ['UECL', 'uecl'],
    ['LaLiga', 'laliga'],
    ['La Liga', 'laliga'],
    ['Primera', 'laliga'],
    ['Hypermotion', 'hypermotion'],
    ['Segunda', 'hypermotion'],
    ['Copa del Rey', 'copa-del-rey'],
    ['Supercopa', 'supercopa'],
    ['Nations League', 'unl'],
    ['UNL', 'unl'],
    ['Mundial', 'mundial'],
    ['Eurocopa', 'eurocopa'],
    ['Premier', 'premier'],
    ['Serie A', 'serie-a'],
    ['Bundesliga', 'bundesliga'],
    ['Ligue 1', 'ligue-1'],
    ['M.', 'movistar'],
    ['M+', 'movistar'],
    ['Movistar', 'movistar'],
    ['Movistar Plus+', 'movistar'],
    ['Tele 5', 'telecinco'],
    ['T5', 'telecinco'],
    ['La 6', 'lasexta'],
    ['TDP', 'teledeporte'],
    ['RMTV', 'rmtv'],
    ['Gol', 'gol'],
    ['beIN', 'bein'],
    ['Eurosport', 'eurosport'],
    ['basket', 'baloncesto'],
    ['F1', 'f1'],
    ['Liga F', 'liga-f'],
  ])('«%s» es %s', (name, id) => {
    expect(aliasOf(name)?.id).toBe(id);
  });

  it('lo que nunca se junta', () => {
    expect(aliasOf('Liga F')?.id).not.toBe('laliga');
    expect(aliasOf('Hypermotion')?.id).not.toBe('laliga');
    expect(aliasOf('Real Sociedad')?.id).not.toBe('real-madrid');
    expect(aliasOf('Getafe')?.id).not.toBe('girona');
    expect(aliasOf('DAZN 1')).toBeNull();
    expect(aliasOf('Primera Federación')?.id).toBe('primera-federacion');
  });
});
