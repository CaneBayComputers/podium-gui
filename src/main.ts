import { app, BrowserWindow, ipcMain, dialog, IpcMainInvokeEvent, Menu, shell } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';

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

  // --no-focus: open without stealing focus, and try to come up behind whatever
  // the user is working in. Meant for automated/background launches (the e2e
  // harness passes it) so a test run does not grab the keyboard mid-sentence.
  // A normal double-click launch still focuses, which is what people expect.
  const noFocus: boolean = process.argv.includes('--no-focus');

  mainWindow = new BrowserWindow({
    width: 2000,
    height: 1200,
    // Render offscreen first, then decide how to present it.
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      additionalArguments: process.argv.includes('--dev') ? ['--debug-mode'] : []
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    title: 'Podium - PHP Development Platform'
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;

    if (!noFocus) {
      mainWindow.show();
      return;
    }

    // showInactive presents the window without activating it — no focus steal.
    mainWindow.showInactive();
    mainWindow.blur();

    // Stacking order is the window manager's call and Electron has no
    // "send to back", so on X11 ask the WM directly. Best-effort by design:
    // if neither tool is installed the window simply stays where it is,
    // unfocused, which is the part that actually matters.
    //
    // The `below` state has to be added and then REMOVED. Adding it drops the
    // window to the bottom; leaving it set makes that permanent, so the window
    // stays behind everything else even after the user clicks it — which is
    // worse than the problem being solved. Clearing the state afterwards keeps
    // the position without keeping the rule. `demands_attention` goes too:
    // that is the taskbar highlight, and a background launch should not be
    // asking for attention at all.
    if (process.platform === 'linux') {
      const title = 'Podium - PHP Development Platform';
      const wm = (state: string) =>
        `xdotool search --name '${title}' set_window --urgency 0 2>/dev/null; ` +
        `wmctrl -r '${title}' -b ${state} 2>/dev/null`;

      setTimeout(() => {
        const lower = spawn('sh', ['-c', wm('add,below')], { stdio: 'ignore' });
        lower.on('error', () => { /* no wmctrl/xdotool; nothing to do */ });
      }, 120);

      // Clear the rule the moment the user actually clicks the window, not on
      // a timer. A timer either fires too early (the window drifts back up the
      // stack) or leaves the state set (the window is stuck behind everything
      // forever). Tying it to focus gives both halves: it opens underneath
      // everything and behaves like a normal window as soon as it is wanted.
      mainWindow.once('focus', () => {
        const clear = spawn('sh', ['-c', wm('remove,below,demands_attention')], { stdio: 'ignore' });
        clear.on('error', () => { /* as above */ });
      });
    }
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
            shell.openExternal('https://donate.podiumcli.com');
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
    mainWindow.loadFile(path.join(__dirname, '..', 'src', 'installer.html'));
  } else if (podiumStatus === 'not-configured') {
    debugLog('Loading installer.html - Podium not configured');
    mainWindow.loadFile(path.join(__dirname, '..', 'src', 'installer.html'));
  } else {
    debugLog('Loading index.html - Podium ready');
    mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
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

// Where `podium` actually is, as an argv pair.
//
// Bare spawn('podium') only works when the launching environment has the CLI on
// PATH. A shell has it; a .desktop launcher started by the panel does not, and
// a packaged install therefore failed with "spawn podium ENOENT" for every
// command while working perfectly from a terminal. Resolving it here means each
// call site gets the same answer instead of one of them having a fallback.
//
// Deliberately not cached. It is a handful of stat calls at human frequency,
// and a cache would make the resolution untestable — the first call would fix
// the answer before any test could vary the environment.
// Find an executable without trusting PATH.
//
// A .desktop launch on Linux has no /usr/local/bin, and a macOS app launched
// from Finder has no /opt/homebrew/bin — Homebrew adds that in ~/.zprofile,
// which a GUI launch never sources. Both are silent: the command simply is not
// found, and whatever depended on it degrades without saying why.
function resolveBinary(name: string): string | null {
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const candidates = [
    // PATH first, so a dev or user-installed copy wins the way it would in a
    // shell, then the locations a GUI launch cannot see.
    ...pathDirs.map((dir) => path.join(dir, name)),
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    `/opt/homebrew/bin/${name}`
  ];

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not there, or not executable — keep looking.
    }
  }
  return null;
}

