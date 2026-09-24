/* Átomos de Pizarra: medidor de 4 segmentos, sparkline, cifras que rotan,
   línea de tiempo del partido, QR generado y pequeñas piezas. */
import { useMemo } from 'react';
import type { GoalEvent, LiveScore } from '../../../core/types';
import type { SignalKind } from './data';
import { useSamples } from './prefs';

/* ---------- medidor ---------- */
const WORDS: Record<SignalKind, string> = {
  verified: 'Verificada',
  weak: 'Floja',
  none: 'Sin señal',
  checking: 'Comprobando',
  queued: 'En cola',
  pending: 'Pendiente',
};

export function Meter({ kind, word, size = 'm', slate, title, label }: { kind: SignalKind; word?: boolean | string; size?: 'm' | 'lg'; slate?: boolean; title?: string; label?: string }) {
  const text = typeof word === 'string' ? word : word ? WORDS[kind] : null;
  return (
    <span className={`pz-meter pz-meter--${kind}${size === 'lg' ? ' pz-meter--lg' : ''}${slate ? ' pz-meter--slate' : ''} pz-anim`} title={title ?? label ?? WORDS[kind]} role="img" aria-label={label ?? WORDS[kind]}>
      <span className="pz-meter-bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        {kind === 'none' && (
          <svg className="pz-meter-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
            <path d="M5 5l14 14M19 5L5 19" />
          </svg>
        )}
      </span>
      {text && <span className="pz-meter-word">{text}</span>}
    </span>
  );
}

