/* Buscar (web): un solo campo grande; «/» lo enfoca desde cualquier sitio. */

import { useEffect, useRef, useState } from 'react';
import { navigate } from '../../../core/router';
import { playChannel, useSim } from '../../../core/store';
import type { Item } from '../../../core/types';
import { Field } from '../components/Key';
import { SearchResults } from '../components/Search';
import { IcSearch } from '../components/icons';
import { engineHash, rememberTitle } from '../components/text';

let savedQuery = '';

export function WebSearch({ now }: { now: number }) {
  const [q, setQ] = useState(savedQuery);
  const agenda = useSim((s) => s.agenda);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    savedQuery = q;
  }, [q]);
  useEffect(() => {
    const focus = () => {
      const el = box.current?.querySelector<HTMLInputElement>('input');
      el?.focus();
      el?.select();
    };
    focus();
    window.addEventListener('tr-focus-search', focus);
    return () => window.removeEventListener('tr-focus-search', focus);
  }, []);

  const openItem = (item: Item) => {
    playChannel(item.id);
    navigate('canal', item.id);
  };

  return (
    <div className="tr-search" ref={box}>
      <h1>Buscar</h1>
      <Field big leading={<IcSearch size={20} />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Canal, o pega un Content ID" autoComplete="off" spellCheck={false} aria-label="Buscar" trailing={<kbd className="tr-kbd">/</kbd>} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
      <SearchResults
        q={q}
        agenda={agenda}
        now={now}
        mode="web"
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
  );
}
