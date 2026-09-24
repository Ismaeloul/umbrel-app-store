/* Hoja de ayuda de atajos (web). */

import { SHORTCUT_TABLE } from '../../../core/keys';
import { Sheet } from './Sheet';

export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = [...new Set(SHORTCUT_TABLE.map((s) => s.group))];
  return (
    <Sheet open={open} onClose={onClose} title="Atajos de teclado" subtitle="No actúan mientras escribes en un campo" mode="web" wide>
      <div className="tr-shortcuts">
        {groups.map((g) => (
          <section key={g}>
            <h3>{g}</h3>
            <dl>
              {SHORTCUT_TABLE.filter((s) => s.group === g).map((s) => (
                <div key={s.keys}>
                  <dt>
                    <kbd>{s.keys}</kbd>
                  </dt>
                  <dd>{s.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section>
          <h3>Sintonía</h3>
          <dl>
            <div>
              <dt>
                <kbd>← →</kbd>
              </dt>
              <dd>Girar el dial (cuando no suena nada)</dd>
            </div>
            <div>
              <dt>
                <kbd>Intro</kbd>
              </dt>
              <dd>Abrir el partido sintonizado</dd>
            </div>
          </dl>
        </section>
      </div>
    </Sheet>
  );
}
