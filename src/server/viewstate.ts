import type { PipelineEvent, Stage } from "./events.ts";

export interface BrandVote { label: string; votes: number; }  // keyed on blind pickedLabel (e.g. OPTION-A), not a conceptId
export interface DecisionFeedItem {
  personaId: string; segment: string; pickedLabel: string; pickedConceptId: string;
  reason: string; topObjection: string; confidence?: number; abstained?: boolean; errored?: boolean;
}
export interface BrandAssets { conceptId: string; name: string; logo?: string; packaging?: string; product?: string; }
export interface FinalistView {
  rank: number; conceptId: string; name: string;
  winRate: number; winRateCiLow: number; winRateCiHigh: number; moatOverall?: number;
}
export interface PageView { conceptId: string; name: string; url: string; winRate?: number; moatOverall?: number; }

export interface ViewState {
  status: "idle" | "running" | "complete" | "error";
  category?: string;
  activeTab: "arena" | "creative" | "pages";
  stages: Record<Stage, "pending" | "active" | "done">;
  brands: { conceptId: string; name: string; positioning: string }[];
  tally: BrandVote[];
  decided: number; abstained: number;
  feed: DecisionFeedItem[];
  creative: BrandAssets[];
  finalists: FinalistView[];
  pages: PageView[];
  error?: string;
}

const STAGES: Stage[] = ["council", "cohort", "arena", "scoring", "finalists", "creative", "pages"];

export function initialState(): ViewState {
  const stages = {} as Record<Stage, "pending" | "active" | "done">;
  for (const s of STAGES) stages[s] = "pending";
  return {
    status: "idle", activeTab: "arena", stages, brands: [], tally: [],
    decided: 0, abstained: 0, feed: [], creative: [], finalists: [], pages: [],
  };
}

const FEED_CAP = 50;

export function reduce(state: ViewState, e: PipelineEvent): ViewState {
  switch (e.type) {
    case "run-started": {
      const fresh = initialState();
      return { ...fresh, status: "running", category: e.category };
    }
    case "stage": {
      const stages = { ...state.stages, [e.stage]: e.status === "start" ? "active" : "done" } as ViewState["stages"];
      let activeTab = state.activeTab;
      if (e.status === "done" && e.stage === "arena") activeTab = "creative";
      return { ...state, stages, activeTab };
    }
    case "brand-spawned":
      return { ...state, brands: [...state.brands, { conceptId: e.conceptId, name: e.name, positioning: e.positioning }] };
    case "persona-decision": {
      const feed = [{ personaId: e.personaId, segment: e.segment, pickedLabel: e.pickedLabel,
        pickedConceptId: e.pickedConceptId, reason: e.reason, topObjection: e.topObjection,
        confidence: e.confidence, abstained: e.abstained, errored: e.errored }, ...state.feed].slice(0, FEED_CAP);
      if (e.abstained || e.errored) return { ...state, abstained: state.abstained + 1, feed };
      const tally = state.tally.map((t) => ({ ...t }));
      const hit = tally.find((t) => t.label === e.pickedLabel);
      if (hit) hit.votes += 1; else tally.push({ label: e.pickedLabel, votes: 1 });
      tally.sort((a, b) => b.votes - a.votes);
      return { ...state, decided: state.decided + 1, tally, feed };
    }
    case "finalist-selected": {
      const finalists = [...state.finalists, { rank: e.rank, conceptId: e.conceptId, name: e.name,
        winRate: e.winRate, winRateCiLow: e.winRateCiLow, winRateCiHigh: e.winRateCiHigh, moatOverall: e.moatOverall }]
        .sort((a, b) => a.rank - b.rank);
      const creative = state.creative.find((c) => c.conceptId === e.conceptId)
        ? state.creative : [...state.creative, { conceptId: e.conceptId, name: e.name }];
      return { ...state, finalists, creative };
    }
    case "image-ready": {
      const creative = state.creative.map((c) => ({ ...c }));
      let entry = creative.find((c) => c.conceptId === e.conceptId);
      if (!entry) { entry = { conceptId: e.conceptId, name: e.name }; creative.push(entry); }
      entry[e.kind] = e.url;
      return { ...state, creative };
    }
    case "page-ready": {
      const fin = state.finalists.find((f) => f.conceptId === e.conceptId);
      const pages = [...state.pages, { conceptId: e.conceptId, name: e.name, url: e.url,
        winRate: fin?.winRate, moatOverall: fin?.moatOverall }];
      return { ...state, pages, activeTab: "pages" };
    }
    case "run-complete":
      return { ...state, status: "complete", activeTab: "pages" };
    case "run-error":
      return { ...state, status: "error", error: e.message };
    default:
      return state;
  }
}
