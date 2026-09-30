/* Chips de distintivos (docs/vod.md §4.4 y §12.4): «Castellano», «Latino»,
   «VOSE», «Multi» y «4K», solo los que tienen algo (su número sale de la
   portada o de la última página de la rejilla). Uno a la vez: tocar el
   elegido lo quita. El elegido se enseña aunque se quede a 0, para poder
   quitarlo. */

import { VOD_TAGS, type VodTag, type VodTagCount } from '@ace/shared';
import { Chip } from '../../ui/index.ts';
import { CINE_TEXT, formatCount, TAG_LABEL } from './texts.ts';

export interface TagChipsProps {
  counts: readonly VodTagCount[];
  value: VodTag | null;
  onChange(tag: VodTag | null): void;
}

/** Los chips que se pintan, en su orden fijo. */
export function visibleTags(counts: readonly VodTagCount[], value: VodTag | null): VodTagCount[] {
  return VOD_TAGS.flatMap((tag) => {
    const count = counts.find((entry) => entry.tag === tag)?.count ?? 0;
    return count > 0 || tag === value ? [{ tag, count }] : [];
  });
}

export function TagChips({ counts, value, onChange }: TagChipsProps) {
  const tags = visibleTags(counts, value);
  if (tags.length === 0) return null;
  return (
    <div className="cine-chips cine-tags" role="group" aria-label={CINE_TEXT.tagsGroup}>
      {tags.map(({ tag, count }) => (
        <Chip
          key={tag}
          pressed={value === tag}
          count={count}
          label={`${TAG_LABEL[tag]}, ${formatCount(count)}`}
          onClick={() => onChange(value === tag ? null : tag)}
        >
          {TAG_LABEL[tag]}
        </Chip>
      ))}
    </div>
  );
}
