/** Domain layer — queries, stores, and types per feature (Multica `packages/core` layout). */
export { localApi, subscribeLocalEvent, type LocalApi, type LocalApiEventChannel } from "./api/localApi";
export { deriveAutopilots, describeCadence, type Autopilot, type AutopilotLastRun } from "./autopilots";
export {
  deriveSquads,
  deriveSquadPresence,
  suggestSquadRanks,
  type Squad,
  type SquadPresence,
  type SquadRankAssignment,
} from "./squads";
export {
  mergeSkillCatalog,
  normalizeSkillTitle,
  type InstalledSkill,
  type SkillCatalogEntry,
  type SkillOrigin,
} from "./skills";
