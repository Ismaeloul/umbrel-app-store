/* Buscar en el móvil (por debajo de 768; maqueta buscar-ajustes.html): los
   trozos que solo pinta el móvil. La vista (SearchView.tsx) decide cuándo.

   - SearchStart, «Buscar · vacío»: Recientes (las búsquedas con las que se
     abrió algo, en este navegador; la ✕ quita una), Atajos (En directo
     ahora, Mis equipos, Mi lista, Mis avisos) y «Pegar un enlace».
   - MatchGroup y TitleGroup, «Buscar · resultados»: los partidos de la
     agenda (el directo primero, con su play) y Pelis y series, en tarjetas
     con su rótulo en mayúsculas y «Ver los N» si con «Todo» no caben.

   Son enlaces y botones de verdad (Tab, Intro): la paleta de escritorio usa
   las flechas, el móvil no. */

import '../cine/cine.css';

import type { FootballMatch, LiveScore, VodCard } from '@ace/shared';
import { useId, type MouseEvent, type ReactNode } from 'react';
import { searchFor } from '../../app/routes.ts';
import { Icon } from '../../ui/Icon.tsx';
import { Art } from '../cine/Art.tsx';
import { seeAllText, type QuickGroup, type QuickMatch } from './quick-model.ts';
import { Marked, MatchSummary, SHORTCUTS, type ShortcutKey } from './quick-rows.tsx';

/** Clic normal: navegación de la app; con Ctrl, Cmd o rueda, el navegador. */
function plainClick(event: MouseEvent): boolean {
  return !(event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

// ---- Sin texto ----------------------------------------------------------------------

export function SearchStart({
  recents,
  onRecent,
  onRemoveRecent,
  onShortcut,
  onPaste,
}: {
  recents: readonly string[];
  onRecent(text: string): void;
  onRemoveRecent(text: string): void;
  onShortcut(key: ShortcutKey): void;
  onPaste(): void;
}) {
  return (
    <div className="search-start">
      {recents.length > 0 ? (
        <Block title="Recientes">
          <ul className="search-lines">
            {recents.map((recent) => (
              <li key={recent} className="search-line">
                <button
                  type="button"
                  className="search-line__main"
                  onClick={() => onRecent(recent)}
                >
                  <Icon name="clock" size={18} className="search-line__lead" />
                  <span className="search-line__text">{recent}</span>
                </button>
                <button
                  type="button"
                  className="search-line__x"
                  aria-label={`Quitar «${recent}» de recientes`}
                  onClick={() => onRemoveRecent(recent)}
                >
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      <Block title="Atajos">
        <div className="search-quick">
          {SHORTCUTS.map((shortcut) => (
            <button
              key={shortcut.key}
              type="button"
              className="search-quick__item"
              onClick={() => onShortcut(shortcut.key)}
            >
              <Icon name={shortcut.icon} size={20} className="search-quick__icon" />
              {shortcut.label}
            </button>
          ))}
        </div>
      </Block>
      <Block title="Pegar un enlace">
        <ul className="search-lines">
          <li className="search-line">
            <button type="button" className="search-line__main" onClick={onPaste}>
              <Icon name="link" size={18} className="search-line__lead" />
              <span className="search-line__text">acestream:// o Content ID</span>
              <Icon name="paste" size={18} className="search-line__trail" />
            </button>
          </li>
        </ul>
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="search-block" aria-labelledby={id}>
      <h2 id={id} className="search-block__title">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ---- Resultados -----------------------------------------------------------------------

/** El rótulo de un grupo y, si con «Todo» no se ven todas, «Ver los N» (elige su chip). */
function GroupHead({
  id,
  title,
  group,
  total,
  shown,
  onSeeAll,
}: {
  id: string;
  title: string;
  group: QuickGroup;
  total: number;
  shown: number;
  onSeeAll(group: QuickGroup): void;
}) {
  return (
    <div className="search-sec__head">
      <h2 id={id} className="search-sec__title">
        {title}
      </h2>
      {total > shown ? (
        <button type="button" className="search-sec__more" onClick={() => onSeeAll(group)}>
          {seeAllText(group, total)}
        </button>
      ) : null}
    </div>
  );
}

export function MatchGroup({
  items,
  total,
  query,
  today,
  scores,
  onOpen,
  onSeeAll,
}: {
  items: readonly QuickMatch[];
  total: number;
  query: string;
  today: string;
  scores: Readonly<Record<string, LiveScore>>;
  onOpen(match: FootballMatch): void;
  onSeeAll(group: QuickGroup): void;
}) {
  const id = useId();
  return (
    <section className="search-sec search-sec--wide" aria-labelledby={id}>
      <GroupHead
        id={id}
        title="Partidos"
        group="partidos"
        total={total}
        shown={items.length}
        onSeeAll={onSeeAll}
      />
      <ul className="search-card">
        {items.map((item) => (
          <li key={item.match.id}>
            <a
              className="search-res"
              href={searchFor({ vista: 'partido', id: item.match.id, canal: null })}
              onClick={(event) => {
                if (!plainClick(event)) return;
                event.preventDefault();
                onOpen(item.match);
              }}
            >
              <MatchSummary
                item={item}
                query={query}
                today={today}
                score={scores[item.match.id] ?? null}
              />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TitleGroup({
  items,
  total,
  query,
  onOpen,
  onSeeAll,
}: {
  items: readonly VodCard[];
  total: number;
  query: string;
  onOpen(card: VodCard): void;
  onSeeAll(group: QuickGroup): void;
}) {
  const id = useId();
  return (
    <section className="search-sec search-sec--wide" aria-labelledby={id}>
      <GroupHead
        id={id}
        title="Pelis y series"
        group="titulos"
        total={total}
        shown={items.length}
        onSeeAll={onSeeAll}
      />
      <ul className="search-card">
        {items.map((card) => (
          <li key={card.id}>
            <a
              className="search-res"
              href={searchFor({ vista: 'cine', id: card.id })}
              onClick={(event) => {
                if (!plainClick(event)) return;
                event.preventDefault();
                onOpen(card);
              }}
            >
              <span className="qs-poster" aria-hidden="true">
                <Art id={card.id} art="poster" v={card.poster} title={card.title} />
              </span>
              <span className="qs-opt__text">
                <b>
                  <Marked text={card.title} query={query} />
                </b>
                <small>
                  {[card.kind === 'movie' ? 'Película' : 'Serie', card.year]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
