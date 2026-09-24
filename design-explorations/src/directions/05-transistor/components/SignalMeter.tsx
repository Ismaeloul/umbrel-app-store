/* Medidor de estática: cinco bloques ▮▮▮▯▯ y una palabra. Cuando busca, los
   bloques se van rellenando (solo opacidad); pendiente = bloques huecos. */

import type { SignalSummary } from './text';

export function SignalMeter({ signal, size = 'md', word = true, className }: { signal: SignalSummary; size?: 'sm' | 'md' | 'lg'; word?: boolean; className?: string }) {
  const blocks = [0, 1, 2, 3, 4];
  if (signal.mode === 'none' && !signal.word) return null;
  return (
    <span className={`tr-meter tr-meter--${size} is-${signal.mode} tr-tone-${signal.tone}${className ? ` ${className}` : ''}`} role="img" aria-label={`${signal.word}${signal.detail ? `: ${signal.detail}` : ''}`}>
      {signal.mode !== 'none' && (
        <span className="tr-meter-blocks" aria-hidden="true">
          {blocks.map((i) => (
            <i key={i} className={i < signal.level ? 'is-on' : ''} style={signal.mode === 'searching' ? { animationDelay: `${i * 0.18}s` } : undefined} />
          ))}
        </span>
      )}
      {word && <span className="tr-meter-word">{signal.word}</span>}
    </span>
  );
}
