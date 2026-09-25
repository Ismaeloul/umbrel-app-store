/* Consola · armazón del iPhone: puertas de primer uso (emparejar, gustos),
   TabView de 4 + búsqueda, transiciones push/pop reales, mini (accesorio de la
   tab bar) y grande, hojas (Reportar, Pegar, acciones) y avisos. */

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { navigate, useRoute, type Screen } from '../../../core/router';
import { addDirectory, addManualSource, dismissToast, renameItem, reportSource, setExpanded, useSim } from '../../../core/store';
import { Icon, type IconName } from '../components/icons';
import { Dot } from '../components/ui';
import { PasteBody, ReportBody, AddListBody } from '../components/sheets';
import { detectContentId, useReducedMotionPref } from '../components/lib';
import { ActionSheet, BottomSheet, EdgeBack, PillButton, Sheets } from './ui';
import { PhoneBig, PhoneMini } from './Player';
import { Partido, Partidos } from './Partidos';
import { Canal, Canales } from './Canales';
import { Buscar } from './Buscar';
import { Dispositivos, Donde } from './Dispositivos';
import { Apariencia, Emparejar, Gustos, Listas, Reproduccion, Sistema } from './Sistema';
import { closeSheet, useSheet } from './state';

type TabId = 'partidos' | 'canales' | 'dispositivos' | 'sistema' | 'buscar';

const TABS: { id: TabId; label: string; icon: IconName; go: () => void }[] = [
  { id: 'partidos', label: 'Partidos', icon: 'ball', go: () => navigate('agenda') },
  { id: 'canales', label: 'Canales', icon: 'tv', go: () => navigate('biblioteca') },
  { id: 'dispositivos', label: 'Dispositivos', icon: 'phone', go: () => navigate('ajustes', 'dispositivos') },
  { id: 'sistema', label: 'Sistema', icon: 'activity', go: () => navigate('ajustes', 'salud') },
];

function tabOf(screen: Screen, param: string | null): TabId {
  switch (screen) {
    case 'biblioteca':
    case 'canal':
      return 'canales';
    case 'buscar':
      return 'buscar';
    case 'ajustes':
      return param === 'dispositivos' || param === 'donde' ? 'dispositivos' : 'sistema';
    case 'gustos':
      return 'sistema';
    default:
      return 'partidos';
  }
}

/** Profundidad de una pantalla (0 = raíz de pestaña). */
function depthOf(screen: Screen, param: string | null): number {
  if (screen === 'partido' || screen === 'canal' || screen === 'gustos') return 1;
  if (screen === 'ajustes') return param && !['dispositivos', 'salud'].includes(param) ? 1 : 0;
  return 0;
}