function resolvePodium(): { command: string; prefix: string[] } {
  const found = resolveBinary('podium');
  if (found) return { command: found, prefix: [] };

  // Last resort: the CLI's own entry script, run through bash so it does not
  // need its executable bit.
  const shipped = path.join(PODIUM_CLI_DIR, 'src', 'podium');
  if (fs.existsSync(shipped)) {
    return { command: 'bash', prefix: [shipped] };
  }

  // Nothing found. Return the bare name so the failure is the familiar ENOENT
  // rather than something invented here.
  return { command: 'podium', prefix: [] };
}

// Terminal emulators that can be told "run this command", in the order worth
// trying. Each entry is the flag that precedes the command, because they do not
// agree: -e takes a command, --  takes the rest of the argv, and gnome-terminal
// wants both. Ordered so a desktop's own terminal wins over a stray xterm.
const TERMINAL_EMULATORS: Array<{ bin: string; args: (cmd: string[]) => string[] }> = [
  { bin: 'x-terminal-emulator', args: (c) => ['-e', ...c] },
  { bin: 'gnome-terminal',      args: (c) => ['--', ...c] },
  { bin: 'konsole',             args: (c) => ['-e', ...c] },
  { bin: 'xfce4-terminal',      args: (c) => ['-e', c.join(' ')] },
  { bin: 'mate-terminal',       args: (c) => ['--', ...c] },
  { bin: 'kitty',               args: (c) => [...c] },
  { bin: 'alacritty',           args: (c) => ['-e', ...c] },
  { bin: 'xterm',               args: (c) => ['-e', ...c] }
];

