/* Emparejar (iPhone, primer uso): el código de 6 dígitos se teclea en un
   teclado físico y se ve en el LCD; o se escanea el QR (simulado). */

import { useState } from 'react';
import { navigate } from '../../../core/router';
import { claimPairing, getState, toast } from '../../../core/store';
import { Key } from '../components/Key';
import { Lcd } from '../components/Lcd';
import { IcAntenna, IcQr } from '../components/icons';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'qr', '0', 'del'] as const;

export function PhonePairing() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const display = (code + '------').slice(0, 6);
  const press = (k: (typeof KEYS)[number]) => {
    setError(null);
    if (k === 'del') setCode((c) => c.slice(0, -1));
    else if (k === 'qr') scan();
    else if (code.length < 6) setCode((c) => c + k);
  };
  const scan = () => {
    const fake = String(Math.floor(100000 + Math.random() * 900000));
    setCode(fake);
    toast('Código leído del QR');
  };
  const submit = () => {
    const r = claimPairing(code);
    if (r === 'invalid') {
      setError('El código son 6 cifras.');
      return;
    }
    if (!getState().preferences.onboardingComplete) navigate('gustos', null, null, { replace: true });
    else navigate('agenda', null, null, { replace: true });
  };
  return (
    <div className="tr-pairpage">
      <div className="tr-pairpage-brand">
        <IcAntenna size={22} /> ACE PLAYER NEO
      </div>
      <h1>Empareja este iPhone</h1>
      <p>En la web, abre Ajustes › Dispositivos › Emparejar. Escribe aquí el código de 6 cifras o escanea el QR. Caduca a los 5 minutos y sirve una vez.</p>
      <div className="tr-pairpage-lcd" aria-live="polite">
        <Lcd text={`${display.slice(0, 3)} ${display.slice(3)}`} height={56} label={code ? `Código ${code.split('').join(' ')}` : 'Código vacío'} />
      </div>
      {error && <p className="tr-pairpage-err tr-tone-red">{error}</p>}
      <div className="tr-keypad" role="group" aria-label="Teclado">
        {KEYS.map((k) => (
          <Key key={k} size="lg" variant={k === 'qr' ? 'ghost' : 'paper'} onClick={() => press(k)} aria-label={k === 'del' ? 'Borrar' : k === 'qr' ? 'Escanear el código QR' : k} icon={k === 'qr' ? <IcQr size={20} /> : undefined}>
            {k === 'del' ? '⌫' : k === 'qr' ? 'QR' : k}
          </Key>
        ))}
      </div>
      <div className="tr-pairpage-keys">
        <Key variant="orange" size="lg" block disabled={code.length !== 6} onClick={submit}>
          Emparejar
        </Key>
        <span className="tr-pairpage-hint">Sin código a mano: la web lo enseña grande en Ajustes › Dispositivos.</span>
      </div>
    </div>
  );
}
