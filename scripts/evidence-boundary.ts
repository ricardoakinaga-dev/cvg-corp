import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Promotion evidence is produced by an external runner or authority. A
 * directory inside the source checkout can be edited by the candidate itself
 * and therefore cannot be accepted as external evidence, even when each file
 * has a matching digest.
 */
export async function requireExternalEvidenceRoot(candidate: string, sourceRoot: string): Promise<string> {
  const candidatePath = resolve(candidate);
  const sourcePath = await realpath(resolve(sourceRoot));
  const candidateStats = await lstat(candidatePath);
  if (candidateStats.isSymbolicLink() || !candidateStats.isDirectory()) throw new Error("evidence root must be a regular directory");
  const canonicalCandidate = await realpath(candidatePath);
  const outside = relative(sourcePath, canonicalCandidate);
  if (!outside || (!outside.startsWith("..") && !isAbsolute(outside))) throw new Error("evidence root must be outside the source worktree");
  return canonicalCandidate;
}