// Hand a command to the user's own terminal emulator.
//
// The shell keeps running after the command exits (`exec bash` style) so a
// finished agent does not take its output with it — the whole reason someone
// picks a system terminal is to keep the scrollback.
ipcMain.handle('open-system-terminal', async (
  _event: IpcMainInvokeEvent,
  cwd: string,
  command: string,
  args: string[] = []
): Promise<{ ok: boolean; error?: string }> => {
  const resolved = resolveIfPodium(command, args);
  const quoted = [resolved.command, ...resolved.args]
    .map((part) => `'${part.replace(/'/g, `'\\''`)}'`)
    .join(' ');
  const inner = ['bash', '-lc', `cd ${JSON.stringify(cwd)} && ${quoted}; exec bash`];

  if (process.platform === 'darwin') {
    try {
      const script = `tell application "Terminal" to do script ${JSON.stringify(`cd ${cwd} && ${quoted}`)}`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  for (const emulator of TERMINAL_EMULATORS) {
    const found = resolveOnPath(emulator.bin);
    if (!found) continue;

    try {
      const child = spawn(found, emulator.args(inner), { detached: true, stdio: 'ignore' });
      child.unref();
      debugLog('Opened system terminal', { emulator: found, cwd, command, args });
      return { ok: true };
    } catch (error) {
      debugLog('System terminal failed to start', { emulator: found, error });
      // Installed but unusable — keep going rather than giving up on the rest.
    }
  }

  return { ok: false, error: 'no terminal emulator found' };
});

function resolveOnPath(bin: string): string | null {
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Next directory.
    }
  }
  return null;
}

// Exposed so the resolution can be exercised against a stripped PATH — the
// exact condition that broke every packaged menu launch.
ipcMain.handle('get-podium-command', async (): Promise<{ command: string; prefix: string[] }> =>
  resolvePodium());

// Same, for the install check. It is a separate handler because it exercises a
// separate code path: `resolvePodium` was already PATH-independent while
// checkPodiumStatus still ran a bare `podium`, so testing the first said
// nothing about the second.
ipcMain.handle('get-podium-status', async (): Promise<string> => checkPodiumStatus());

// The renderer asks for commands by name. Rewrite the one command that is ours
// and leave everything else (docker, git) alone — those genuinely are expected
// to be on PATH, and silently rewriting them would hide a real misconfiguration.
function resolveIfPodium(command: string, args: string[]): { command: string; args: string[] } {
  if (command !== 'podium') return { command, args };

  const podium = resolvePodium();
  return { command: podium.command, args: [...podium.prefix, ...args] };
}

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
    // Resolve rather than trusting PATH. This ran a bare `podium`, so on any
    // launch without /usr/local/bin on PATH — a .desktop entry, or a macOS app
    // opened from Finder — it threw and the app decided Podium was not
    // installed, showing the installer instead of the dashboard. It is the
    // first decision the app makes, so getting it wrong replaces the whole UI.
    const podium = resolvePodium();
    execSync([...[podium.command, ...podium.prefix].map((part) => `'${part}'`), 'help', '--no-colors'].join(' '),
             { stdio: 'pipe' });

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

    const podium = resolvePodium();
    const child: ChildProcess = run(podium.command, [...podium.prefix, ...allArgs]);
    child.on('error', (error: Error) => reject(error));
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
interface CatalogFramework {
  slug: string;
  display: string;
  runtime: string;
  databases: string[];
  note: string;
}

// Read at runtime for the same reason as the app catalogue: frameworks.json is
// the CLI's authority on which engines each framework ACTUALLY works with, and
// a copy here would drift. The GUI previously hardcoded three of the thirteen
// and sent `--database mysql` for all of them.
ipcMain.handle('get-framework-catalog', async (): Promise<{ frameworks: CatalogFramework[]; error?: string }> => {
  const catalogPath = path.join(PODIUM_CLI_DIR, 'src', 'catalog', 'frameworks.json');

  try {
    if (!fs.existsSync(catalogPath)) {
      return { frameworks: [], error: `Framework catalogue not found at ${catalogPath}` };
    }

    const parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const frameworks: CatalogFramework[] = (parsed.frameworks ?? []).map((fw: any) => ({
      slug: fw.slug ?? '',
      display: fw.display ?? fw.slug ?? '',
      runtime: fw.runtime ?? '',
      // An empty/absent list means every engine is fine.
      databases: Array.isArray(fw.databases) ? fw.databases : [],
      note: fw.note ?? ''
    })).filter((fw: CatalogFramework) => fw.slug !== '');

    debugLog('Loaded framework catalogue', { count: frameworks.length });
    return { frameworks };
  } catch (error) {
    debugLog('Failed to read framework catalogue', { error: (error as Error).message });
    return { frameworks: [], error: (error as Error).message };
  }
});

// What the INSTALLED CLI actually supports, probed once.
//
// The cheap-models work lives on podium-cli `dev` and is not on its `master`,
// so a current install has no qwen and stores `--api-base none` as a literal
// string. Offering qwen there produces an agent the CLI rejects. Rather than
// couple the GUI's release to the CLI's, ask the CLI what it can do.
let cliCapabilities: { qwen: boolean; clearableEndpoint: boolean; unattended: boolean } | null = null;

ipcMain.handle('get-cli-capabilities', async (): Promise<{ qwen: boolean; clearableEndpoint: boolean; unattended: boolean }> => {
  if (cliCapabilities) return cliCapabilities;

  const help = await runPodium(['ai-set', '--help']);
  const text = help.stdout + help.stderr;

  cliCapabilities = {
    qwen: /\bqwen\b/.test(text),
    // Same commit added both, so qwen is a reliable proxy for "endpoint clearing
    // works" — on older CLIs `none` is stored verbatim.
    clearableEndpoint: /\bqwen\b/.test(text),
    // Offering a control the installed CLI cannot honour would silently do
    // nothing — worse here than elsewhere, since the user would believe they
    // had changed how much the agent is allowed to do on its own.
    unattended: /--allow-unattended/.test(text)
  };

  debugLog('CLI capabilities', cliCapabilities);
  return cliCapabilities;
});

// Does a freshly installed project actually serve anything?
//
// `podium install` exits 0 even when its readiness retries are exhausted — it
// prints "returned HTTP 000 — it may still be initializing" and gives up, which
// is the right call for a CLI that cannot wait forever. The GUI was reading only
// the exit code, so a crash-looping app produced a green "installed" toast and a
// URL that had never served a request. Ask the app directly instead.
ipcMain.handle('check-project-url', async (
  _event: IpcMainInvokeEvent,
  projectName: string
): Promise<{ code: number }> => {
  return new Promise((resolve) => {
    const request = http.get(`http://${projectName}/`, { timeout: 6000 }, (res) => {
      // Any response at all is the answer; the body is irrelevant.
      res.resume();
      resolve({ code: res.statusCode ?? 0 });
    });

    // 0 mirrors curl's "no response" convention, which is what the CLI prints.
    request.on('error', () => resolve({ code: 0 }));
    request.on('timeout', () => { request.destroy(); resolve({ code: 0 }); });
  });
});

