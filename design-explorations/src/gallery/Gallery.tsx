import { DIRECTIONS } from '../directions/registry';
import { buildHash } from '../core/router';

export function Gallery() {
  return (
    <main className="gallery">
      <h1>Ace Player Neo · cinco diseños navegables</h1>
      <p className="lead">
        Cada propuesta funciona entera con datos falsos: agenda de una semana, centro de partido con sus fuentes, reproductor grande y mini, biblioteca, buscar y ajustes. Abre la
        versión <strong>Web</strong> en el PC y la versión <strong>iPhone</strong> desde el propio teléfono (se ve a pantalla completa, sin marco). El botón ⚙︎ de abajo a la
        derecha simula goles, cortes de señal, un segundo dispositivo y el primer uso.
      </p>
      <div className="gallery-grid">
        {DIRECTIONS.map((d) => (
          <article className="gcard" key={d.id}>
            <span className="num">
              Propuesta {d.id} · {d.tagline}
            </span>
            <h2>{d.name}</h2>
            <p>{d.concept}</p>
            <div className="swatches" aria-hidden="true">
              {d.swatches.map((c) => (
                <span key={c} style={{ background: c }} />
              ))}
            </div>
            <div className="links">
              <a href={buildHash(d.id, 'web', 'agenda')}>Web escritorio</a>
              <a className="secondary" href={buildHash(d.id, 'iphone', 'agenda')}>
                iPhone
              </a>
            </div>
          </article>
        ))}
      </div>
      <p className="meta">
        Atajos en la web: ← → zapear mientras ves algo · J retrocede 30 s · Espacio pausa · L ir al directo · F pantalla completa · / buscar · ? ayuda. En el iPhone: desliza el
        mini-reproductor hacia arriba para abrirlo y hacia abajo para minimizarlo, desliza desde el borde izquierdo para volver. Documentación en <code>design-explorations/</code>:
        <code>00-inventario.md</code>, <code>01-investigacion.md</code> y un <code>DESIGN.md</code> por propuesta.
      </p>
    </main>
  );
}
