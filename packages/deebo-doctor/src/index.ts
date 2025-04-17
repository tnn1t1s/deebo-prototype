#!/usr/bin/env node
import { homedir } from 'os';
import { join } from 'path';
import chalk from 'chalk';
import { allChecks } from './checks.js';
import { DoctorConfig } from './types.js';

async function main() {
  // Parse arguments
  const verbose = process.argv.includes('--verbose');
  const deeboPath = join(homedir(), '.deebo');
  const logPath = verbose ? join(deeboPath, 'doctor.log') : undefined;

  const config: DoctorConfig = {
    verbose,
    deeboPath,
    logPath
  };

  console.log(chalk.bold('\nDeebo Doctor - System Health Check\n'));

  // Run all checks
  let allPassed = true;
  for (const check of allChecks) {
    try {
      const result = await check.check(config);
      
      // Print result
      const icon = result.status === 'pass' ? '✔' : result.status === 'warn' ? '⚠' : '✖';
      const color = result.status === 'pass' ? chalk.green : result.status === 'warn' ? chalk.yellow : chalk.red;
      
      console.log(color(`${icon} ${result.name}: ${result.message}`));
      
      if (verbose && result.details) {
        console.log(chalk.dim(result.details));
      }

      if (result.status === 'fail') {
        allPassed = false;
      }
    } catch (err) {
      console.error(chalk.red(`✖ ${check.name}: Error running check`));
      if (verbose) {
        console.error(chalk.dim(err));
      }
      allPassed = false;
    }
  }

  // Print summary
  console.log('\n' + (allPassed 
    ? chalk.green('✔ All checks passed!')
    : chalk.red('✖ Some checks failed. Run with --verbose for more details.')));

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(chalk.red('\n✖ Error running doctor:'), err);
  process.exit(1);
});
