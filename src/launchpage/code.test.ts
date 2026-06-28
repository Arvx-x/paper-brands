import { test, expect } from "bun:test";
import { codePage } from "./code.ts";

function concept() {
  return { id: "C1", name: "MyBrand", positioning: "pos", targetCustomer: "t", coreInsight: "c",
    productPromise: "promise", heroSku: "Hero SKU", priceMinor: 59900, priceBand: "premium",
    tagline: "tag", claims: ["claim a", "claim b"], packagingDirection: "x", brandVoice: "x",
    landingHeadline: "Big Headline", topAdAngles: [], objections: [], launchRisks: [] } as any;
}
const assets: any = { brandKit: { palette: [{ name: "Ink", hex: "#171411", role: "primary" }], typeMoods: [], artDirection: "", voice: "", logoDirection: "" }, heroPath: "/src/hero.png" };

test("returns the html doc the LLM produced (fenced block extracted)", async () => {
  const page = "<!DOCTYPE html><html><body><h1>Big Headline</h1></body></html>";
  const llm = { complete: async () => "Here you go:\n```html\n" + page + "\n```" } as any;
  const out = await codePage(concept(), assets, llm, "gemini-3.1-flash");
  expect(out).toContain("<!DOCTYPE html>");
  expect(out).toContain("Big Headline");
  expect(out).not.toContain("```");
});

test("extracts a bare <!DOCTYPE..></html> span when no fence", async () => {
  const llm = { complete: async () => "prose <!DOCTYPE html><html><body>x</body></html> trailing" } as any;
  const out = await codePage(concept(), assets, llm, "gemini-3.1-flash");
  expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
  expect(out.endsWith("</html>")).toBe(true);
});

test("throws when output contains no html", async () => {
  const llm = { complete: async () => "sorry, I cannot help with that" } as any;
  await expect(codePage(concept(), assets, llm, "gemini-3.1-flash")).rejects.toThrow();
});

test("passes the model through and references hero asset path in prompt", async () => {
  let capturedModel: string | undefined;
  let capturedPrompt = "";
  const llm = { complete: async (o: any) => { capturedModel = o.model; capturedPrompt = o.messages.map((m: any) => m.content).join("\n"); return "<!DOCTYPE html><html><body>x</body></html>"; } } as any;
  await codePage(concept(), assets, llm, "gemini-3.1-flash");
  expect(capturedModel).toBe("gemini-3.1-flash");
  expect(capturedPrompt).toContain("assets/hero");
});
