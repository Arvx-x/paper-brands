// src/creative/motif.ts
import { mkdir } from "node:fs/promises";
import { ImageClient, writeImage } from "../llm/imageClient.ts";
import { LLMClient } from "../llm/client.ts";
import type { BrandKit } from "./types.ts";

export interface MotifResult { imagePath: string; }

/**
 * Generate ONE restrained, transparent-PNG brand device per brand — the quiet
 * recurring thread reused across the brand book (divider background, light
 * watermark). Fail-clean: returns null on any failure; the motif is an
 * enhancement, never load-bearing.
 */
export async function generateMotif(
  kit: BrandKit,
  opts: {
    outDir: string;
    imageClient?: ImageClient;
    /** Reserved: future use for LLM-augmented prompt generation. Currently unused. */
    llm?: LLMClient;
  },
): Promise<MotifResult | null> {
  const ic = opts.imageClient ?? new ImageClient();
  const primary = kit.palette?.find((p) => p.role === "primary")?.hex ?? kit.palette?.[0]?.hex ?? "#1a1a1a";
  const prompt =
    `A single, minimal, abstract brand device/motif for "${kit.brandName}" — ${kit.essence}. ` +
    `Mood: ${(kit.moodKeywords ?? []).join(", ")}. ` +
    `RESTRAINED and quiet: one simple line-based or geometric mark, lots of negative space, ` +
    `single-color (${primary}) or subtle two-tone. NOT a busy pattern, NOT loud, NOT a logo, ` +
    `no text. Transparent background. Suitable as a faint recurring accent in a brand book.`;
  try {
    const blob = await ic.generate({
      prompt,
      aspect: "1:1",
      imageSize: "1K",
      system: "You produce minimal, elegant, restrained abstract brand devices on transparent backgrounds. Never busy, never loud.",
    });
    await mkdir(opts.outDir, { recursive: true });
    const ext = blob.mime.includes("jpeg") ? "jpg" : "png";
    const path = await writeImage(blob, `${opts.outDir}/motif.${ext}`);
    return { imagePath: path };
  } catch {
    return null;
  }
}
