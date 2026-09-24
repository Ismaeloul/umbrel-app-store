/* Gustos (iPhone): «¿Qué fútbol te mueve?». En primer uso no se puede
   cancelar: se guarda y se va a la sintonía. */

import { back, navigate } from '../../../core/router';
import { useSim } from '../../../core/store';
import { PrefsEditor } from '../components/Settings';
import { NavBar } from './NavBar';

export function PhoneGustos() {
  const firstUse = useSim((s) => !s.preferences.onboardingComplete);
  return (
    <div className="tr-ph-gustos">
      {firstUse ? (
        <header className="tr-ph-head">
          <div>
            <div className="tr-ph-head-sub">Primer uso · 2 de 2</div>
            <h1>¿Qué fútbol te mueve?</h1>
          </div>
        </header>
      ) : (
        <NavBar title="Tu fútbol" backLabel="Ajustes" fallback="ajustes" />
      )}
      <div className="tr-ph-body">
        {!firstUse && <h2 className="tr-ph-h2">¿Qué fútbol te mueve?</h2>}
        <p className="tr-ph-lead">Lo que elijas es lo que «Para ti» pone primero en el dial. Se cambia cuando quieras.</p>
        <PrefsEditor mode="phone" firstUse={firstUse} onDone={() => (firstUse ? navigate('agenda', null, null, { replace: true }) : back('ajustes'))} />
      </div>
    </div>
  );
}