/* ---------- sparkline 40×14 ---------- */
export function Sparkline({ sourceId, weak, width = 40, height = 14 }: { sourceId: string | null; weak?: boolean; width?: number; height?: number }) {
  const samples = useSamples(sourceId);
  const d = useMemo(() => {
    if (samples.length < 2) return '';
    const max = Math.max(...samples, 1);
    const min = Math.min(...samples);
    const span = Math.max(1, max - min);
    const n = samples.length;
    return samples
      .map((v, i) => {
        const x = (i / (n - 1)) * (width - 1) + 0.5;
        const y = height - 1.5 - ((v - min) / span) * (height - 3);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [samples, width, height]);
  return (
    <svg className={`pz-spark${weak ? ' pz-spark--weak' : ''}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line x1="0" y1={height - 0.5} x2={width} y2={height - 0.5} strokeWidth="1" />
      {d ? <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /> : <path d={`M0.5 ${height - 3} H ${width - 0.5}`} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="2 2" />}
    </svg>
  );
}

/* ---------- cifras que rotan ---------- */
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function Roll({ value, className }: { value: number; className?: string }) {
  const str = String(Math.max(0, Math.floor(value)));
  return (
    <span className={`pz-roll${className ? ` ${className}` : ''}`} aria-label={str}>
      {str.split('').map((ch, i) => {
        const d = Number(ch);
        return (
          <span className="pz-roll-col" key={`${str.length}-${i}`} aria-hidden="true">
            <span className="pz-roll-strip" style={{ transform: `translateY(-${d * 10}%)` }}>
              {DIGITS.map((x) => (
                <span key={x}>{x}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/* ---------- línea de tiempo ---------- */
export function Timeline({ score, goals, homeColor, awayColor, showLabels = true }: { score: LiveScore; goals: GoalEvent[]; homeColor: string; awayColor: string; showLabels?: boolean }) {
  const W = 400;
  const H = 30;
  const x0 = 4;
  const x1 = W - 4;
  const len = x1 - x0;
  const totalMin = 94; // 45+2 · 45+4 aprox
  const xOf = (min: number) => x0 + (Math.min(min, totalMin) / totalMin) * len;
  const progress = score.state === 'post' ? 1 : score.state === 'pre' ? 0 : Math.min(1, score.minute / totalMin);
  const midY = 15;
  return (
    <svg className="pz-tl" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <line className="tl-base" x1={x0} y1={midY} x2={x1} y2={midY} />
      {progress > 0 && <line className="tl-fill" x1={x0} y1={midY} x2={x0 + len * progress} y2={midY} />}
      <line className="tl-tick" x1={xOf(45)} y1={midY - 5} x2={xOf(45)} y2={midY + 5} />
      {goals.map((g, i) => {
        const x = xOf(g.minute);
        const up = g.side === 'home';
        const y = up ? midY - 7 : midY + 7;
        return <rect key={i} className="tl-goal" x={x - 3.5} y={y - 3.5} width="7" height="7" fill={up ? homeColor : awayColor} transform={`rotate(45 ${x} ${y})`} />;
      })}
      {score.state === 'in' && <circle className="tl-now" cx={x0 + len * progress} cy={midY} r="3.5" />}
      {showLabels && (
        <>
          <text x={x0} y={H - 1} textAnchor="start">
            0'
          </text>
          <text x={xOf(45)} y={H - 1} textAnchor="middle">
            DESC.
          </text>
          <text x={x1} y={H - 1} textAnchor="end">
            90'
          </text>
        </>
      )}
    </svg>
  );
}

/* ---------- QR generado (cuadrados pseudoaleatorios con patrones de posición) ---------- */
export function QR({ seed, size = 168 }: { seed: string; size?: number }) {
  const N = 25;
  const cells = useMemo(() => {
    let h = 2166136261;
    for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    const rnd = () => {
      h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const grid: boolean[][] = [];
    for (let y = 0; y < N; y++) {
      grid.push([]);
      for (let x = 0; x < N; x++) grid[y].push(rnd() < 0.46);
    }
    const finder = (ox: number, oy: number) => {
      for (let y = -1; y <= 7; y++)
        for (let x = -1; x <= 7; x++) {
          const gx = ox + x;
          const gy = oy + y;
          if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
          const ring = x === 0 || y === 0 || x === 6 || y === 6;
          const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          const inside = x >= 0 && x <= 6 && y >= 0 && y <= 6;
          grid[gy][gx] = inside ? ring || core : false;
        }
    };
    finder(0, 0);
    finder(N - 7, 0);
    finder(0, N - 7);
    // patrón de sincronía
    for (let i = 8; i < N - 8; i++) {
      grid[6][i] = i % 2 === 0;
      grid[i][6] = i % 2 === 0;
    }
    return grid;
  }, [seed]);
  const cell = size / N;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Código QR para emparejar" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      {cells.map((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill="#111418" /> : null)))}
    </svg>
  );
}

/* ---------- interruptor ---------- */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`pz-switch${on ? ' is-on' : ''}`} onClick={() => onChange(!on)} />;
}

/* ---------- segmentado ---------- */
export function Segmented<T extends string>({ value, onChange, options, size, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; count?: number }[]; size?: 'lg'; label?: string }) {
  return (
    <div className={`pz-seg${size === 'lg' ? ' pz-seg--lg' : ''}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} className={value === o.id ? 'is-on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
          {o.count !== undefined && <span className="pz-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- vacío ---------- */
export function Empty({ title, text, actions, center, icon }: { title: string; text?: string; actions?: React.ReactNode; center?: boolean; icon?: React.ReactNode }) {
  return (
    <div className={`pz-empty${center ? ' pz-empty--center' : ''}`}>
      {icon && <span className="pz-empty-glyph">{icon}</span>}
      <b>{title}</b>
      {text && <span>{text}</span>}
      {actions && <div className="pz-empty-actions">{actions}</div>}
    </div>
  );
}

/* ---------- disclosure ---------- */
export function Disclosure({ title, open, onToggle, children, right }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className={`pz-disc${open ? ' is-open' : ''}`}>
      <button type="button" className="pz-disc-head" onClick={onToggle} aria-expanded={open}>
        <span>{title}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {right}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && <div className="pz-disc-body">{children}</div>}
    </div>
  );
}
