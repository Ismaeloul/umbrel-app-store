/* Instrumentación de la página (se inyecta con addInitScript ANTES que la web).

   Recoge, sin tocar el código de la web:
   - cada 250 ms: currentTime, paused, readyState, seeking, playbackRate,
     buffered y seekable, la calidad (fotogramas perdidos), el CÓDIGO de la
     tira del clip (qué fotograma de la emisión se ve), lo que dice hls.js
     (liveSyncPosition, latency, targetLatency, maxLatency, drift y la lista:
     edge, fragmentStart, targetduration, startSN/endSN, age) y el estado
     público del reproductor (`__acePlayer.get()` en desarrollo);
   - todos los eventos del <video> (waiting, seeking, seeked, stalled,
     playing, pause, ratechange…);
   - QUIÉN mueve el cabezal: el setter de `currentTime`, `play()`, `pause()`
     y `playbackRate` de HTMLMediaElement se envuelven y guardan la pila (en
     Vite de desarrollo sale el fichero: hls__js.js, controller.ts…);
   - los eventos de hls.js (ver `hlsPatch`: el módulo de hls.js se sirve
     parcheado y cada `trigger` llega aquí);
   - los eventos SSE que la web escucha (se envuelve EventSource);
   - los avisos de la línea de estado y los toasts (MutationObserver).

   Node lo recoge con `window.__lab.drain()` cada 2 s. */

import { CODE } from './clips.ts';

