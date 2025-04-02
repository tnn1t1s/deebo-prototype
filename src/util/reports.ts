import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';
import { getProjectId } from './sanitize.js';

// src/util/reports.ts
//we changed it to text to make check tool work better 
export async function writeReport(repoPath: string, sessionId: string, scenarioId: string, report: string) {
    const projectId = getProjectId(repoPath);
    const reportDir = join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'reports');
    await mkdir(reportDir, { recursive: true });
    const reportPath = join(reportDir, `${scenarioId}.txt`); // .txt not .json
    await writeFile(reportPath, report); // Raw string, no JSON
}
