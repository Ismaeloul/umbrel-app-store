/* Onda de directo: tres barras que suben y bajan (solo `transform`).
   Con movimiento reducido quedan fijas. Con gol, la amplitud se dobla 3 s. */

export function Wave({ size = 14, className, strong = false }: { size?: number; className?: string; strong?: boolean }) {
  return (
    <span className={`tr-wave${strong ? ' is-strong' : ''}${className ? ` ${className}` : ''}`} style={{ height: size }} aria-label="En directo" role="img">
      <i />
      <i />
      <i />
    </span>
  );
}
