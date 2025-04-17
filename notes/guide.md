# Deebo Development Guide

## NPX Commands

### 1. Installation and Health Check

Deebo provides two NPX commands:

1. **deebo-setup**: Installs and configures Deebo
   ```bash
   npx deebo-setup
   ```
   - Checks prerequisites (Node.js, git)
   - Finds Cline/Claude Desktop configs
   - Gets LLM host preference and API key
   - Creates ~/.deebo directory
   - Clones repository and builds project
   - Creates environment file
   - Updates MCP configurations

2. **deebo-doctor**: Verifies installation and configuration
   ```bash
   npx deebo-doctor        # Basic health check
   npx deebo-doctor --verbose  # Detailed check with paths
   ```
   - Checks Node.js version
   - Verifies git installation
   - Checks tool paths (npx, uvx)
   - Verifies MCP tools
   - Validates configuration files
   - Checks API keys

## Publishing and Testing

### 1. Updating the NPX Commands

Both `npx deebo-setup` and `npx deebo-doctor` pull from the npm registry. To update either:

1. **Update Version**
   ```bash
   # In package.json
   {
     "version": "1.0.1" // Increment version number
   }
   ```

2. **Build and Test**
   ```bash
   npm run build
   # Test changes locally
   ```

3. **Publish**
   ```bash
   npm login      # If not already logged in
   npm publish    # Publishes to npm registry
   ```

4. **Users Update**
   Users can get the new version by running:
   ```bash
   npx deebo-setup@latest
   ```

### 2. Testing Local Changes

When developing Deebo, you'll have two versions:
- System installation (`~/.deebo`): The stable version from npm
- Local repository: Your development version

To test local changes without publishing:

1. **Build Local Changes**
   ```bash
   cd /path/to/deebo-prototype
   npm run build
   npm link     # Makes package available globally
   ```

2. **Update MCP Configuration**
   Edit your Cline/Claude config to point to your local build:
   ```json
   {
     "mcpServers": {
       "deebo": {
         "args": [
           "--experimental-specifier-resolution=node",
           "--experimental-modules",
           "--max-old-space-size=4096",
           "/Users/sriram/Documents/Cline/MCP/deebo-prototype/build/index.js"
         ]
       }
     }
   }
   ```

3. **Switch Back to System Version**
   To revert to the stable version:
   - Update the path in MCP config back to `~/.deebo/build/index.js`
   - Restart your MCP client

### Tips
- Keep the system installation (`~/.deebo`) as your stable version
- Use local repository for development and testing
- Always test changes locally before publishing
- Consider using semantic versioning for releases
