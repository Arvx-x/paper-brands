// Back-compat shim: the arena moved to singleShot.ts and gained the BuyerArena seam.
export { SingleShotArena } from "./singleShot.ts";
export { SingleShotArena as Arena } from "./singleShot.ts";
export type { ArenaInput, MatchResult, BuyerArena } from "./types.ts";
