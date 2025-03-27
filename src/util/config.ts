import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function loadConfig() {
  try {
    // Dynamic import of dotenv
    const dotenvModule = await import('dotenv');
    
    // Load .env from project root (two levels up from util/)
    const rootDir = dirname(dirname(__dirname));
    const result = dotenvModule.default.config({ path: join(rootDir, '.env') });
    
    if (result.error) {
      throw result.error;
    }

    return {
      serverName: process.env.SERVER_NAME || "deebo-prototype",
      serverVersion: process.env.SERVER_VERSION || "0.1.0",
      deeboRoot: process.env.DEEBO_ROOT || rootDir
    };
  } catch (error) {
    // If .env doesn't exist, return defaults
    return {
      serverName: "deebo-prototype",
      serverVersion: "0.1.0",
      deeboRoot: dirname(dirname(__dirname))
    };
  }
}