export function PhoneShell() {
  const route = useRoute();
  const paired = useSim((s) => s.paired);
  const onboarding = useSim((s) => !s.preferences.onboardingComplete);
  const firstUse = useSim((s) => s.firstUse);
  const hasTarget = useSim((s) => !!s.player.target);
  const expanded = useSim((s) => s.player.expanded);
  const reduced = useReducedMotionPref();
  const sheet = useSheet();
  const targetId = useSim((s) => s.player.target?.id ?? null);
  const [prev, setPrev] = useState<{ screen: Screen; param: string | null }>({ screen: route.screen, param: route.param });

  useEffect(() => {
    setPrev({ screen: route.screen, param: route.param });
  }, [route.seq]);

  const variants = useMemo(
    () => ({
      enter: (k: string) => (reduced ? { opacity: 0 } : k === 'push' ? { x: '100%', opacity: 1 } : k === 'pop' ? { x: '-28%', opacity: 0.6 } : { opacity: 0 }),
      center: { x: 0, opacity: 1 },
      exit: (k: string) => (reduced ? { opacity: 0 } : k === 'push' ? { x: '-28%', opacity: 0.6 } : k === 'pop' ? { x: '100%', opacity: 1 } : { opacity: 0 }),
    }),
    [reduced],
  );

  // Puertas de primer uso
  if (!paired) return <div className="co-root ip-root"><Emparejar /><PhoneToasts /></div>;
  if (firstUse && onboarding && route.screen !== 'gustos') {
    return (
      <div className="co-root ip-root">
        <div className="ip-screen">
          <Gustos onboarding />
        </div>
        <PhoneToasts />
      </div>
    );
  }

  const tab = tabOf(route.screen, route.param);
  const depth = depthOf(route.screen, route.param);
  const prevDepth = depthOf(prev.screen, prev.param);
  const kind: 'push' | 'pop' | 'fade' = depth > prevDepth ? 'push' : depth < prevDepth ? 'pop' : route.direction === 'back' && depth > 0 ? 'pop' : depth > 0 && prevDepth > 0 ? (route.direction === 'back' ? 'pop' : 'push') : 'fade';
  const mini = hasTarget && !((route.screen === 'partido' || route.screen === 'canal') && route.param === targetId);

  let screen: React.ReactNode;
  switch (route.screen) {
    case 'partido':
      screen = <Partido id={route.param ?? ''} hasMini={mini} />;
      break;
    case 'canal':
      screen = <Canal id={route.param ?? ''} hasMini={mini} />;
      break;
    case 'biblioteca':
      screen = <Canales hasMini={mini} initialTab={route.param ?? undefined} />;
      break;
    case 'buscar':
      screen = <Buscar hasMini={mini} />;
      break;
    case 'gustos':
      screen = <Gustos onboarding={onboarding && firstUse} />;
      break;
    case 'ajustes':
      switch (route.param) {
        case 'dispositivos':
          screen = <Dispositivos hasMini={mini} />;
          break;
        case 'donde':
          screen = <Donde hasMini={mini} />;
          break;
        case 'listas':
          screen = <Listas hasMini={mini} />;
          break;
        case 'apariencia':
          screen = <Apariencia hasMini={mini} />;
          break;
        case 'reproduccion':
          screen = <Reproduccion hasMini={mini} />;
          break;
        default:
          screen = <Sistema hasMini={mini} />;
      }
      break;
    default:
      screen = <Partidos hasMini={mini} />;
  }

  return (
    <div className="co-root ip-root" data-tab={tab} data-mini={mini && !expanded ? 'true' : 'false'} data-expanded={expanded ? 'true' : 'false'}>
      <div className="ip-screens">
        <AnimatePresence initial={false} custom={kind} mode="sync">
          <motion.div
            key={`${route.screen}/${route.param ?? ''}`}
            className="ip-screen"
            custom={kind}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={reduced ? { duration: 0.06 } : { type: 'spring', stiffness: 420, damping: 42, mass: 0.9 }}
            style={{ zIndex: kind === 'pop' ? 0 : 1 }}
          >
            {screen}
          </motion.div>
        </AnimatePresence>
      </div>
      <EdgeBack enabled={depth > 0 && !expanded} />

      {!expanded && <div className="ip-tabbar-scrim" aria-hidden="true" />}
      {!expanded && (
        <div className="ip-tabbar-wrap">
          <nav className="ip-tabbar" aria-label="Pestañas">
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`ip-tab ${tab === t.id ? 'is-on' : ''}`} onClick={t.go} aria-current={tab === t.id ? 'page' : undefined}>
                <Icon name={t.icon} size={22} strokeWidth={tab === t.id ? 2 : 1.6} />
                <span>{t.label}</span>
                {t.id === 'partidos' && <LiveBadge />}
                {t.id === 'sistema' && <EngineBadge />}
              </button>
            ))}
          </nav>
          <button type="button" className={`ip-tab-search ${tab === 'buscar' ? 'is-on' : ''}`} onClick={() => navigate('buscar')} aria-label="Buscar" aria-current={tab === 'buscar' ? 'page' : undefined}>
            <Icon name="search" size={22} strokeWidth={2} />
          </button>
        </div>
      )}
      <PhoneMini />
      <AnimatePresence>{expanded && <PhoneBig key="big" />}</AnimatePresence>
      <Sheets>
        {sheet?.type === 'actions' && <ActionSheet key="actions" title={sheet.title} items={sheet.items} onClose={closeSheet} />}
        {sheet?.type === 'report' && <ReportPhone key="report" kind={sheet.kind} id={sheet.id} sourceId={sheet.sourceId} />}
        {sheet?.type === 'paste' && <PastePhone key="paste" kind={sheet.kind} id={sheet.id} />}
        {sheet?.type === 'rename' && <RenamePhone key="rename" id={sheet.id} title={sheet.title} />}
        {sheet?.type === 'addList' && <AddListPhone key="addlist" />}
      </Sheets>
      <PhoneToasts />
    </div>
  );
}