// Ollama exposes what the user has actually pulled. Turning the hardest step of
// a local setup — "type the exact model tag" — into a picker is most of the value
// of the local presets. Fails quietly to free text when Ollama is not running.
ipcMain.handle('list-ollama-models', async (event: IpcMainInvokeEvent, baseUrl: string): Promise<string[]> => {
  // The agent endpoint is .../v1; the tags API sits at the host root.
  const root = (baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '');

  return new Promise((resolve) => {
    const request = http.get(`${root}/api/tags`, { timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const models = (JSON.parse(body).models || [])
            .map((m: any) => m.name)
            .filter((n: string) => typeof n === 'string' && n !== '');
          resolve(models);
        } catch (error) {
          resolve([]);
        }
      });
    });

    request.on('error', () => resolve([]));
    request.on('timeout', () => { request.destroy(); resolve([]); });
  });
});

// Qwen Code wants Node 22+. It installs on 20 with an EBADENGINE warning, which
// is unsupported — and the GUI's own installers pin 20 as the floor, so the app
// can end up offering an agent this machine cannot properly run.
ipcMain.handle('get-node-major', async (): Promise<number> => {
  try {
    // Bare `node` fails on a macOS GUI launch when node came from Homebrew:
    // /opt/homebrew/bin is added by ~/.zprofile, which Finder does not source.
    // It failed quietly, returning 0, which silently suppressed the Node
    // version warning for qwen rather than showing a wrong one.
    const nodeBin = resolveBinary('node');
    if (!nodeBin) return 0;
    const out = execSync(`'${nodeBin}' -v`, { encoding: 'utf8' }).trim();
    return parseInt(out.replace(/^v/, '').split('.')[0] || '0', 10);
  } catch (error) {
    return 0;
  }
});

// CLI version, for the lock-step check. A dedicated command rather than reading
// it off `status`, which touches Docker and can be slow — this is just a string.
// Returns 'unknown' on an older CLI that has no version command at all, which is
// distinguishable from a real version and means "too old to say".
ipcMain.handle('get-cli-version', async (): Promise<string> => {
  const result = await runPodium(['version', '--json-output']);
  if (result.code !== 0) return 'unknown';

  try {
    return JSON.parse(result.stdout).version || 'unknown';
  } catch (error) {
    return 'unknown';
  }
});

// `app.getVersion()` only returns the app's own version when the app is
// packaged. Run unpackaged — which is every `npm run dev` and every e2e run —
// Electron returns *its* version instead, so the lock-step check compared
// "1.0.0-beta.1" against "28.3.3" and showed a mismatch banner permanently.
// package.json is the single source of truth for the version, so read it.
ipcMain.handle('get-gui-version', async (): Promise<string> => {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    if (version) return version;
  } catch {
    // Packaged builds resolve it fine through Electron.
  }
  return app.getVersion();
});

