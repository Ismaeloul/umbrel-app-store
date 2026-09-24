/* Primer uso del iPhone: emparejar con código de seis dígitos o QR. */

import { useState } from 'react';
import { navigate } from '../../../core/router';
import { claimPairing, useSim } from '../../../core/store';
import { Button, TextField } from '../components/primitives';
import { Icon, Spinner } from '../components/icons';
import { Ambient, CoverVideo } from '../components/video';
import { haptic } from '../components/haptics';

export function Pairing() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'scan' | 'claim' | null>(null);
  const [err, setErr] = useState(false);
  const onboarding = useSim((s) => s.preferences.onboardingComplete);

  const finish = (c: string) => {
    setBusy('claim');
    setTimeout(() => {
      const r = claimPairing(c);
      setBusy(null);
      if (r === 'ok') {
        haptic('success');
        navigate(onboarding ? 'agenda' : 'gustos', null, null, { replace: true });
      } else {
        haptic('error');
        setErr(true);
      }
    }, 900);
  };
  const scan = () => {
    haptic('light');
    setBusy('scan');
    setTimeout(() => {
      setCode('482913');
      finish('482913');
    }, 1400);
  };
  const digits = code.replace(/\D/g, '').slice(0, 6);

  return (
    <div className="pl-ip__pair">
      <div className="pl-ip__cover" style={{ height: '100%' }} aria-hidden="true">
        <CoverVideo playing kind="studio" home="#AA151B" away="#F1BF00" zoom={1.1} />
        <Ambient home="#ffd60a" away="#ff3b30" strength={0.18} />
        <div className="pl-ip__pairveil" />
      </div>
      <div className="pl-ip__pairbody">
        <div className="pl-ip__brand pl-ip__brand--static">
          <span className="pl-topbar__mark" aria-hidden="true" />
          <span>Ace Player Neo</span>
        </div>
        <h1 className="pl-ip__pairtitle">Empareja este iPhone</h1>
        <p className="pl-ip__pairlead">
          En la web, abre <strong>Ajustes › Dispositivos › Crear código</strong>. Escanea el QR o escribe los seis dígitos.
        </p>
        <Button variant="gold" size="lg" block icon="qr" onClick={scan} disabled={busy !== null}>
          {busy === 'scan' ? 'Leyendo el código…' : 'Escanear el código QR'}
        </Button>
        <div className="pl-ip__pairor">o escribe el código</div>
        <div className="pl-ip__pairfield">
          <TextField mono inputMode="numeric" autoComplete="one-time-code" placeholder="000 000" maxLength={7} value={digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits} onChange={(e) => { setErr(false); setCode(e.target.value); }} aria-label="Código de emparejamiento" />
          <div className="pl-ip__pairboxes" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={`pl-ip__pairbox${digits[i] ? ' is-on' : ''}`}>
                {digits[i] ?? ''}
              </span>
            ))}
          </div>
        </div>
        {err && (
          <p className="pl-ip__pairerr">
            <Icon name="warning" size={14} /> Ese código no vale: tiene que ser de seis cifras y estar en vigor.
          </p>
        )}
        <Button variant="outline" size="lg" block disabled={digits.length !== 6 || busy !== null} onClick={() => finish(digits)}>
          {busy === 'claim' ? <Spinner size={18} /> : 'Emparejar'}
        </Button>
        <p className="pl-ip__pairnote">El código caduca a los cinco minutos y solo sirve una vez.</p>
      </div>
    </div>
  );
}
