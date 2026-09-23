/* Ajustes v2 (arquitectura §5.6): hoy solo la política de mismo canal.
   Se leen desde la web y desde la app iOS; solo la web los cambia. */

import { z } from 'zod';
import { SameChannelPolicySchema, SettingsSchema } from '../../state/v2.js';

export const SettingsResponseSchema = z.strictObject({
  settings: SettingsSchema,
  /** De dónde sale cada valor: guardado en v2/settings.json o el de `ACE_SAME_CHANNEL_POLICY`. */
  source: z.enum(['saved', 'environment']),
});
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

/** Cambio parcial: lo que no llega se queda como está. */
export const SettingsUpdateBodySchema = z.strictObject({
  sameChannelPolicy: SameChannelPolicySchema.optional(),
});
export type SettingsUpdateBody = z.infer<typeof SettingsUpdateBodySchema>;
