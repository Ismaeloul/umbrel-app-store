/* Página de muestra del sistema de diseño (?vista=sistema). Solo en
   desarrollo o con el flag `sistema` (src/lib/flags.ts). Enseña cada token y
   cada componente de src/ui en sus estados, con los interruptores de tema y
   de transparencia, para revisar el sistema en los dos temas y a cualquier
   ancho. Documentación: docs/diseno/sistema.md. */

import { useState, type ReactNode } from 'react';
import { notify, setStatusBase, showStatus, StatusLineHost, toast } from '../../notices/index.ts';
import {
  Button,
  Card,
  ChannelMark,
  Chip,
  EmptyState,
  Icon,
  ICON_NAMES,
  IconButton,
  Kbd,
  LiveDot,
  LiveRing,
  Menu,
  MenuButton,
  Num,
  Panel,
  ProgressBar,
  Segmented,
  Sheet,
  SignalBadge,
  Skeleton,
  SkeletonRows,
  StatusLineView,
  Switch,
  Tabs,
  tabPanelProps,
  TeamMark,
  TextField,
  ToastView,
  useContextMenu,
  type MenuItem,
  type SignalState,
} from '../../ui/index.ts';
import type { ViewProps } from '../contracts.ts';
import { setTheme, setTransparency, useTheme, type ThemePreference } from '../theme.ts';
import { ViewHeader } from '../ViewHeader.tsx';
import './sistema.css';

const COLOR_TOKENS = [
  ['--bg', 'Fondo'],
  ['--bg-sunk', 'Fondo hundido'],
  ['--surface', 'Superficie'],
  ['--surface-2', 'Superficie elevada'],
  ['--line', 'Línea'],
  ['--line-strong', 'Borde de control'],
  ['--text', 'Texto'],
  ['--text-2', 'Texto secundario'],
  ['--text-3', 'Texto terciario'],
  ['--accent', 'Cielo (relleno)'],
  ['--accent-ink', 'Cielo (texto)'],
  ['--accent-edge', 'Cielo (borde)'],
  ['--ok', 'Verificada'],
  ['--weak', 'Floja'],
  ['--fail', 'Sin señal'],
  ['--glass-solid', 'Cristal opaco'],
] as const;

const SIGNALS: SignalState[] = ['ok', 'weak', 'fail', 'checking', 'pending'];

