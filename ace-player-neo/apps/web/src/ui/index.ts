/* Componentes base del sistema de diseño (docs/diseno/sistema.md), piel
   «Palco» desde la fase 2 (design-explorations/02-plan-palco.md §4).
   Componentes de presentación SIN lógica de datos: reciben props y pintan.
   Cambiar de dirección visual es cambiar los tokens y la piel de estos
   componentes, no las vistas.

   El paquete declara `sideEffects: ["**\/*.css"]`, así que importar de aquí
   solo arrastra (JS y CSS) los componentes que se usan. */

export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonVariant,
  type IconButtonProps,
} from './Button.tsx';
export { Capsule, type CapsuleProps, type CapsuleTone } from './Capsule.tsx';
export { Card, Panel, type PanelProps } from './Surface.tsx';
export {
  ChannelMark,
  channelAbbrev,
  channelDorsal,
  type ChannelMarkProps,
} from './ChannelMark.tsx';
export { Chip, type ChipProps } from './Chip.tsx';
export { CompetitionBadge, type CompetitionBadgeProps } from './CompetitionBadge.tsx';
export { EmptyState, type EmptyStateProps } from './EmptyState.tsx';
export { Kbd, Switch, TextField, type SwitchProps, type TextFieldProps } from './Field.tsx';
export { Icon, type IconProps } from './Icon.tsx';
export { ICON_NAMES, ICONS, type IconName } from './icons.ts';
export { LiveDot, LiveRing, matchProgress, type LiveRingProps } from './LiveRing.tsx';
export {
  Menu,
  MenuButton,
  placeMenu,
  useContextMenu,
  type MenuAnchor,
  type MenuItem,
  type MenuProps,
} from './Menu.tsx';
export { Num, splitDigits, type NumProps } from './Num.tsx';
export { PosterRail, type PosterRailProps } from './PosterRail.tsx';
export { ProgressBar, type ProgressBarProps } from './ProgressBar.tsx';
export {
  Segmented,
  Tabs,
  tabPanelProps,
  type SegmentItem,
  type SegmentedProps,
  type TabsProps,
} from './Segmented.tsx';
export { Sheet, type SheetProps } from './Sheet.tsx';
export {
  SIGNAL_GLYPH,
  SIGNAL_WORD,
  SignalBadge,
  signalFromCandidate,
  type SignalBadgeProps,
  type SignalState,
} from './SignalBadge.tsx';
export { SignalRing, type SignalRingProps, type SignalRingState } from './SignalRing.tsx';
export { Skeleton, SkeletonRows, type SkeletonProps } from './Skeleton.tsx';
export { StatusLineView, type StatusLineViewProps } from './StatusLine.tsx';
export { TeamMark, teamInitials, type TeamColors, type TeamMarkProps } from './TeamMark.tsx';
export { ToastView, TONE_ICON, type NoticeTone, type ToastViewProps } from './Toast.tsx';
export {
  VersusCard,
  type VersusCardProps,
  type VersusSize,
  type VersusWhen,
} from './VersusCard.tsx';
