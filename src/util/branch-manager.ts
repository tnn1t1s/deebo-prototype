// src/util/branch-manager.ts
import { simpleGit } from 'simple-git';

// note: second parameter is `scenarioId`
export async function createScenarioBranch(repoPath: string, scenarioId: string): Promise<string> {
  const git = simpleGit(repoPath);
  const branchName = `debug-${scenarioId}`;  // e.g. debug-session-1745287764331-0
  await git.checkoutLocalBranch(branchName);
  return branchName;
}