ipcMain.handle('get-projects-dir', async (): Promise<string> => getProjectsDir());

ipcMain.handle('get-optional-services', async (): Promise<string[]> => {
  const raw = readEnvValue('OPTIONAL_SERVICES');
  if (!raw) return [];

  return raw
    .split(/[\s,]+/)
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');
});

// The CLI's own service listing, which it generates from the same catalogue it
// validates against. Replaces a copy that lived in the GUI: the copy existed
// only because `enable-service` had no machine-readable output, and it drifted
// the moment the CLI grew from two services to nine.
ipcMain.handle('get-service-catalog', async (): Promise<{
  always_on: string[];
  services: Array<{ slug: string; group: string; description: string; address: string; state: string }>;
  error?: string;
}> => {
  const result = await runPodium(['enable-service', '--json-output']);

  try {
    const parsed = JSON.parse(result.stdout || '{}');
    if (!Array.isArray(parsed.services)) {
      // An older CLI prints usage text here rather than JSON. Say so instead of
      // rendering an empty manager that looks like "no services exist".
      return { always_on: [], services: [], error: 'This Podium CLI has no machine-readable service listing.' };
    }
    return { always_on: parsed.always_on || [], services: parsed.services };
  } catch (error) {
    return { always_on: [], services: [], error: 'Could not read the service listing from the CLI.' };
  }
});

// Which shared services a project actually depends on.
//
// Disabling a database a project is using leaves it unable to connect, and
// nothing in the CLI stops that today. The compose files name the service
// hostnames directly (DB_HOST: podium-mariadb and friends), so ask them rather
// than inferring from the framework or trusting metadata.
ipcMain.handle('get-services-in-use', async (): Promise<Record<string, string[]>> => {
  const inUse: Record<string, string[]> = {};
  const hosts: Record<string, string> = {
    mysql: 'podium-mariadb',
    postgres: 'podium-postgres',
    mongo: 'podium-mongo',
    minio: 'podium-minio',
    meilisearch: 'podium-meilisearch'
  };

  try {
    const dir = getProjectsDir();
    if (!fs.existsSync(dir)) return inUse;

    for (const project of fs.readdirSync(dir)) {
      const compose = composePathFor(project);
      if (!compose) continue;

      let body = '';
      try {
        body = fs.readFileSync(compose, 'utf8');
      } catch {
        continue;
      }

      for (const [service, host] of Object.entries(hosts)) {
        if (body.includes(host)) (inUse[service] ||= []).push(project);
      }
    }
  } catch (error) {
    debugLog('Could not scan projects for service use', error);
  }

  return inUse;
});

// ---------------------------------------------------------------------------
// Embedded terminal (phase 3 of create)
//
// The build hand-off is a genuinely interactive agent session — it asks
// clarifying questions and expects answers. Streaming a one-off would lose
// that, so the GUI hosts a real pty and lets `podium ai` run in it exactly as
// it would in a terminal.
// ---------------------------------------------------------------------------

const ptySessions = new Map<string, any>();

ipcMain.handle('pty-start', async (
  event: IpcMainInvokeEvent,
  sessionId: string,
  cwd: string,
  command: string,
  args: string[] = []
): Promise<{ ok: boolean; error?: string }> => {
  try {
    // Required lazily: node-pty is a native module, and a machine where the
    // rebuild did not run should degrade to "open a terminal yourself" rather
    // than taking the whole app down at startup.
    const pty = require('node-pty');

    if (ptySessions.has(sessionId)) {
      ptySessions.get(sessionId).kill();
      ptySessions.delete(sessionId);
    }

    const resolved = resolveIfPodium(command, args);
    const shell = pty.spawn(resolved.command, resolved.args, {
      name: 'xterm-color',
      cols: 100,
      rows: 28,
      cwd: fs.existsSync(cwd) ? cwd : os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    shell.onData((data: string) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('pty-data', { sessionId, data });
      }
    });

    shell.onExit(({ exitCode }: { exitCode: number }) => {
      ptySessions.delete(sessionId);
      if (!event.sender.isDestroyed()) {
        event.sender.send('pty-exit', { sessionId, exitCode });
      }
    });

    ptySessions.set(sessionId, shell);
    debugLog('Started pty session', { sessionId, command, args, cwd });
    return { ok: true };
  } catch (error) {
    debugLog('Failed to start pty', { sessionId, error: (error as Error).message });
    return { ok: false, error: (error as Error).message };
  }
});

