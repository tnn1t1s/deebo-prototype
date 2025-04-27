// src/util/sanitize.ts
import { createHash } from 'crypto';
export function getProjectId(repoPath) {
    const hash = createHash('sha256').update(repoPath).digest('hex');
    return hash.slice(0, 12); // use first 12 characters
}
