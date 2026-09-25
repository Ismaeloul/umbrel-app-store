import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { addManualSource, completeOnboarding, reportSource, setPreferences, useSim } from '../../../core/store';
import type { Source } from '../../../core/types';
import { I } from './icons';
import { SHORTCUT_TABLE } from '../../../core/keys';

/* Hoja modal (desde abajo en iPhone, centrada en escritorio ancho), menú
   contextual, y las hojas concretas: Reportar, Pegar Content ID, Ayuda, Gustos. */

export function Sheet({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  const controls = useDragControls();
  const reduced = useSim((s) => s.reducedMotion);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="tb-sheet-veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.1 : 0.22 }} onClick={onClose}>
          <motion.div
            className={`tb-sheet tb-sheet--${size}`}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={reduced ? { duration: 0.12 } : { type: 'spring', duration: 0.42, bounce: 0.1 }}
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) onClose();
            }}
          >
            <div className="tb-sheet__grab" onPointerDown={(e) => controls.start(e)} aria-hidden="true">
              <span />
            </div>
            {title && (
              <header className="tb-sheet__head">
                <h2>{title}</h2>
                <button type="button" className="tb-sheet__close" onClick={onClose} aria-label="Cerrar">
                  <I.X size={16} />
                </button>
              </header>
            )}
            <div className="tb-sheet__body">{children}</div>
            {footer && <footer className="tb-sheet__foot">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  separated?: boolean;
  shortcut?: string;
}

