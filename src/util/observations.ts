import { writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';
import { getProjectId } from './sanitize.js';

export async function getAgentObservations(repoPath: string, sessionId: string, agentId: string): Promise<string[]> {
  const projectId = getProjectId(repoPath);
  const obsPath = join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'observations', `${agentId}.log`);
  
  try {
    const content = await readFile(obsPath, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line: string) => JSON.parse(line).observation);
  } catch {
    return []; // No observations yet
  }
}

export async function writeObservation(repoPath: string, sessionId: string, agentId: string, observation: string) {
  const projectId = getProjectId(repoPath);
  const obsDir = join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'observations');
  await mkdir(obsDir, { recursive: true });
  
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    observation
  }) + '\n';
  
  await writeFile(join(obsDir, `${agentId}.log`), entry, { flag: 'a' });
}
