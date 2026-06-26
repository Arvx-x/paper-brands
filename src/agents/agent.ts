import { LLMClient, type ChatMessage } from "../llm/client.ts";

export interface AgentSpec {
  role: string;
  /** What this specialist optimizes for and how it argues. */
  charter: string;
  temperature?: number;
}

/** A specialist agent with a charter. Stateless; context passed per call. */
export class Agent {
  constructor(
    public spec: AgentSpec,
    private llm: LLMClient = new LLMClient(),
  ) {}

  private system(): ChatMessage {
    return {
      role: "system",
      content:
        `You are the ${this.spec.role} on a brand-building council.\n` +
        `${this.spec.charter}\n` +
        `Be concrete and evidence-led. Cite the specific need, trigger, or ` +
        `constraint you are reasoning from. Avoid generic marketing platitudes.`,
    };
  }

  async respond(prompt: string): Promise<string> {
    return this.llm.complete({
      messages: [this.system(), { role: "user", content: prompt }],
      temperature: this.spec.temperature ?? 0.6,
    });
  }

  async respondJson<T>(prompt: string): Promise<T> {
    return this.llm.completeJson<T>({
      messages: [
        this.system(),
        {
          role: "user",
          content: prompt + "\n\nReturn ONLY a valid JSON object.",
        },
      ],
      temperature: this.spec.temperature ?? 0.5,
    });
  }
}

export const COUNCIL_SPECS: AgentSpec[] = [
  {
    role: "Category Analyst",
    charter:
      "Map competitor archetypes, white space, and price ladders. You argue from the structure of the market and where demand is underserved.",
  },
  {
    role: "Behavioral Psychologist",
    charter:
      "Explain purchase triggers, anxieties, and rejection reasons. You argue from how real buyers decide under context and emotion.",
  },
  {
    role: "Brand Strategist",
    charter:
      "Define positioning, wedge, and narrative. You argue for a sharp, ownable difference that a real buyer can repeat in one sentence.",
  },
  {
    role: "Pricing & Margin Analyst",
    charter:
      "Pressure-test price points against willingness to pay and gross margin feasibility. You kill concepts with unrealistic unit economics.",
  },
  {
    role: "Compliance & Risk Analyst",
    charter:
      "Flag claims, regulatory, and supply risks. You veto unsubstantiated or non-compliant claims regardless of how well they sell.",
  },
  {
    role: "Creative Director",
    charter:
      "Translate strategy into packaging direction, voice, taglines, and ad angles that feel distinctive on shelf and in feed.",
  },
];
