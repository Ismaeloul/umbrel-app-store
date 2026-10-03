/* Idiomas de Películas y series (docs/vod.md §4.10). Lo pidió Isma: «que me
   des a elegir el idioma que quiero, con castellano y latino separados, y
   que luego lo pueda editar: cambio el idioma al francés y busco».

   - `LanguageWelcome`: la primera vez que se entra (`chosen: false`), una
     pantalla corta en la propia vista (no un modal): teselas grandes con
     cuántos títulos hay de cada idioma, castellano y latino bien separados,
     y «Puedes cambiarlo cuando quieras». Nunca bloquea: «Ahora no, ver todo».
   - `LanguageButton`: el botón de la cabecera con lo elegido («Castellano
     y Francés», con el globo): abre la hoja para cambiarlo al vuelo.
   - `OnlyLangNote`: «Viendo solo en latino» (tras «3 en latino · Ver»).
   - `LanguageSheet`: la misma elección en una hoja (cabecera y Ajustes).
   - `OtherLangs`: «3 en latino · Ver» cuando una búsqueda no da nada en tus
     idiomas pero sí en otros.
   - `CineLanguagesSetting`: la fila de Ajustes → IPTV.

   Se guarda en el servidor (`vodLanguagesUpdate`): vale en el PC y en el
   iPhone. Si guardar falla, la elección vale en esta pestaña y se avisa
   (nunca se queda uno atascado en el selector). */

import type { VodHome, VodLang, VodLangHidden, VodLanguages } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { describeFailure, routeKey, useApiQuery } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { notify } from '../../notices/index.ts';
import { Button, Icon, Sheet, Switch } from '../../ui/index.ts';
import { useSaveLanguages, useVodLanguages } from './data.ts';
import { langOptions, toggleLang, type LangOption } from './model.ts';
import {
  inLangText,
  LANG_CODE,
  LANG_HINT,
  LANG_LABEL,
  LANG_TEXT,
  langButtonLabel,
  langCountText,
  langSummary,
  onlyInLangText,
  unknownHelp,
} from './texts.ts';
import './demo.ts';
import './languages.css';

/** Títulos sin idioma de todo el catálogo (los dos tipos). */
function unknownTotal(home: VodHome | undefined): number {
  return (home?.noLang?.movies ?? 0) + (home?.noLang?.series ?? 0);
}

interface Draft {
  langs: VodLang[];
  unknown: boolean;
}

/**
 * Guarda la elección. Si el servidor falla, vale en esta pestaña (la caché
 * de `vodLanguagesGet`) y se avisa: la vista sigue, nunca se bloquea.
 */
function useCommit() {
  const save = useSaveLanguages();
  const client = useQueryClient();
  return async (draft: Draft): Promise<boolean> => {
    try {
      await save(draft);
      return true;
    } catch (error) {
      const local: VodLanguages = { chosen: true, ...draft, updatedAt: null };
      client.setQueryData(routeKey('vodLanguagesGet'), local);
      notify(`${LANG_TEXT.saveFailed} ${describeFailure(error)}`, { tone: 'err' });
      return false;
    }
  };
}

// ---- El selector ---------------------------------------------------------------------------

export interface LanguagePickerProps {
  options: readonly LangOption[];
  value: readonly VodLang[];
  onChange(langs: VodLang[]): void;
  unknown: boolean;
  onUnknown(unknown: boolean): void;
  /** Títulos sin idioma en el catálogo (para explicar el interruptor). */
  unknownCount: number;
  /** Las teselas, en columnas anchas (la pantalla de la primera vez). */
  wide?: boolean;
}

export function LanguagePicker({
  options,
  value,
  onChange,
  unknown,
  onUnknown,
  unknownCount,
  wide = false,
}: LanguagePickerProps) {
  return (
    <div className="cine-langs">
      <div
        className={cx('cine-langs__grid', wide && 'cine-langs__grid--wide')}
        role="group"
        aria-label={LANG_TEXT.group}
      >
        {options.map((option) => {
          const on = value.includes(option.lang);
          const count = langCountText(option.movies, option.series);
          return (
            <button
              key={option.lang}
              type="button"
              className="cine-lang press"
              data-lang={option.lang}
              aria-pressed={on}
              aria-label={`${LANG_LABEL[option.lang]}: ${LANG_HINT[option.lang]}. ${count}`}
              onClick={() => {
                haptic('selection');
                onChange(toggleLang(value, option.lang));
              }}
            >
              <span className="cine-lang__code" aria-hidden="true">
                {LANG_CODE[option.lang]}
              </span>
              <span className="cine-lang__text" aria-hidden="true">
                <span className="cine-lang__name">{LANG_LABEL[option.lang]}</span>
                <span className="cine-lang__hint">{LANG_HINT[option.lang]}</span>
                <span className="cine-lang__count">{count}</span>
              </span>
              <span className="cine-lang__check" aria-hidden="true">
                <Icon name="check" size={16} />
              </span>
            </button>
          );
        })}
      </div>
      {value.length > 0 ? (
        <Switch
          className="cine-langs__unknown"
          label={LANG_TEXT.unknownLabel}
          description={unknownCount > 0 ? unknownHelp(unknownCount) : undefined}
          checked={unknown}
          onChange={onUnknown}
        />
      ) : null}
    </div>
  );
}

