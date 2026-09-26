/* «¿Cambiar en los dos o solo aquí?» (docs/multidispositivo.md §2.4.2): la
   hoja de la puerta de la casa. Desde abajo en el móvil y centrada desde
   768 px; Escape, el velo o arrastrarla = «Cancelar»; Intro = el botón
   principal. La monta el armazón y pinta `houseQuestionStore` (gate.ts). */

import { useRef, type KeyboardEvent } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { answerHouse, useHouseQuestion } from './gate.ts';
import './multi.css';

export function HouseQuestion() {
  const open = useHouseQuestion();
  const primary = useRef<HTMLButtonElement>(null);
  const texts = open?.texts;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    /* Intro sobre otro botón lo pulsa él; fuera de los botones, el principal. */
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    answerHouse(texts?.secondary === null ? 'here' : 'both');
  };
  return (
    <Sheet
      open={open !== null}
      onClose={() => answerHouse('cancel')}
      title={texts?.title ?? ''}
      size="sm"
      initialFocus={primary}
      className="house-question"
      description={
        texts ? (
          <div className="house-question__body" onKeyDown={onKeyDown}>
            <p className="house-question__sentence">{texts.sentence}</p>
            <p className="house-question__note">{texts.note}</p>
          </div>
        ) : null
      }
      footer={
        texts ? (
          <div className="house-question__actions">
            <Button
              ref={primary}
              variant="primary"
              block
              onClick={() => answerHouse(texts.secondary === null ? 'here' : 'both')}
            >
              {texts.primary}
            </Button>
            {texts.secondary ? (
              <Button variant="quiet" block onClick={() => answerHouse('here')}>
                {texts.secondary}
              </Button>
            ) : null}
            <Button variant="ghost" block onClick={() => answerHouse('cancel')}>
              {texts.cancel}
            </Button>
          </div>
        ) : null
      }
    />
  );
}
