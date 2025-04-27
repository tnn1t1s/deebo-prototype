// src/util/membank.js
import { join } from 'path';
import { writeFile } from 'fs/promises';
import { DEEBO_ROOT } from '../index.js';
export async function updateMemoryBank(projectId, content, file) {
    const path = join(DEEBO_ROOT, 'memory-bank', projectId, `${file}.md`);
    await writeFile(path, '\n' + content, { flag: 'a' });
}
