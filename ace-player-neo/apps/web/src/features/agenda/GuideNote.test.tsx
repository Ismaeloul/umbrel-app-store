/* «Confirmado en tu guía: …» (agenda híbrida, docs/iptv.md §4.7). */

import type { FootballGuideInfo, FootballMatch } from '@ace/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WhereAired } from '../match-center/WhereAired.tsx';
import { madridClock } from './domain.ts';
import { GuideNote, guideNoteSentence, guideNoteText } from './GuideNote.tsx';
import { MatchRowView } from './MatchRow.tsx';
import { matchAt, NOW } from './test-utils.tsx';

const confirmed: FootballGuideInfo = { channel: 'M+ LaLiga TV 2', time: '21:00', added: false };

describe('GuideNote', () => {
  it('textos: confirmado, hora movida y partido añadido', () => {
    expect(guideNoteText(confirmed)).toEqual({
      lead: 'Confirmado en tu guía',
      channel: 'M+ LaLiga TV 2',
      time: '21:00',
      extra: null,
    });
    expect(guideNoteSentence(confirmed)).toBe('Confirmado en tu guía: M+ LaLiga TV 2 · 21:00');
    expect(guideNoteText({ ...confirmed, time: '21:15', agendaTime: '18:30' }).extra).toBe(
      'Tu guía lo pone a las 21:15; la agenda decía 18:30.',
    );
    expect(guideNoteText({ ...confirmed, added: true }).extra).toBe(
      'No salía en la agenda: lo añade tu guía.',
    );
    expect(guideNoteSentence({ ...confirmed, time: 'Por confirmar' })).toBe(
      'Confirmado en tu guía: M+ LaLiga TV 2',
    );
  });

  it('en la tarjeta: una línea con el canal y la hora; lo demás en el title', () => {
    render(<GuideNote guide={{ ...confirmed, time: '21:15', agendaTime: '18:30' }} />);
    const note = screen.getByText(/Confirmado en tu guía/).closest('p');
    expect(note).toHaveTextContent('Confirmado en tu guía: M+ LaLiga TV 2 · , a las 21:15');
    expect(note).toHaveAttribute(
      'title',
      'Confirmado en tu guía: M+ LaLiga TV 2 · 21:15. Tu guía lo pone a las 21:15; la agenda decía 18:30.',
    );
    expect(screen.queryByText(/la agenda decía/)).toBeNull();
  });

  it('en el partido: con la nota debajo', () => {
    render(<GuideNote guide={{ ...confirmed, added: true }} variant="detail" />);
    expect(screen.getByText('No salía en la agenda: lo añade tu guía.')).toBeInTheDocument();
  });

  it('sin guía (sin IPTV, en pausa o sin datos del partido): nada', () => {
    const { container } = render(<GuideNote guide={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('dónde sale', () => {
  const base = matchAt(30, { home: 'Real Madrid', away: 'Bayern', title: 'Real Madrid - Bayern' });
  const row = (match: FootballMatch, compact = false) =>
    render(
      <MatchRowView
        match={match}
        now={NOW}
        score={null}
        signal={null}
        channels={[{ name: 'M+ Liga de Campeones', inLibrary: true }]}
        mine={false}
        scoreHidden
        compact={compact}
        onReveal={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

  it('la tarjeta de la agenda la lleva debajo de los canales; la pequeña y sin guía, no', () => {
    const guided = {
      ...base,
      guide: { channel: 'M+ Liga de Campeones', time: '21:00', added: false },
    };
    const { unmount } = row(guided);
    expect(screen.getByText(/Confirmado en tu guía/)).toBeInTheDocument();
    unmount();
    const small = row(guided, true);
    expect(screen.queryByText(/Confirmado en tu guía/)).toBeNull();
    small.unmount();
    row(base);
    expect(screen.queryByText(/Confirmado en tu guía/)).toBeNull();
  });

  it('«Dónde se emite» del partido la lleva con su nota', () => {
    const guided = {
      ...base,
      guide: { channel: 'M+ Liga de Campeones', time: '21:00', agendaTime: '20:45', added: false },
    };
    render(
      <WhereAired
        match={guided}
        channels={[{ name: 'M+ Liga de Campeones', inLibrary: true }]}
        today={madridClock(NOW).date}
      />,
    );
    expect(screen.getByText(/Confirmado en tu guía/)).toBeInTheDocument();
    expect(
      screen.getByText('Tu guía lo pone a las 21:00; la agenda decía 20:45.'),
    ).toBeInTheDocument();
  });
});
