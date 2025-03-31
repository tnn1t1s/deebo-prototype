import { simpleGit } from 'simple-git';

export async function createScenarioBranch(repoPath: string, sessionId: string): Promise<string> {
  const git = simpleGit(repoPath);
  const branchName = `debug-${sessionId}-${Date.now()}`;
  
  await git.checkoutLocalBranch(branchName);
  return branchName;
}