function LiveBadge() {
  const n = useSim((s) => s.agenda.filter((m) => m.start <= Date.now() + s.clockOffset && m.start + 110 * 60000 > Date.now() + s.clockOffset).length);
  if (!n) return null;
  return <Dot tone="live" size="sm" className="ip-tab-badge" />;
}

function EngineBadge() {
  const st = useSim((s) => s.engine.status);
  if (st === 'online') return null;
  return <Dot tone={st === 'restarting' ? 'checking' : 'fail'} size="sm" className="ip-tab-badge" />;
}

function PhoneToasts() {
  const toasts = useSim((s) => s.toasts);
  return (
    <div className="ip-toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} className="ip-toast" role="status" data-testid={t.action ? 'aviso-accion' : undefined} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.16 }}>
            <Dot tone={t.tone === 'ok' ? 'ok' : t.tone === 'warn' ? 'weak' : t.tone === 'err' ? 'fail' : 'accent'} />
            <span className="co-grow" style={{ lineHeight: 1.3 }}>
              {t.text}
              {t.count > 1 && <span style={{ color: 'var(--co-ink-3)' }}> ×{t.count}</span>}
            </span>
            {t.action && (
              <button
                type="button"
                className="ip-toast-action"
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------- Hojas

function ReportPhone({ kind, id, sourceId }: { kind: 'match' | 'channel'; id: string; sourceId: string }) {
  const session = useSim((s) => s.sourceSessions[`${kind}:${id}`]);
  const [reason, setReason] = useState('no_start');
  const src = session?.sources.find((x) => x.id === sourceId);
  if (!src || !session) return null;
  return (
    <BottomSheet
      title="Reportar fuente"
      onClose={closeSheet}
      detent="auto"
      footer={
        <PillButton
          kind="primary"
          size="lg"
          onClick={() => {
            reportSource(kind, id, sourceId, reason);
            closeSheet();
          }}
        >
          Reportar y comprobar
        </PillButton>
      }
    >
      <div className="ip-report">
        <ReportBody source={src} index={session.sources.indexOf(src) + 1} reason={reason} setReason={setReason} />
      </div>
    </BottomSheet>
  );
}

function PastePhone({ kind, id }: { kind: 'match' | 'channel'; id: string }) {
  const [value, setValue] = useState('');
  const hash = detectContentId(value);
  return (
    <BottomSheet
      title="Pegar Content ID"
      onClose={closeSheet}
      detent="auto"
      footer={
        <PillButton
          kind="primary"
          size="lg"
          icon="play"
          disabled={!hash}
          onClick={() => {
            if (!hash) return;
            addManualSource(kind, id, hash);
            closeSheet();
            setExpanded(true);
          }}
        >
          Reproducir
        </PillButton>
      }
    >
      <PasteBody value={value} setValue={setValue} autoFocus />
    </BottomSheet>
  );
}

function RenamePhone({ id, title }: { id: string; title: string }) {
  const [v, setV] = useState(title);
  return (
    <BottomSheet
      title="Renombrar canal"
      onClose={closeSheet}
      detent="auto"
      footer={
        <PillButton
          kind="primary"
          size="lg"
          disabled={!v.trim()}
          onClick={() => {
            renameItem(id, v.trim());
            closeSheet();
          }}
        >
          Guardar
        </PillButton>
      }
    >
      <label className="ip-field">
        <input value={v} onChange={(e) => setV(e.target.value)} autoFocus aria-label="Nombre del canal" />
      </label>
    </BottomSheet>
  );
}

function AddListPhone() {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<'m3u' | 'html'>('m3u');
  const ok = name.trim().length > 1 && /^https?:\/\/.+\..+/.test(url.trim());
  return (
    <BottomSheet
      title="Añadir una lista"
      onClose={closeSheet}
      detent="auto"
      footer={
        <PillButton
          kind="primary"
          size="lg"
          disabled={!ok}
          onClick={() => {
            addDirectory(name.trim(), url.trim(), type);
            closeSheet();
          }}
        >
          Guardar lista
        </PillButton>
      }
    >
      <AddListBody name={name} setName={setName} url={url} setUrl={setUrl} type={type} setType={setType} />
    </BottomSheet>
  );
}
