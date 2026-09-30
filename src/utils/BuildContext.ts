/**
 * BuildContext — lets code a build calls say which build it is serving,
 * without passing the build around.
 *
 * BuildService runs each build inside buildScope.run({ buildId, phase }). Node
 * carries that through every await, so when ModelRouter streams an answer it
 * can ask "which build is this for?" and report the text as it is written.
 * Outside a build (a repair from the Projects screen, a test) there is no scope
 * and nothing is reported.
 */
import { AsyncLocalStorage } from "async_hooks";
import { EventEmitter } from "events";

export interface BuildScope {
  buildId: string;
  /** What the build is doing right now, in words: "Writing code (pass 2)". BuildService keeps it current. */
  phase?: string;
}

export const buildScope = new AsyncLocalStorage<BuildScope>();

/**
 * "thinking" { buildId, phase, model, tail, chars, tokensPerSecond, done, at }
 *            — the model's answer as it is being written (see BuildService's LiveWriting).
 */
export const buildActivity = new EventEmitter();
buildActivity.setMaxListeners(20);

export const currentBuild = (): BuildScope | undefined => buildScope.getStore();
