/**
 * BuildContext — lets anything a build calls report what it is doing, without
 * passing the build around.
 *
 * BuildService runs each build inside buildScope.run({ buildId }). Node carries
 * that through every await, so when the model router is streaming an answer or
 * the Verifier starts a check, it can ask "which build is this for?" and say so.
 * Outside a build (a repair from the Projects screen, a test) there is no scope
 * and the reports are simply dropped.
 */
import { AsyncLocalStorage } from "async_hooks";
import { EventEmitter } from "events";

export interface BuildScope {
  buildId: string;
  /** What the build is doing right now, in words: "writing the code", "fixing typecheck". */
  phase?: string;
}

export const buildScope = new AsyncLocalStorage<BuildScope>();

/**
 * "step"     { buildId, text, kind, at } — a line for the build's activity log.
 * "thinking" { buildId, phase, model, tail, chars, tokensPerSecond, done, at }
 *            — the model's answer as it is being written.
 * "check"    { buildId, name, state: "running" | "passed" | "failed" | "skipped", at }
 */
export const buildActivity = new EventEmitter();
buildActivity.setMaxListeners(20);

export type StepKind = "info" | "good" | "bad" | "model";

export const currentBuild = (): BuildScope | undefined => buildScope.getStore();

/** Add a line to the current build's activity log. */
export const reportStep = (text: string, kind: StepKind = "info"): void => {
  const scope = currentBuild();
  if (scope) buildActivity.emit("step", { buildId: scope.buildId, text, kind, at: new Date().toISOString() });
};

/** Say what the build is doing now; also logged as a step. */
export const setPhase = (phase: string): void => {
  const scope = currentBuild();
  if (!scope) return;
  scope.phase = phase;
  reportStep(phase);
};

export const reportCheck = (name: string, state: "running" | "passed" | "failed" | "skipped"): void => {
  const scope = currentBuild();
  if (scope) buildActivity.emit("check", { buildId: scope.buildId, name, state, at: new Date().toISOString() });
};
