export interface SegInput {
  seed: string;
  estimateWeight: number;  // existing LLM-estimate weight (fallback)
  supplyShare: number;     // 0..1 from price-tier/subtype shares (0 if unknown)
  demandShare: number;     // 0..1 from review-activity (0 if unknown)
}

export interface SegWeight { seed: string; weight: number; basis: string }

/**
 * Blend supply + demand proxies into a segment weight with honest provenance.
 * A segment with NEITHER proxy (both 0) falls back to its LLM-estimate weight
 * (never zeroed — a segment must not vanish from the cohort).
 * Weights normalized to sum 1.
 */
export function blendWeights(segs: SegInput[], alpha = 0.5): SegWeight[] {
  const raw = segs.map((s) => {
    const hasProxy = s.supplyShare > 0 || s.demandShare > 0;
    if (!hasProxy) {
      return { seed: s.seed, w: Math.max(0, s.estimateWeight), basis: "estimate (no grounding data)" };
    }
    const w = alpha * s.supplyShare + (1 - alpha) * s.demandShare;
    const basis = `blend: ${alpha} supply (price-tier shares) + ${(1 - alpha).toFixed(2)} review-activity`;
    return { seed: s.seed, w: Math.max(0, w), basis };
  });
  const total = raw.reduce((a, x) => a + x.w, 0) || 1;
  return raw.map((x) => ({ seed: x.seed, weight: Math.round((x.w / total) * 100) / 100, basis: x.basis }));
}
