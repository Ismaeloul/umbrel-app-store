/* Buscar (iPhone): la pestaña de búsqueda. */

import { useEffect, useState } from 'react';
import { navigate } from '../../../core/router';
import { playChannel, useSim } from '../../../core/store';
import type { Item } from '../../../core/types';
import { Field } from '../components/Key';
import { SearchResults } from '../components/Search';
import { IcSearch } from '../components/icons';
import { engineHash, rememberTitle } from '../components/text';
import { PageHead } from './NavBar';

let savedQuery = '';

export function PhoneBuscar({ now }: { now: number }) {
  const [q, setQ] = useState(savedQuery);
  const agenda = useSim((s) => s.agenda);
  useEffect(() => {
    savedQuery = q;
  }, [q]);
  const openItem = (item: Item) => {
    playChannel(item.id);
    navigate('canal', item.id);
  };
  return (
    <div className="tr-ph-buscar">
      <PageHead title="Buscar" />
      <div className="tr-ph-body">
        <Field leading={<IcSearch size={20} />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Canal, o pega un Content ID" autoComplete="off" spellCheck={false} aria-label="Buscar" inputMode="search" enterKeyHint="search" />
        <SearchResults
          q={q}
          agenda={agenda}
          now={now}
          mode="phone"
          onOpenItem={openItem}
          onOpenEngine={(hit) => {
            const id = engineHash(hit.title);
            rememberTitle(id, hit.title);
            playChannel(id);
            navigate('canal', id);
          }}
          onPlayHash={(hash) => {
            rememberTitle(hash, 'Enlace pegado');
            playChannel(hash);
            navigate('canal', hash);
          }}
        />
      </div>
    </div>
  );
}
