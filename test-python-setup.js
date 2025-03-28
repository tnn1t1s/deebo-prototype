import { PythonPathResolver } from './build/util/python-path-resolver.js';
import { homedir } from 'os';
import * as path from 'path';

async function testPythonSetup() {
  try {
    const infrastructureRoot = path.join(homedir(), '.local', 'share', 'deebo-prototype');
    const resolver = await PythonPathResolver.getInstance(infrastructureRoot);
    
    console.log('Testing Python configuration...');
    await resolver.validate();
    
    console.log('\nConfiguration validated successfully!');
    console.log('Interpreter Path:', resolver.getInterpreterPath());
    console.log('Venv Path:', resolver.getVenvPath());
    console.log('Git MCP Version:', resolver.getGitMcpVersion());
    
    const env = resolver.getEnv();
    console.log('\nEnvironment Variables:');
    console.log('VIRTUAL_ENV:', env['VIRTUAL_ENV']);
    console.log('PATH:', env['PATH']);
    console.log('PYTHONUNBUFFERED:', env['PYTHONUNBUFFERED']);
    console.log('DEEBO_PYTHON_VERSION:', env['DEEBO_PYTHON_VERSION']);
  } catch (error) {
    console.error('Validation failed:', error);
    process.exit(1);
  }
}

testPythonSetup();
