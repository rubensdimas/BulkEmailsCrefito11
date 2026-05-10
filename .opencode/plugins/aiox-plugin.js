/**
 * AIOX Opencode Plugin
 * 
 * Ported from .gemini/hooks/
 * Integrates AIOX framework with Opencode CLI.
 */

const fs = require('fs');
const path = require('path');

// Constants
const SESSION_DIR = path.join(process.cwd(), '.aiox-core', '.session');
const SESSION_FILE = path.join(SESSION_DIR, 'current-session.json');
const MAX_HISTORY_LENGTH = 10;

// Helper to detect project type
function detectProjectType(projectDir) {
  const packageJsonPath = path.join(projectDir, 'package.json');

  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (pkg.dependencies?.next || pkg.devDependencies?.next) return 'nextjs';
      if (pkg.dependencies?.react || pkg.devDependencies?.react) return 'react';
      if (pkg.dependencies?.express) return 'express';
      if (pkg.dependencies?.['@nestjs/core']) return 'nestjs';
      return 'node';
    } catch {
      return 'node';
    }
  }

  if (fs.existsSync(path.join(projectDir, 'requirements.txt'))) return 'python';
  if (fs.existsSync(path.join(projectDir, 'Cargo.toml'))) return 'rust';
  if (fs.existsSync(path.join(projectDir, 'go.mod'))) return 'go';

  return 'unknown';
}

// Patterns to block
const BLOCKED_PATTERNS = [
  /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
  /password\s*[:=]\s*['"][^'"]+['"]/i,
  /secret\s*[:=]\s*['"][^'"]+['"]/i,
  /AKIA[0-9A-Z]{16}/i, // AWS key
  /ghp_[a-zA-Z0-9]{36}/, // GitHub token
  /sk-[a-zA-Z0-9]{48}/, // OpenAI key
];

// Dangerous commands
const DANGEROUS_COMMANDS = [
  'rm -rf /',
  'rm -rf ~',
  'rm -rf *',
  'git push --force',
  'git reset --hard',
  'DROP DATABASE',
  'DROP TABLE',
];

/**
 * Session Management (Ported from command-execution-hook.js)
 */
async function updateSession(agentId, commandName, options = {}) {
  try {
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    let session = {
      sessionType: 'new',
      commandHistory: [],
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };

    if (fs.existsSync(SESSION_FILE)) {
      try {
        session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      } catch (e) {}
    }

    const commandEntry = {
      command: commandName,
      agent: agentId,
      timestamp: Date.now(),
      success: options.success !== false,
    };

    session.commandHistory = session.commandHistory || [];
    session.commandHistory.push(commandEntry);

    if (session.commandHistory.length > MAX_HISTORY_LENGTH) {
      session.commandHistory = session.commandHistory.slice(-MAX_HISTORY_LENGTH);
    }

    // Determine session type
    if (session.commandHistory.length >= 3) {
      session.sessionType = 'workflow';
    } else if (session.commandHistory.length >= 1) {
      session.sessionType = 'existing';
    }

    session.currentAgent = agentId;
    session.lastUpdated = Date.now();

    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf8');
    return session;
  } catch (error) {
    console.warn('[AIOX] Failed to update session:', error.message);
  }
}

/**
 * Handle Rewind (Ported from rewind-handler.js)
 * Since Opencode resets context on compaction/rewind, we clean up AIOX state.
 */
function handleRewind(projectDir, sessionId) {
  try {
    const memoryDir = path.join(projectDir, '.aiox', 'memory');
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
    const sessionMemory = path.join(memoryDir, `session-${safeSessionId}.json`);

    if (fs.existsSync(sessionMemory)) {
      fs.unlinkSync(sessionMemory);
      console.log(`[AIOX] Session memory cleared for rewind: ${safeSessionId}`);
    }
  } catch (error) {
    // Non-critical
  }
}

/**
 * Log tool execution
 */
function logToolResult(projectDir, tool, result, sessionId) {
  try {
    const logDir = path.join(projectDir, '.aiox', 'logs');

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      tool,
      success: result.success !== false,
      provider: 'opencode',
      sessionId: sessionId,
    };

    const logPath = path.join(logDir, 'tool-results.jsonl');
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
  } catch (error) {
    // Non-critical
  }
}

/**
 * Track file modifications
 */
