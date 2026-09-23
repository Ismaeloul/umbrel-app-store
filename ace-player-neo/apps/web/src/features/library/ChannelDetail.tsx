/* Ficha del canal elegido (panel lateral de escritorio, maqueta A):

   - dorsal, nombre y de dónde sale (favorito, reciente, lista);
   - «Ver canal» como acción principal y, al lado, favorito, copiar enlace,
     renombrar y eliminar (con deshacer), más «Abrir en…» (D7);
   - «Ahora»: el partido que da en este momento, con el minuto en el círculo
     central y el marcador TAPADO si es el que estás viendo (regla 29);
   - «Después»: lo que da hoy más tarde, con su hora;
   - el hash, con su botón de copiar.

   Solo se monta con el panel a la vista; en el móvil y la tableta lo mismo
   está en la tarjeta y en su menú «Más». */

import type { Item, LibraryCollection } from '@ace/shared';
import {
  Button,
  ChannelMark,
  IconButton,
  LiveRing,
  matchProgress,
  MenuButton,
  Num,
  TeamMark,
} from '../../ui/index.ts';
import { copyAcestreamLink, copyHash } from './clipboard.ts';
import { itemsFor } from './model.ts';
import { EMPTY_ON_AIR, isHalftime, liveMinute, useOnAir } from './on-air.ts';
import { revealScore, useScoreHidden } from '../agenda/score-reveal.ts';
import { useOnScreenHash } from './play.ts';
import { useSelection } from './selection.ts';
import { useChannelActions } from './useChannelActions.tsx';
import './library.css';

const COLLECTION_LABEL: Record<LibraryCollection, string> = {
  favorites: 'En tus favoritos',
  history: 'En tus recientes',
  web: 'En tu lista activa',
};

function findSelected(
  library: ReturnType<typeof useChannelActions>['library'],
  collection: LibraryCollection,
  id: string,
): Item | null {
  if (!library) return null;
  const tab =
    collection === 'favorites' ? 'favoritos' : collection === 'history' ? 'recientes' : 'listas';
  return itemsFor(library, tab).find((item) => item.id === id) ?? null;
}

export function ChannelDetail({ active = true }: { active?: boolean }) {
  const selection = useSelection();
  const actions = useChannelActions();
  const onAir = useOnAir(active);
  const onScreen = useOnScreenHash();
  const item = selection ? findSelected(actions.library, selection.collection, selection.id) : null;
  const info = item ? onAir(item) : EMPTY_ON_AIR;
  const live = info.live;
  const watching = item !== null && onScreen === item.id;
  // Tapado si es el partido que ves (regla 29), con el almacén común de la agenda.
  const hidden = useScoreHidden(live?.match.id ?? '', watching);

  if (!selection || !item) {
    return (
      <div className="lib-detail lib-detail--empty">
        <p className="lib-detail__hint">
          Elige un canal de la lista para ver qué da hoy, sus acciones y su hash.
        </p>
        {actions.sheets}
      </div>
    );
  }

  const minute = live ? liveMinute(live.score) : null;
  const isFavorite = actions.favoriteIds.has(item.id);
  const later = live ? info.later : info.next ? [info.next, ...info.later] : info.later;

  return (
    <section className="lib-detail" aria-label={`Ficha de ${item.title}`}>
      <header className="lib-detail__head">
        <ChannelMark name={item.title} size={76} />
        <div className="lib-detail__titles">
          <h2 className="lib-detail__name">{item.title}</h2>
          <p className="lib-detail__from">
            {COLLECTION_LABEL[selection.collection]}
            {item.category ? ` · ${item.category}` : ''}
          </p>
        </div>
      </header>
      <div className="lib-detail__acts">
        <Button
          variant="primary"
          icon="play"
          className="lib-detail__play"
          onClick={() => actions.play(item)}
        >
          Ver canal
        </Button>
        <IconButton
          icon="star"
          pressedIcon="star-f"
          variant="quiet"
          label={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
          pressed={isFavorite}
          onClick={() => actions.toggleFavorite(item)}
        />
        <IconButton
          icon="link"
          variant="quiet"
          label="Copiar enlace acestream://"
          onClick={() => void copyAcestreamLink(item.id)}
        />
        <MenuButton
          variant="quiet"
          label={`Más acciones para ${item.title}`}
          title="Más acciones"
          items={actions.menuFor(item, selection.collection)}
        />
      </div>

      <div className="lib-detail__sec">
        <h3 className="lib-detail__h">Ahora</h3>
        {live ? (
          <div className="lib-now">
            {minute ? (
              <LiveRing
                minute={minute}
                progress={matchProgress(minute)}
                halftime={isHalftime(live.score)}
                size="card"
              />
            ) : null}
            <div className="lib-now__teams">
              {[
                { name: live.match.home, goals: live.score?.home },
                ...(live.match.away ? [{ name: live.match.away, goals: live.score?.away }] : []),
              ].map((team) => (
                <p key={team.name} className="lib-now__team">
                  <TeamMark name={team.name} size={22} lit />
                  <span className="lib-now__name">{team.name}</span>
                  {!hidden && typeof team.goals === 'number' ? (
                    <Num className="lib-now__goals" value={team.goals} />
                  ) : null}
                </p>
              ))}
            </div>
            {hidden ? (
              <Button
                size="sm"
                variant="quiet"
                className="lib-now__reveal"
                title="Tu emisión va por detrás del directo"
                onClick={() => revealScore(live.match.id)}
              >
                Ver marcador
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="lib-detail__none">
            {onAir.ready ? 'Sin partido anunciado ahora mismo.' : 'Cargando la agenda…'}
          </p>
        )}
      </div>

      {later.length ? (
        <div className="lib-detail__sec">
          <h3 className="lib-detail__h">Después</h3>
          <ol className="lib-later">
            {later.slice(0, 6).map(({ match }) => (
              <li key={match.id} className="lib-later__row">
                <Num
                  className="lib-later__time"
                  value={/^\d{2}:\d{2}$/.test(match.time) ? match.time : '--:--'}
                />
                <span className="lib-later__title">
                  {match.away ? `${match.home} – ${match.away}` : match.title}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <p className="lib-detail__hash">
        <span className="mono">
          Hash {item.id.slice(0, 8)}…{item.id.slice(-8)}
        </span>
        <IconButton icon="copy" label="Copiar hash" onClick={() => void copyHash(item.id)} />
      </p>
      {actions.sheets}
    </section>
  );
}
