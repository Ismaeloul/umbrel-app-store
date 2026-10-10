/* «Mi lista» de Películas y series (0.9.1). Lo pidió Isma: «Cuando me meta
   en una serie… quiero que salga un botón que diga "Añadir a mi lista" y así
   tengo como una lista de series a las que puedo ir a ver».

   - `ListButton`: en la ficha, junto al play. «Añadir a mi lista» (+) o «En
     mi lista» (✓, interruptor con aria-pressed); al pulsarlo otra vez, se
     quita. Cambia al momento (optimista) y, si el servidor falla, vuelve y
     lo dice.
   - `MyListRow`: la fila de la portada, justo después de «Seguir viendo»,
     con los de ese tipo (películas o series). Vacía, no sale. En las series
     empezadas, por qué capítulo se va.
   - `MyListScreen`: «Ver todo», la rejilla entera (`cinecat=milista`).

   NO filtra por los idiomas elegidos: enseña lo que se añadió, con su
   distintivo de idioma (la tarjeta lo pone si no es de los que se ven). Lo
   que ya no está en la IPTV se queda, apagado y con «Ya no está en tu IPTV»,
   hasta que se quite desde su ficha. La lista vive en el servidor
   (`vodListGet`): vale en el PC y en el iPhone, y otra pestaña se entera
   por `state.changed` (`vod`). */

import type { VodKind, VodListItem } from '@ace/shared';
import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton, PosterRail, EmptyState } from '../../ui/index.ts';
import { closeCineGrid, openCineGrid, rememberCards, useListToggle, useVodList } from './data.ts';
import { MY_LIST_CAT } from './model.ts';
import { PosterGrid } from './Grid.tsx';
import { PosterCard } from './PosterCard.tsx';
import { RowHead } from './Rows.tsx';
import { CINE_TEXT, titlesText, upToText } from './texts.ts';
import type { ListTarget } from './data.ts';

/** La línea de debajo del título en «Mi lista». */
export function listNote(item: Pick<VodListItem, 'available' | 'upTo'>): string | null {
  if (!item.available) return CINE_TEXT.listGone;
  return item.upTo ? upToText(item.upTo) : null;
}

/** Los de un tipo (la portada y la rejilla van por «Películas | Series»). */
export function listOfKind(
  items: readonly VodListItem[] | undefined,
  kind: VodKind,
): VodListItem[] {
  return (items ?? []).filter((item) => item.kind === kind);
}

/** ¿Está en «Mi lista»? (null mientras no se sabe). */
export function useInList(id: string, enabled: boolean): boolean | null {
  const list = useVodList(enabled);
  if (!list.data) return null;
  return list.data.items.some((item) => item.id === id);
}

/** «Añadir a mi lista» / «En mi lista ✓» de la ficha. */
export function ListButton({ target, className }: { target: ListTarget; className?: string }) {
  const inList = useInList(target.id, true);
  const toggle = useListToggle();
  const [busy, setBusy] = useState(false);
  /* Sin saber todavía si está (la lista no ha llegado o falló), se ofrece añadir. */
  const pressed = inList === true;
  return (
    <Button
      variant="quiet"
      icon={pressed ? 'check' : 'plus'}
      pressed={pressed}
      className={className}
      onClick={() => {
        if (busy) return;
        setBusy(true);
        void toggle(target, !pressed).finally(() => setBusy(false));
      }}
    >
      {pressed ? CINE_TEXT.inList : CINE_TEXT.addToList}
    </Button>
  );
}

/** En la ficha de un título que ya no está: «Quitar de mi lista», si estaba en ella. */
export function RemoveGoneButton({ id }: { id: string }) {
  const list = useVodList(true);
  const toggle = useListToggle();
  const item = list.data?.items.find((entry) => entry.id === id);
  if (!item) return null;
  return (
    <Button variant="quiet" icon="trash" onClick={() => void toggle(item, false)}>
      {CINE_TEXT.removeFromList}
    </Button>
  );
}

/** «Mi lista» en la portada (tras «Seguir viendo»). Vacía, no sale. */
export function MyListRow({ kind, active }: { kind: VodKind; active: boolean }) {
  const list = useVodList(active);
  const data = list.data?.items;
  const items = useMemo(() => listOfKind(data, kind), [data, kind]);
  useEffect(() => {
    if (items.length) rememberCards(items);
  }, [items]);
  if (!items.length) return null;
  const id = 'cine-mi-lista';
  return (
    <section className="cine-row cine-row--mylist" aria-labelledby={id}>
      <RowHead
        id={id}
        title={CINE_TEXT.myList}
        count={items.length}
        kind={kind}
        onSeeAll={() => openCineGrid({ cat: MY_LIST_CAT, tag: null, q: '' })}
      />
      <PosterRail label={CINE_TEXT.myList} list className="cine-rail">
        {items.map((item) => (
          <PosterCard key={item.id} card={item} note={listNote(item)} gone={!item.available} />
        ))}
      </PosterRail>
    </section>
  );
}

const TITLE_ID = 'cine-rejilla-titulo';

/** «Ver todo» de «Mi lista»: toda la lista de ese tipo en la rejilla. */
export function MyListScreen({ kind, active }: { kind: VodKind; active: boolean }) {
  const list = useVodList(active);
  const data = list.data?.items;
  const items = useMemo(() => listOfKind(data, kind), [data, kind]);
  useEffect(() => {
    if (items.length) rememberCards(items);
  }, [items]);
  const byId = new Map(items.map((item) => [item.id, item] as const));
  return (
    <section className="cine-browse cine-browse--mylist" aria-labelledby={TITLE_ID}>
      <div className="cine-browse__head">
        <IconButton
          icon="chev-l"
          variant="quiet"
          label={CINE_TEXT.backHome}
          onClick={closeCineGrid}
        />
        <div className="cine-browse__titles">
          <h2 id={TITLE_ID} className="cine-browse__title" tabIndex={-1}>
            {CINE_TEXT.myList}
          </h2>
          {list.data ? (
            <p className="cine-browse__count">{titlesText(items.length, kind)}</p>
          ) : null}
        </div>
      </div>
      {list.data && items.length === 0 ? (
        <EmptyState
          title={kind === 'movie' ? CINE_TEXT.listEmptyMovies : CINE_TEXT.listEmptySeries}
          actions={
            <Button variant="primary" icon="chev-l" onClick={closeCineGrid}>
              {CINE_TEXT.backHome}
            </Button>
          }
        />
      ) : null}
      {list.isError && !list.data ? (
        <div className="cine-row__failed" role="alert">
          <p>{CINE_TEXT.rowFailed}</p>
          <Button variant="quiet" size="sm" icon="refresh" onClick={() => void list.refetch()}>
            {CINE_TEXT.retry}
          </Button>
        </div>
      ) : null}
      {items.length ? (
        <PosterGrid
          cards={items}
          total={items.length}
          label={CINE_TEXT.myList}
          noteOf={(card) => {
            const item = byId.get(card.id);
            return item ? listNote(item) : null;
          }}
          goneOf={(card) => byId.get(card.id)?.available === false}
        />
      ) : null}
    </section>
  );
}
