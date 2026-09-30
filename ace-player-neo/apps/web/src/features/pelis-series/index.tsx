import type { Item } from '@ace/shared';
import { useMemo } from 'react';
import { useApiQuery } from '../../api/index.ts';
import type { ViewProps } from '../../app/contracts.ts';
import { useNavigate, useSearchParam } from '../../app/router.tsx';
import { ViewHeader } from '../../app/ViewHeader.tsx';
import { Button, Card, EmptyState, Icon, Segmented, SkeletonRows, TextField } from '../../ui/index.ts';
import { playChannel } from '../library/play.ts';
import { classifyVod, languagesFor, matchesVodSearch, vodLanguages, type VodKind } from './model.ts';
import './pelis-series.css';

type KindFilter = 'todos' | VodKind;
const UNKNOWN_LANGUAGE = '__sin-especificar__';

function countKind(items: readonly Item[], kind: VodKind): number {
  return items.filter((item) => classifyVod(item) === kind).length;
}

function plural(count: number): string {
  return `${count} ${count === 1 ? 'título' : 'títulos'}`;
}

export default function PelisSeriesView({ active }: ViewProps) {
  const navigate = useNavigate();
  const library = useApiQuery('libraryGet', undefined, { enabled: active });
  const [query, setQuery] = useSearchParam('psq');
  const [kindParam, setKindParam] = useSearchParam('pskind');
  const [languageParam, setLanguageParam] = useSearchParam('pslang');
  const kind: KindFilter = kindParam === 'peliculas' || kindParam === 'series' ? kindParam : 'todos';
  const language = languageParam ?? '';
  const data = library.data;
  const source = data
    ? data.webSources.find((entry) => entry.id === data.activeWebSourceId)
    : undefined;

  const vodItems = useMemo(
    () => (data?.web ?? []).filter((item) => classifyVod(item) !== null),
    [data?.web],
  );
  const languages = useMemo(() => vodLanguages(vodItems), [vodItems]);
  const unknownCount = useMemo(() => vodItems.filter((item) => languagesFor(item).length === 0).length, [vodItems]);
  const counts = useMemo(
    () => ({
      peliculas: countKind(vodItems, 'peliculas'),
      series: countKind(vodItems, 'series'),
    }),
    [vodItems],
  );
  const results = useMemo(() => {
    const needle = query ?? '';
    return vodItems.filter((item) => {
      if (kind !== 'todos' && classifyVod(item) !== kind) return false;
      if (!matchesVodSearch(item, needle)) return false;
      if (language === UNKNOWN_LANGUAGE) return languagesFor(item).length === 0;
      if (language && !languagesFor(item).includes(language)) return false;
      return true;
    });
  }, [vodItems, query, kind, language]);

  const resetFilters = () => {
    setQuery(null);
    setKindParam(null);
    setLanguageParam(null);
  };

  const subtitle = library.isLoading
    ? 'Cargando tu lista…'
    : source
      ? `${source.name} · ${plural(vodItems.length)}`
      : 'Películas y series de la lista IPTV activa';

  if (library.isLoading) {
    return (
      <section className="vod">
        <ViewHeader title="Pelis y Series" subtitle={subtitle} />
        <SkeletonRows rows={5} label="Cargando películas y series…" />
      </section>
    );
  }

  if (!data && library.isError) {
    return (
      <section className="vod">
        <ViewHeader title="Pelis y Series" subtitle="No se pudo cargar la lista activa" />
        <EmptyState
          title="No se pudo cargar tu catálogo"
          tone="error"
          actions={(
            <Button variant="primary" icon="refresh" busy={library.isFetching} onClick={() => void library.refetch()}>
              Reintentar
            </Button>
          )}
        >
          Comprueba la conexión con Ace Stream Neo y vuelve a intentarlo.
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="vod">
      <ViewHeader title="Pelis y Series" subtitle={subtitle} />

      <div className="vod__toolbar">
        <Segmented<KindFilter>
          label="Filtrar por tipo"
          block
          value={kind}
          onChange={(next) => setKindParam(next === 'todos' ? null : next)}
          items={[
            { value: 'todos', label: 'Todo', count: vodItems.length },
            { value: 'peliculas', label: 'Películas', count: counts.peliculas },
            { value: 'series', label: 'Series', count: counts.series },
          ]}
        />
        <div className="vod__filters">
          <TextField
            aria-label="Buscar películas y series"
            label="Buscar películas y series"
            hideLabel
            variant="search"
            type="search"
            icon="buscar"
            placeholder="Título, género o idioma"
            value={query ?? ''}
            onChange={(event) => setQuery(event.currentTarget.value || null)}
            autoComplete="off"
            spellCheck={false}
          />
          <label className="vod__language">
            <span>Idioma</span>
            <select
              value={language || 'todos'}
              onChange={(event) => setLanguageParam(event.currentTarget.value === 'todos' ? null : event.currentTarget.value)}
            >
              <option value="todos">Todos</option>
              {languages.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              {unknownCount > 0 ? <option value={UNKNOWN_LANGUAGE}>Sin especificar</option> : null}
            </select>
            <Icon name="chev-d" size={18} />
          </label>
        </div>
      </div>

      <p className="vod__count" aria-live="polite">
        {results.length === vodItems.length && kind === 'todos' && !language && !query
          ? `${plural(results.length)} disponibles`
          : `${plural(results.length)} encontrados`}
      </p>

      {results.length ? (
        <div className="vod__grid" aria-label="Resultados de películas y series">
          {results.map((item) => {
            const itemKind = classifyVod(item);
            const itemLanguages = languagesFor(item);
            const category = item.category.trim();
            return (
              <Card as="article" key={item.id} padding={0} className="vod-card">
                <div className={`vod-card__art ${itemKind === 'series' ? 'vod-card__art--series' : ''}`} aria-hidden="true">
                  <span className="vod-card__type">{itemKind === 'series' ? 'SERIE' : 'PELÍCULA'}</span>
                  <Icon name="cine" size={32} />
                  <span className="vod-card__initial">{item.title.trim().slice(0, 1).toLocaleUpperCase('es') || 'P'}</span>
                </div>
                <div className="vod-card__body">
                  <h2 title={item.title}>{item.title}</h2>
                  {category && category.toLocaleLowerCase('es') !== 'importado' ? (
                    <p className="vod-card__category" title={category}>{category}</p>
                  ) : null}
                  <p className="vod-card__language">
                    <Icon name="learn" size={16} />
                    {itemLanguages.length ? itemLanguages.join(' · ') : 'Idioma sin especificar'}
                  </p>
                  <Button
                    variant="primary"
                    icon="play"
                    block
                    onClick={() => playChannel(navigate, {
                      hash: item.id,
                      title: item.title,
                      ih: item.ih,
                      category: item.category,
                      record: true,
                      origin: 'biblioteca',
                    })}
                  >
                    Reproducir
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : vodItems.length === 0 ? (
        <EmptyState
          title="Aún no hay películas ni series"
          actions={<Button variant="primary" icon="list" onClick={() => navigate({ vista: 'biblioteca' })}>Revisar listas</Button>}
        >
          {source
            ? `La lista «${source.name}» no contiene entradas AceStream identificadas como películas o series.`
            : 'Añade y sincroniza una lista compatible desde Canales para que aparezcan aquí.'}
        </EmptyState>
      ) : (
        <EmptyState
          title="No encontramos resultados"
          actions={<Button variant="primary" icon="refresh" onClick={resetFilters}>Limpiar filtros</Button>}
        >
          Prueba con otro título, tipo o idioma.
        </EmptyState>
      )}
    </section>
  );
}
