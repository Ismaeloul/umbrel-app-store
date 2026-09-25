/* Consola · Tu fútbol (web): ligas, equipos y selecciones como chips; el
   mismo componente sirve de paso de primer uso. */

import { useState } from 'react';
import { back } from '../../../core/router';
import { completeOnboarding, setPreferences, toast, useSim } from '../../../core/store';
import { COMPETITIONS, TEAMS } from '../../../core/data/teams';
import { Button, Chip } from '../components/ui';

export const LEAGUES = Object.values(COMPETITIONS)
  .filter((c) => c.id !== 'ami' && c.id !== 'nat')
  .sort((a, b) => a.rank - b.rank)
  .map((c) => c.name);
export const CLUBS = Object.values(TEAMS)
  .filter((t) => !t.id.endsWith('-nt'))
  .map((t) => t.name)
  .sort((a, b) => a.localeCompare(b, 'es'));
export const NATIONS = Object.values(TEAMS)
  .filter((t) => t.id.endsWith('-nt'))
  .map((t) => t.name)
  .sort((a, b) => a.localeCompare(b, 'es'));

export function useGustosDraft() {
  const prefs = useSim((s) => s.preferences);
  const [leagues, setLeagues] = useState<string[]>(prefs.leagues);
  const [teams, setTeams] = useState<string[]>(prefs.teams);
  const [nations, setNations] = useState<string[]>(prefs.nationalities);
  const flip = (list: string[], set: (v: string[]) => void, v: string, max: number) => {
    if (list.includes(v)) set(list.filter((x) => x !== v));
    else if (list.length < max) set([...list, v]);
    else toast(`Como mucho ${max}`, 'warn');
  };
  const save = () => {
    setPreferences({ leagues, teams, nationalities: nations });
    completeOnboarding();
    toast('Tu agenda ya está personalizada', 'ok');
  };
  return { leagues, teams, nations, flip, setLeagues, setTeams, setNations, save, total: leagues.length + teams.length + nations.length };
}

export function Gustos() {
  const d = useGustosDraft();
  const [teamFilter, setTeamFilter] = useState('');
  const clubs = teamFilter ? CLUBS.filter((c) => c.toLowerCase().includes(teamFilter.toLowerCase())) : CLUBS;
  return (
    <div className="co-gustos">
      <header className="co-gustos-head">
        <h1 className="co-h1">¿Qué fútbol te mueve?</h1>
        <p className="co-label">«Para ti» reúne tus ligas, tus equipos y tus selecciones. Resalta, no reordena.</p>
      </header>
      <section className="co-gustos-group">
        <h2 className="co-insp-title">
          Ligas <span className="co-label">{d.leagues.length} de 12</span>
        </h2>
        <div className="co-chips">
          {LEAGUES.map((l) => (
            <Chip key={l} on={d.leagues.includes(l)} onClick={() => d.flip(d.leagues, d.setLeagues, l, 12)}>
              {l}
            </Chip>
          ))}
        </div>
      </section>
      <section className="co-gustos-group">
        <h2 className="co-insp-title">
          Equipos <span className="co-label">{d.teams.length} de 24</span>
        </h2>
        <label className="co-field" style={{ maxWidth: 280, marginBottom: 8 }}>
          <input value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} placeholder="Filtrar equipos…" />
        </label>
        <div className="co-chips">
          {clubs.map((l) => (
            <Chip key={l} on={d.teams.includes(l)} onClick={() => d.flip(d.teams, d.setTeams, l, 24)}>
              {l}
            </Chip>
          ))}
        </div>
      </section>
      <section className="co-gustos-group">
        <h2 className="co-insp-title">
          Selecciones <span className="co-label">{d.nations.length} de 24</span>
        </h2>
        <div className="co-chips">
          {NATIONS.map((l) => (
            <Chip key={l} on={d.nations.includes(l)} onClick={() => d.flip(d.nations, d.setNations, l, 24)}>
              {l}
            </Chip>
          ))}
        </div>
      </section>
      <footer className="co-gustos-foot">
        <span className="co-label">{d.total === 0 ? 'Sin nada elegido, la agenda enseña «Todos».' : `${d.total} elegidos`}</span>
        <span className="co-grow" />
        <Button onClick={() => back('ajustes')}>Cancelar</Button>
        <Button
          kind="primary"
          onClick={() => {
            d.save();
            back('agenda');
          }}
        >
          Guardar y ver mi agenda
        </Button>
      </footer>
    </div>
  );
}
