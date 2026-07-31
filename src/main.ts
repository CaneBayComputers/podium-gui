import { app, BrowserWindow, ipcMain, dialog, IpcMainInvokeEvent, Menu, shell } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

// Debug log file path
const debugLogPath: string = path.join(os.tmpdir(), 'podium-gui-debug.log');

// Debug logging function
function debugLog(message: string, data: any = null): void {
  const timestamp: string = new Date().toISOString();
  const logEntry: string = `[${timestamp}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;
  
  // Console log for immediate viewing
  console.log(message, data || '');
  
  // Only write to file if in debug mode (--dev flag)
  if (process.argv.includes('--dev')) {
    try {
      // Overwrite file each time (not append)
      if (!fs.existsSync(debugLogPath)) {
        fs.writeFileSync(debugLogPath, '=== PODIUM GUI DEBUG LOG ===\n');
      }
      fs.appendFileSync(debugLogPath, logEntry);
    } catch (error) {
      console.error('Failed to write debug log:', error);
    }
  }
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // Clear debug log at startup
  if (process.argv.includes('--dev')) {
    try {
      fs.writeFileSync(debugLogPath, '=== PODIUM GUI DEBUG LOG ===\n');
      debugLog('Debug logging initialized', { logPath: debugLogPath });
    } catch (error) {
      console.error('Failed to initialize debug log:', error);
    }
  }

  mainWindow = new BrowserWindow({
    width: 2000,
    height: 1200,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      additionalArguments: process.argv.includes('--dev') ? ['--debug-mode'] : []
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    title: 'Podium - PHP Development Platform'
  });

  // Set up custom application menu
  const template: any[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow?.webContents.executeJavaScript('createNewProject()');
          }
        },
        {
          label: 'Clone Project',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            mainWindow?.webContents.executeJavaScript('cloneProject()');
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectall' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            mainWindow?.webContents.executeJavaScript('openAboutModal()');
          }
        },
        { type: 'separator' },
        {
          label: 'Patreon',
          click: () => {
            shell.openExternal('https://patreon.com/canebaycomputers');
          }
        },
        {
          label: 'Donate',
          click: () => {
            shell.openExternal('https://securelink-prod.valorpaytech.com:4430/?redirect=1&uid=6e840752-8751-11f0-a74f-12a0879a85b1');
          }
        }
      ]
    }
  ];

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideothers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });

    // Window menu
    template[5].submenu = [
      { role: 'close' },
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' }
    ];
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Check if Podium CLI is installed and configured
  const podiumStatus: string = checkPodiumStatus();
  debugLog('Podium status check result', { status: podiumStatus });
  
  if (podiumStatus === 'not-installed') {
    debugLog('Loading installer.html - Podium not installed');
    mainWindow.loadFile('../src/installer.html');
  } else if (podiumStatus === 'not-configured') {
    debugLog('Loading installer.html - Podium not configured');
    mainWindow.loadFile('../src/installer.html');
  } else {
    debugLog('Loading index.html - Podium ready');
    mainWindow.loadFile('../src/index.html');
  }

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

type PodiumStatus = 'configured' | 'not-configured' | 'not-installed';

// Podium's machine-wide config. Written by `podium configure`; the CLI reads it
// from this fixed path, so there is nothing to search for.
const PODIUM_ENV_PATH = '/etc/podium-cli/.env';

// Installed location of the CLI itself. Only used as a fallback when `podium`
// is not on PATH.
const PODIUM_CLI_DIR = '/usr/local/share/podium-cli';

// Read a single KEY=value out of Podium's config. Returns null when the file is
// absent, the key is missing, or the value is empty.
function readEnvValue(key: string): string | null {
  try {
    if (!fs.existsSync(PODIUM_ENV_PATH)) return null;

    const match = fs.readFileSync(PODIUM_ENV_PATH, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';

    return value === '' ? null : value;
  } catch (error) {
    debugLog('Failed to read Podium config', { key, error: (error as Error).message });
    return null;
  }
}

function checkPodiumStatus(): PodiumStatus {
  try {
    // Check if podium command exists in PATH
    execSync('podium help --no-colors', { stdio: 'pipe' });

    // Installed. Configured means the env file exists AND names a projects
    // directory — `podium configure` writes PROJECTS_DIR, and every project
    // command depends on it.
    if (!fs.existsSync(PODIUM_ENV_PATH)) {
      return 'not-configured';
    }

    return readEnvValue('PROJECTS_DIR') !== null ? 'configured' : 'not-configured';
  } catch (error) {
    return 'not-installed';
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', (): void => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', (): void => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handler for renderer console messages
ipcMain.handle('renderer-log', async (event: IpcMainInvokeEvent, ...args: any[]): Promise<void> => {
  console.log('🔥 RENDERER LOG:', ...args);
  debugLog('RENDERER LOG', args);
});

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

// IPC handlers for communicating with Podium CLI
ipcMain.handle('execute-podium-script', async (event: IpcMainInvokeEvent, scriptName: string, args: string[] = []): Promise<CommandResult> => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(PODIUM_CLI_DIR)) {
      reject(new Error('Podium CLI not found'));
      return;
    }

    // Scripts live under src/scripts/, not scripts/.
    const scriptPath: string = path.join(PODIUM_CLI_DIR, 'src', 'scripts', scriptName);

    const childProcess: ChildProcess = spawn('bash', [scriptPath, ...args], {
      cwd: PODIUM_CLI_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' }
    });

    let stdout: string = '';
    let stderr: string = '';

    childProcess.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code: number | null) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });

    childProcess.on('error', (error: Error) => {
      reject(error);
    });
  });
});

// New handler for podium command
// Function to refresh sudo timestamp for operations that need it
async function refreshSudoTimestamp(): Promise<boolean> {
  return new Promise((resolve) => {
    debugLog('Refreshing sudo timestamp for hosts file modification');
    
    const childProcess: ChildProcess = spawn('sudo', ['-v'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    childProcess.on('close', (code: number) => {
      if (code === 0) {
        debugLog('Sudo timestamp refreshed successfully');
        resolve(true);
      } else {
        debugLog('Failed to refresh sudo timestamp', { exitCode: code });
        resolve(false);
      }
    });
    
    childProcess.on('error', (error: Error) => {
      debugLog('Error refreshing sudo timestamp', error);
      resolve(false);
    });
  });
}

ipcMain.handle('execute-podium', async (event: IpcMainInvokeEvent, subcommand: string, args: string[] = []): Promise<CommandResult> => {
  return new Promise(async (resolve, reject) => {
    // Commands that modify hosts file need sudo timestamp. `install` runs
    // `podium setup` + `podium up` internally, so it needs one too.
    const sudoCommands = ['new', 'clone', 'setup', 'install'];
    if (sudoCommands.includes(subcommand)) {
      debugLog(`Command '${subcommand}' requires sudo, refreshing timestamp`);
      const sudoSuccess = await refreshSudoTimestamp();
      if (!sudoSuccess) {
        resolve({
          code: 1,
          stdout: '',
          stderr: 'Failed to authenticate for hosts file modification. Please run the command from terminal.'
        });
        return;
      }
    }
    
    // Callers own their flags. `--json-output` is NOT added here: it suppresses
    // all human-readable output including error text, so a command can fail with
    // an empty stdout. Only pass it where the caller actually parses JSON, and
    // always judge success by the exit code.
    const allArgs: string[] = [subcommand, ...args];

    // Collect a spawned process into a CommandResult. Listeners are attached to
    // the process that is actually running — the previous version re-assigned
    // the variable in the fallback path and left the listeners on the dead one,
    // so the fallback never resolved.
    const run = (command: string, commandArgs: string[]): ChildProcess => {
      const child: ChildProcess = spawn(command, commandArgs, {
        cwd: os.homedir(), // Run from user's home directory
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' }
      });

      let stdout: string = '';
      let stderr: string = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code: number | null) => {
        debugLog('Podium command finished', { subcommand, args, code });
        resolve({ code: code ?? 1, stdout, stderr });
      });

      return child;
    };

    // Try the global podium command first, then fall back to the installed copy.
    const primary: ChildProcess = run('podium', allArgs);

    primary.on('error', () => {
      const podiumPath: string = path.join(PODIUM_CLI_DIR, 'src', 'podium');
      if (!fs.existsSync(podiumPath)) {
        reject(new Error('Podium CLI not found'));
        return;
      }

      const fallback: ChildProcess = run('bash', [podiumPath, ...allArgs]);
      fallback.on('error', (error: Error) => reject(error));
    });
  });
});

interface CatalogApp {
  slug: string;
  display: string;
  database: string;
  note: string;
}

// The app catalogue is generated by the CLI from its installers
// (src/scripts/build_catalog.sh), so it is read at runtime rather than
// duplicated here — a hardcoded copy would rot on every installer change.
ipcMain.handle('get-app-catalog', async (): Promise<{ apps: CatalogApp[]; error?: string }> => {
  const catalogPath = path.join(PODIUM_CLI_DIR, 'src', 'catalog', 'apps.json');

  try {
    if (!fs.existsSync(catalogPath)) {
      return { apps: [], error: `App catalogue not found at ${catalogPath}` };
    }

    const parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const apps: CatalogApp[] = (parsed.apps ?? []).map((app: any) => ({
      slug: app.slug ?? '',
      display: app.display ?? app.slug ?? '',
      // Empty database means the app manages its own storage internally.
      database: app.database ?? '',
      note: app.note ?? ''
    })).filter((app: CatalogApp) => app.slug !== '');

    debugLog('Loaded app catalogue', { count: apps.length });
    return { apps };
  } catch (error) {
    debugLog('Failed to read app catalogue', { error: (error as Error).message });
    return { apps: [], error: (error as Error).message };
  }
});

// MinIO and Meilisearch are OPTIONAL shared services, off unless enabled per
// machine with `podium enable-service`. `podium status` reports them as
// "stopped" either way, which in the UI reads as "a service is down" rather
// than "you never turned this on" — so the GUI filters them by what is actually
// enabled in OPTIONAL_SERVICES.
ipcMain.handle('get-optional-services', async (): Promise<string[]> => {
  const raw = readEnvValue('OPTIONAL_SERVICES');
  if (!raw) return [];

  return raw
    .split(/[\s,]+/)
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');
});

// Installing writes to /etc/hosts (via setup + up), so the renderer asks for a
// sudo timestamp before starting the streamed command.
ipcMain.handle('ensure-sudo', async (): Promise<boolean> => {
  return refreshSudoTimestamp();
});

interface ProjectStatusResult {
  error?: string;
}

ipcMain.handle('get-project-status', async (): Promise<ProjectStatusResult> => {
  try {
    const result = await ipcMain.emit('execute-podium-script', null, 'status.sh');
    return { error: 'Not implemented' }; // This function needs proper implementation
  } catch (error) {
    return { error: (error as Error).message };
  }
});

ipcMain.handle('select-podium-directory', async (): Promise<string | null> => {
  if (!mainWindow) return null;
  
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Podium CLI Directory'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0] || null;
  }
  
  return null;
});

interface ExecuteCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  [key: string]: any;
}

// Execute arbitrary commands (needed for Docker checks, etc.)
ipcMain.handle('execute-command', async (event: IpcMainInvokeEvent, command: string, args: string[] = [], options: ExecuteCommandOptions = {}): Promise<CommandResult> => {
  return new Promise((resolve, reject) => {
    debugLog('Executing command', { command, args, options });
    
    const process: ChildProcess = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options
    });

    let stdout: string = '';
    let stderr: string = '';

    process.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    process.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    process.on('close', (code: number | null) => {
      const result: CommandResult = { code: code ?? 1, stdout, stderr };
      debugLog('Command completed', { command, result });
      resolve(result);
    });

    process.on('error', (error: Error) => {
      debugLog('Command error', { command, error: error.message });
      reject(error);
    });
  });
});

interface StreamCommandResult {
  success: boolean;
  code: number;
  exitCode: number;
  stdout: string;
  stderr: string;
}

ipcMain.handle('execute-command-stream', async (event: IpcMainInvokeEvent, command: string, args: string[] = [], options: ExecuteCommandOptions = {}): Promise<StreamCommandResult> => {
  return new Promise((resolve, reject) => {
    debugLog('Executing command stream', { command, args, options });
    
    // Create temp file for progress tracking
    const tempFile = `/tmp/podium-progress-${Date.now()}.log`;
    
    const childProcess: ChildProcess = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
      ...options
    });

    let stdout: string = '';
    let stderr: string = '';
    let progressBuffer: string = '';

    // Stream stdout data to renderer in real-time
    childProcess.stdout?.on('data', (data: Buffer) => {
      const output: string = data.toString('utf8');
      stdout += output;
      progressBuffer += output;
      
      console.log('STDOUT:', output);
      debugLog('Command stdout', { command, output });
      
      // Write raw output to temp file for progress parsing
      require('fs').appendFileSync(tempFile, output);
      
      // Parse Docker progress from buffer
      const progressInfo = parseDockerProgress(progressBuffer);
      if (progressInfo) {
        event.sender.send('command-stream-progress', {
          command: command,
          progress: progressInfo
        });
        // Clear processed lines from buffer
        progressBuffer = progressBuffer.split('\n').slice(-5).join('\n'); // Keep last 5 lines
      }
      
      // Send streaming data to renderer process
      event.sender.send('command-stream-data', {
        type: 'stdout',
        data: output,
        command: command
      });
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const output: string = data.toString('utf8');
      stderr += output;
      console.log('STDERR:', output);
      debugLog('Command stderr', { command, output });
      
      // Write stderr to temp file too (Docker sometimes outputs progress to stderr)
      require('fs').appendFileSync(tempFile, output);
      
      // Send streaming data to renderer process
      event.sender.send('command-stream-data', {
        type: 'stderr',
        data: output,
        command: command
      });
    });

    childProcess.on('close', (code: number | null) => {
      const result: StreamCommandResult = { 
        success: code === 0,
        code: code ?? 1,
        exitCode: code ?? 1,
        stdout,
        stderr
      };
      console.log('Process exited with code:', code);
      debugLog('Command completed', { command, result });
      
      // Clean up temp file
      try {
        require('fs').unlinkSync(tempFile);
      } catch (err) {
        console.warn('Could not clean up temp file:', tempFile);
      }
      
      // Send completion event to renderer
      event.sender.send('command-stream-complete', {
        command: command,
        result: result
      });
      
      resolve(result);
    });

    childProcess.on('error', (error: Error) => {
      console.error('Process error:', error);
      debugLog('Command error', { command, error: error.message });
      
      // Clean up temp file
      try {
        require('fs').unlinkSync(tempFile);
      } catch (err) {
        console.warn('Could not clean up temp file:', tempFile);
      }
      
      // Send error event to renderer
      event.sender.send('command-stream-error', {
        command: command,
        error: error.message
      });
      
      reject(error);
    });
  });
});

// Parse Docker progress from output buffer
function parseDockerProgress(buffer: string): any {
  const lines = buffer.split('\n');
  let latestProgress: any = null;
  
  for (const line of lines) {
    // Remove ANSI escape sequences
    const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
    
    // Parse Docker download progress: "Downloading [=====>     ] 45.2MB/89.1MB"
    const downloadMatch = cleanLine.match(/Downloading\s+\[([=>\s]+)\]\s+([0-9.]+[KMGT]?B)\/([0-9.]+[KMGT]?B)/);
    if (downloadMatch && downloadMatch[2] && downloadMatch[3]) {
      const [, progressBar, downloaded, total] = downloadMatch;
      const percentage = Math.round((parseSize(downloaded) / parseSize(total)) * 100);
      latestProgress = {
        type: 'download',
        percentage: Math.min(percentage, 100),
        downloaded,
        total,
        message: `Downloading images: ${percentage}% (${downloaded}/${total})`
      };
    }
    
    // Parse Docker extraction progress: "Extracting [=====>     ] 45.2MB/89.1MB"
    const extractMatch = cleanLine.match(/Extracting\s+\[([=>\s]+)\]\s+([0-9.]+[KMGT]?B)\/([0-9.]+[KMGT]?B)/);
    if (extractMatch && extractMatch[2] && extractMatch[3]) {
      const [, progressBar, extracted, total] = extractMatch;
      const percentage = Math.round((parseSize(extracted) / parseSize(total)) * 100);
      latestProgress = {
        type: 'extract',
        percentage: Math.min(percentage, 100),
        extracted,
        total,
        message: `Extracting images: ${percentage}% (${extracted}/${total})`
      };
    }
    
    // Parse "Pull complete" messages
    if (cleanLine.includes('Pull complete')) {
      latestProgress = {
        type: 'complete',
        percentage: 100,
        message: 'Image download complete'
      };
    }
    
    // Parse "Pulling from" messages
    const pullingMatch = cleanLine.match(/Pulling from (.+)/);
    if (pullingMatch && pullingMatch[1]) {
      const imageName = pullingMatch[1].split('/').pop() || pullingMatch[1];
      latestProgress = {
        type: 'pulling',
        percentage: 0,
        imageName,
        message: `Pulling ${imageName}...`
      };
    }
  }
  
  return latestProgress;
}

// Helper function to parse size strings like "45.2MB" to bytes
function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/([0-9.]+)([KMGT]?B)/);
  if (!match || !match[1]) return 0;
  
  const [, num, unit] = match;
  const size = parseFloat(num);
  
  switch (unit) {
    case 'TB': return size * 1024 * 1024 * 1024 * 1024;
    case 'GB': return size * 1024 * 1024 * 1024;
    case 'MB': return size * 1024 * 1024;
    case 'KB': return size * 1024;
    default: return size;
  }
}

interface SelectDirectoryOptions {
  title?: string;
  defaultPath?: string;
}

ipcMain.handle('select-directory', async (event: IpcMainInvokeEvent, options: SelectDirectoryOptions = {}): Promise<string | null> => {
  if (!mainWindow) return null;
  
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ['openDirectory'],
    title: options.title || 'Select Directory'
  };
  
  if (options.defaultPath) {
    dialogOptions.defaultPath = options.defaultPath;
  }
  
  const result = await dialog.showOpenDialog(mainWindow, dialogOptions);
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0] || null;
  }
  
  return null;
});

// Handler for getting home directory
ipcMain.handle('get-home-directory', async (): Promise<string> => {
  const homeDir = os.homedir();
  debugLog('Get home directory request', { homeDir });
  return homeDir;
});

// Handler for showing directory dialog (alias for select-directory)
ipcMain.handle('show-directory-dialog', async (event: IpcMainInvokeEvent, options: SelectDirectoryOptions = {}): Promise<{ filePaths: string[] } | null> => {
  debugLog('Show directory dialog request', { options, mainWindowExists: !!mainWindow });
  
  if (!mainWindow) {
    debugLog('Show directory dialog failed - no main window');
    return null;
  }
  
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ['openDirectory'],
    title: options.title || 'Select Projects Directory'
  };
  
  if (options.defaultPath) {
    dialogOptions.defaultPath = options.defaultPath;
  }
  
  debugLog('Opening directory dialog with options', dialogOptions);
  
  try {
    const result = await dialog.showOpenDialog(mainWindow, dialogOptions);
    debugLog('Directory dialog result', { canceled: result.canceled, filePaths: result.filePaths });
    
    if (!result.canceled) {
      return { filePaths: result.filePaths };
    }
    
    return null;
  } catch (error) {
    debugLog('Directory dialog error', { error: (error as Error).message });
    throw error;
  }
});

interface ProjectMetadata {
  display_name: string;
  description: string;
  emoji: string;
}

// Resolve the projects directory from Podium's own config rather than guessing
// at a list of candidate paths. `podium projects-dir` prints the same value.
function getProjectsDir(): string {
  return readEnvValue('PROJECTS_DIR') ?? path.join(os.homedir(), 'podium-projects');
}

// Run a podium subcommand and collect its text output. The service panels use
// this rather than driving docker directly, so custom container names and any
// future CLI fixes are picked up for free.
function runPodium(args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn('podium', args, {
      cwd: os.homedir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' }
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.on('close', (code: number | null) => {
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on('error', (error: Error) => {
      resolve({ code: 1, stdout: '', stderr: error.message });
    });

    child.stdin?.end();
  });
}

function parseMemcachedStats(output: string): Record<string, string> {
  const stats: Record<string, string> = {};

  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith('STAT ')) continue;

    const parts = line.trim().split(' ');
    if (parts.length >= 3 && parts[1] && parts[2]) {
      stats[parts[1]] = parts[2];
    }
  }

  // Format bytes as human readable
  if (stats.bytes) {
    const bytes = parseInt(stats.bytes);
    if (bytes > 1024 * 1024) {
      stats.bytes = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    } else if (bytes > 1024) {
      stats.bytes = `${(bytes / 1024).toFixed(2)} KB`;
    } else {
      stats.bytes = `${bytes} B`;
    }
  }

  return stats;
}

function composePathFor(projectName: string): string | null {
  const composePath = path.join(getProjectsDir(), projectName, 'docker-compose.yaml');
  return fs.existsSync(composePath) ? composePath : null;
}

// Display metadata (friendly name, description, emoji) is a GUI-only concern —
// the CLI no longer writes or reports an x-metadata block, and `podium status`
// does not return these fields. The GUI keeps them in the project's
// docker-compose.yaml under the compose-standard `x-` extension prefix, which
// Docker ignores, and reads them back itself.
ipcMain.handle('get-project-metadata', async (event: IpcMainInvokeEvent, projectName: string): Promise<ProjectMetadata | null> => {
  try {
    const composePath = composePathFor(projectName);
    if (!composePath) return null;

    const content = fs.readFileSync(composePath, 'utf8');
    const block = content.match(/x-metadata:\s*\n([\s\S]*?)(?=\n\s*\S+:\s*$|\n\S|$)/);
    const body = block?.[1];
    if (!body) return null;

    const read = (key: string): string => {
      const match = body.match(new RegExp(`^\\s*${key}:\\s*"?(.*?)"?\\s*$`, 'm'));
      return match?.[1] ?? '';
    };

    return {
      display_name: read('name'),
      description: read('description'),
      emoji: read('emoji')
    };
  } catch (error) {
    debugLog('Error reading project metadata', { projectName, error: (error as Error).message });
    return null;
  }
});

// Handler for updating project metadata directly in docker-compose.yaml
ipcMain.handle('update-project-metadata', async (event: IpcMainInvokeEvent, projectName: string, metadata: ProjectMetadata): Promise<{ success: boolean; error?: string }> => {
  try {
    const composePath = composePathFor(projectName);
    if (!composePath) {
      return { success: false, error: 'Project docker-compose.yaml not found' };
    }

    let content = fs.readFileSync(composePath, 'utf8');

    // Escape double quotes so a name like `My "Cool" App` can't break the YAML.
    const quote = (value: string): string => `"${(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

    if (/x-metadata:/.test(content)) {
      content = content.replace(/(x-metadata:\s*\n(?:[\s\S]*?\n)??\s*emoji:\s*).*/, `$1${quote(metadata.emoji)}`);
      content = content.replace(/(x-metadata:\s*\n(?:[\s\S]*?\n)??\s*name:\s*).*/, `$1${quote(metadata.display_name)}`);
      content = content.replace(/(x-metadata:\s*\n(?:[\s\S]*?\n)??\s*description:\s*).*/, `$1${quote(metadata.description)}`);
    } else {
      // `podium new` no longer emits an x-metadata block, so create one on the
      // web-facing service, matching the indentation the CLI's compose uses.
      const service = content.match(/^(\s{2})(\w[\w-]*):\s*\n(\s{4})image:/m);
      if (!service) {
        return { success: false, error: 'Could not locate a service to attach metadata to' };
      }

      const indent = service[3];
      const block = [
        `${indent}x-metadata:`,
        `${indent}  type: "podium-project"`,
        `${indent}  version: "1.0.0"`,
        `${indent}  emoji: ${quote(metadata.emoji)}`,
        `${indent}  name: ${quote(metadata.display_name)}`,
        `${indent}  description: ${quote(metadata.description)}`,
        ''
      ].join('\n');

      // Insert immediately after the service's image line.
      content = content.replace(/^(\s{4}image:.*\n)/m, `$1${block}`);
    }

    fs.writeFileSync(composePath, content, 'utf8');

    debugLog('Updated project metadata', { projectName, metadata, composePath });
    return { success: true };
  } catch (error) {
    debugLog('Error updating project metadata', { error: (error as Error).message, stack: (error as Error).stack });
    return { success: false, error: (error as Error).message };
  }
});

