/* Resolución y comprobador de muestra del modo demo (inventario §7.3 «Demo»
   y §22). Solo se descarga en demo: demo.ts lo pide con import().

   Cada partido de la agenda de muestra tiene su guion para enseñar los
   casos de verdad:
   - demo-1 y demo-5: seis fuentes con de todo (verificadas, floja, una que
     tarda en comprobarse, una sin señal con reintento y una en cola), como
     la maqueta. Arranca sola la primera verificada.
   - demo-4: ninguna verificada del todo → «probamos la fuente 3, que da
     señal floja».
   - demo-12: todas sin señal y reintento → «Las vuelvo a probar a las…».
   - demo-2: varias coincidencias → «Encontrar canal» con candidatos.
   - demo-3: nada → «Encontrar canal» para pegarlo a mano.
   El comprobador avanza un paso cada 1,35 s (como la 0.6.59, index.html:3570). */

import type {
  BindResponse,
  ReportResponse,
  Resolution,
  ResolutionCandidate,
  ScanCandidate,
  ScanJob,
  SourceReportReason,
} from '@ace/shared';
import { normalizeChannelKey } from '@ace/shared';

export const DEMO_STEP_MS = 1350;

type Outcome = 'working' | 'weak' | 'failed' | 'retry';

interface PlanItem {
  provider: string;
  outcome: Outcome;
  /** Pasos que tarda en decidirse (2 por defecto). */
  slow?: number;
  peers?: number;
  /** Mbit/s del enjambre y del canal. */
  intake?: number;
  stream?: number;
  source?: ResolutionCandidate['source'];
}

interface Plan {
  status: Resolution['status'];
  items: PlanItem[];
  engineAvailable?: boolean;
}

const RICH: PlanItem[] = [
  { provider: 'Elcano', outcome: 'working', peers: 48, intake: 6.2, stream: 4.8 },
  { provider: 'Faro', outcome: 'working', peers: 31, intake: 5.1, stream: 4.8 },
  { provider: 'Norte', outcome: 'weak', peers: 9, intake: 2.1, stream: 4.8 },
  { provider: 'Vega', outcome: 'working', slow: 9, peers: 22, intake: 4.9, stream: 4.8 },
  { provider: 'Tarifa', outcome: 'retry' },
  { provider: 'Sur', outcome: 'failed', slow: 14 },
];

const PLANS: Record<string, Plan> = {
  'demo-1': { status: 'found', items: RICH },
  'demo-5': { status: 'found', items: RICH },
  'demo-4': {
    status: 'found',
    items: [
      { provider: 'Alba', outcome: 'failed' },
      { provider: 'Brisa', outcome: 'failed' },
      { provider: 'Cierzo', outcome: 'weak', peers: 6, intake: 1.8, stream: 4.2 },
      { provider: 'Duna', outcome: 'failed' },
      { provider: 'Estela', outcome: 'failed' },
    ],
  },
  'demo-12': {
    status: 'found',
    items: [
      { provider: 'Orión', outcome: 'retry' },
      { provider: 'Lira', outcome: 'retry' },
      { provider: 'Vela', outcome: 'retry' },
      { provider: 'Hidra', outcome: 'retry' },
    ],
  },
  'demo-2': {
    status: 'choices',
    items: [
      { provider: 'Zapping HD', outcome: 'working', source: 'acestream' },
      { provider: 'Zapping 2', outcome: 'weak', source: 'm3u' },
    ],
  },
  'demo-3': { status: 'not_found', items: [] },
};

const DEFAULT_PLAN: Plan = {
  status: 'found',
  items: [
    { provider: 'Atlas', outcome: 'working', peers: 27, intake: 5.4, stream: 4.6 },
    { provider: 'Boreal', outcome: 'weak', peers: 7, intake: 2.4, stream: 4.6 },
    { provider: 'Cénit', outcome: 'failed' },
  ],
};

const RESEARCH_EXTRA: PlanItem[] = [
  { provider: 'Poniente', outcome: 'working', peers: 18, intake: 5.6, stream: 4.8 },
  { provider: 'Levante', outcome: 'failed' },
];