export function instrumentSource(): string {
  const code = { ...CODE };
  return `(() => {
  if (window.__lab) return;
  const CODE = ${JSON.stringify(code)};
  const lab = { samples: [], events: [], hls: null, hlsCount: 0, video: null };
  window.__lab = lab;
  const push = (type, data) => { lab.events.push(Object.assign({}, data || {}, { at: Date.now(), type })); };
  lab.push = push;
  lab.drain = () => { const out = { samples: lab.samples, events: lab.events }; lab.samples = []; lab.events = []; return out; };

  const ranges = (r) => { const out = []; try { for (let i = 0; i < r.length; i++) out.push([+r.start(i).toFixed(3), +r.end(i).toFixed(3)]); } catch {} return out; };
  const stack = () => {
    const lines = String(new Error().stack || '').split('\\n').slice(3, 12);
    return lines.map((l) => l.trim().replace(/^at /, '').replace(/https?:\\/\\/[^/]+/g, '').replace(/\\?v=[0-9a-f]+/g, '').replace(/\\?t=\\d+/g, '')).join(' <- ');
  };

  /* --- Quién mueve el cabezal --- */
  const P = HTMLMediaElement.prototype;
  const ctDesc = Object.getOwnPropertyDescriptor(P, 'currentTime');
  Object.defineProperty(P, 'currentTime', {
    configurable: true,
    get() { return ctDesc.get.call(this); },
    set(v) {
      if (this.tagName === 'VIDEO') push('seek.set', { from: +ctDesc.get.call(this).toFixed(3), to: +Number(v).toFixed(3), by: stack() });
      ctDesc.set.call(this, v);
    },
  });
  const rateDesc = Object.getOwnPropertyDescriptor(P, 'playbackRate');
  Object.defineProperty(P, 'playbackRate', {
    configurable: true,
    get() { return rateDesc.get.call(this); },
    set(v) {
      if (this.tagName === 'VIDEO' && Number(v) !== rateDesc.get.call(this)) push('rate.set', { from: rateDesc.get.call(this), to: Number(v), by: stack().slice(0, 300) });
      rateDesc.set.call(this, v);
    },
  });
  const origPlay = P.play;
  P.play = function () { if (this.tagName === 'VIDEO') push('call.play', { ct: +this.currentTime.toFixed(3), by: stack().slice(0, 400) }); return origPlay.apply(this, arguments); };
  const origPause = P.pause;
  P.pause = function () { if (this.tagName === 'VIDEO' && !this.paused) push('call.pause', { ct: +this.currentTime.toFixed(3), by: stack().slice(0, 400) }); return origPause.apply(this, arguments); };

  /* --- Eventos del <video> --- */
  const MEDIA_EVENTS = ['waiting','seeking','seeked','stalled','playing','pause','play','ratechange','emptied','loadstart','loadedmetadata','loadeddata','canplay','canplaythrough','ended','error','abort'];
  const lite = (v) => ({ ct: +v.currentTime.toFixed(3), rs: v.readyState, paused: v.paused, buf: ranges(v.buffered) });
  const hookVideo = (v) => {
    if (v.__labHooked) return;
    v.__labHooked = true;
    lab.video = v;
    push('video.found', {});
  };
  /* En fase de captura en window: llega ANTES que los manejadores de la web (el de 'error' de runtime.ts
     vacía el <video> y después ya no se ve v.error). */
  for (const name of MEDIA_EVENTS) window.addEventListener(name, (e) => {
    const v = e.target;
    if (!v || v.tagName !== 'VIDEO') return;
    const extra = name === 'error' && v.error ? { code: v.error.code, message: String(v.error.message || '').slice(0, 300) } : {};
    push('media.' + name, Object.assign(lite(v), extra));
  }, true);

  /* --- hls.js (el módulo parcheado llama aquí en cada trigger) --- */
  const HLS_KEEP = new Set(['hlsMediaAttached','hlsMediaDetaching','hlsManifestLoading','hlsManifestParsed','hlsLevelLoaded','hlsLevelUpdated','hlsFragLoaded','hlsFragBuffered','hlsFragChanged','hlsError','hlsBufferFlushing','hlsBufferFlushed','hlsLevelPtsUpdated','hlsFragParsingInitSegment','hlsDestroying','hlsBufferEos','hlsLiveBackBufferReached','hlsBackBufferReached']);
  window.__labHlsEvent = (hls, ev, data) => {
    if (lab.hls !== hls) { lab.hls = hls; lab.hlsCount += 1; push('hls.instance', { n: lab.hlsCount }); }
    if (!HLS_KEEP.has(ev)) return;
    const d = data || {};
    const out = {};
    try {
      if (ev === 'hlsLevelUpdated' || ev === 'hlsLevelLoaded') {
        const det = d.details || {};
        Object.assign(out, { seq: det.startSN, endSN: det.endSN, td: det.targetduration, edge: +(det.edge ?? 0).toFixed(3), fstart: +(det.fragmentStart ?? 0).toFixed(3), tot: +(det.totalduration ?? 0).toFixed(3), updated: det.updated, advanced: det.advanced, misses: det.misses, drift: det.drift, durs: (det.fragments || []).slice(-4).map((f) => +f.duration.toFixed(3)) });
      } else if (ev === 'hlsFragLoaded' || ev === 'hlsFragBuffered' || ev === 'hlsFragChanged') {
        const f = d.frag || {};
        Object.assign(out, { sn: f.sn, start: +(f.start ?? 0).toFixed(3), dur: +(f.duration ?? 0).toFixed(3), cc: f.cc, ms: d.stats ? Math.round((d.stats.loading?.end ?? 0) - (d.stats.loading?.start ?? 0)) : undefined });
      } else if (ev === 'hlsError') {
        Object.assign(out, { details: d.details, fatal: d.fatal, etype: d.type, reason: d.reason ? String(d.reason).slice(0, 200) : undefined, err: d.error ? String(d.error.message || d.error).slice(0, 300) : undefined, buffer: d.buffer, code: d.response?.code });
      } else if (ev === 'hlsLevelPtsUpdated') {
        Object.assign(out, { drift: d.drift, start: d.start, end: d.end, track: d.type });
      } else if (ev === 'hlsBufferFlushing') {
        Object.assign(out, { start: d.startOffset, end: d.endOffset, track: d.type });
      }
    } catch (e) { out.err = String(e); }
    push('hls.' + ev.replace(/^hls/, ''), out);
  };

  /* --- SSE --- */
  const ES = window.EventSource;
  if (ES) {
    window.EventSource = class extends ES {
      constructor(url, init) { super(url, init); this.__labTypes = new Set(); push('sse.open', { url: String(url).replace(/[?].*/, '') }); }
      addEventListener(type, fn, opts) {
        if (this.__labTypes && !this.__labTypes.has(type)) {
          this.__labTypes.add(type);
          super.addEventListener(type, (e) => { if (type !== 'stream.stats') push('sse', { event: type, data: String(e.data ?? '').slice(0, 500) }); });
        }
        return super.addEventListener(type, fn, opts);
      }
    };
  }

  /* --- Código del fotograma que se ve --- */
  let canvas = null, ctx = null;
  const readCode = (v) => {
    try {
      if (!v || v.readyState < 2 || !v.videoWidth) return null;
      const w = CODE.blocks * CODE.blockPx, h = CODE.heightPx;
      if (!canvas) { canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; ctx = canvas.getContext('2d', { willReadFrequently: true }); }
      ctx.drawImage(v, 0, 0, w, h, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h).data;
      const lum = (i) => { let s = 0; for (let dy = -3; dy <= 3; dy += 3) for (let dx = -3; dx <= 3; dx += 3) { const x = i * CODE.blockPx + CODE.blockPx / 2 + dx, y = CODE.heightPx / 2 + dy; const o = (y * w + x) * 4; s += 0.299 * img[o] + 0.587 * img[o + 1] + 0.114 * img[o + 2]; } return s / 9; };
      if (lum(0) < 128 || lum(CODE.blocks - 1) > 128) return -1;
      let n = 0;
      for (let b = 0; b < CODE.blocks - 2; b++) if (lum(b + 1) > 128) n |= 1 << b;
      return n;
    } catch (e) { return -2; }
  };

  /* --- Avisos de la línea de estado y toasts --- */
  let lastNotice = '';
  const noticeText = () => {
    const nodes = document.querySelectorAll('[role="status"], [role="alert"], .toast, .status-line');
    const texts = [];
    nodes.forEach((n) => { const t = (n.textContent || '').trim(); if (t) texts.push(t.slice(0, 160)); });
    return texts.join(' | ');
  };

  /* --- Muestreo --- */
  setInterval(() => {
    const v = document.querySelector('video');
    if (v) hookVideo(v);
    const n = noticeText();
    const key = n.replace(/\d+/g, '#');
    if (key !== lastNotice) { lastNotice = key; push('notice', { text: n }); }
    if (!v) return;
    const h = lab.hls;
    let hs = null;
    try {
      if (h) {
        const det = h.latestLevelDetails || (h.levels && h.levels[h.currentLevel] && h.levels[h.currentLevel].details) || null;
        hs = { lsp: h.liveSyncPosition == null ? null : +h.liveSyncPosition.toFixed(3), lat: +(h.latency || 0).toFixed(3), tl: h.targetLatency == null ? null : +h.targetLatency.toFixed(3), ml: +(h.maxLatency || 0).toFixed(3), drift: h.drift, edge: det ? +det.edge.toFixed(3) : null, fstart: det ? +det.fragmentStart.toFixed(3) : null, td: det ? det.targetduration : null, seq: det ? det.startSN : null, endSN: det ? det.endSN : null, age: det ? +det.age.toFixed(2) : null };
      }
    } catch (e) { hs = { err: String(e) }; }
    let app = null;
    try {
      const s = window.__acePlayer && window.__acePlayer.get();
      if (s) app = { phase: s.phase, conn: s.conn, msg: s.message, reb: s.rebuffering ? s.rebuffering.targetS : null, live: s.live ? { at: s.live.atLive, behind: s.live.behindS, delay: s.live.delayS } : null, ahead: s.bufferAheadS, follow: s.following, engine: s.engine, src: s.streamSource, sid: s.sessionId, want: s.desiredPlaying, attempt: s.attempt };
    } catch {}
    let q = null;
    try { const pq = v.getVideoPlaybackQuality(); q = [pq.totalVideoFrames, pq.droppedVideoFrames]; } catch {}
    lab.samples.push({ at: Date.now(), ct: +v.currentTime.toFixed(3), paused: v.paused, rs: v.readyState, seeking: v.seeking, rate: v.playbackRate, buf: ranges(v.buffered), sk: ranges(v.seekable), dur: Number.isFinite(v.duration) ? +v.duration.toFixed(3) : String(v.duration), code: readCode(v), hls: hs, app, q });
  }, 250);
})();`;
}

