/* Página de invitado de «Ver juntos» (docs/ver-juntos.md §9): la que abre
   quien recibe el enlace `https://<dominio>/s/<código>`. La sirve el proxy de
   la sala, que solo deja llegar al servidor las rutas de la sala: aquí no hay
   armazón, ni bootstrap, ni SSE de la casa, ni service worker. Usa los mismos
   Join y Room que la vista de casa, con sus propias salidas: salir vuelve a la
   entrada de la sala. */

import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../features/juntos/juntos.css';
import './guest.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setMode } from '../api/mode.ts';
import { GuestApp } from './App.tsx';

/* Siempre en vivo: sin bootstrap (el proxy no lo deja pasar) la web pasaría al modo demo. */
setMode('live', 'bootstrap');

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <GuestApp pathname={location.pathname} />
    </StrictMode>,
  );
}