function trackFileModification(projectDir, filePath) {
  if (!filePath) return;

  try {
    const trackPath = path.join(projectDir, '.aiox', 'session-files.json');

    let files = [];
    if (fs.existsSync(trackPath)) {
      files = JSON.parse(fs.readFileSync(trackPath, 'utf8'));
    }

    if (!files.includes(filePath)) {
      files.push(filePath);
      fs.writeFileSync(trackPath, JSON.stringify(files, null, 2));
    }
  } catch (error) {
    // Non-critical
  }
}

/**
 * Load Dynamic Context
 */
function loadDynamicContext(projectDir) {
  const context = {
    gotchas: [],
    patterns: [],
    conventions: '',
  };

  try {
    const gotchasPath = path.join(projectDir, '.aiox', 'gotchas.json');
    if (fs.existsSync(gotchasPath)) {
      const gotchas = JSON.parse(fs.readFileSync(gotchasPath, 'utf8'));
      context.gotchas = gotchas.slice(0, 5);
    }
  } catch (e) {}

  try {
    const codebaseMapPath = path.join(projectDir, '.aiox', 'codebase-map.json');
    if (fs.existsSync(codebaseMapPath)) {
      const map = JSON.parse(fs.readFileSync(codebaseMapPath, 'utf8'));
      if (map.patterns) context.patterns = map.patterns.slice(0, 5);
    }
  } catch (e) {}

  try {
    const claudeMdPath = path.join(projectDir, '.claude', 'CLAUDE.md');
    if (fs.existsSync(claudeMdPath)) {
      const content = fs.readFileSync(claudeMdPath, 'utf8');
      const match = content.match(/## (?:Code Standards|Conventions)([\s\S]*?)(?=##|$)/i);
      if (match) context.conventions = match[1].trim().slice(0, 500);
    }
  } catch (e) {}

  return context;
}

/**
 * Plugin Entry Point
 */
export const AIOXPlugin = async ({ project, client, $, directory, worktree }) => {
  const projectDir = directory || process.cwd();
  const sessionId = `opencode-${Date.now()}`;
  const projectType = detectProjectType(projectDir);

  console.log(`[AIOX] Plugin initialized for project type: ${projectType}`);

  return {
    "shell.env": async (input, output) => {
      output.env.AIOX_VERSION = '3.0';
      output.env.AIOX_SESSION_ID = sessionId;
      output.env.AIOX_PROJECT_TYPE = projectType;
      output.env.AIOX_PROVIDER = 'opencode';
    },

    "tool.execute.before": async (input, output) => {
      const toolName = input.tool || '';
      const toolArgs = output.args || {};

      if (toolName === 'write_file' || toolName === 'replace' || toolName === 'edit') {
        const content = toolArgs.content || toolArgs.new_content || toolArgs.new_string || '';
        for (const pattern of BLOCKED_PATTERNS) {
          if (pattern.test(content)) {
            throw new Error('Blocked: Potential secret or credential detected in content');
          }
        }
      }

      if (toolName === 'shell' || toolName === 'bash' || toolName === 'run_shell_command') {
        const command = toolArgs.command || '';
        for (const dangerous of DANGEROUS_COMMANDS) {
          if (command.toLowerCase().includes(dangerous.toLowerCase())) {
            throw new Error(`Blocked: Dangerous command detected: ${dangerous}`);
          }
        }
      }
    },

    "tool.execute.after": async (input, output) => {
      const toolName = input.tool || '';
      const toolResult = output.result || {};
      
      // Update AIOX session
      await updateSession('opencode-agent', toolName, { success: toolResult.success !== false });

      // Log execution result
      logToolResult(projectDir, toolName, toolResult, sessionId);
      
      // Track file modifications
      if (['write_file', 'replace', 'edit', 'write'].includes(toolName)) {
        trackFileModification(projectDir, input.args?.path || input.args?.file_path);
      }
    },

    "experimental.session.compacting": async (input, output) => {
       const dynContext = loadDynamicContext(projectDir);
       
       // If the compaction is triggered by a reset/rewind logic (context management)
       // we ensure memory is in sync.
       handleRewind(projectDir, sessionId);

       output.context.push(`
## AIOX Session State
- Session ID: ${sessionId}
- Project Type: ${projectType}
- Provider: Opencode

## AIOX Intelligence (Dynamic)
### Recent Gotchas
${dynContext.gotchas.map(g => `- ${g.title}: ${g.description}`).join('\n') || 'None detected yet.'}

### Detected Patterns
${dynContext.patterns.map(p => `- ${p.name}: ${p.description}`).join('\n') || 'Generic project structure.'}

### Project Conventions
${dynContext.conventions || 'Follow standard professional engineering practices.'}
`);
    }
  };
};
