import { getProjectId } from '../build/util/sanitize.js';

const fixture = process.argv[2];
if (!fixture) {
  console.error('Please provide the fixture path as an argument');
  process.exit(1);
}

console.log(await getProjectId(fixture));
