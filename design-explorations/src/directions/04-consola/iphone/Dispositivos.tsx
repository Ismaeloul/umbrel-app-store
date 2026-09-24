/* Consola · iPhone · Dispositivos: emparejar (código grande + QR + cuenta atrás),
   emparejados (revocar con segundo toque) y «Dónde se está reproduciendo». */

import { useState } from 'react';
import { navigate } from '../../../core/router';
import { cancelPairing, createPairingCode, joinSession, revokeDevice, useNow, useSim } from '../../../core/store';
import { hhmm, relativeTime } from '../../../core/format';
import type { Device } from '../../../core/types';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Icon } from '../components/icons';
import { Dot } from '../components/ui';
import { FakeQr } from '../components/qr';
import { simTime } from '../components/lib';
import { EmptyView, NavBar, PillButton, Row, Section, Value, useArmed } from './ui';

function DeviceRow({ d }: { d: Device }) {
  const nowMs = useNow();
  const [armed, tap] = useArmed(5000);
  const seen = d.lastSeenAt ? simTime(new Date(d.lastSeenAt).getTime()) : null;
  const online = seen !== null && nowMs - seen < 5 * 60000;
  return (
    <Row
      leading={<Icon name={d.platform === 'ipados' ? 'tablet' : d.platform === 'macos' ? 'monitor' : 'phone'} size={20} className="co-ink-3" />}
      title={d.name}
      subtitle={
        d.revokedAt ? (
          `Revocado ${relativeTime(simTime(new Date(d.revokedAt).getTime()), nowMs)}`
        ) : (
          <span className="co-row-flex" style={{ gap: 5 }}>
            <Dot tone={online ? 'ok' : 'idle'} size="sm" /> {online ? 'Conectado' : seen ? `Visto ${relativeTime(seen, nowMs)}` : 'Nunca visto'}
          </span>
        )
      }
      trailing={
        !d.revokedAt ? (
          <PillButton kind="danger" className={armed ? 'is-armed' : ''} onClick={() => tap(() => revokeDevice(d.id))}>
            {armed ? '¿Seguro?' : 'Revocar'}
          </PillButton>
        ) : undefined
      }
    />
  );
}