// ---- La primera vez ------------------------------------------------------------------------

/** Lo elegido de entrada la primera vez: castellano, si el catálogo tiene. */
function firstDraft(options: readonly LangOption[]): Draft {
  const castellano = options.find((option) => option.lang === 'castellano');
  return {
    langs: castellano && castellano.movies + castellano.series > 0 ? ['castellano'] : [],
    unknown: true,
  };
}

export interface LanguageWelcomeProps {
  home: VodHome;
}

/** «¿En qué idiomas las quieres ver?» (la primera vez que se entra). */
export function LanguageWelcome({ home }: LanguageWelcomeProps) {
  const options = langOptions(home.langs);
  const [draft, setDraft] = useState<Draft>(() => firstDraft(options));
  const [busy, setBusy] = useState<'start' | 'skip' | null>(null);
  const commit = useCommit();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  /* El foco al titular: el lector de pantalla lo dice y Tab sigue por las teselas. */
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);
  const go = async (which: 'start' | 'skip') => {
    setBusy(which);
    const ok = await commit(which === 'skip' ? { langs: [], unknown: true } : draft);
    if (ok) haptic('success');
    setBusy(null);
    /* La portada empieza arriba (el botón estaba al final del selector). */
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } catch {}
  };
  return (
    <section className="cine-welcome" aria-labelledby={titleId}>
      <div className="cine-welcome__head">
        <span className="cine-welcome__kicker">
          <Icon name="idioma" size={16} />
          {LANG_TEXT.welcomeKicker}
        </span>
        <h2 id={titleId} ref={titleRef} className="cine-welcome__title" tabIndex={-1}>
          {LANG_TEXT.welcomeTitle}
        </h2>
        <p className="cine-welcome__text">{LANG_TEXT.welcomeText}</p>
      </div>
      <LanguagePicker
        wide
        options={options}
        value={draft.langs}
        onChange={(langs) => setDraft((current) => ({ ...current, langs }))}
        unknown={draft.unknown}
        onUnknown={(unknown) => setDraft((current) => ({ ...current, unknown }))}
        unknownCount={unknownTotal(home)}
      />
      <div className="cine-welcome__foot">
        <Button
          variant="primary"
          icon={draft.langs.length ? 'check' : 'cine'}
          busy={busy === 'start'}
          disabled={busy !== null}
          onClick={() => void go('start')}
        >
          {draft.langs.length ? LANG_TEXT.start : LANG_TEXT.startAll}
        </Button>
        {draft.langs.length ? (
          <Button
            variant="ghost"
            busy={busy === 'skip'}
            disabled={busy !== null}
            onClick={() => void go('skip')}
          >
            {LANG_TEXT.skip}
          </Button>
        ) : null}
        <p className="cine-welcome__anytime">{LANG_TEXT.anytime}</p>
      </div>
    </section>
  );
}

// ---- La hoja para cambiarlos --------------------------------------------------------------

export interface LanguageSheetProps {
  open: boolean;
  onClose(): void;
  /** La portada que ya se tiene (para los recuentos); si no, se pide. */
  home?: VodHome;
}

/** La elección en una hoja: «Guardar» la cambia en el servidor y la vista se filtra al momento. */
export function LanguageSheet({ open, onClose, home }: LanguageSheetProps) {
  const languages = useVodLanguages(open);
  /* Los recuentos: los de la portada si se tienen; si no (Ajustes), la portada sin filtro. */
  const fallback = useApiQuery('vodHome', { query: {} }, { enabled: open && !home, retry: 1 });
  const counts = home ?? fallback.data;
  const prefs = languages.data;
  const [draft, setDraft] = useState<Draft>({ langs: [], unknown: true });
  const [busy, setBusy] = useState(false);
  const commit = useCommit();
  const wasOpen = useRef(false);
  /* Cada vez que se abre, la elección de ahora (sin restos de la vez anterior). */
  useEffect(() => {
    if (open && !wasOpen.current)
      setDraft({ langs: [...(prefs?.langs ?? [])], unknown: prefs?.unknown ?? true });
    wasOpen.current = open;
  }, [open, prefs]);
  const options = langOptions(counts?.langs, draft.langs);
  const save = async () => {
    setBusy(true);
    const ok = await commit(draft);
    setBusy(false);
    if (ok) {
      haptic('success');
      notify(LANG_TEXT.saved, { tone: 'ok', icon: 'idioma' });
    }
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={LANG_TEXT.sheetTitle}
      description={LANG_TEXT.sheetText}
      size="lg"
      className="cine-langs-sheet"
      footer={
        <>
          <Button variant="primary" icon="check" busy={busy} onClick={() => void save()}>
            {LANG_TEXT.save}
          </Button>
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            {LANG_TEXT.cancel}
          </Button>
        </>
      }
    >
      <LanguagePicker
        options={options}
        value={draft.langs}
        onChange={(langs) => setDraft((current) => ({ ...current, langs }))}
        unknown={draft.unknown}
        onUnknown={(unknown) => setDraft((current) => ({ ...current, unknown }))}
        unknownCount={unknownTotal(counts)}
      />
    </Sheet>
  );
}

