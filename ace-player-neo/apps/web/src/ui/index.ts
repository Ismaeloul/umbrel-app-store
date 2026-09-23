/* Componentes base del sistema de diseño (docs/diseno/sistema.md).
   Componentes de presentación SIN lógica de datos: reciben props y pintan.
   Cambiar de dirección visual (eleccion.md, «Si mañana prefieres otra») es
   cambiar los tokens y la piel de estos componentes, no las vistas.

   El paquete declara `sideEffects: ["**\/*.css"]`, así que importar de aquí
   solo arrastra (JS y CSS) los componentes que se usan. */

export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonVariant,
  type IconButtonProps,
} from './Button.tsx';
export { Card, Panel, type PanelProps } from './Surface.tsx';
export { ChannelMark, channelDorsal } from './ChannelMark.tsx';
export { Chip, type ChipProps } from './Chip.tsx';
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
export { Skeleton, SkeletonRows, type SkeletonProps } from './Skeleton.tsx';
export { StatusLineView, type StatusLineViewProps } from './StatusLine.tsx';
export { TeamMark, teamInitials, type TeamColors, type TeamMarkProps } from './TeamMark.tsx';
export { ToastView, TONE_ICON, type NoticeTone, type ToastViewProps } from './Toast.tsx';
