import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';
import { getProjectId } from './sanitize.js';
// src/util/reports.ts
//we changed it to text to make check tool work better then changed it back to json
// after removing validation.ts which was blocking access to memory bank files 
// but really inelegantly so i took it out but i might have not reverted all the 
// changes so there's probably that if you're still getting bugs
export async function writeReport(repoPath, sessionId, scenarioId, report) {
    const projectId = getProjectId(repoPath);
    const reportDir = join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'reports');
    await mkdir(reportDir, { recursive: true });
    const reportPath = join(reportDir, `${scenarioId}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2));
}