export function Menu({ items, onClose, title }: { items: MenuItem[]; onClose: () => void; title?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [onClose]);
  return (
    <div className="tb-menu-veil" onClick={onClose}>
      <motion.div ref={ref} className="tb-menu" role="menu" aria-label={title} onClick={(e) => e.stopPropagation()} initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', duration: 0.32, bounce: 0.12 }}>
        {title && <div className="tb-menu__title">{title}</div>}
        {items.map((it, i) => (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`tb-menu__item${it.danger ? ' is-danger' : ''}${it.separated ? ' is-separated' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            <span className="tb-menu__label">{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
            {it.checked && <I.Check size={16} />}
            {it.icon}
          </button>
        ))}
      </motion.div>
    </div>
  );
}

const REASONS: [string, string][] = [
  ['not_starting', 'No arranca'],
  ['stuttering', 'Se corta'],
  ['wrong_channel', 'Canal incorrecto'],
  ['bad_quality', 'Mala calidad'],
  ['audio', 'Problema de audio'],
];

export function ReportSheet({ source, kind, id, onClose }: { source: Source | null; kind: 'match' | 'channel'; id: string; onClose: () => void }) {
  const [reason, setReason] = useState('not_starting');
  return (
    <Sheet
      open={!!source}
      onClose={onClose}
      title="Reportar señal"
      size="sm"
      footer={
        <button
          type="button"
          className="tb-btn tb-btn--primary tb-btn--block"
          onClick={() => {
            if (source) reportSource(kind, id, source.id, reason);
            onClose();
          }}
        >
          Apartar y comprobar
        </button>
      }
    >
      <p className="tb-sheet__lead">
        ¿Qué pasa con <strong>{source?.listaName}</strong> · {source?.resolution}?
      </p>
      <div className="tb-choice">
        {REASONS.map(([v, l]) => (
          <button key={v} type="button" className={`tb-choice__item${reason === v ? ' is-on' : ''}`} onClick={() => setReason(v)} role="radio" aria-checked={reason === v}>
            <span className="tb-choice__radio" aria-hidden="true" />
            {l}
          </button>
        ))}
      </div>
      <p className="tb-sheet__note">La señal se aparta un rato y se vuelve a comprobar sola. Si estaba en pantalla, pasamos a la siguiente.</p>
    </Sheet>
  );
}

export function PasteSheet({ open, kind, id, onClose }: { open: boolean; kind: 'match' | 'channel'; id: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const hash = normalizeHash(text);
  const valid = !!hash;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Pegar Content ID"
      size="sm"
      footer={
        <button
          type="button"
          className="tb-btn tb-btn--primary tb-btn--block"
          disabled={!valid}
          onClick={() => {
            if (hash) addManualSource(kind, id, hash);
            setText('');
            onClose();
          }}
        >
          <I.Play size={16} /> Reproducir
        </button>
      }
    >
      <label className="tb-field">
        <span className="tb-field__label">Content ID o enlace acestream://</span>
        <input className="tb-field__input tb-field__input--mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="acestream://…" autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="text" />
      </label>
      <div className="tb-field__hint">{text && !valid ? 'Hace falta un ID de 40 caracteres, un enlace acestream:// o una URL con el ID.' : valid ? `ID detectado: ${hash.slice(0, 8)}…${hash.slice(-4)}` : 'Solo para esta sesión: no se guarda ni se vincula al canal.'}</div>
      <button type="button" className="tb-btn tb-btn--tint" onClick={() => setText('acestream://b2c3d4e5f60718293a4b5c6d7e8f901234567890')}>
        <I.Paste size={16} /> Pegar del portapapeles
      </button>
    </Sheet>
  );
}

export function normalizeHash(input: string): string {
  const m = input.toLowerCase().match(/[a-f0-9]{40}/);
  return m ? m[0] : '';
}

export function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = [...new Set(SHORTCUT_TABLE.map((s) => s.group))];
  return (
    <Sheet open={open} onClose={onClose} title="Atajos de teclado" size="md">
      {groups.map((g) => (
        <div key={g} className="tb-help__group">
          <h3>{g}</h3>
          {SHORTCUT_TABLE.filter((s) => s.group === g).map((s) => (
            <div key={s.keys} className="tb-help__row">
              <span>{s.label}</span>
              <kbd>{s.keys}</kbd>
            </div>
          ))}
        </div>
      ))}
      <p className="tb-sheet__note">Los atajos no actúan mientras escribes en un campo.</p>
    </Sheet>
  );
}

const LEAGUES = ['LaLiga', 'LaLiga Hypermotion', 'Liga de Campeones', 'Europa League', 'Premier League', 'Serie A', 'Bundesliga', 'Ligue 1', 'Copa del Rey'];
const TEAMS = ['Real Madrid', 'FC Barcelona', 'Atlético de Madrid', 'Athletic Club', 'Real Sociedad', 'Real Betis', 'Sevilla', 'Villarreal', 'Valencia', 'Manchester City', 'Arsenal', 'Liverpool', 'Bayern', 'PSG', 'Inter', 'Juventus'];
const NATIONS = ['España', 'Marruecos', 'Argentina', 'Brasil', 'Francia', 'Portugal', 'Italia', 'Inglaterra', 'Alemania'];

export function PrefsSheet({ open, onClose, firstUse = false }: { open: boolean; onClose: () => void; firstUse?: boolean }) {
  const prefs = useSim((s) => s.preferences);
  const [leagues, setLeagues] = useState(prefs.leagues);
  const [teams, setTeams] = useState(prefs.teams);
  const [nations, setNations] = useState(prefs.nationalities);
  useEffect(() => {
    if (open) {
      setLeagues(prefs.leagues);
      setTeams(prefs.teams);
      setNations(prefs.nationalities);
    }
  }, [open, prefs]);
  const toggle = (list: string[], set: (v: string[]) => void, v: string, max: number) => {
    if (list.includes(v)) set(list.filter((x) => x !== v));
    else if (list.length < max) set([...list, v]);
  };
  const save = () => {
    setPreferences({ leagues, teams, nationalities: nations, onboardingComplete: true });
    completeOnboarding();
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={firstUse ? 'Tu fútbol' : 'Tu fútbol'}
      size="lg"
      footer={
        <div className="tb-sheet__actions">
          {!firstUse && (
            <button type="button" className="tb-btn tb-btn--tint" onClick={onClose}>
              Cancelar
            </button>
          )}
          <button type="button" className="tb-btn tb-btn--primary tb-btn--block" onClick={save}>
            {firstUse ? 'Ver mis partidos' : 'Guardar'}
          </button>
        </div>
      }
    >
      <p className="tb-sheet__lead">Elige lo que sigues. «Para ti» enseña solo esos partidos; siempre puedes ver todos.</p>
      <ChipGroup title="Ligas" items={LEAGUES} selected={leagues} onToggle={(v) => toggle(leagues, setLeagues, v, 12)} max={12} />
      <ChipGroup title="Equipos" items={TEAMS} selected={teams} onToggle={(v) => toggle(teams, setTeams, v, 24)} max={24} />
      <ChipGroup title="Selecciones" items={NATIONS} selected={nations} onToggle={(v) => toggle(nations, setNations, v, 24)} max={24} />
    </Sheet>
  );
}

function ChipGroup({ title, items, selected, onToggle, max }: { title: string; items: string[]; selected: string[]; onToggle: (v: string) => void; max: number }) {
  return (
    <section className="tb-chips">
      <h3>
        {title} <span>{selected.length} de {max}</span>
      </h3>
      <div className="tb-chips__wrap">
        {items.map((it) => (
          <button key={it} type="button" className={`tb-chip${selected.includes(it) ? ' is-on' : ''}`} onClick={() => onToggle(it)} aria-pressed={selected.includes(it)}>
            {selected.includes(it) && <I.Check size={14} />}
            {it}
          </button>
        ))}
      </div>
    </section>
  );
}
