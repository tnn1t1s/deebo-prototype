// src/util/membank.js
import { join } from 'path';
import { writeFile } from 'fs/promises';
import { DEEBO_ROOT } from '../index.js';

export async function updateMemoryBank(projectId: string, content: string, file: 'activeContext' | 'progress'): Promise<void> {
  const path = join(DEEBO_ROOT, 'memory-bank', projectId, `${file}.md`);
  await writeFile(path, content, { flag: 'a' });
}