// ---- El botón de la cabecera --------------------------------------------------------------

export interface LanguageButtonProps {
  prefs: VodLanguages | null;
  onClick(): void;
  className?: string;
}

/** «Castellano y Francés ▾» con el globo: abre la hoja para cambiar los idiomas al vuelo. */
export function LanguageButton({ prefs, onClick, className }: LanguageButtonProps) {
  const langs = prefs?.chosen ? prefs.langs : [];
  return (
    <Button
      variant="quiet"
      icon="idioma"
      trailingIcon="chev-d"
      className={cx('cine-lang-button', className)}
      aria-label={langButtonLabel(langs)}
      aria-haspopup="dialog"
      onClick={onClick}
    >
      <span className="cine-lang-button__text">{langSummary(langs)}</span>
    </Button>
  );
}

// ---- «Viendo solo en latino» ---------------------------------------------------------------

/** La rejilla tras «3 en latino · Ver»: lo dice y deja volver a los idiomas elegidos. */
export function OnlyLangNote({ lang, onBack }: { lang: VodLang; onBack(): void }) {
  return (
    <div className="cine-only-lang" role="status">
      <span className="cine-only-lang__text">
        <Icon name="idioma" size={20} />
        {onlyInLangText(lang)}
      </span>
      <Button variant="quiet" size="sm" icon="chev-l" onClick={onBack}>
        {LANG_TEXT.backToMine}
      </Button>
    </div>
  );
}

// ---- «3 en latino · Ver» ------------------------------------------------------------------

/** Cuántos idiomas de fuera se ofrecen como mucho. */
export const OTHER_LANGS_MAX = 3;

export interface OtherLangsProps {
  hidden: VodLangHidden;
  onPick(lang: VodLang): void;
}

/** Lo que hay en otros idiomas, cada uno con su «Ver». */
export function OtherLangs({ hidden, onPick }: OtherLangsProps) {
  const langs = hidden.langs.filter((item) => item.count > 0).slice(0, OTHER_LANGS_MAX);
  if (langs.length === 0) return null;
  return (
    <div className="cine-other-langs" role="group" aria-label={LANG_TEXT.otherLangsLead}>
      <p className="cine-other-langs__lead">{LANG_TEXT.otherLangsLead}</p>
      <div className="cine-other-langs__list">
        {langs.map((item) => (
          <Button
            key={item.lang}
            variant="quiet"
            size="sm"
            trailingIcon="chev-r"
            className="cine-other-langs__item"
            onClick={() => onPick(item.lang)}
          >
            {inLangText(item.count, item.lang)} · Ver
          </Button>
        ))}
      </div>
    </div>
  );
}

// ---- Ajustes → IPTV -----------------------------------------------------------------------

/** «Idiomas de Pelis y series: Castellano y Francés [Cambiar]» en la tarjeta de la IPTV. */
export function CineLanguagesSetting() {
  const languages = useVodLanguages(true);
  const [open, setOpen] = useState(false);
  if (languages.isError) return null;
  const prefs = languages.data;
  const langs = prefs?.chosen ? prefs.langs : [];
  return (
    <div className="cine-langs-setting">
      <span className="cine-langs-setting__icon" aria-hidden="true">
        <Icon name="idioma" size={20} />
      </span>
      <span className="cine-langs-setting__text">
        <span className="cine-langs-setting__title">{LANG_TEXT.settingsTitle}</span>
        <span className="cine-langs-setting__value">
          {prefs ? langSummary(langs) : LANG_TEXT.loading}
          {prefs?.chosen && langs.length > 0 && !prefs.unknown ? ` · ${LANG_TEXT.onlyMarked}` : ''}
        </span>
      </span>
      <Button
        size="sm"
        variant="quiet"
        icon="pencil"
        disabled={!prefs}
        aria-label={langButtonLabel(langs)}
        onClick={() => setOpen(true)}
      >
        {LANG_TEXT.settingsChange}
      </Button>
      <LanguageSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