export function Dispositivos({ hasMini }: { hasMini: boolean }) {
  const devices = useSim((s) => s.devices);
  const pairing = useSim((s) => s.pairing);
  const sessions = useSim((s) => s.sessions);
  const nowMs = useNow();
  const [showRevoked, setShowRevoked] = useState(false);
  const active = devices.filter((d) => !d.revokedAt);
  const revoked = devices.filter((d) => d.revokedAt);
  const left = Math.max(0, Math.round((pairing.expiresAt - Date.now()) / 1000));
  return (
    <>
      <NavBar title="Dispositivos" large />
      <div className={`ip-scroll ${hasMini ? 'has-mini' : ''}`}>
        <Section title="Dónde se está reproduciendo" inset footer={sessions.length ? 'Si dos dispositivos ven el mismo canal, la señal se comparte.' : undefined}>
          {sessions.length === 0 && <Row leading={<Icon name="radio" size={18} className="co-ink-3" />} title="Nada en otros dispositivos" subtitle="Aquí verás qué canal suena y dónde" onClick={() => navigate('ajustes', 'donde')} chevron />}
          {sessions.map((s) => (
            <Row
              key={s.id}
              leading={<ChannelMark name={s.title} size={32} radius={8} />}
              title={s.title}
              subtitle={`${s.viewers.map((v) => v.deviceName).join(', ')} · desde las ${hhmm(simTime(new Date(s.openedAt).getTime()))}`}
              trailing={
                <PillButton kind="tint" icon="play" onClick={() => joinSession(s.id)}>
                  Ver aquí
                </PillButton>
              }
            />
          ))}
        </Section>

        <Section title="Emparejar" inset footer="El código sirve una vez y caduca a los 5 minutos.">
          {pairing.phase === 'idle' && <Row leading={<Icon name="qr" size={20} className="co-ink-3" />} title="Emparejar otro dispositivo" subtitle="Crea un código para otro iPhone o iPad" onClick={createPairingCode} chevron />}
          {pairing.phase === 'creating' && <Row leading={<span className="co-spinner" />} title="Creando el código…" />}
          {(pairing.phase === 'code' || pairing.phase === 'expired') && (
            <div style={{ padding: '12px 12px 12px', display: 'grid', gap: 10, justifyItems: 'center' }}>
              <div className="ip-qr" style={{ opacity: pairing.phase === 'expired' ? 0.35 : 1 }}>
                <FakeQr seed={pairing.code} size={168} light />
              </div>
              <div className="ip-pairing-code" style={{ textDecoration: pairing.phase === 'expired' ? 'line-through' : 'none', color: pairing.phase === 'expired' ? 'var(--co-ink-3)' : 'var(--co-ink)' }}>
                {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
              </div>
              <div className="ip-value" style={{ fontSize: 13 }}>
                {pairing.phase === 'expired' ? (
                  <>
                    <Dot tone="fail" size="sm" /> El código ha caducado
                  </>
                ) : (
                  <span className="ip-mono">
                    Caduca en {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <PillButton onClick={createPairingCode} icon="refresh">
                  Otro código
                </PillButton>
                <PillButton onClick={cancelPairing}>Cancelar</PillButton>
              </div>
            </div>
          )}
          {pairing.phase === 'paired' && <Row leading={<Dot tone="ok" />} title="Dispositivo emparejado" subtitle="Ya aparece en la lista" onClick={cancelPairing} trailing={<span className="ip-link">Listo</span>} />}
        </Section>

        <Section title="Emparejados" count={active.length} inset>
          {active.length === 0 && <Row title="Ningún dispositivo emparejado" subtitle="Crea un código arriba" />}
          {active.map((d) => (
            <DeviceRow key={d.id} d={d} />
          ))}
          {revoked.length > 0 && <Row title={`${showRevoked ? 'Ocultar' : 'Ver'} los revocados`} trailing={<Value>{revoked.length}</Value>} onClick={() => setShowRevoked((v) => !v)} chevron />}
          {showRevoked && revoked.map((d) => <DeviceRow key={d.id} d={d} />)}
        </Section>
        <p className="ip-note">Este iPhone: «iPhone de Isma», emparejado hace 12 días.</p>
      </div>
    </>
  );
}

export function Donde({ hasMini }: { hasMini: boolean }) {
  const sessions = useSim((s) => s.sessions);
  const player = useSim((s) => s.player);
  useNow();
  const here = player.target;
  return (
    <>
      <NavBar title="Dónde se está reproduciendo" backLabel="Dispositivos" />
      <div className={`ip-scroll ${hasMini ? 'has-mini' : ''}`}>
        <Section title="Ahora mismo" inset footer="En tiempo real. Si dos dispositivos ven el mismo canal, la señal se comparte.">
          {here && (
            <Row
              leading={<ChannelMark name={here.title} size={32} radius={8} />}
              title={here.title}
              subtitle={`${player.conn === 'activa' ? (player.media === 'playing' ? 'Reproduciendo' : 'En pausa') : player.conn === 'idle' ? 'Detenido' : 'Conectando'} · desde las ${hhmm(simTime(player.startedAt ?? Date.now()))}`}
              trailing={<span className="co-chip co-chip--accent">Este iPhone</span>}
            />
          )}
          {sessions.map((s) => (
            <Row
              key={s.id}
              leading={<ChannelMark name={s.title} size={32} radius={8} />}
              title={s.title}
              subtitle={s.viewers.map((v) => `${v.deviceName} · ${v.playing ? 'reproduciendo' : v.playing === false ? 'en pausa' : 'conectado'}`).join(' · ')}
              trailing={
                <PillButton kind="tint" icon="play" onClick={() => joinSession(s.id)}>
                  Ver aquí
                </PillButton>
              }
            />
          ))}
          {!here && sessions.length === 0 && <Row title="No se está reproduciendo nada" subtitle="Cuando un dispositivo emparejado vea algo, aparecerá aquí" />}
        </Section>
        {!here && sessions.length === 0 && <EmptyView icon="radio" title="Todo en silencio" action={<PillButton kind="tint" onClick={() => navigate('agenda')}>Abrir Partidos</PillButton>} />}
      </div>
    </>
  );
}