// Handler for getting service statistics
ipcMain.handle("get-service-stats", async (event: IpcMainInvokeEvent, serviceName: string): Promise<{ success: boolean; stats?: any; error?: string }> => {
  try {
    if (serviceName === "memcached") {
      const memcached = await runPodium(["memcache-stats"]);
      if (memcached.code !== 0) {
        return { success: false, error: memcached.stderr || "Failed to get stats" };
      }
      return { success: true, stats: parseMemcachedStats(memcached.stdout) };
    }

    if (serviceName !== "redis") {
      return { success: false, error: "Unsupported service" };
    }

    const result = await runPodium(["redis", "INFO"]);
    
    if (result.code !== 0) {
      return { success: false, error: result.stderr || "Failed to get stats" };
    }
    
    let stats: any = {};
    
    if (serviceName === "redis") {
      // Parse Redis INFO output. Note: this split used to be "\\n", which is a
      // literal backslash-n, so no line ever matched and stats came back empty.
      for (const line of result.stdout.split(/\r?\n/)) {
        if (line.startsWith("#") || !line.includes(":")) continue;

        const separator = line.indexOf(":");
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (key && value) {
          stats[key] = value;
        }
      }

      // Calculate total keys from keyspace info
      let totalKeys = 0;
      for (const [key, value] of Object.entries(stats)) {
        if (key.startsWith("db") && typeof value === "string") {
          const match = value.match(/keys=([0-9]+)/);
          if (match && match[1]) totalKeys += parseInt(match[1]);
        }
      }
      stats.total_keys = totalKeys.toString();
    }

    debugLog("Service stats retrieved", { serviceName, stats });
    return { success: true, stats };
  } catch (error) {
    debugLog("Error getting service stats", { error: (error as Error).message });
    return { success: false, error: (error as Error).message };
  }
});

// Handler for flushing service data
ipcMain.handle("flush-service-data", async (event: IpcMainInvokeEvent, serviceName: string): Promise<{ success: boolean; error?: string }> => {
  try {
    if (serviceName !== "redis" && serviceName !== "memcached") {
      return { success: false, error: "Unsupported service" };
    }

    const result = await runPodium([serviceName === "redis" ? "redis-flush" : "memcache-flush"]);

    if (result.code !== 0) {
      return { success: false, error: result.stderr || "Failed to flush data" };
    }
    
    debugLog("Service data flushed", { serviceName });
    return { success: true };
  } catch (error) {
    debugLog("Error flushing service data", { error: (error as Error).message });
    return { success: false, error: (error as Error).message };
  }
});
