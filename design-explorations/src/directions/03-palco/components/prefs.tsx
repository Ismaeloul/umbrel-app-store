/* «¿Qué fútbol te mueve?»: ligas, equipos y selecciones. Compartido por web e
   iPhone; cada uno lo mete en su hoja o pantalla. */

import { useState } from 'react';
import { completeOnboarding, setPreferences, toast, useSim } from '../../../core/store';
import { Button, Chip, TextField } from './primitives';
import { Icon } from './icons';

export const LEAGUES = ['LaLiga', 'Liga de Campeones', 'Europa League', 'Premier League', 'Serie A', 'Bundesliga', 'Ligue 1', 'Copa del Rey', 'LaLiga Hypermotion'];
export const TEAMS = ['Real Madrid', 'FC Barcelona', 'Atlético de Madrid', 'Athletic Club', 'Real Sociedad', 'Villarreal', 'Real Betis', 'Sevilla', 'Valencia', 'Arsenal', 'Liverpool', 'Manchester City', 'Bayern', 'PSG', 'Juventus', 'Napoli'];
export const NATIONS = ['España', 'Marruecos', 'Francia', 'Alemania', 'Italia', 'Inglaterra', 'Portugal', 'Argentina', 'Brasil'];

export function prefsSummary(p: { leagues: string[]; teams: string[]; nationalities: string[] }): string {
  const parts = [...p.leagues, ...p.teams, ...p.nationalities];
  if (!parts.length) return 'Sin gustos todavía: la agenda enseña todo';
  const head = parts.slice(0, 3).join(', ');
  return parts.length > 3 ? `${head} y ${parts.length - 3} más` : head;
}

export function PrefsForm({ onDone, onCancel, compact, firstUse, stickyFooter }: { onDone: () => void; onCancel?: () => void; compact?: boolean; firstUse?: boolean; stickyFooter?: boolean }) {
  const prefs = useSim((s) => s.preferences);
  const [leagues, setLeagues] = useState<string[]>(prefs.leagues);
  const [teams, setTeams] = useState<string[]>(prefs.teams);
  const [nats, setNats] = useState<string[]>(prefs.nationalities);
  const [extra, setExtra] = useState('');
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const save = () => {
    setPreferences({ leagues, teams, nationalities: nats });
    completeOnboarding();
    toast('Tu agenda ya está personalizada', 'ok');
    onDone();
  };
  const total = leagues.length + teams.length + nats.length;
  return (
    <div className={`pl-prefs${compact ? ' pl-prefs--compact' : ''}`}>
      <header className="pl-prefs__head">
        <h2 className="pl-prefs__title">¿Qué fútbol te mueve?</h2>
        <p className="pl-prefs__lead">{firstUse ? 'Elige lo tuyo y «Para ti» lo pondrá delante. Lo puedes cambiar cuando quieras.' : 'Lo que marques aquí es lo que enseña «Para ti».'}</p>
      </header>
      <section className="pl-prefs__group">
        <h3>
          <span className="pl-prefs__num">01</span> Tus ligas
        </h3>
        <div className="pl-prefs__chips">
          {LEAGUES.map((l) => (
            <Chip key={l} selected={leagues.includes(l)} onClick={() => toggle(leagues, setLeagues, l)}>
              {l}
            </Chip>
          ))}
        </div>
      </section>
      <section className="pl-prefs__group">
        <h3>
          <span className="pl-prefs__num">02</span> Tus equipos
        </h3>
        <div className="pl-prefs__chips">
          {TEAMS.map((t) => (
            <Chip key={t} selected={teams.includes(t)} onClick={() => toggle(teams, setTeams, t)}>
              {t}
            </Chip>
          ))}
        </div>
      </section>
      <section className="pl-prefs__group">
        <h3>
          <span className="pl-prefs__num">03</span> Selecciones
        </h3>
        <div className="pl-prefs__chips">
          {NATIONS.map((n) => (
            <Chip key={n} selected={nats.includes(n)} onClick={() => toggle(nats, setNats, n)}>
              {n}
            </Chip>
          ))}
        </div>
        <form
          className="pl-prefs__add"
          onSubmit={(e) => {
            e.preventDefault();
            const v = extra.trim();
            if (!v) return;
            if (!teams.includes(v)) setTeams([...teams, v]);
            setExtra('');
          }}
        >
          <TextField icon="plus" placeholder="Añadir otro equipo…" value={extra} onChange={(e) => setExtra(e.target.value)} />
        </form>
      </section>
      <footer className={`pl-prefs__foot${stickyFooter ? " pl-prefs__foot--sticky" : ""}`}>
        <span className="pl-prefs__count">
          <Icon name="sparkle" size={14} /> {total ? `${total} elegidos` : 'Nada elegido: verás todo'}
        </span>
        <div className="pl-prefs__btns">
          {onCancel && (
            <Button variant="quiet" onClick={onCancel}>
              {firstUse ? 'Ahora no' : 'Cancelar'}
            </Button>
          )}
          <Button variant="gold" onClick={save} icon="check">
            {firstUse ? 'Ver mi agenda' : 'Guardar'}
          </Button>
        </div>
      </footer>
    </div>
  );
}
