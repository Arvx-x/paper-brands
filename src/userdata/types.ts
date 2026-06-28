// src/userdata/types.ts
import { z } from "zod";

export const VOICE_KINDS = ["unmet", "rejection", "trigger", "praise"] as const;
export type VoiceKind = (typeof VOICE_KINDS)[number];

export const UserVoiceSchema = z.object({
  quote: z.string().min(1),
  kind: z.enum(VOICE_KINDS),
  segment: z.string().optional(),
  source: z.string().min(1),
  date: z.string().optional(),
  /** A brand-internal note (not customer voice) is NOT independent. */
  independent: z.boolean().default(true),
});
export type UserVoice = z.infer<typeof UserVoiceSchema>;

export const UserSkuSchema = z.object({
  brand: z.string().min(1),
  product: z.string().min(1),
  price: z.number().finite(),
  mrp: z.number().finite().optional(),
  packSize: z.string().optional(),
  unitQty: z.number().finite().optional(),
  subtype: z.string().optional(),
  reviewCount: z.number().finite().optional(),
  rating: z.number().finite().optional(),
  tier: z.string().optional(),
  /** NEW: measured-demand signal. Recorded, NOT yet load-bearing in win-rate. */
  unitsSold: z.number().finite().optional(),
  /** NEW: real economics. Recorded, informational. */
  marginPct: z.number().finite().optional(),
});
export type UserSku = z.infer<typeof UserSkuSchema>;

export const UserCompetitorSchema = z.object({
  name: z.string().min(1),
  pricePositioning: z.string().optional(),
  claims: z.array(z.string()).default([]),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
});
export type UserCompetitor = z.infer<typeof UserCompetitorSchema>;

export const UserOverridesSchema = z.object({
  priceBands: z.array(z.object({ label: z.string(), lowMinor: z.number(), highMinor: z.number() })).optional(),
  buyerSegments: z.array(z.object({ seed: z.string(), weight: z.number() })).optional(),
  currency: z.string().optional(),
});
export type UserOverrides = z.infer<typeof UserOverridesSchema>;

export interface UserIntel {
  voices: UserVoice[];
  skus: UserSku[];
  competitors: UserCompetitor[];
  overrides: UserOverrides;
  summary: { voices: number; skus: number; competitors: number; overrides: string[] };
}
