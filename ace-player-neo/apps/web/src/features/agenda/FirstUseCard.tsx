/* Tarjeta de primer uso (inventario §3.2): sustituye al modal bloqueante de
   la 0.6.59. Se ve mientras las preferencias no digan onboardingComplete; la
   agenda sigue entera debajo (regla 35: nada bloquea la entrada). */

import { useId } from 'react';
import { Button, Card, Icon } from '../../ui/index.ts';

export function FirstUseCard({
  onCustomize,
  onSkip,
  busy = false,
}: {
  onCustomize(): void;
  onSkip(): void;
  busy?: boolean;
}) {
  const titleId = useId();
  return (
    <Card as="section" className="agenda-first" radius="l" padding={4} aria-labelledby={titleId}>
      <span className="agenda-first__mark" aria-hidden="true">
        <Icon name="star" size={20} />
      </span>
      <div className="agenda-first__text">
        <h2 id={titleId} className="agenda-first__title">
          Personaliza tu agenda
        </h2>
        <p>
          Dinos tus ligas y equipos y la agenda pondrá primero lo tuyo. Mientras tanto ves todos los
          partidos.
        </p>
      </div>
      <div className="agenda-first__actions">
        <Button variant="ghost" size="sm" onClick={onSkip} disabled={busy}>
          Ahora no
        </Button>
        <Button variant="primary" size="sm" onClick={onCustomize}>
          Personalizar
        </Button>
      </div>
    </Card>
  );
}