ipcMain.handle('pty-input', async (event: IpcMainInvokeEvent, sessionId: string, data: string): Promise<void> => {
  ptySessions.get(sessionId)?.write(data);
});

ipcMain.handle('pty-resize', async (event: IpcMainInvokeEvent, sessionId: string, cols: number, rows: number): Promise<void> => {
  try {
    ptySessions.get(sessionId)?.resize(cols, rows);
  } catch (error) {
    // A resize racing process exit is not worth surfacing.
  }
});

ipcMain.handle('pty-kill', async (event: IpcMainInvokeEvent, sessionId: string): Promise<void> => {
  const session = ptySessions.get(sessionId);
  if (session) {
    try { session.kill(); } catch (error) { /* already gone */ }
    ptySessions.delete(sessionId);
  }
});

interface ClassifyCandidate {
  kind: 'app' | 'framework';
  slug: string;
  display: string;
  reason: string;
  database?: string;      // apps: fixed by the installer ("" = self-contained)
  databases?: string[];   // frameworks: the engines this one actually supports
}

// Cached after the first successful probe; the CLI does not change mid-session.
let classifyOnlySupported = false;

interface Classification {
  status: 'success' | 'error';
  message?: string;
  project_name: string | null;
  recommended: 'app' | 'framework';
  customization_requested: boolean;
  database?: { slug: string; reason: string } | null;
  candidates: ClassifyCandidate[];
}

// Phase 1 of `podium create`, on its own. The CLI works out which stack fits and
// returns JSON; the GUI renders the choices natively instead of the terminal
// menus, then drives phase 2 with `podium install` / `podium new` directly.
//
// Deliberately NOT `podium create` in one shot: that presents interactive menus
// a GUI cannot answer, and its non-interactive path silently takes the top
// recommendation — which discards the user's choice, the whole point of asking.
ipcMain.handle('classify-idea', async (event: IpcMainInvokeEvent, idea: string): Promise<Classification> => {
  const failure = (message: string): Classification => ({
    status: 'error',
    message,
    project_name: null,
    recommended: 'framework',
    customization_requested: true,
    candidates: []
  });

  if (!idea || idea.trim() === '') {
    return failure('Describe what you want to build first.');
  }

  // Confirm the CLI actually supports --classify-only before using it.
  //
  // This is not defensive padding. A CLI predating the flag does not reject it:
  // it falls through to an ordinary `podium create --json-output`, which is
  // non-interactive, auto-picks the top recommendation and BUILDS THE PROJECT.
  // Observed on a machine running an older CLI — asking it to classify an idea
  // installed Gitea. The GUI and CLI ship separately, so this drift is normal
  // and has to be caught before the command runs, not after.
  if (!classifyOnlySupported) {
    const help = await runPodium(['create', '--help']);
    if (!/--classify-only/.test(help.stdout + help.stderr)) {
      return failure(
        'This Podium CLI is too old to classify an idea safely — it has no ' +
        '--classify-only flag, and running create would build a project ' +
        'straight away. Update the CLI, then try again.'
      );
    }
    classifyOnlySupported = true;
  }

  // Classification is an AI round-trip — tens of seconds is normal.
  const result = await runPodium(['create', '--classify-only', '--json-output', idea.trim()]);

  // Judge by exit code, never by whether the output happens to parse.
  if (result.code !== 0) {
    try {
      const parsed = JSON.parse(result.stdout || '{}');
      if (parsed.message) return failure(parsed.message);
    } catch (error) {
      // fall through to the generic message
    }
    return failure(result.stderr || 'Could not work out a stack for that description.');
  }

  try {
    const parsed = JSON.parse(result.stdout);
    debugLog('Classified idea', { idea, candidates: parsed.candidates?.length });
    return parsed as Classification;
  } catch (error) {
    return failure('The classifier returned something unreadable.');
  }
});

