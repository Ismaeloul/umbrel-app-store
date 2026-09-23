/* Panel de ayuda de atajos (tecla «?»): lista TODO lo registrado en
   shortcuts.ts en este momento, agrupado. Como cada vista registra los suyos
   mientras está visible, la ayuda enseña lo que sirve aquí y ahora.

   Si existe src/features/help/panel.tsx (el agente de ayuda: teclado + gestos
   y ratón), la hoja pinta ese contenido, cargado aparte al abrirla (no pesa en
   el JS inicial); mientras llega, o si no se pudiera descargar, sale la lista
   de atajos de aquí. Mismo patrón que las vistas (import.meta.glob). */

import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Kbd } from '../ui/Field.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useShortcutGroups } from './shortcuts.ts';
import './shortcut-help.css';

const PANELS = import.meta.glob<{ default: ComponentType }>('../features/help/panel.tsx');
const panelLoader = PANELS['../features/help/panel.tsx'];
const HelpPanel = panelLoader ? lazy(panelLoader) : null;

/** Si el panel ampliado falla (trozo que no se descarga), la lista de siempre. */
class PanelBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ShortcutList() {
  const groups = useShortcutGroups();
  return (
    <div className="help">
      {groups.length === 0 ? <p className="texto-2">Aquí no hay atajos.</p> : null}
      {groups.map((group) => (
        <section
          key={group.group}
          className="help__group"
          aria-labelledby={`atajos-${group.group}`}
        >
          <h3 id={`atajos-${group.group}`} className="help__title">
            {group.group}
          </h3>
          <dl className="help__list">
            {group.items.map((item) => (
              <div key={item.id} className="help__row">
                <dt className="help__keys">
                  {item.display.map((key, index) => (
                    <span key={key}>
                      {index > 0 ? <span className="help__or"> o </span> : null}
                      <Kbd>{key}</Kbd>
                    </span>
                  ))}
                </dt>
                <dd className="help__label">{item.label}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="help__note">
        Los atajos no funcionan mientras escribes en un campo (salvo Esc).
      </p>
    </div>
  );
}

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Atajos de teclado" size="md">
      {/* Todo es texto: sin nada enfocable dentro, la hoja no se podría bajar
          con el teclado (WCAG 2.1.1; axe «scrollable-region-focusable»). Con
          el foco aquí, las flechas y Av Pág desplazan la hoja. */}
      <div className="help-scroll" tabIndex={0} role="group" aria-label="Atajos y gestos">
        {HelpPanel ? (
          <PanelBoundary fallback={<ShortcutList />}>
            <Suspense fallback={<ShortcutList />}>
              <HelpPanel />
            </Suspense>
          </PanelBoundary>
        ) : (
          <ShortcutList />
        )}
      </div>
    </Sheet>
  );
}
