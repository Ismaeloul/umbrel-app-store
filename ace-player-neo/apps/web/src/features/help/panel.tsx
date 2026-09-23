/* Contenido del panel de ayuda (tecla «?», o «Atajos de teclado» en Ajustes →
   Acerca de). La hoja la pone el armazón (src/app/ShortcutHelp.tsx), que busca
   este fichero con import.meta.glob y lo carga aparte al abrirla: mientras
   llega, enseña su lista de atajos de siempre.

   - Teclado: TODO lo que hay en el registro central ahora mismo, agrupado
     (cada vista registra los suyos mientras se ve: la ayuda enseña lo que
     sirve aquí y ahora).
   - Gestos y ratón: la 0.6.59 no tenía gestos (inventario §19) y en el móvil
     no hay tecla «?»; sin esta lista, deslizar o mantener pulsado no se
     descubre nunca.
   - El orden depende del puntero: con ratón, teclado primero; con el dedo,
     gestos primero. Se pinta todo siempre (un iPad con teclado usa ambos). */

import { useShortcutGroups, type ShortcutGroup } from '../../app/shortcuts.ts';
import { MEDIA, useMediaQuery } from '../../lib/media.ts';
import { Kbd } from '../../ui/Field.tsx';
import { Icon } from '../../ui/Icon.tsx';
import type { IconName } from '../../ui/icons.ts';
import { MOUSE_GESTURES, TOUCH_GESTURES, type GestureHelp } from './gestures.ts';
import './help.css';

function KeyboardGroups({ groups }: { groups: ShortcutGroup[] }) {
  return (
    <section className="ayuda-part" aria-labelledby="ayuda-teclado">
      <h3 id="ayuda-teclado" className="ayuda-part__title">
        <Icon name="kbd" size={18} />
        Teclado
      </h3>
      {groups.length === 0 ? <p className="texto-2">Aquí no hay atajos.</p> : null}
      {groups.map((group) => (
        <section
          key={group.group}
          className="help__group"
          aria-labelledby={`atajos-${group.group}`}
        >
          <h4 id={`atajos-${group.group}`} className="help__title">
            {group.group}
          </h4>
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
    </section>
  );
}

function Gestures({
  id,
  title,
  icon,
  items,
}: {
  id: string;
  title: string;
  icon: IconName;
  items: readonly GestureHelp[];
}) {
  return (
    <section className="ayuda-part" aria-labelledby={id}>
      <h3 id={id} className="ayuda-part__title">
        <Icon name={icon} size={18} />
        {title}
      </h3>
      <dl className="help__list">
        {items.map((item) => (
          <div key={item.id} className="help__row ayuda-row">
            <dt className="ayuda-gesture">{item.gesture}</dt>
            <dd className="help__label">{item.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function HelpPanel() {
  const groups = useShortcutGroups();
  const fine = useMediaQuery(MEDIA.finePointer);
  const keyboard = <KeyboardGroups key="teclado" groups={groups} />;
  const touch = (
    <Gestures key="gestos" id="ayuda-gestos" title="Gestos" icon="movil" items={TOUCH_GESTURES} />
  );
  const mouse = (
    <Gestures key="raton" id="ayuda-raton" title="Ratón" icon="pantalla" items={MOUSE_GESTURES} />
  );
  return (
    <div className="help ayuda">{fine ? [keyboard, mouse, touch] : [touch, keyboard, mouse]}</div>
  );
}
