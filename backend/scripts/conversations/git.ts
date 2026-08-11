import { execFileSync } from "node:child_process";

export interface GitRevision {
  hash: string;
  dirty: boolean;
}

export function gitRevision(): GitRevision | undefined {
  try {
    const hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    if (hash.length === 0) return undefined;
    const porcelain = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
    return { hash, dirty: porcelain.length > 0 };
  } catch {
    return undefined;
  }
}

export function formatGitRevision(revision: GitRevision | undefined): string {
  if (revision === undefined) return "unknown";
  return revision.dirty ? `${revision.hash}-dirty` : revision.hash;
}
