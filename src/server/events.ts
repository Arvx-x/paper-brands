export interface BaseEvent { seq: number; ts: string; }

export type Stage =
  | "council" | "cohort" | "arena" | "scoring" | "finalists" | "creative" | "pages";

export type PipelineEvent =
  | (BaseEvent & { type: "run-started"; category: string })
  | (BaseEvent & { type: "stage"; stage: Stage; status: "start" | "done"; note?: string })
  | (BaseEvent & { type: "brand-spawned"; conceptId: string; name: string; positioning: string })
  | (BaseEvent & { type: "persona-decision";
      personaId: string; segment: string; pickedConceptId: string; pickedLabel: string;
      reason: string; topObjection: string; confidence?: number;
      willingnessToPayMinor: number; abstained?: boolean; errored?: boolean })
  | (BaseEvent & { type: "finalist-selected";
      rank: number; conceptId: string; name: string;
      winRate: number; winRateCiLow: number; winRateCiHigh: number; moatOverall?: number })
  | (BaseEvent & { type: "image-ready"; conceptId: string; name: string; kind: "logo" | "packaging" | "product"; url: string })
  | (BaseEvent & { type: "page-ready"; conceptId: string; name: string; url: string })
  | (BaseEvent & { type: "run-complete"; pageUrls: { name: string; url: string }[] })
  | (BaseEvent & { type: "run-error"; stage?: Stage; message: string });

export type EmitInput = PipelineEvent extends infer U
  ? U extends BaseEvent
    ? Omit<U, "seq" | "ts">
    : never
  : never;
export type PipelineOnEvent = (e: EmitInput) => void;

export interface Writer { write(s: string): void; close?(): void; }

export type RunStatus = "idle" | "running" | "complete" | "error";

export class RunBroadcaster {
  private subscribers = new Set<Writer>();
  private buffer: PipelineEvent[] = [];
  private seq = 0;
  private status: RunStatus = "idle";
  private category?: string;

  constructor(private cap = 500) {}

  setRunning(category: string) {
    // Clear buffer + reset seq so a new run doesn't replay the previous run's events to late-joiners.
    this.buffer = [];
    this.seq = 0;
    this.status = "running";
    this.category = category;
  }
  setStatus(s: RunStatus) { this.status = s; }

  emit(input: EmitInput): PipelineEvent {
    const event = { ...input, seq: this.seq++, ts: new Date().toISOString() } as PipelineEvent;
    this.buffer.push(event);
    if (this.buffer.length > this.cap) this.buffer.splice(0, this.buffer.length - this.cap);
    const frame = this.frame(event);
    for (const w of this.subscribers) {
      try { w.write(frame); } catch { /* one bad writer must not break others */ }
    }
    return event;
  }

  private frame(e: PipelineEvent): string {
    return `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;
  }

  subscribe(w: Writer): void {
    for (const e of this.buffer) {
      try { w.write(this.frame(e)); } catch { /* ignore */ }
    }
    this.subscribers.add(w);
  }

  unsubscribe(w: Writer): void { this.subscribers.delete(w); }

  snapshot() {
    return { status: this.status, category: this.category, lastSeq: this.seq - 1, events: this.buffer };
  }
}
