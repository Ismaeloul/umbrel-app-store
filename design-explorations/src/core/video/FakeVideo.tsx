import { useEffect, useRef } from 'react';
import { useSim } from '../store';

/* Vídeo falso: un canvas en bucle que dibuja una realización de fútbol
   estilizada (césped, líneas, jugadores, balón, marcador de la cadena).
   `quality` degrada la imagen (bloques, ruido) y `frozen` la congela. */

export interface FakeVideoProps {
  playing: boolean;
  /** 'ok' | 'weak' | 'frozen' */
  quality?: 'ok' | 'weak' | 'frozen';
  /** Colores de los equipos para las camisetas. */
  home?: string;
  away?: string;
  /** Rótulo de la cadena. */
  channel?: string;
  /** Marcador que pinta la propia «cadena» (cuando se destapa). */
  score?: string;
  className?: string;
  /** Tono del vídeo: 'broadcast' (realización) o 'studio' (plató para canales sin partido). */
  kind?: 'broadcast' | 'studio';
  radius?: number;
  style?: React.CSSProperties;
}

interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  side: 0 | 1;
}

export function FakeVideo({ playing, quality = 'ok', home = '#d8d8d8', away = '#2b5ee8', channel, score, className, kind = 'broadcast', radius = 0, style }: FakeVideoProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useSim((s) => s.reducedMotion);
  const stateRef = useRef({ t: 0, players: [] as Player[], ball: { x: 0.5, y: 0.5, vx: 0.0015, vy: 0.0009 }, cam: 0, zoom: 1, lastFrame: 0 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const st = stateRef.current;
    if (!st.players.length) {
      for (let i = 0; i < 20; i++) {
        st.players.push({ x: 0.1 + Math.random() * 0.8, y: 0.15 + Math.random() * 0.7, vx: 0, vy: 0, side: (i % 2) as 0 | 1 });
      }
    }
    let raf = 0;
    let running = true;

    const draw = (ts: number) => {
      if (!running) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const advance = playing && quality !== 'frozen' && !reducedMotion;
      const dt = advance ? Math.min(40, ts - (st.lastFrame || ts)) : 0;
      st.lastFrame = ts;
      st.t += dt;

      if (kind === 'studio') {
        drawStudio(ctx, w, h, st.t, channel);
      } else {
        drawPitch(ctx, w, h, st, dt, home, away, channel, score);
      }
      if (quality === 'weak' && advance) {
        // bloques de compresión y ruido
        ctx.save();
        const n = 6 + Math.floor(Math.random() * 6);
        for (let i = 0; i < n; i++) {
          const bx = Math.floor(Math.random() * 12) * (w / 12);
          const by = Math.floor(Math.random() * 7) * (h / 7);
          ctx.fillStyle = `rgba(${40 + Math.random() * 60},${90 + Math.random() * 40},${40},${0.25 + Math.random() * 0.3})`;
          ctx.fillRect(bx, by, w / 12, h / 7);
        }
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [playing, quality, home, away, channel, score, kind, reducedMotion]);

  return <canvas ref={ref} className={className} aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%', borderRadius: radius, background: '#0b1a10', ...style }} />;
}

function drawPitch(ctx: CanvasRenderingContext2D, w: number, h: number, st: { t: number; players: Player[]; ball: { x: number; y: number; vx: number; vy: number }; cam: number; zoom: number }, dt: number, home: string, away: string, channel?: string, score?: string) {
  // cámara: sigue al balón con suavidad
  const targetCam = (st.ball.x - 0.5) * 0.35;
  st.cam += (targetCam - st.cam) * 0.02 * (dt / 16 || 0);
  const zoomTarget = 1.15 + Math.sin(st.t / 9000) * 0.05;
  st.zoom += (zoomTarget - st.zoom) * 0.01 * (dt / 16 || 0);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(st.zoom, st.zoom);
  ctx.translate(-w / 2 - st.cam * w, -h / 2);

  // césped a franjas con perspectiva suave
  const stripes = 12;
  for (let i = 0; i < stripes; i++) {
    const x0 = (i / stripes) * w * 1.4 - w * 0.2;
    ctx.fillStyle = i % 2 === 0 ? '#2f7a3c' : '#2a6e36';
    ctx.fillRect(x0, -h * 0.2, (w * 1.4) / stripes + 1, h * 1.4);
  }
  // sombra de gradas arriba
  const grad = ctx.createLinearGradient(0, -h * 0.2, 0, h * 0.35);
  grad.addColorStop(0, 'rgba(10,14,20,0.9)');
  grad.addColorStop(1, 'rgba(10,14,20,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(-w * 0.3, -h * 0.2, w * 1.6, h * 0.55);
  // luz de focos
  const spot = ctx.createRadialGradient(w * 0.5, h * 0.55, 10, w * 0.5, h * 0.55, w * 0.7);
  spot.addColorStop(0, 'rgba(255,255,230,0.14)');
  spot.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = spot;
  ctx.fillRect(-w * 0.3, -h * 0.2, w * 1.6, h * 1.4);

  // líneas
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = Math.max(1, w * 0.0025);
  const px = w * 0.05;
  const py = h * 0.18;
  const pw = w * 0.9;
  const ph = h * 0.72;
  ctx.strokeRect(px, py, pw, ph);
  ctx.beginPath();
  ctx.moveTo(w / 2, py);
  ctx.lineTo(w / 2, py + ph);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, py + ph / 2, ph * 0.13, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(px, py + ph * 0.22, pw * 0.16, ph * 0.56);
  ctx.strokeRect(px + pw - pw * 0.16, py + ph * 0.22, pw * 0.16, ph * 0.56);
  ctx.strokeRect(px, py + ph * 0.36, pw * 0.06, ph * 0.28);
  ctx.strokeRect(px + pw - pw * 0.06, py + ph * 0.36, pw * 0.06, ph * 0.28);

  // balón
  const b = st.ball;
  const step = dt / 16;
  b.x += b.vx * step;
  b.y += b.vy * step;
  if (b.x < 0.08 || b.x > 0.92) b.vx *= -1;
  if (b.y < 0.22 || b.y > 0.86) b.vy *= -1;
  if (Math.random() < 0.006 * step) {
    b.vx = (Math.random() - 0.5) * 0.006;
    b.vy = (Math.random() - 0.5) * 0.004;
  }

  // jugadores: persiguen el balón con inercia
  st.players.forEach((p, i) => {
    const k = 0.00025 + (i % 5) * 0.00004;
    const ax = (b.x - p.x) * k + (Math.random() - 0.5) * 0.0004;
    const ay = (b.y - p.y) * k + (Math.random() - 0.5) * 0.0004;
    p.vx = (p.vx + ax * step) * 0.96;
    p.vy = (p.vy + ay * step) * 0.96;
    p.x = Math.min(0.95, Math.max(0.05, p.x + p.vx * step));
    p.y = Math.min(0.9, Math.max(0.2, p.y + p.vy * step));
    const r = Math.max(3, h * 0.016 + p.y * h * 0.01);
    const x = p.x * w;
    const y = p.y * h;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 1.1, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.side === 0 ? home : away;
    ctx.beginPath();
    ctx.roundRect(x - r * 0.8, y - r * 1.6, r * 1.6, r * 2.1, r * 0.4);
    ctx.fill();
    ctx.fillStyle = '#e9c9a8';
    ctx.beginPath();
    ctx.arc(x, y - r * 2.1, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  });
  // balón
  const br = Math.max(2.5, h * 0.011);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(b.x * w, b.y * h + br, br, br * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(b.x * w, b.y * h - br * 0.4, br, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // viñeta y grano de emisión
  const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  // rótulo de la cadena (scorebug) arriba a la izquierda
  if (channel) {
    const fs = Math.max(9, Math.round(h * 0.035));
    ctx.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
    const label = score ? `${channel}   ${score}` : channel;
    const tw = ctx.measureText(label).width;
    const padX = fs * 0.7;
    const boxW = tw + padX * 2 + fs * 1.1;
    const bx = (w - boxW) / 2;
    const by = h * 0.05;
    ctx.fillStyle = 'rgba(8,10,14,0.72)';
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, fs * 1.9, fs * 0.35);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + padX, by + fs * 0.95);
    // punto rojo de directo
    ctx.fillStyle = '#ff4d3d';
    ctx.beginPath();
    ctx.arc(bx + tw + padX * 2 + fs * 0.6, by + fs * 0.95, fs * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStudio(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, channel?: string) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1b2440');
  g.addColorStop(1, '#0c1020');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // paneles de luz que se mueven
  for (let i = 0; i < 5; i++) {
    const x = ((t / (2200 + i * 600)) % 1.4) * w - w * 0.2;
    const lg = ctx.createLinearGradient(x, 0, x + w * 0.25, h);
    lg.addColorStop(0, 'rgba(90,140,255,0)');
    lg.addColorStop(0.5, `rgba(${90 + i * 20},${140},255,0.12)`);
    lg.addColorStop(1, 'rgba(90,140,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(x, 0, w * 0.25, h);
  }
  // mesa
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, h * 0.7, w, h * 0.3);
  // presentadores
  const people = 3;
  for (let i = 0; i < people; i++) {
    const cx = w * (0.28 + i * 0.22);
    const cy = h * 0.6 + Math.sin(t / 900 + i) * 2;
    const r = h * 0.09;
    ctx.fillStyle = ['#3a4a7a', '#7a3a4a', '#3a6a5a'][i];
    ctx.beginPath();
    ctx.roundRect(cx - r * 1.3, cy - r * 0.2, r * 2.6, r * 2.2, r * 0.5);
    ctx.fill();
    ctx.fillStyle = '#e9c9a8';
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.9, r * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }
  if (channel) {
    const fs = Math.max(9, Math.round(h * 0.04));
    ctx.font = `700 ${fs}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textBaseline = 'middle';
    ctx.fillText(channel, w * 0.04, h * 0.1);
  }
}
