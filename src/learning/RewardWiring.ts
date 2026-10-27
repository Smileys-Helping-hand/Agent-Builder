/**
 * Rewards that arrive by themselves, from what actually happened.
 *
 *   build.approach  a finished build: its best score / 100, +0.1 if it passed.
 *                   A build that failed for the PC's sake (model server down,
 *                   game mode, stopped) is not counted against its approach.
 *
 * (lesson.style is rewarded by the learner's first quiz score in
 * StudyCourse.grade; chat.style and lessons by 👍/👎 in the app and from Jarvis.)
 */
import { buildEvents, type BuildRecord } from "../orchestrator/BuildService.js";
import { Logger } from "../utils/Logger.js";
import { Reinforcement } from "./Reinforcement.js";

/** Failures that say nothing about how the build was approached. */
const NOT_THE_APPROACH = /model server|ECONN|fetch failed|socket|game mode|stopped|cancel|aborted|out of memory|GPU|ollama/i;

let started = false;

const rewardBuild = (record: BuildRecord, failedWith?: string) => {
  const episode = Reinforcement.episodeFor("build.approach", `build:${record.buildId}`);
  if (!episode || episode.reward !== null) return;
  if (failedWith && NOT_THE_APPROACH.test(failedWith)) return;
  const score = Math.max(0, Math.min(100, record.bestScore ?? 0)) / 100;
  const value = Math.round(Math.min(1, score + (record.passed ? 0.1 : 0)) * 1000) / 1000;
  Reinforcement.reward(episode.id, value, "build-outcome", `score ${Math.round(score * 100)}${record.passed ? ", passed" : ""}`);
  Logger.log("Build approach rewarded", { buildId: record.buildId, arm: episode.arm, reward: value });
};

export const RewardWiring = {
  start() {
    if (started) return;
    started = true;
    buildEvents.on("completed", (record: BuildRecord) => rewardBuild(record));
    buildEvents.on("failed", (record: BuildRecord) => rewardBuild(record, record.error ?? "failed"));
  }
};