/**
 * Parche del módulo de hls.js que sirve Vite (o el de node_modules en la página
 * sola): al final del módulo, `trigger` de la clase por defecto llama a
 * `window.__labHlsEvent(this, evento, datos)`.
 */
export function hlsPatch(source: string): string {
  const exportMatch = /export\s*\{([^}]*)\}\s*;?\s*(?:\/\/# sourceMappingURL=.*)?\s*$/.exec(source);
  let local: string | null = null;
  if (exportMatch) {
    for (const part of (exportMatch[1] as string).split(',')) {
      const m = /^\s*([\w$]+)\s+as\s+default\s*$/.exec(part);
      if (m) local = m[1] as string;
    }
  }
  if (!local) {
    const m = /export\s+default\s+([\w$]+)\s*;/.exec(source);
    if (m) local = m[1] as string;
  }
  if (!local) return source;
  return `${source}
;(() => {
  try {
    const H = ${local};
    const target = H && H.prototype;
    if (!target || target.__labPatched) return;
    target.__labPatched = true;
    const orig = target.trigger;
    target.trigger = function (event, data) {
      try { if (globalThis.__labHlsEvent) globalThis.__labHlsEvent(this, event, data); } catch {}
      return orig.call(this, event, data);
    };
  } catch (e) { console.warn('[lab] no se pudo parchear hls.js', e); }
})();
`;
}