// `podium create` is meaningless without an AI agent, and AI_AGENT is empty on a
// fresh install. ai-set reports it as JSON (its own --help documents this), so
// there is no need to read the env file.
// Full ai-set state, for the settings panel.
ipcMain.handle('get-ai-agent-full', async (): Promise<any> => {
  const result = await runPodium(['ai-set', '--json-output']);
  if (result.code !== 0) return { agent: '', model: '', api_base: '', has_api_key: false };
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return { agent: '', model: '', api_base: '', has_api_key: false };
  }
});

ipcMain.handle('get-ai-agent', async (): Promise<{ agent: string; model: string }> => {
  const result = await runPodium(['ai-set', '--json-output']);

  if (result.code !== 0) return { agent: '', model: '' };

  try {
    const parsed = JSON.parse(result.stdout);
    // Unconfigured is reported as "" rather than null.
    return { agent: parsed.agent || '', model: parsed.model || '' };
  } catch (error) {
    return { agent: '', model: '' };
  }
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

    const resolved = resolveIfPodium(command, args);
    const process: ChildProcess = spawn(resolved.command, resolved.args, {
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
    
    const resolved = resolveIfPodium(command, args);
    const childProcess: ChildProcess = spawn(resolved.command, resolved.args, {
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
  // Written by the CLI, never by the GUI. ISO-8601 UTC, stamped on both start
  // and stop so it means "last time this was up" rather than "last time
  // somebody started it" — the latter sorts a project that ran for a week and
  // stopped yesterday into the wrong place. Absent on projects that have not
  // been started or stopped since the CLI began writing it; there is no
  // backfill, and inventing a timestamp would be worse than an absent one.
  // Optional because the GUI's write path never supplies it.
  last_on?: string;
  // Parked, not deleted. Written by `podium disable` / `podium enable`.
  // ONLY the exact string "disabled" disables — missing, empty or anything
  // unrecognised means enabled, so a project can never become unusable
  // because a read returned something unexpected.
  status?: string;
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
    const podium = resolvePodium();
    const child = spawn(podium.command, [...podium.prefix, ...args], {
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

// Display metadata is no longer read here. `podium status --json-output` carries
// it per project (CLI 36109a7), so the GUI parses it alongside operational state
// instead of opening each project's docker-compose.yaml. That removed a
// per-project filesystem read, the cache it fed, and the two bugs that existed
// only because the two arrived by different routes.

// Metadata writes go through `podium set-metadata` (CLI 36109a7) rather than
// editing docker-compose.yaml here.
//
// The careful part — replacing only the three keys the GUI owns and leaving the
// CLI's last_on and status untouched — is now a property of that command, which
// writes one key at a time through the CLI's own helper. It used to be a
// property of three targeted regexes in this file. The test pinning that
// behaviour still earns its place; it tests the CLI's code now, which is where
// it belongs.
//
// This was also the last filesystem write, which is what lets a remote host
// need no file access at all.
ipcMain.handle('update-project-metadata', async (
  _event: IpcMainInvokeEvent,
  projectName: string,
  metadata: ProjectMetadata
): Promise<{ success: boolean; error?: string }> => {
  const args = ['set-metadata', projectName, '--json-output'];
  if (metadata.emoji) args.push('--emoji', metadata.emoji);
  if (metadata.display_name) args.push('--name', metadata.display_name);
  if (metadata.description) args.push('--description', metadata.description);

  const result = await runPodium(args);
  if (result.code !== 0) {
    return { success: false, error: result.stderr || result.stdout || 'set-metadata failed' };
  }
  return { success: true };
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
