/* Gustos (web): «¿Qué fútbol te mueve?». */

import { back } from '../../../core/router';
import { useSim } from '../../../core/store';
import { PrefsEditor } from '../components/Settings';

export function WebPrefs() {
  const firstUse = useSim((s) => !s.preferences.onboardingComplete);
  return (
    <div className="tr-prefspage">
      <header className="tr-prefspage-head">
        <span className="tr-prefspage-k">Tu fútbol</span>
        <h1>¿Qué fútbol te mueve?</h1>
        <p>Lo que elijas aquí es lo que «Para ti» pone en el dial y marca en la parrilla. Se puede cambiar cuando quieras.</p>
      </header>
      <PrefsEditor mode="web" firstUse={firstUse} onDone={() => back('agenda')} />
    </div>
  );
}