/** 40 hex deterministas a partir de un texto (FNV-1a + xorshift). */
export function demoHash(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = '';
  let x = h || 1;
  while (out.length < 40) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out += x.toString(16).padStart(8, '0');
  }
  return out.slice(0, 40);
}

let jobCounter = 0;
function newJobId(): string {
  jobCounter += 1;
  return `de${Date.now().toString(16)}${jobCounter.toString(16)}`.padEnd(24, '0').slice(0, 24);
}

interface DemoJob {
  id: string;
  kind: ScanJob['kind'];
  createdAt: number;
  items: Array<PlanItem & { hash: string }>;
}

const jobs = new Map<string, DemoJob>();

function planFor(matchId: string | undefined): Plan {
  return (matchId && PLANS[matchId]) || DEFAULT_PLAN;
}

function candidateOf(
  item: PlanItem & { hash: string },
  channel: string,
  index: number,
): ResolutionCandidate {
  return {
    id: item.hash,
    title: `${channel} --> ${item.provider}`,
    alias: null,
    ih: item.source === 'acestream',
    source: item.source ?? 'm3u',
    score: 100 - index,
    matchedChannel: channel,
    soloFamilia: false,
    familyFallbackAllowed: false,
    listaId: item.source === 'acestream' ? null : 'principal',
    availability: item.source === 'acestream' ? 0.91 : item.outcome === 'weak' ? 0.4 : null,
    bitrate: null,
    learned: null,
    reported: null,
    rejectedByLearning: false,
    quarantined: false,
  };
}

function scanRef(job: DemoJob) {
  return {
    id: job.id,
    statusUrl: `/api/v1/football/scans/${job.id}`,
    total: job.items.length,
    initialCount: Math.min(3, job.items.length),
  };
}

export function demoResolve(query: {
  match?: string | undefined;
  channel?: string | string[] | undefined;
  research?: '0' | '1' | undefined;
}): Resolution {
  const channels = Array.isArray(query.channel) ? query.channel : query.channel ? [query.channel] : [];
  const channel = channels[0] ?? 'Canal';
  const plan = planFor(query.match);
  const research = query.research === '1';
  const items = [...plan.items, ...(research ? RESEARCH_EXTRA : [])].map((item) => ({
    ...item,
    hash: demoHash(`${query.match ?? channel}|${item.provider}`),
  }));
  const candidates = items.map((item, index) => candidateOf(item, channel, index));
  const base: Resolution = {
    status: research ? 'found' : plan.status,
    channels,
    checked: ['saved', 'm3u', 'favorites', 'history', 'acestream'],
    candidates,
    engineAvailable: plan.engineAvailable ?? true,
    ai: { enabled: false, used: false, model: null, catalogSize: 0, error: null },
    program: null,
    research,
    preheat: null,
    scan: null,
  };
  if (base.status !== 'found') return { ...base, candidate: null };
  const job: DemoJob = {
    id: newJobId(),
    kind: research ? 'research' : 'interactive',
    createdAt: Date.now(),
    items,
  };
  jobs.set(job.id, job);
  return { ...base, candidate: candidates[0] ?? null, scan: scanRef(job) };
}

function stepsOf(item: PlanItem, index: number): { start: number; end: number } {
  const start = Math.floor(index / 2);
  return { start, end: start + (item.slow ?? 2) };
}

function probeOf(item: PlanItem & { hash: string }, index: number, step: number, now: number): ScanCandidate {
  const { start, end } = stepsOf(item, index);
  const done = step >= end;
  const checking = !done && step >= start;
  const final: ScanCandidate['state'] =
    item.outcome === 'retry' ? 'failed' : item.outcome;
  const state: ScanCandidate['state'] = done ? final : checking ? 'checking' : 'queued';
  const alive = done && (final === 'working' || final === 'weak');
  const retryAt = done && item.outcome === 'retry' ? new Date(now + 6 * 60_000).toISOString() : null;
  return {
    id: item.hash,
    state,
    checkedAt: done ? new Date(now).toISOString() : null,
    retryAt,
    durationMs: done ? 900 + index * 630 : 0,
    bytes: alive ? 180_000 : 0,
    peers: alive ? (item.peers ?? 12) : 0,
    speedDown: alive ? Math.round((item.intake ?? 3) * 125) : 0,
    rateKbps: alive ? Math.round((item.stream ?? 4) * 1000) : null,
    intakeKbps: alive ? Math.round((item.intake ?? 3) * 1000) : null,
    streamKbps: alive ? Math.round((item.stream ?? 4) * 1000) : 0,
    reason: !done
      ? ''
      : final === 'working'
        ? 'playable_media'
        : final === 'weak'
          ? 'starved'
          : item.outcome === 'retry'
            ? 'timeout'
            : 'no_media',
    mediaValid: alive,
    browserCompatible: alive,
    videoCodec: alive ? 'h264' : '',
    audioCodecs: alive ? ['aac'] : [],
    cached: false,
    attempts: done ? 1 : 0,
    ...(done ? { playableOn: { web: alive, ios: alive } } : {}),
  };
}