const MENU_ITEMS: MenuItem[] = [
  {
    id: 'fav',
    label: 'Guardar en favoritos',
    icon: 'star',
    shortcut: 'G',
    onSelect: () => toast('«DAZN 1» guardado en favoritos', { tone: 'ok' }),
  },
  {
    id: 'copiar',
    label: 'Copiar hash',
    icon: 'copy',
    onSelect: () => toast('Hash copiado', { tone: 'ok' }),
  },
  {
    id: 'abrir',
    label: 'Abrir en…',
    icon: 'externo',
    onSelect: () => toast('Abriendo en el reproductor externo…'),
  },
  {
    id: 'nerd',
    label: 'Datos técnicos',
    icon: 'nerd',
    checked: false,
    shortcut: 'S',
    onSelect: () => {},
  },
  {
    id: 'reportar',
    label: 'Reportar la fuente',
    icon: 'flag',
    danger: true,
    separated: true,
    onSelect: () => toast('Fuente reportada', { tone: 'warn' }),
  },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="sis-section" aria-labelledby={`sis-${id}`}>
      <h2 id={`sis-${id}`} className="sis-section__title">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function SistemaPage(_props: ViewProps) {
  const theme = useTheme();
  const [filter, setFilter] = useState<'para-ti' | 'todos'>('para-ti');
  const [tab, setTab] = useState<'favoritos' | 'recientes' | 'listas'>('favoritos');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState(0.8);
  const context = useContextMenu();

  return (
    <div className="sis">
      <ViewHeader
        title="Sistema"
        subtitle="Tokens y componentes de la dirección A «Luz de focos»"
        actions={<MenuButton label="Más opciones" items={MENU_ITEMS} />}
      />

      <Section id="tema" title="Tema y transparencia">
        <Card className="sis-stack">
          <Segmented<ThemePreference>
            label="Tema"
            value={theme.theme}
            onChange={setTheme}
            items={[
              { value: 'sistema', label: 'Sistema', icon: 'pantalla' },
              { value: 'claro', label: 'Claro', icon: 'sol' },
              { value: 'oscuro', label: 'Oscuro', icon: 'luna' },
            ]}
          />
          <Switch
            label="Reducir transparencia"
            description="El cristal pasa a opaco (además de la opción del sistema)."
            checked={theme.transparency === 'reducida'}
            onChange={(on) => setTransparency(on ? 'reducida' : 'normal')}
          />
        </Card>
      </Section>

      <Section id="color" title="Color">
        <div className="sis-swatches">
          {COLOR_TOKENS.map(([token, name]) => (
            <div key={token} className="sis-swatch">
              <span className="sis-swatch__chip" style={{ background: `var(${token})` }} />
              <span className="sis-swatch__name">{name}</span>
              <code className="mono">{token}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section id="tipo" title="Tipografía y cifras">
        <Card className="sis-stack">
          <p className="sis-type sis-type--head">Hoy, miércoles 23</p>
          <p className="sis-type sis-type--score">
            <Num value="2" /> <span className="sis-dash">–</span> <Num value="1" />
          </p>
          <p className="sis-type">
            Cifras con celda fija y cero sin barra: <Num value="21:00" /> · <Num value="0-0" /> ·{' '}
            <Num value="90+4'" />
          </p>
          <p>
            Texto normal a 15 px con peso 450. <strong>Fuerte a 650.</strong>{' '}
            <span className="texto-2">Secundario.</span> <span className="texto-3">Terciario.</span>
          </p>
          <p className="mono">Hash b71e44d0…0c9f2a31 · 1,92 MB/s · 48 pares</p>
        </Card>
      </Section>

      <Section id="botones" title="Botones">
        <div className="sis-row">
          <Button variant="primary" icon="play">
            Ver partido
          </Button>
          <Button variant="quiet">Elegir fuente</Button>
          <Button variant="ghost" icon="refresh">
            Rebuscar
          </Button>
          <Button variant="danger" icon="trash">
            Borrar
          </Button>
          <Button
            variant="quiet"
            pressed={pressed}
            icon="star"
            onClick={() => setPressed(!pressed)}
          >
            {pressed ? 'En favoritos' : 'Favorito'}
          </Button>
          <Button variant="quiet" size="sm" icon="paste">
            Pegar hash
          </Button>
          <Button variant="quiet" busy>
            Guardando…
          </Button>
        </div>
        <div className="sis-row">
          <IconButton icon="refresh" label="Actualizar" />
          <IconButton
            icon="star"
            pressedIcon="star-f"
            label="Favorito"
            shortcut="G"
            pressed={pressed}
            onClick={() => setPressed(!pressed)}
          />
          <IconButton icon="copy" label="Copiar hash" variant="quiet" />
          <IconButton icon="panel" label="Plegar el panel" variant="glass" />
          <IconButton icon="trash" label="Borrar" variant="danger" />
        </div>
      </Section>

      <Section id="chips" title="Chips, pestañas y segmentado">
        <div className="sis-row">
          <Chip tone="mine">Tu equipo</Chip>
          <Chip icon="tv" outline="solid">
            M+ Liga de Campeones
          </Chip>
          <Chip icon="tv" outline="dashed" title="Se buscará al reproducir">
            DAZN 2
          </Chip>
          <Chip pressed={pressed} count={3} onClick={() => setPressed(!pressed)}>
            En directo
          </Chip>
        </div>
        <Segmented
          label="Filtro de la agenda"
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'para-ti', label: 'Para ti', count: 8 },
            { value: 'todos', label: 'Todos', count: 9 },
          ]}
        />
        <Tabs
          label="Biblioteca"
          idPrefix="sis-bib"
          value={tab}
          onChange={setTab}
          block
          items={[
            { value: 'favoritos', label: 'Favoritos', count: 8 },
            { value: 'recientes', label: 'Recientes', count: 12 },
            { value: 'listas', label: 'Listas', count: 0 },
          ]}
        />
        <div {...tabPanelProps('sis-bib', tab)} className="sis-tabpanel texto-2">
          Panel de «{tab}».
        </div>
      </Section>

      <Section id="senal" title="Señal de una fuente">
        <Card className="sis-signals">
          {SIGNALS.map((state) => (
            <div key={state} className="sis-signal">
              <SignalBadge state={state} size="lg" />
              <SignalBadge state={state} layout="stacked" />
              <SignalBadge state={state} size="sm" />
              <SignalBadge state={state} compact />
            </div>
          ))}
          <SignalBadge state="fail" label="Sin señal · reintento 20:51" />
        </Card>
      </Section>

      <Section id="directo" title="Directo, equipos y canales">
        <Card className="sis-row sis-row--center">
          <LiveRing minute={72} />
          <LiveRing minute="45+2" halftime />
          <LiveRing minute={58} size="compact" />
          <LiveRing minute={12} size="card" />
          <span className="sis-live">
            <LiveDot /> 3 en directo
          </span>
        </Card>
        <Card className="sis-row sis-row--center">
          <TeamMark
            name="Atlético de Madrid"
            short="ATM"
            colors={{ primary: 'cb3524', secondary: '272e61' }}
            size={64}
            lit
          />
          <TeamMark
            name="Tottenham"
            short="TOT"
            colors={{ primary: 'f7f8fa', secondary: '132257' }}
            size={64}
            lit
          />
          <TeamMark
            name="Real Sociedad"
            colors={{ primary: '0067b1', secondary: 'f4f4f4' }}
            pattern="rayas"
            size={28}
          />
          <TeamMark
            name="Galatasaray"
            colors={{ primary: 'fdb912', secondary: 'a90432' }}
            pattern="mitades"
            size={28}
            lit
          />
          <TeamMark name="Equipo sin datos" size={28} />
          <ChannelMark name="DAZN 1" />
          <ChannelMark name="M+ Liga de Campeones 2" />
          <ChannelMark name="Eurosport" />
        </Card>
        <Card className="sis-stack">
          <ProgressBar
            value={progress}
            label={`Minuto ${Math.round(progress * 90)} de 90`}
            tone="live"
            marks={[0.5]}
          />
          <ProgressBar value={4 / 6} label="4 de 6 fuentes comprobadas" size="thin" />
          <div className="sis-row">
            <Button
              variant="quiet"
              size="sm"
              onClick={() => setProgress((p) => (p >= 1 ? 0.1 : Math.min(1, p + 0.1)))}
            >
              Avanzar el partido
            </Button>
          </div>
        </Card>
      </Section>

      <Section id="cristal" title="Cristal">
        <div className="sis-glass">
          <Panel material="regular">Regular (sobre contenido)</Panel>
          <Panel material="dense">Denso (sobre listas)</Panel>
          <Panel material="video">Sobre vídeo (siempre oscuro)</Panel>
        </div>
      </Section>

      <Section id="avisos" title="Avisos">
        <div className="sis-row">
          <Button
            variant="quiet"
            onClick={() => toast('«DAZN 1» guardado en favoritos', { tone: 'ok' })}
          >
            Toast
          </Button>
          <Button
            variant="quiet"
            onClick={() =>
              toast('«DAZN 1» eliminado', {
                tone: 'warn',
                ms: 6000,
                action: { label: 'Deshacer', onAction: () => toast('Recuperado', { tone: 'ok' }) },
              })
            }
          >
            Toast con Deshacer
          </Button>
          <Button
            variant="quiet"
            onClick={() => toast('No se pudo guardar el favorito', { tone: 'err' })}
          >
            Toast de error
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setStatusBase({
                text: 'Fuente 1 verificada. Vas en directo.',
                signal: 'ok',
                tone: 'ok',
                meta: '6 s de retraso',
              });
              showStatus({ text: 'Reconectando la fuente 1…', tone: 'warn', icon: 'refresh' });
            }}
          >
            Línea de estado
          </Button>
          <Button
            variant="quiet"
            onClick={() =>
              notify('Fuente floja: rellenando el búfer', { kind: 'signal', tone: 'warn' })
            }
          >
            notify() de señal
          </Button>
        </div>
        <StatusLineHost />
        <StatusLineView
          text="Fuente 1 verificada. Vas en directo."
          signal="ok"
          tone="ok"
          meta="6 s de retraso"
        />
        <StatusLineView
          text="Sin señal en la fuente 3. Probando la 4."
          signal="fail"
          tone="err"
          meta="reintento 20:51"
        />
        <ToastView text="Hash copiado" tone="ok" count={3} />
      </Section>

      <Section id="capas" title="Hojas y menús">
        <div className="sis-row">
          <Button variant="quiet" icon="plus" onClick={() => setSheetOpen(true)}>
            Abrir hoja
          </Button>
          <Button variant="quiet" icon="panel" onClick={() => setSideOpen(true)}>
            Panel lateral
          </Button>
          <div className="sis-context" {...context.bind} tabIndex={0}>
            Clic derecho o pulsación larga aquí
          </div>
          <Menu {...context.menu} label="Acciones de la fuente" items={MENU_ITEMS} />
        </div>
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Reproducir otro hash"
          description="Pega un Content ID o un enlace acestream://"
          footer={
            <>
              <Button variant="quiet" onClick={() => setSheetOpen(false)}>
                Cancelar
              </Button>
              <Button variant="primary" icon="play" onClick={() => setSheetOpen(false)}>
                Reproducir
              </Button>
            </>
          }
        >
          <TextField
            label="Content ID o enlace"
            placeholder="acestream://…"
            hint="40 caracteres hexadecimales."
          />
        </Sheet>
        <Sheet
          open={sideOpen}
          onClose={() => setSideOpen(false)}
          title="Atajos de ejemplo"
          placement="side"
        >
          <p className="texto-2">
            Pulsa <Kbd>?</Kbd> en cualquier sitio para ver los atajos de verdad.
          </p>
        </Sheet>
      </Section>

      <Section id="campos" title="Campos">
        <Card className="sis-stack">
          <TextField
            label="Buscar canal"
            hideLabel
            variant="search"
            icon="buscar"
            kbd="/"
            placeholder="Buscar canal…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <TextField
            label="URL de la lista"
            placeholder="https://…"
            error={query === 'error' ? 'Esa dirección no es válida.' : null}
          />
        </Card>
      </Section>

      <Section id="carga" title="Carga y vacío">
        <Card className="sis-stack">
          <Skeleton width="40%" height={22} radius="m" />
          <Skeleton width="70%" />
        </Card>
        <SkeletonRows rows={2} />
        <Card>
          <EmptyState
            title="Aún no hay listas"
            actions={
              <>
                <Button variant="primary" icon="plus">
                  Añadir una lista
                </Button>
                <Button variant="quiet" icon="paste">
                  Pegar un hash
                </Button>
              </>
            }
          >
            Añade una lista M3U o pega un hash para empezar a ver canales.
          </EmptyState>
        </Card>
      </Section>

      <Section id="iconos" title="Iconos">
        <div className="sis-icons">
          {ICON_NAMES.map((name) => (
            <span key={name} className="sis-icon" title={name}>
              <Icon name={name} />
              <span>{name}</span>
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
