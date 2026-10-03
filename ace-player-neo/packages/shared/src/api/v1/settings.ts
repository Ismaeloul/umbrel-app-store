/* Ajustes v2 (arquitectura §5.6): la política de mismo canal y, desde la
   0.8.4, «Arranque instantáneo» (D24, guardado en su propio fichero).
   Se leen y se cambian desde la web y desde la app iOS (0.8.1: «Un solo
   dispositivo a la vez» también en el iPhone). */

import { z } from 'zod';
import { SameChannelPolicySchema, SettingsSchema } from '../../state/v2.js';

/**
 * Lo que ve la interfaz: lo de `settings.json` más `instantStart` (D24).
 * Opcional para los clientes: ausente = activado (el servidor 0.8.4 siempre
 * lo manda; un servidor anterior no lo conoce).
 */
export const SettingsViewSchema = SettingsSchema.extend({
  instantStart: z.boolean().optional(),
});
export type SettingsView = z.infer<typeof SettingsViewSchema>;

export const SettingsResponseSchema = z.strictObject({
  settings: SettingsViewSchema,
  /** De dónde sale cada valor: guardado en v2/settings.json o el de `ACE_SAME_CHANNEL_POLICY`. */
  source: z.enum(['saved', 'environment']),
});
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

/** Cambio parcial: lo que no llega se queda como está. */
export const SettingsUpdateBodySchema = z.strictObject({
  sameChannelPolicy: SameChannelPolicySchema.optional(),
  /** «Arranque instantáneo» (D24): preparar la fuente de tus equipos antes del saque. */
  instantStart: z.boolean().optional(),
});
export type SettingsUpdateBody = z.infer<typeof SettingsUpdateBodySchema>;