export function demoScan(id: string, now = Date.now()): ScanJob {
  const job = jobs.get(id);
  const created = new Date(job?.createdAt ?? now).toISOString();
  if (!job) {
    return {
      id,
      kind: 'interactive',
      status: 'cancelled',
      createdAt: created,
      updatedAt: created,
      total: 0,
      checked: 0,
      playable: 0,
      failed: 0,
      waiting: 0,
      retryAt: null,
      initialCount: 0,
      candidates: [],
    };
  }
  const step = Math.floor((now - job.createdAt) / DEMO_STEP_MS);
  const candidates = job.items.map((item, index) => probeOf(item, index, step, now));
  const decided = candidates.filter((c) => c.state === 'working' || c.state === 'weak' || c.state === 'failed');
  const playable = candidates.filter((c) => c.state === 'working' || c.state === 'weak').length;
  const waiting = candidates.filter((c) => c.retryAt).length;
  const all = decided.length === candidates.length;
  const status: ScanJob['status'] = !all ? 'running' : waiting && !playable ? 'waiting' : 'complete';
  const retryAt = candidates.map((c) => c.retryAt).find(Boolean) ?? null;
  return {
    id: job.id,
    kind: job.kind,
    status,
    createdAt: created,
    updatedAt: new Date(now).toISOString(),
    total: candidates.length,
    checked: decided.length,
    playable,
    failed: decided.length - playable,
    waiting,
    retryAt: status === 'waiting' ? retryAt : null,
    initialCount: Math.min(3, candidates.length),
    candidates,
  };
}

export function demoReport(body: {
  id: string;
  reason?: SourceReportReason | undefined;
  channel?: string | undefined;
  matchId?: string | undefined;
}): ReportResponse {
  const now = Date.now();
  const reason = body.reason ?? 'not_starting';
  // El comprobador vuelve a mirar la fuente reportada: si iba bien, sigue viva.
  const previous = [...jobs.values()].flatMap((job) => job.items).find((item) => item.hash === body.id);
  const job: DemoJob = {
    id: newJobId(),
    kind: 'report',
    createdAt: now,
    items: [{ provider: previous?.provider ?? 'Externa', outcome: previous?.outcome ?? 'failed', hash: body.id }],
  };
  jobs.set(job.id, job);
  return {
    report: {
      reportId: `rep_demo_${job.id.slice(-6)}`,
      id: body.id,
      channel: body.channel ?? '',
      matchId: body.matchId ?? '',
      reason,
      state: 'checking',
      checkReason: '',
      reportedAt: new Date(now).toISOString(),
      lastCheckedAt: null,
      quarantineUntil: new Date(now + 30 * 60_000).toISOString(),
    },
    scan: scanRef(job),
  };
}

export function demoBind(body: { channel: string; id: string; title?: string | undefined; ih?: boolean | undefined }): BindResponse {
  const binding = {
    channel: body.channel.slice(0, 120),
    channelKey: normalizeChannelKey(body.channel) || 'canal',
    id: body.id.toLowerCase(),
    title: (body.title || body.channel).slice(0, 120),
    ih: body.ih === true,
    updatedAt: new Date().toISOString(),
  };
  return { binding, channelBindings: [binding] };
}

/** Solo para los tests. */
export function resetDemoJobs(): void {
  jobs.clear();
  jobCounter = 0;
}
