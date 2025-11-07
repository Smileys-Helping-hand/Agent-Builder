import { diffLines, type Change } from "diff";

export type DiffSegment = {
  value: string;
  added?: boolean;
  removed?: boolean;
};

export const createDiff = (original: string, updated: string): DiffSegment[] => {
  return diffLines(original, updated).map((part: Change) => ({
    value: part.value ?? "",
    added: part.added,
    removed: part.removed
  }));
};
