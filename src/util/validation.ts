// src/util/validation.ts
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';

export function validateMemoryBankAccess(agentName: string, path: string): string {
  const memoryBankRoot = join(DEEBO_ROOT, 'memory-bank');
  if (agentName.startsWith('scenario-') && path.startsWith(memoryBankRoot)) {
    throw new Error('Access denied: Scenario agents are not permitted to access memory bank files.');
  }
  return path;
}