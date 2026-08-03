const { ipcRenderer, shell } = require('electron');

// Global state interfaces
interface Project {
  name: string;
  display_name?: string;
  description?: string;
  emoji?: string;
  type: 'php' | 'laravel' | 'wordpress';
  folderExists: boolean;
  hostEntry: boolean;
  dockerRunning: boolean;
  portMapped: boolean;
  localUrl: string;
  lanUrl: string;
  port: number | null;
  status: 'running' | 'starting' | 'stopped';
}

interface SharedService {
  name: string;
  status: string;
  port: string;
  ip_address: string;
}

interface SharedServices {
  [key: string]: SharedService;
}

interface Services {
  [key: string]: any;
}

// Global state
let projects: Project[] = [];
let sharedServices: SharedServices = {};
let services: Services = {};
let autoRefreshInterval: NodeJS.Timeout | null = null;
const isDebugMode = process.argv.includes('--debug-mode');
console.log('RENDERER: Global state initialized', { debugMode: isDebugMode });

// Function to get emoji CSS class for dynamic backgrounds
function getEmojiClass(emoji: string): string {
    const emojiMap: { [key: string]: string } = {
        '🚀': 'emoji-rocket',
        '💻': 'emoji-computer',
        '🌟': 'emoji-star',
        '🔥': 'emoji-fire',
        '⚡': 'emoji-lightning',
        '🎯': 'emoji-target',
        '🏆': 'emoji-trophy',
        '💎': 'emoji-diamond',
        '🎨': 'emoji-art',
        '🔧': 'emoji-wrench',
        '📱': 'emoji-mobile',
        '🌐': 'emoji-globe',
        '🎮': 'emoji-game',
        '📊': 'emoji-chart',
        '🛡️': 'emoji-shield'
    };
    
    return emojiMap[emoji] || 'emoji-rocket'; // Default to rocket
}

// Initialize app
document.addEventListener('DOMContentLoaded', (): void => {
    console.log('DEBUG: DOMContentLoaded event fired');
    
    // Show initial loading screen
    showInitialLoading();
    
    // Read which optional services are enabled BEFORE the first render, so
    // minio/meilisearch are never briefly shown as "Stopped" on a machine that
    // simply never enabled them.
    loadOptionalServices().then(() => Promise.all([
        loadProjects(),
        loadServices()
    ])).then(() => {
        setupEventListeners();
        
        // Show debug indicator if in debug mode
        if (isDebugMode) {
            const debugIndicator = document.getElementById('debug-indicator');
            if (debugIndicator) {
                debugIndicator.style.display = 'block';
            }
        }
        
        console.log('DEBUG: DOMContentLoaded initialization complete');
        
        // Hide initial loading screen after a brief delay
        setTimeout(() => {
            hideInitialLoading();
        }, 1000);
    }).catch((error) => {
        console.error('Failed to initialize app:', error);
        hideInitialLoading();
    });
});

function setupEventListeners(): void {
    // Project type radio buttons
    const projectTypeRadios: NodeListOf<HTMLInputElement> = document.querySelectorAll('input[name="project-type"]');
    projectTypeRadios.forEach((radio: HTMLInputElement) => {
        radio.addEventListener('change', toggleVersionGroups);
    });
    
    // GitHub repository checkbox
    const githubCheckbox: HTMLInputElement | null = document.getElementById('create-github-repo') as HTMLInputElement;
    if (githubCheckbox) {
        githubCheckbox.addEventListener('change', toggleGithubOptions);
    }

    // Clone Project form handler
    const cloneProjectForm = document.getElementById('clone-project-form');
    if (cloneProjectForm) {
        cloneProjectForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitCloneProject();
        });
    }

    // F5 key listener for manual refresh
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'F5') {
            e.preventDefault(); // Prevent browser refresh
            manualRefresh();
        }
    });

    console.log('Event listeners setup complete', { 
        debugMode: isDebugMode,
        f5RefreshEnabled: true 
    });
}

function toggleGithubOptions(): void {
    const githubCheckbox: HTMLInputElement | null = document.getElementById('create-github-repo') as HTMLInputElement;
    const githubOptions: HTMLElement | null = document.getElementById('github-options');
    
    if (githubCheckbox && githubOptions) {
        githubOptions.style.display = githubCheckbox.checked ? 'block' : 'none';
    }
}

// ---------------------------------------------------------------------------
// Framework catalogue (New Project)
//
// Read from the CLI's src/catalog/frameworks.json rather than hardcoded. The
// form used to offer 3 of the 13 frameworks and send `--database mysql` for
// every one of them, which the CLI then silently coerced to whatever that
// framework actually supports.
// ---------------------------------------------------------------------------

interface CatalogFramework {
    slug: string;
    display: string;
    runtime: string;
    databases: string[];
    note: string;
}

let frameworkCatalog: CatalogFramework[] = [];

// `--version` only genuinely does something for these two:
//   laravel   -> sets CUR_LARAVEL_BRANCH, validated against Laravel's git tags
//   wordpress -> downloads wordpress-<version>.tar.gz
// The CLI's help also advertises `php: 8 or 7`, but frameworks/php.sh contains
// no version handling at all and the only PHP image in the tree is nginx-php8 —
// passing a PHP version silently gets you 8.3 either way. October CMS pins its
// own version through OCTOBER_VERSION rather than this flag. Reported upstream;
// offering a control for any of those would be lying to the user.
const VERSIONED_FRAMEWORKS = ['laravel', 'wordpress'];

async function loadFrameworkCatalog(): Promise<void> {
    if (frameworkCatalog.length > 0) return;

    const result = await ipcRenderer.invoke('get-framework-catalog');
    frameworkCatalog = result.frameworks || [];

    const list = document.getElementById('framework-list');
    if (!list) return;

    if (frameworkCatalog.length === 0) {
        list.innerHTML = `<p class="app-list-empty">Could not read the framework catalogue.<br><small>${escapeHtml(result.error || '')}</small></p>`;
        return;
    }

    // Group by runtime, the way the CLI's own listing reads.
    const runtimes: string[] = [];
    for (const fw of frameworkCatalog) {
        if (!runtimes.includes(fw.runtime)) runtimes.push(fw.runtime);
    }

    list.innerHTML = runtimes.map((runtime) => {
        const rows = frameworkCatalog
            .filter((fw) => fw.runtime === runtime)
            .map((fw) => `
                <label class="framework-option" data-testid="framework-${escapeHtml(fw.slug)}">
                    <input type="radio" name="project-type" value="${escapeHtml(fw.slug)}"
                           onchange="onFrameworkChange()">
                    <span>${escapeHtml(fw.display)}</span>
                </label>
            `).join('');

        return `
            <div class="framework-runtime">
                <span class="runtime-label">${escapeHtml(runtime)}</span>
                <div class="framework-options">${rows}</div>
            </div>
        `;
    }).join('');

    // Laravel stays the default, as before.
    const preferred = (list.querySelector('input[value="laravel"]')
        || list.querySelector('input[name="project-type"]')) as HTMLInputElement | null;
    if (preferred) preferred.checked = true;

    onFrameworkChange();
}

function selectedFramework(): CatalogFramework | null {
    const checked = document.querySelector('input[name="project-type"]:checked') as HTMLInputElement | null;
    if (!checked) return null;
    return frameworkCatalog.find((fw) => fw.slug === checked.value) || null;
}

function onFrameworkChange(): void {
    const framework = selectedFramework();
    if (!framework) return;

    // Offer only the engines this framework actually works with. "Auto" is the
    // default and sends no --database at all, letting the CLI apply its own
    // per-framework rule rather than the GUI second-guessing it.
    const select = document.getElementById('project-database') as HTMLSelectElement;
    if (select) {
        const options = ['<option value="">Auto — chosen by Podium</option>'];
        for (const db of framework.databases) {
            options.push(`<option value="${escapeHtml(db)}">${escapeHtml(db)}</option>`);
        }
        select.innerHTML = options.join('');
    }

    const help = document.getElementById('project-database-help');
    if (help) {
        help.textContent = framework.databases.length === 1
            ? `${framework.display} only works with ${framework.databases[0]}.`
            : 'Only engines this framework supports are offered.';
    }

    // The catalogue's note carries what the name alone cannot — in-house
    // frameworks especially, which no one can be expected to recognise.
    const note = document.getElementById('framework-note');
    if (note) note.textContent = framework.note || '';

    toggleVersionGroups();
}

function toggleVersionGroups(): void {
    const framework = selectedFramework();
    const slug = framework?.slug || '';

    const versionGroups: Array<[string, string]> = [
        ['laravel-version-group', 'laravel'],
        ['wordpress-version-group', 'wordpress']
    ];

    for (const [id, owner] of versionGroups) {
        const group = document.getElementById(id);
        if (!group) continue;

        const show = slug === owner && VERSIONED_FRAMEWORKS.includes(slug);
        group.style.display = show ? 'block' : 'none';

        if (show && owner !== 'php') {
            const input = document.getElementById(`${owner}-version`) as HTMLInputElement;
            if (input) input.value = 'latest';
        }
    }
}

async function loadProjects(): Promise<void> {
    try {
        // `--all` is required: podium status lists only RUNNING projects by
        // default, so without it the grid is empty whenever nothing is up.
        const result = await ipcRenderer.invoke('execute-podium', 'status', ['--all', '--json-output']);

        // Check if command succeeded
        if (result.code !== 0) {
            console.log('Podium status command failed, likely no projects or services stopped');
            projects = [];
            sharedServices = {};
            renderProjects();
            return;
        }

        parseProjectStatusJSON(result.stdout);
        await hydrateProjectMetadata();
        renderProjects();
    } catch (error) {
        console.error('Failed to load projects:', error);
        // Only show error if it's a real failure, not just empty state
        if (projects.length === 0) {
            console.log('No projects found, not showing error notification');
        } else {
            showError('Failed to load projects');
        }
    }
}

function parseProjectStatusJSON(statusOutput: string): void {
    projects = [];
    sharedServices = {};
    
    if (!statusOutput || statusOutput.trim() === '') {
        console.log('Empty status output, no projects to parse');
        return;
    }
    
    // Check if output looks like JSON
    const trimmed: string = statusOutput.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        console.log('Status output is not JSON format, likely no projects or services stopped:', trimmed);
        return;
    }
    
    try {
        const data = JSON.parse(statusOutput);
        
        // Store shared services data
        sharedServices = data.shared_services || {};
        
        // Parse projects
        if (data.projects && Array.isArray(data.projects)) {
            for (const projectData of data.projects) {
                const project: Project = {
                    name: projectData.name || '',
                    display_name: projectData.display_name || projectData.name || '',
                    description: projectData.description || '',
                    emoji: projectData.emoji || '🚀',
                    type: 'php', // Default type
                    folderExists: projectData.folder_exists === true,
                    hostEntry: projectData.host_entry === true,
                    dockerRunning: projectData.docker_running === true,
                    portMapped: projectData.port_mapped === true,
                    localUrl: projectData.local_url || '',
                    lanUrl: projectData.lan_url || '',
                    port: projectData.external_port ? parseInt(projectData.external_port) : null,
                    status: 'stopped'
                };
                
                // Determine overall status.
                //
                // `port_mapped` is NOT a liveness signal. Podium routes to a
                // project by hostname via its VPC IP (http://<project>/), so an
                // adapted multi-service compose — anything `podium install`
                // produces with an nginx front — runs perfectly with no host
                // port published at all. Requiring port_mapped here marked a
                // verified-healthy install (HTTP 200) as stopped, offered a
                // "Start" button for an already-running container, and hid its
                // URL. The container being up is what "running" means.
                if (!project.dockerRunning) {
                    project.status = 'stopped';
                } else if (projectData.ping_status && projectData.ping_status !== 'ok' && projectData.ping_status !== 'skipped') {
                    // Container is up but not answering on the VPC yet.
                    project.status = 'starting';
                } else {
                    project.status = 'running';
                }
                
                // Detect project type from name (simplified)
                if (project.name.includes('laravel') || project.name.includes('api')) {
                    project.type = 'laravel';
                } else if (project.name.includes('wordpress') || project.name.includes('wp')) {
                    project.type = 'wordpress';
                } else {
                    project.type = 'php';
                }
                
                projects.push(project);
            }
        }
        
    } catch (error) {
        console.error('Failed to parse JSON status output:', error);
        console.log('Raw output that failed to parse:', statusOutput);
        // Only show error if the directory exists but parsing failed
        // This prevents errors when services are simply stopped or directory is empty
        if (statusOutput.includes('Error:') || statusOutput.includes('Failed:')) {
            showError('Failed to parse project status data');
        } else {
            console.log('Non-JSON output likely due to stopped services, not showing error');
        }
    }
}

// `podium status` reports operational state only — it has no display_name,
// description or emoji, and the CLI no longer writes an x-metadata block. The
// GUI owns that metadata and reads it back from each project's compose file.
// Cached by project name and applied at RENDER time, not parse time.
// parseProjectStatusJSON() rebuilds the shared `projects` array from scratch and
// is called by both loadProjects() and loadServices() — so anything written onto
// the project objects gets wiped by whichever call finishes last. Keeping
// metadata in its own map makes it survive that.
let projectMetadata: Record<string, { display_name: string; description: string; emoji: string }> = {};

async function hydrateProjectMetadata(): Promise<void> {
    await Promise.all(projects.map(async (project: Project) => {
        try {
            const metadata = await ipcRenderer.invoke('get-project-metadata', project.name);
            if (metadata) {
                projectMetadata[project.name] = metadata;
            }
        } catch (error) {
            console.log(`No metadata for ${project.name}:`, error);
        }
    }));
}

/** Merge cached display metadata onto a freshly parsed project. */
function withMetadata(project: Project): Project {
    const metadata = projectMetadata[project.name];
    if (!metadata) return project;

    const merged: Project = { ...project };
    if (metadata.display_name) merged.display_name = metadata.display_name;
    if (metadata.description) merged.description = metadata.description;
    if (metadata.emoji) merged.emoji = metadata.emoji;

    return merged;
}

// Legacy function - redirects to JSON version
function parseProjectStatus(statusOutput: string): void {
    console.log('DEBUG: parseProjectStatus called - redirecting to JSON version');
    parseProjectStatusJSON(statusOutput);
}

function renderProjects(): void {
    const grid: HTMLElement | null = document.getElementById('projects-grid');
    if (!grid) return;
    
    if (projects.length === 0) {
        grid.innerHTML = `
            <div class="project-card placeholder">
                <div class="project-icon">🚀</div>
                <h3>Create Your First Project</h3>
                <p>Get started by creating a new PHP, Laravel, or WordPress project</p>
                <button class="btn btn-primary" onclick="showCreateProject()">Create Project</button>
            </div>
        `;
        return;
    }

    grid.innerHTML = projects.map((parsed: Project) => {
        // Apply cached display metadata here rather than trusting the parsed
        // object — see projectMetadata for why.
        const project = withMetadata(parsed);

        // Use emoji from metadata or fallback to type-based icon
        const projectIcon = project.emoji ||
                           (project.type === 'laravel' ? '🎯' : 
                            project.type === 'wordpress' ? '📝' : '🐘');
        
        // Use display_name or fallback to name
        const displayName = project.display_name || project.name;
        
        // Show description if available
        const descriptionHtml = project.description ? 
            `<p class="project-description">${project.description}</p>` : '';

        // Get the emoji-based CSS class
        const emojiClass = getEmojiClass(projectIcon);
        
        // Status dot emoji (red for stopped, green for running)
        const statusDot = project.status === 'running' ? '🟢' : '🔴';
        const statusClass = project.status === 'running' ? 'running' : 'stopped';
        
        return `
            <div class="project-card ${emojiClass}">
                <div class="project-status-dot ${statusClass}">${statusDot}</div>
                <div class="project-header">
                    <div class="project-icon">${projectIcon}</div>
                    <h3>${displayName}</h3>
                </div>
                ${descriptionHtml}
                <div class="project-details">
                    <div class="project-urls">
                        ${project.status !== 'stopped' && project.localUrl ? `<a href="#" class="url-link" onclick="event.preventDefault(); openUrl('${project.localUrl}'); return false;">${project.localUrl}</a>` : ''}
                        ${project.status !== 'stopped' && project.portMapped && project.lanUrl ? `<a href="#" class="url-link" onclick="event.preventDefault(); openUrl('${project.lanUrl}'); return false;">${project.lanUrl}</a>` : ''}
                    </div>
                    <div class="project-actions">
                        ${project.status !== 'stopped' ?
                            `<button class="btn btn-warning btn-sm" onclick="stopProject('${project.name}')">Stop</button>` :
                            `<button class="btn btn-success btn-sm" onclick="startProject('${project.name}')">Start</button>`
                        }
                        <button class="btn btn-create btn-sm" onclick="modifyWithAI('${project.name}')" title="Continue the AI session in this project">✨ Modify with AI</button>
                        <button class="btn btn-secondary btn-sm" onclick="editProject('${project.name}')">Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="showRemoveProjectModal('${project.name}')">Trash</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}



async function loadServices(): Promise<void> {
    try {
        const result = await ipcRenderer.invoke('execute-podium', 'status', ['--all', '--json-output']);
        
        if (result.code !== 0) {
            console.log('Services status command failed, likely no services running');
            renderServices();
            return;
        }
        
        parseProjectStatusJSON(result.stdout);
        renderServices();
    } catch (error) {
        console.error('Failed to load services:', error);
        renderServices();
    }
}

// Optional shared services, per the CLI's `podium enable-service`. Kept as a
// list rather than inferred, so a core service is never hidden by accident.
const OPTIONAL_SERVICE_NAMES = ['minio', 'meilisearch'];
let enabledOptionalServices: string[] = [];

async function loadOptionalServices(): Promise<void> {
    try {
        enabledOptionalServices = await ipcRenderer.invoke('get-optional-services') || [];
    } catch (error) {
        console.log('Could not read OPTIONAL_SERVICES:', error);
        enabledOptionalServices = [];
    }
}

function renderServices(): void {
    const servicesGrid: HTMLElement | null = document.getElementById('services-grid');
    if (!servicesGrid) return;

    if (!sharedServices || Object.keys(sharedServices).length === 0) {
        servicesGrid.innerHTML = `
            <div class="service-card">
                <div class="service-status">⚪</div>
                <h4>No Services</h4>
                <p>Start Podium to see shared services</p>
            </div>
        `;
        return;
    }

    // Hide optional services this machine has not enabled. podium status reports
    // minio/meilisearch as "stopped" whether or not they were ever turned on,
    // and a red "Stopped" card reads as a broken service rather than an unused
    // feature. Anything enabled via `podium enable-service` shows normally.
    const visibleServices = Object.entries(sharedServices).filter(([serviceName]) => {
        const key = serviceName.replace(/^podium-/, '').toLowerCase();
        return !OPTIONAL_SERVICE_NAMES.includes(key) || enabledOptionalServices.includes(key);
    });

    if (visibleServices.length === 0) {
        servicesGrid.innerHTML = `
            <div class="service-card">
                <div class="service-status">⚪</div>
                <h4>No Services</h4>
                <p>Start Podium to see shared services</p>
            </div>
        `;
        return;
    }

    servicesGrid.innerHTML = visibleServices.map(([serviceName, service]: [string, SharedService]) => {
        const statusIcon = service.status === 'running' ? '🟢' : '🔴';
        const statusText = service.status === 'running' ? 'Running' : 'Stopped';
        
        // Handle IP and port display
        let ipInfo = '';
        if (service.ip_address) {
            if (service.port) {
                ipInfo = `${service.ip_address}:${service.port}`;
            } else if (serviceName === 'phpmyadmin') {
                ipInfo = `${service.ip_address}:80`; // Default port for phpMyAdmin
            } else {
                ipInfo = service.ip_address;
            }
        } else if (service.port) {
            ipInfo = `Port ${service.port}`;
        }
        
        return `
            <div class="service-card">
                <div class="service-header">
                    <div class="service-title">
                        <div class="status-indicator ${service.status === 'running' ? 'running' : 'stopped'}"></div>
                        <h3>${service.name}</h3>
                    </div>
                </div>
                <div class="service-info">
                    <p>${statusText}</p>
                    ${ipInfo ? `<div class="service-ip">${ipInfo}</div>` : ''}
                </div>
                <div class="service-actions">
                    ${(serviceName === 'redis' || serviceName === 'memcached') && service.status === 'running' ? 
                        `<button class="btn btn-secondary btn-sm" onclick="showManageModal('${serviceName}')">Manage</button>` : 
                        ''
                    }
                    ${serviceName === 'phpmyadmin' && service.status === 'running' ? 
                        `<button class="btn btn-primary btn-sm" onclick="openUrl('http://phpmyadmin')">🗄️ Open Web UI</button>` : 
                        ''
                    }
                    ${serviceName === 'mailhog' && service.status === 'running' ? 
                        `<button class="btn btn-primary btn-sm" onclick="openUrl('http://localhost:8025')">📧 Open Web UI</button>` : 
                        ''
                    }
                </div>
            </div>
        `;
    }).join('');
}

// Project management functions
async function startProject(projectName: string): Promise<void> {
    try {
        showLoadingOverlay('Starting Project', `Starting ${projectName}...`);
        const result = await ipcRenderer.invoke('execute-podium', 'up', [projectName, '--json-output']);
        
        hideLoadingOverlay();
        
        if (result.code === 0) {
            showSuccess(`Project ${projectName} started successfully`);
        } else {
            showError(`Failed to start project: ${result.stderr || result.stdout}`);
        }
        
        // Refresh project list
        setTimeout(() => {
            loadProjects();
            loadServices();
        }, 2000);
    } catch (error) {
        hideLoadingOverlay();
        showError('Error starting project: ' + (error as Error).message);
    }
}

async function stopProject(projectName: string): Promise<void> {
    try {
        showLoadingOverlay('Stopping Project', `Stopping ${projectName}...`);
        const result = await ipcRenderer.invoke('execute-podium', 'down', [projectName, '--json-output']);
        
        hideLoadingOverlay();
        
        if (result.code === 0) {
            showSuccess(`Project ${projectName} stopped successfully`);
        } else {
            showError(`Failed to stop project: ${result.stderr || result.stdout}`);
        }
        
        // Refresh project list
        setTimeout(() => {
            loadProjects();
            loadServices();
        }, 2000);
    } catch (error) {
        hideLoadingOverlay();
        showError('Error stopping project: ' + (error as Error).message);
    }
}

async function removeProject(projectName: string): Promise<void> {
    // First confirmation
    if (!confirm(`Are you sure you want to remove project "${projectName}"?\n\nThis will remove the project files and Docker container.`)) {
        return;
    }

    // Database preservation confirmation
    const preserveDatabase = confirm(`Do you want to keep the database for "${projectName}"?\n\nClick OK to keep the database, Cancel to delete it.`);

    try {
        showLoadingOverlay('Removing Project', `Removing project ${projectName}...`);
        
        // podium remove PRESERVES the database by default; --force-db-delete is
        // what drops it. (The legacy --force flag is an alias for
        // --force-db-delete, not "skip prompts" — passing it here used to delete
        // databases the user asked to keep.)
        const args = [projectName, '--json-output'];
        args.push(preserveDatabase ? '--preserve-database' : '--force-db-delete');

        const result = await ipcRenderer.invoke('execute-podium', 'remove', args);
        
        hideLoadingOverlay();
        
        if (result.code === 0) {
            const dbMessage = preserveDatabase ? ' (database preserved)' : ' (database deleted)';
            showSuccess(`Project ${projectName} removed successfully${dbMessage}`);
        } else {
            showError(`Failed to remove project: ${result.stderr || result.stdout}`);
        }
        
        // Refresh project list
        setTimeout(() => {
            loadProjects();
            loadServices();
        }, 2000);
    } catch (error) {
        hideLoadingOverlay();
        showError('Error removing project: ' + (error as Error).message);
    }
}

function refreshProjects(): void {
    manualRefresh();
    
    // Show completion notification after a brief delay
    setTimeout(() => {
        showNotification('✅ Projects refreshed', 'success', 2000);
    }, 1000);
}

function openUrl(url: string): void {
    shell.openExternal(url);
}

async function showCreateProject(): Promise<void> {
    showModal('new-project-modal');
    // Built from the CLI's catalogue on first open, then cached.
    await loadFrameworkCatalog();
}



// Modal management
function showModal(modalId: string): void {
    console.log('DEBUG: showModal called with modalId:', modalId);
    const modal: HTMLElement | null = document.getElementById(modalId);
    console.log('DEBUG: modal element found:', !!modal);
    if (modal) {
        modal.classList.add('show');
        console.log('DEBUG: modal show class added');
    }
}

// Make showModal available globally immediately
(window as any).showModal = showModal;

function hideModal(modalId: string): void {
    const modal: HTMLElement | null = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
    }
}

// Auto-refresh projects and services every 10 seconds (disabled in debug mode)
function startAutoRefresh(): void {
    if (!isDebugMode && !autoRefreshInterval) {
        autoRefreshInterval = setInterval((): void => {
            loadProjects();
            loadServices();
        }, 10000);
        console.log('Auto-refresh started (10s interval)');
    } else if (isDebugMode) {
        console.log('Auto-refresh disabled in debug mode - use F5 to refresh manually');
    }
}

function stopAutoRefresh(): void {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        console.log('Auto-refresh stopped');
    }
}

// Manual refresh function
function manualRefresh(): void {
    console.log('Manual refresh triggered');
    showNotification('🔄 Refreshing...', 'info', 2000);
    loadProjects();
    loadServices();
}

// Start auto-refresh unless in debug mode
startAutoRefresh();

// Loading overlay functions
// When `streamOutput` is set, the overlay grows a live output pane fed by
// command-stream-data. Long operations (scaffolding a framework pulls
// composer/npm/pip) otherwise showed a spinner and nothing else for minutes.
let overlayStreaming = false;

function showLoadingOverlay(
    message: string = 'Please wait...',
    details: string = 'Processing your request',
    streamOutput: boolean = false
): void {
    const overlay = document.getElementById('loading-overlay');
    const messageEl = document.getElementById('loading-message');
    const detailsEl = document.getElementById('loading-details');
    const output = document.getElementById('loading-output');

    if (overlay && messageEl && detailsEl) {
        messageEl.textContent = message;
        detailsEl.textContent = details;
        overlay.style.display = 'flex';
    }

    overlayStreaming = streamOutput;
    if (output) {
        output.textContent = '';
        output.style.display = streamOutput ? 'block' : 'none';
    }
}

// Fed by execute-command-stream. Kept separate from the install modal's pane so
// the two can be open independently.
ipcRenderer.on('command-stream-data', (_event: any, payload: { type: string; data: string }) => {
    if (!overlayStreaming) return;

    const output = document.getElementById('loading-output');
    if (!output) return;

    // Strip ANSI colour — this is a plain <pre>, not a terminal.
    output.textContent += payload.data.replace(/\x1b\[[0-9;]*m/g, '');
    output.scrollTop = output.scrollHeight;
});

// Keep the overlay up with its output when something fails, so the user can
// actually read why. Previously the whole of stdout — curl progress bars and
// all — was concatenated into a toast, which was unreadable.
function failLoadingOverlay(message: string, details: string): void {
    overlayStreaming = false;

    const messageEl = document.getElementById('loading-message');
    const detailsEl = document.getElementById('loading-details');
    const spinner = document.querySelector('#loading-overlay .loading-spinner') as HTMLElement;
    const dismiss = document.getElementById('loading-dismiss');

    if (messageEl) messageEl.textContent = message;
    if (detailsEl) detailsEl.textContent = details;
    if (spinner) spinner.style.display = 'none';
    if (dismiss) dismiss.style.display = 'inline-block';
}

function hideLoadingOverlay(): void {
    overlayStreaming = false;

    const spinner = document.querySelector('#loading-overlay .loading-spinner') as HTMLElement;
    const dismiss = document.getElementById('loading-dismiss');
    if (spinner) spinner.style.display = '';
    if (dismiss) dismiss.style.display = 'none';
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// Initial loading screen functions
function showInitialLoading(): void {
    const initialLoading = document.getElementById('initial-loading');
    if (initialLoading) {
        initialLoading.style.display = 'flex';
        initialLoading.classList.remove('hide');
    }
}

function hideInitialLoading(): void {
    const initialLoading = document.getElementById('initial-loading');
    if (initialLoading) {
        initialLoading.classList.add('hide');
        // Remove from DOM after transition completes
        setTimeout(() => {
            initialLoading.style.display = 'none';
        }, 500);
    }
}

// Utility functions
let currentNotification: HTMLElement | null = null;

function showLoading(message: string): void {
    hideNotification();
    currentNotification = showNotification(message, 'loading', 0);
}

function showSuccess(message: string): void {
    hideNotification();
    currentNotification = showNotification(message, 'success', 5000);
}

function showError(message: string): void {
    hideNotification();
    currentNotification = showNotification(message, 'error', 8000);
}

function hideNotification(): void {
    if (currentNotification) {
        currentNotification.remove();
        currentNotification = null;
    }
}

function showNotification(message: string, type: 'success' | 'error' | 'info' | 'loading' = 'info', duration: number = 5000): HTMLElement {
    hideNotification();

    const notification: HTMLElement = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-message">${message}</span>
            <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;

    document.body.appendChild(notification);

    // Auto-hide after duration (if duration > 0)
    if (duration > 0) {
        setTimeout((): void => {
            if (notification.parentNode) {
                notification.remove();
                if (currentNotification === notification) {
                    currentNotification = null;
                }
            }
        }, duration);
    }

    return notification;
}

// Debug logging for renderer
if (ipcRenderer) {
    const originalConsoleLog = console.log;
    console.log = function(...args: any[]): void {
        originalConsoleLog.apply(console, args);
        if (ipcRenderer) {
            ipcRenderer.invoke('renderer-log', ...args);
        }
    }
    
    // Log that renderer is ready
    if (document.readyState === 'loading') {
        ipcRenderer.invoke('renderer-log', '🎯 DOM loaded, initializing...');
    }
    
    loadProjects();
    loadServices();
    
    // Add functions to global scope for debugging
    (window as any).testStartProject = testStartProject;
    (window as any).startProject = startProject;
    
    console.log('✅ Initialization complete, functions available:', {
        testStartProject: typeof (window as any).testStartProject,
        startProject: typeof (window as any).startProject
    });
}

// Test function for debugging
async function testStartProject(projectName: string): Promise<void> {
    console.log('🧪 Testing startProject with:', projectName);
    try {
        const result = await ipcRenderer.invoke('execute-podium', 'up', [projectName]);
        console.log('✅ Command result:', result);
    } catch (error) {
        console.error('❌ Command failed:', error);
    }
}

// Service management functions
async function startServices(): Promise<void> {
    try {
        showLoadingOverlay('Starting Services', 'Starting all shared services...');
        // No flags: the podium dispatcher invokes start_services.sh/stop_services.sh
        // without forwarding arguments, so --json-output never reaches them.
        // Success is judged by the exit code.
        const result = await ipcRenderer.invoke('execute-podium', 'start-services', []);
        
        hideLoadingOverlay();
        
        if (result.code === 0) {
            showSuccess('Shared services started successfully');
        } else {
            showError(`Failed to start services: ${result.stderr || result.stdout}`);
        }
        
        // Refresh both services and projects status
        setTimeout(() => {
            loadServices();
            loadProjects();
        }, 2000);
    } catch (error) {
        hideLoadingOverlay();
        showError('Error starting services: ' + (error as Error).message);
    }
}

async function stopServices(): Promise<void> {
    try {
        showLoadingOverlay('Stopping Services', 'Stopping all shared services...');
        const result = await ipcRenderer.invoke('execute-podium', 'stop-services', []);
        
        hideLoadingOverlay();
        
        if (result.code === 0) {
            showSuccess('Shared services stopped successfully');
        } else {
            showError(`Failed to stop services: ${result.stderr || result.stdout}`);
        }
        
        // Refresh both services and projects status
        setTimeout(() => {
            loadServices();
            loadProjects();
        }, 2000);
    } catch (error) {
        hideLoadingOverlay();
        showError('Error stopping services: ' + (error as Error).message);
    }
}

async function startAllProjects(): Promise<void> {
    if (projects.length === 0) {
        showNotification('No projects to start', 'info', 3000);
        return;
    }
    
    try {
        // Start all stopped projects
        const stoppedProjects = projects.filter(p => p.status === 'stopped');
        
        if (stoppedProjects.length === 0) {
            showNotification('All projects are already running', 'info', 3000);
            return;
        }
        
        // Show loading overlay
        showLoadingOverlay('Starting All Projects', `Starting ${stoppedProjects.length} project(s)...`);
        
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < stoppedProjects.length; i++) {
            const project = stoppedProjects[i];
            if (!project) continue;
            
            // Update progress
            showLoadingOverlay(
                'Starting All Projects', 
                `Starting ${project.name} (${i + 1} of ${stoppedProjects.length})...`
            );
            
            try {
                const result = await ipcRenderer.invoke('execute-podium', 'up', [project.name, '--json-output']);
                if (result.code === 0) {
                    successCount++;
                } else {
                    failCount++;
                    console.error(`Failed to start ${project.name}:`, result.stderr);
                }
            } catch (error) {
                failCount++;
                console.error(`Error starting ${project.name}:`, error);
            }
        }
        
        // Hide loading overlay
        hideLoadingOverlay();
        
        if (failCount === 0) {
            showSuccess(`Successfully started ${successCount} projects`);
        } else if (successCount > 0) {
            showNotification(`Started ${successCount} projects, ${failCount} failed`, 'info', 5000);
        } else {
            showError(`Failed to start all ${failCount} projects`);
        }
        
        // Refresh project list
        setTimeout(() => {
            loadProjects();
            loadServices();
        }, 3000);
    } catch (error) {
        hideLoadingOverlay();
        showError('Error starting projects: ' + (error as Error).message);
    }
}

async function stopAllProjects(): Promise<void> {
    if (projects.length === 0) {
        showNotification('No projects to stop', 'info', 3000);
        return;
    }
    
    try {
        // Stop all running projects
        const runningProjects = projects.filter(p => p.status === 'running' || p.status === 'starting');
        
        if (runningProjects.length === 0) {
            showNotification('All projects are already stopped', 'info', 3000);
            return;
        }
        
        // Show loading overlay
        showLoadingOverlay('Stopping All Projects', `Stopping ${runningProjects.length} project(s)...`);
        
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < runningProjects.length; i++) {
            const project = runningProjects[i];
            if (!project) continue;
            
            // Update progress
            showLoadingOverlay(
                'Stopping All Projects', 
                `Stopping ${project.name} (${i + 1} of ${runningProjects.length})...`
            );
            
            try {
                const result = await ipcRenderer.invoke('execute-podium', 'down', [project.name, '--json-output']);
                if (result.code === 0) {
                    successCount++;
                } else {
                    failCount++;
                    console.error(`Failed to stop ${project.name}:`, result.stderr);
                }
            } catch (error) {
                failCount++;
                console.error(`Error stopping ${project.name}:`, error);
            }
        }
        
        // Hide loading overlay
        hideLoadingOverlay();
        
        if (failCount === 0) {
            showSuccess(`Successfully stopped ${successCount} projects`);
        } else if (successCount > 0) {
            showNotification(`Stopped ${successCount} projects, ${failCount} failed`, 'info', 5000);
        } else {
            showError(`Failed to stop all ${failCount} projects`);
        }
        
        // Refresh project list
        setTimeout(() => {
            loadProjects();
            loadServices();
        }, 3000);
    } catch (error) {
        hideLoadingOverlay();
        showError('Error stopping projects: ' + (error as Error).message);
    }
}

// Additional GUI functions
async function createNewProject(): Promise<void> {
    console.log('DEBUG: createNewProject called');

    showModal('new-project-modal');
    // The header button and the empty-state button are separate entry points;
    // both need the catalogue built before the form is usable.
    await loadFrameworkCatalog();
}

// Make this function available globally immediately
(window as any).createNewProject = createNewProject;

function handleCreateProject(): void {
    console.log('DEBUG: handleCreateProject called');
    submitNewProject().catch(error => {
        console.error('Error creating project:', error);
        showError(`Failed to create project: ${error.message}`);
    });
}

// Functions made globally available at end of file

// ---------------------------------------------------------------------------
// AI agent settings (`podium ai-set`)
//
// Saving can INSTALL the agent — ai_set.sh's ensure_ai_agent_installed runs
// `npm install -g` for codex/gemini and curl installers for claude/aider — so
// this streams rather than spinning silently.
// ---------------------------------------------------------------------------

// Which fields each agent actually uses, from `podium ai-set --help` and the
// CLI's endpoint table. `--api-base` is no longer aider-only: Podium passes it
// to whichever env var each agent CLI reads. gemini has no endpoint at all
// (Google account auth), and claude needs an ANTHROPIC-compatible proxy rather
// than a raw Ollama URL — worth saying, or people point it at :11434 and it fails.
const AI_AGENT_RULES: Record<string, {
    modelRequired: boolean;
    keyRequired: boolean;
    apiBase: boolean;
    apiBaseNote: string;
    minNode?: number;
}> = {
    claude: { modelRequired: false, keyRequired: false, apiBase: true,
              apiBaseNote: 'Must be Anthropic-compatible — a LiteLLM proxy for local models, not a raw Ollama URL.' },
    codex:  { modelRequired: false, keyRequired: false, apiBase: true,
              apiBaseNote: 'OpenAI-compatible endpoint.' },
    gemini: { modelRequired: false, keyRequired: false, apiBase: false,
              apiBaseNote: '' },
    qwen:   { modelRequired: true,  keyRequired: false, apiBase: true,
              apiBaseNote: 'OpenAI-compatible endpoint.', minNode: 22 },
    aider:  { modelRequired: true,  keyRequired: true,  apiBase: true,
              apiBaseNote: 'OpenAI-compatible endpoint.' }
};

// Known-good configurations. A dropdown of these beats a blank URL field —
// running against a cheap or local model is most of the point of this panel.
const AI_PRESETS: Record<string, {
    agent: string; apiBase: string; apiKey: string; model: string; clearKey: boolean;
}> = {
    hosted:     { agent: 'claude', apiBase: '', apiKey: '', model: '', clearKey: true },
    ollama:     { agent: 'qwen',   apiBase: 'http://localhost:11434/v1', apiKey: 'ollama', model: '', clearKey: false },
    openrouter: { agent: 'qwen',   apiBase: 'https://openrouter.ai/api/v1', apiKey: '', model: 'qwen/qwen3-coder-next', clearKey: false },
    lmstudio:   { agent: 'codex',  apiBase: 'http://localhost:1234/v1', apiKey: 'local', model: '', clearKey: false }
};

function isLocalEndpoint(url: string): boolean {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url || '');
}

async function applyAiPreset(): Promise<void> {
    const key = (document.getElementById('ai-preset') as HTMLSelectElement)?.value || '';
    const preset = AI_PRESETS[key];
    if (!preset) return;

    (document.getElementById('ai-agent') as HTMLSelectElement).value = preset.agent;
    (document.getElementById('ai-api-base') as HTMLInputElement).value = preset.apiBase;
    (document.getElementById('ai-api-key') as HTMLInputElement).value = preset.apiKey;
    (document.getElementById('ai-model') as HTMLInputElement).value = preset.model;

    // "Default (hosted)" has to actively CLEAR the stored key and endpoint —
    // omitting the flags would leave the previous local settings in place.
    const clear = document.getElementById('ai-clear-key') as HTMLInputElement;
    if (clear) clear.checked = preset.clearKey;

    await onAiAgentChange();
}

function debugAiState(state: any): void {
    console.log('ai-set now reports:', JSON.stringify(state));
}

async function showAiSettings(): Promise<void> {
    clearFieldErrors();
    const output = document.getElementById('ai-settings-output');
    const wrap = document.getElementById('ai-settings-output-wrap');
    if (output) output.textContent = '';
    if (wrap) wrap.style.display = 'none';

    const current = await ipcRenderer.invoke('get-ai-agent-full');

    (document.getElementById('ai-agent') as HTMLSelectElement).value = current.agent || '';
    (document.getElementById('ai-model') as HTMLInputElement).value = current.model || '';
    (document.getElementById('ai-api-base') as HTMLInputElement).value = current.api_base || '';
    (document.getElementById('ai-api-key') as HTMLInputElement).value = '';

    const note = document.getElementById('ai-key-note');
    if (note) {
        note.textContent = current.has_api_key
            ? 'A key is stored. Leave blank to keep it.'
            : 'No key stored.';
    }

    // Only offer "clear the key" when there is one to clear.
    const clearGroup = document.getElementById('ai-clear-key-group');
    const clearBox = document.getElementById('ai-clear-key') as HTMLInputElement;
    if (clearGroup) clearGroup.style.display = current.has_api_key ? 'block' : 'none';
    if (clearBox) clearBox.checked = false;

    (document.getElementById('ai-preset') as HTMLSelectElement).value = '';

    await onAiAgentChange();
    showModal('ai-settings-modal');
}

async function onAiAgentChange(): Promise<void> {
    // Switching agents invalidates any previous validation message. Without
    // this, selecting aider, failing validation, then switching to Claude left
    // "aider requires a model" sitting under a field marked optional.
    clearFieldErrors();

    const agent = (document.getElementById('ai-agent') as HTMLSelectElement)?.value || '';
    const rules = AI_AGENT_RULES[agent];

    const status = document.getElementById('ai-agent-status');
    if (status) {
        status.textContent = agent
            ? 'Podium installs this agent if it is not already present.'
            : 'Create with AI and Modify with AI stay disabled without an agent.';
    }

    const baseGroup = document.getElementById('ai-api-base-group');
    if (baseGroup) baseGroup.style.display = rules?.apiBase ? 'block' : 'none';

    const baseHelp = document.getElementById('ai-api-base-help');
    if (baseHelp) baseHelp.textContent = rules?.apiBaseNote || '';

    const modelReq = document.getElementById('ai-model-req');
    if (modelReq) modelReq.textContent = rules?.modelRequired ? '(required)' : '(optional)';

    const keyReq = document.getElementById('ai-key-req');
    if (keyReq) keyReq.textContent = rules?.keyRequired ? '(required)' : '(optional)';

    // Qwen Code wants Node 22+. It runs on 20 with an EBADENGINE warning, which
    // is unsupported — and our own installers pin 20, so say so rather than
    // offering to install something this machine cannot properly run.
    const nodeWarning = document.getElementById('ai-node-warning');
    if (nodeWarning) {
        nodeWarning.style.display = 'none';
        if (rules?.minNode) {
            const major = await ipcRenderer.invoke('get-node-major');
            if (major > 0 && major < rules.minNode) {
                nodeWarning.textContent =
                    `${agent} needs Node ${rules.minNode}+. This machine has Node ${major}, `
                    + `where it installs with an EBADENGINE warning and is unsupported.`;
                nodeWarning.style.display = 'block';
            }
        }
    }

    const apiBase = (document.getElementById('ai-api-base') as HTMLInputElement)?.value || '';
    const localWarning = document.getElementById('ai-local-warning');
    if (localWarning) localWarning.style.display = isLocalEndpoint(apiBase) ? 'block' : 'none';

    await refreshOllamaModels(apiBase);
}

// Offer the models the user has actually pulled. Turns the hardest step of a
// local setup into a click; falls back silently to free text when Ollama is
// not reachable.
async function refreshOllamaModels(apiBase: string): Promise<void> {
    const list = document.getElementById('ai-model-options');
    const hint = document.getElementById('ai-model-hint');
    if (!list) return;

    list.innerHTML = '';
    if (hint) hint.textContent = '';
    if (!isLocalEndpoint(apiBase)) return;

    const models: string[] = await ipcRenderer.invoke('list-ollama-models', apiBase);
    if (models.length === 0) {
        if (hint) hint.textContent = 'Ollama is not reachable — type the model name.';
        return;
    }

    list.innerHTML = models.map((m) => `<option value="${escapeHtml(m)}"></option>`).join('');
    if (hint) hint.textContent = `${models.length} model(s) available locally — start typing to pick one.`;
}

let aiSettingsStreaming = false;

ipcRenderer.on('command-stream-data', (_event: any, payload: { type: string; data: string }) => {
    if (!aiSettingsStreaming) return;
    const output = document.getElementById('ai-settings-output');
    if (!output) return;
    output.textContent += payload.data.replace(/\x1b\[[0-9;]*m/g, '');
    output.scrollTop = output.scrollHeight;
});

async function saveAiSettings(): Promise<void> {
    clearFieldErrors();

    const agent = (document.getElementById('ai-agent') as HTMLSelectElement)?.value || '';
    const model = (document.getElementById('ai-model') as HTMLInputElement)?.value?.trim() || '';
    const apiKey = (document.getElementById('ai-api-key') as HTMLInputElement)?.value?.trim() || '';
    const apiBase = (document.getElementById('ai-api-base') as HTMLInputElement)?.value?.trim() || '';
    const rules = AI_AGENT_RULES[agent];

    if (agent && rules?.modelRequired && !model) {
        showFieldError('ai-model', `${agent} requires a model.`);
        return;
    }

    const args = ['ai-set', '--agent', agent];
    if (model) args.push('--model', model);

    // Endpoint is sent EVERY time, as a value or as `none`. Omitting it leaves
    // whatever the previous agent stored, so switching from a local preset back
    // to hosted would silently keep pointing at localhost.
    if (rules?.apiBase) {
        args.push('--api-base', apiBase || 'none');
    } else {
        args.push('--api-base', 'none');
    }

    // The key is write-only — blank means "keep what is stored", because the
    // field never shows it. Clearing therefore has to be explicit.
    const clearKey = (document.getElementById('ai-clear-key') as HTMLInputElement)?.checked;
    if (apiKey) {
        args.push('--api-key', apiKey);
    } else if (clearKey) {
        args.push('--api-key', '');
    }

    const wrap = document.getElementById('ai-settings-output-wrap');
    const output = document.getElementById('ai-settings-output');
    if (wrap) wrap.style.display = 'block';
    if (output) output.textContent = '';
    aiSettingsStreaming = true;

    try {
        // Not --json-output: that suppresses the installer's progress, which is
        // the whole reason this streams.
        const result = await ipcRenderer.invoke('execute-command-stream', 'podium', args);
        aiSettingsStreaming = false;

        if (result.code === 0) {
            // Confirm what actually landed rather than trusting the exit code —
            // the clearing semantics are the fiddly part of this panel.
            const now = await ipcRenderer.invoke('get-ai-agent-full');
            debugAiState(now);
            showSuccess(agent
                ? `AI agent set to ${agent}${now.api_base ? ` via ${now.api_base}` : ''}.`
                : 'AI agent cleared.');
            closeModal();
        } else {
            showError(`Could not set the AI agent (exit ${result.code}). See the output above.`);
        }
    } catch (error) {
        aiSettingsStreaming = false;
        showError('Error setting the AI agent: ' + (error as Error).message);
    }
}

// ---------------------------------------------------------------------------
// Create with AI (`podium create`, driven phase by phase)
//
// Phase 1 classify -> render choices natively -> phase 2 create -> phase 3 build.
// Shelling out to `podium create` in one call is not an option: it presents
// interactive terminal menus a GUI cannot answer, and --json-output silently
// auto-picks the top recommendation instead.
// ---------------------------------------------------------------------------

interface ClassifyCandidate {
    kind: 'app' | 'framework';
    slug: string;
    display: string;
    reason: string;
    database?: string;
    databases?: string[];
}

interface Classification {
    status: 'success' | 'error';
    message?: string;
    project_name: string | null;
    recommended: 'app' | 'framework';
    customization_requested: boolean;
    database?: { slug: string; reason: string } | null;
    candidates: ClassifyCandidate[];
}

let classification: Classification | null = null;
let chosenCandidate: ClassifyCandidate | null = null;
let currentIdea = '';

async function showCreateWithAI(): Promise<void> {
    classification = null;
    chosenCandidate = null;
    currentIdea = '';

    (document.getElementById('create-idea') as HTMLTextAreaElement).value = '';
    (document.getElementById('create-name') as HTMLInputElement).value = '';
    (document.getElementById('create-output') as HTMLElement).textContent = '';
    clearFieldErrors();
    setCreateStage('idea');
    showModal('create-ai-modal');

    // Creating is meaningless without an agent; say so up front rather than
    // failing a minute later inside the classifier.
    const { agent } = await ipcRenderer.invoke('get-ai-agent');
    const warning = document.getElementById('create-no-agent');
    const classifyBtn = document.getElementById('create-classify-btn') as HTMLButtonElement;

    if (warning) warning.style.display = agent ? 'none' : 'block';
    if (classifyBtn) classifyBtn.disabled = !agent;
}

function setCreateStage(stage: 'idea' | 'thinking' | 'choose' | 'building'): void {
    const stages: Record<string, string> = {
        idea: 'create-stage-idea',
        thinking: 'create-stage-thinking',
        choose: 'create-stage-choose',
        building: 'create-stage-building'
    };

    for (const [name, id] of Object.entries(stages)) {
        const el = document.getElementById(id);
        if (el) el.style.display = name === stage ? 'block' : 'none';
    }

    const classifyBtn = document.getElementById('create-classify-btn') as HTMLButtonElement;
    const confirmBtn = document.getElementById('create-confirm-btn') as HTMLButtonElement;
    const cancelBtn = document.getElementById('create-cancel-btn') as HTMLButtonElement;

    if (classifyBtn) classifyBtn.style.display = stage === 'idea' ? '' : 'none';
    if (confirmBtn) confirmBtn.style.display = stage === 'choose' ? '' : 'none';
    if (cancelBtn) cancelBtn.textContent = stage === 'building' ? 'Close' : 'Cancel';
}

async function handleClassifyIdea(): Promise<void> {
    const idea = (document.getElementById('create-idea') as HTMLTextAreaElement)?.value?.trim() || '';

    clearFieldErrors();
    if (!idea) {
        showFieldError('create-idea', 'Describe what you want to build.');
        return;
    }

    currentIdea = idea;
    setCreateStage('thinking');

    const result: Classification = await ipcRenderer.invoke('classify-idea', idea);

    if (result.status !== 'success' || result.candidates.length === 0) {
        setCreateStage('idea');
        showFieldError('create-idea', result.message || 'Could not work out a stack for that.');
        return;
    }

    renderClassification(result);
    setCreateStage('choose');
}

// Split out so the rendering can be tested with a fixture rather than a live
// AI round-trip, which is slow and non-deterministic.
function renderClassification(result: Classification): void {
    const list = document.getElementById('create-candidates');
    if (!list) return;

    // Rendering a classification makes it the current one. selectCandidate and
    // handleCreateFromChoice both read this, so setting it here keeps the two
    // in step and makes the function usable on its own.
    classification = result;

    // The CLI orders these apps-first, framework-last, and marks whichever kind
    // it actually recommends — not simply the first row.
    const recommendedIndex = result.candidates.findIndex((c) => c.kind === result.recommended);

    list.innerHTML = result.candidates.map((candidate, index) => {
        const tag = candidate.kind === 'app'
            ? 'ready to run — live in about 2 minutes'
            : 'custom build — exactly what you asked for, more time and tokens';
        const badge = index === recommendedIndex
            ? '<span class="rec-badge">Recommended</span>'
            : '';

        return `
            <div class="candidate" onclick="selectCandidate(${index})" data-testid="candidate-${escapeHtml(candidate.slug)}">
                <div class="candidate-header">
                    <strong>${escapeHtml(candidate.display)}</strong>
                    <code class="app-slug">${escapeHtml(candidate.slug)}</code>
                    ${badge}
                </div>
                <p class="candidate-tag">${tag}</p>
                <p class="app-note">${escapeHtml(candidate.reason)}</p>
            </div>
        `;
    }).join('');

    // Prefill the name only when the idea implied a real subject; the CLI
    // returns null rather than inventing "flask-app", and that means ask.
    const nameInput = document.getElementById('create-name') as HTMLInputElement;
    const nameHelp = document.getElementById('create-name-help');
    if (nameInput) nameInput.value = result.project_name || '';
    if (nameHelp) {
        nameHelp.textContent = result.project_name
            ? 'Becomes the project directory and the hostname.'
            : 'Your description does not suggest a name — pick one.';
    }

    selectCandidate(recommendedIndex >= 0 ? recommendedIndex : 0);
}

function selectCandidate(index: number): void {
    if (!classification) return;

    const candidate = classification.candidates[index];
    if (!candidate) return;

    chosenCandidate = candidate;

    document.querySelectorAll('#create-candidates .candidate').forEach((el, i) => {
        el.classList.toggle('selected', i === index);
    });

    const dbGroup = document.getElementById('create-database-group');
    const dbSelect = document.getElementById('create-database') as HTMLSelectElement;
    const dbWhy = document.getElementById('create-database-why');
    const fixed = document.getElementById('create-fixed-db');
    const fixedText = document.getElementById('create-fixed-db-text');

    if (candidate.kind === 'app') {
        // The installer's compose fixes the engine — never offer a choice here.
        if (dbGroup) dbGroup.style.display = 'none';
        if (fixed) fixed.style.display = 'block';
        if (fixedText) {
            fixedText.textContent = candidate.database
                ? `Database: ${candidate.database} — set by the ${candidate.display} installer.`
                : `Database: managed internally by ${candidate.display}.`;
        }
    } else {
        if (fixed) fixed.style.display = 'none';
        if (dbGroup) dbGroup.style.display = 'block';

        // Offer only engines this framework actually supports, recommended first.
        const allowed = candidate.databases || [];
        const recommended = classification.database?.slug || '';
        const ordered = allowed.includes(recommended)
            ? [recommended, ...allowed.filter((d) => d !== recommended)]
            : allowed;

        if (dbSelect) {
            dbSelect.innerHTML = ordered.map((db, i) =>
                `<option value="${escapeHtml(db)}">${escapeHtml(db)}${i === 0 && db === recommended ? ' (recommended)' : ''}</option>`
            ).join('');
        }
        if (dbWhy) {
            dbWhy.textContent = allowed.includes(recommended)
                ? (classification.database?.reason || '')
                : `Only engines ${candidate.display} supports are offered.`;
        }
    }

    const confirmBtn = document.getElementById('create-confirm-btn') as HTMLButtonElement;
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = candidate.kind === 'app'
            ? `Install ${candidate.display}`
            : `Create ${candidate.display} project`;
    }
}

async function handleCreateFromChoice(): Promise<void> {
    if (!classification || !chosenCandidate) return;

    clearFieldErrors();

    const name = (document.getElementById('create-name') as HTMLInputElement)?.value?.trim() || '';
    const validation = validateProjectName(name);
    if (!validation.valid) {
        showFieldError('create-name', validation.error!);
        return;
    }

    const sanitized = sanitizeContainerName(name);
    if (!sanitized) {
        showFieldError('create-name', 'Project name must contain at least one valid character.');
        return;
    }

    const sudoOk = await ipcRenderer.invoke('ensure-sudo');
    if (!sudoOk) {
        showError('Could not authenticate for the hosts file change. Run it from a terminal instead.');
        return;
    }

    const candidate = chosenCandidate;
    installInProgress = true;
    setCreateStage('building');

    const title = document.getElementById('create-build-title');
    if (title) {
        title.textContent = candidate.kind === 'app'
            ? `Installing ${candidate.display} as "${sanitized}"…`
            : `Creating ${candidate.display} project "${sanitized}"…`;
    }

    // Phase 2 is deterministic and identical to the existing flows — no AI.
    const args = candidate.kind === 'app'
        ? ['install', candidate.slug, sanitized, '--one-off']
        : ['new', candidate.slug, sanitized,
           ...((document.getElementById('create-database') as HTMLSelectElement)?.value
               ? ['--database', (document.getElementById('create-database') as HTMLSelectElement).value]
               : []),
           '--one-off'];

    try {
        const result = await ipcRenderer.invoke('execute-command-stream', 'podium', args);
        installInProgress = false;

        if (result.code !== 0) {
            showError(`Create failed (exit ${result.code}). See the output above.`);
            if (title) title.textContent = `Creating "${sanitized}" failed (exit ${result.code}).`;
            return;
        }

        loadProjects();
        loadServices();

        // Phase 3. The build is skipped only for a ready-to-run app that the
        // idea asked nothing extra of — a framework scaffold is empty, so it
        // always needs building regardless of customization_requested.
        const needsBuild = !(candidate.kind === 'app' && classification!.customization_requested === false);

        if (needsBuild) {
            if (title) title.textContent = `"${sanitized}" is ready — now building your idea.`;
            openBuildTerminal(sanitized, currentIdea);
        } else {
            if (title) title.textContent = `${candidate.display} is installed — http://${sanitized}/`;
            showSuccess(`${candidate.display} installed at http://${sanitized}/`);
        }
    } catch (error) {
        installInProgress = false;
        showError('Error creating project: ' + (error as Error).message);
    }
}

// ---------------------------------------------------------------------------
// Phase 3: the AI build session, in a real embedded terminal
// ---------------------------------------------------------------------------

interface TerminalSession {
    id: string;
    key: string;          // stable per target, so re-opening focuses rather than duplicates
    label: string;
    term: any;
    fit: any;
    pane: HTMLElement;
    exited: boolean;
    status: string;
}

// Sessions outlive the window: hiding the terminal modal leaves them running,
// and the header's Terminals button brings them back. Only the tab's × (or
// "End session") kills a pty. The main process already keys ptys by id, so
// nothing there needed changing.
const terminalSessions = new Map<string, TerminalSession>();
let activeTerminalId = '';
let terminalResizeHandler: (() => void) | null = null;

function updateTerminalsButton(): void {
    const button = document.getElementById('terminals-button');
    if (!button) return;

    const live = terminalSessions.size;
    button.style.display = live > 0 ? '' : 'none';
    button.textContent = live > 1 ? `🖥️ Terminals (${live})` : '🖥️ Terminals';
}

function renderTerminalTabs(): void {
    const bar = document.getElementById('terminal-tabs');
    if (!bar) return;

    bar.innerHTML = [...terminalSessions.values()].map((session) => `
        <div class="terminal-tab${session.id === activeTerminalId ? ' active' : ''}${session.exited ? ' exited' : ''}"
             onclick="activateTerminal('${session.id}')"
             data-testid="terminal-tab-${escapeHtml(session.key)}">
            <span>${escapeHtml(session.label)}</span>
            <button class="tab-close" title="End this session"
                    onclick="event.stopPropagation(); killTerminal('${session.id}')">&times;</button>
        </div>
    `).join('');

    bar.style.display = terminalSessions.size > 1 ? 'flex' : 'none';
    updateTerminalsButton();
}

function fitTerminal(session: TerminalSession): void {
    try {
        session.fit.fit();
        ipcRenderer.invoke('pty-resize', session.id, session.term.cols, session.term.rows);
    } catch (error) {
        // A fit racing teardown is not worth surfacing.
    }
}

function activateTerminal(id: string): void {
    const session = terminalSessions.get(id);
    if (!session) return;

    activeTerminalId = id;
    terminalSessions.forEach((s) => {
        s.pane.style.display = s.id === id ? 'block' : 'none';
    });

    const status = document.getElementById('build-terminal-status');
    if (status) status.textContent = session.status;

    const title = document.getElementById('build-terminal-title');
    if (title) title.textContent = terminalSessions.size > 1 ? '🖥️ Terminals' : session.label;

    renderTerminalTabs();

    // Fit only once visible — measuring a hidden pane gives the wrong rows.
    setTimeout(() => {
        fitTerminal(session);
        session.term.focus();
    }, 30);
}

function showTerminals(): void {
    if (terminalSessions.size === 0) return;
    showModal('build-terminal-modal');
    activateTerminal(activeTerminalId && terminalSessions.has(activeTerminalId)
        ? activeTerminalId
        : [...terminalSessions.keys()][0]!);
}

// Closing the window does NOT end the sessions — that is what the tab × is for.
function hideTerminals(): void {
    closeModal();
    updateTerminalsButton();
    loadProjects();
}

function killTerminal(id: string): void {
    const session = terminalSessions.get(id);
    if (!session) return;

    ipcRenderer.invoke('pty-kill', id);
    try { session.term.dispose(); } catch (error) { /* already gone */ }
    session.pane.remove();
    terminalSessions.delete(id);

    if (terminalSessions.size === 0) {
        activeTerminalId = '';
        if (terminalResizeHandler) {
            window.removeEventListener('resize', terminalResizeHandler);
            terminalResizeHandler = null;
        }
        closeModal();
    } else if (activeTerminalId === id) {
        activateTerminal([...terminalSessions.keys()][0]!);
    } else {
        renderTerminalTabs();
    }

    updateTerminalsButton();
    loadProjects();
}

function closeActiveTerminal(): void {
    if (activeTerminalId) killTerminal(activeTerminalId);
}

interface AgentTerminalOptions {
    title: string;
    status: string;
    cwd: string;
    command: string;
    args: string[];
    sessionKey: string;
    /** Shown if the pty cannot start, so the user can run it themselves. */
    fallbackHint?: string;
}

// One embedded-terminal implementation for both agent entry points: the build
// hand-off after `create`, and "Modify with AI" on an existing project.
async function openAgentTerminal(options: AgentTerminalOptions): Promise<void> {
    const { Terminal } = require('@xterm/xterm');
    const { FitAddon } = require('@xterm/addon-fit');

    const panes = document.getElementById('terminal-panes');
    if (!panes) return;

    closeModal();

    // Re-opening the same target focuses the live session rather than starting a
    // second agent in the same directory.
    const existing = [...terminalSessions.values()].find((s) => s.key === options.sessionKey && !s.exited);
    if (existing) {
        showModal('build-terminal-modal');
        activateTerminal(existing.id);
        return;
    }

    const id = `${options.sessionKey}-${performance.now()}`;
    const pane = document.createElement('div');
    pane.className = 'terminal-pane';
    pane.dataset.sessionId = id;
    panes.appendChild(pane);

    const term = new Terminal({
        fontSize: 13,
        fontFamily: 'monospace',
        cursorBlink: true,
        theme: { background: '#0f0f23', foreground: '#f8fafc' }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(pane);

    const session: TerminalSession = {
        id, key: options.sessionKey, label: options.title,
        term, fit, pane, exited: false, status: options.status
    };
    terminalSessions.set(id, session);

    term.onData((data: string) => ipcRenderer.invoke('pty-input', id, data));

    if (!terminalResizeHandler) {
        terminalResizeHandler = () => {
            const active = terminalSessions.get(activeTerminalId);
            if (active) fitTerminal(active);
        };
        window.addEventListener('resize', terminalResizeHandler);
    }

    showModal('build-terminal-modal');
    activateTerminal(id);

    const started = await ipcRenderer.invoke('pty-start', id, options.cwd, options.command, options.args);

    if (!started.ok) {
        term.writeln('\r\n\x1b[31mCould not start an embedded terminal.\x1b[0m');
        term.writeln(`\x1b[2m${started.error || ''}\x1b[0m`);
        term.writeln('');
        term.writeln('Run this yourself instead:');
        term.writeln(`\x1b[36m  ${options.fallbackHint || `cd ${options.cwd} && ${options.command} ${options.args.join(' ')}`}\x1b[0m`);
        session.status = 'Embedded terminal unavailable — run the command above.';
        session.exited = true;
        activateTerminal(id);
    }
}

// Continue the AI session on an existing project.
//
// `podium resume <project>` starts the project, prints its status and URL, then
// reopens the agent with its previous conversation (claude --continue,
// codex resume --last, gemini --resume latest, aider --restore-chat-history).
async function modifyWithAI(projectName: string): Promise<void> {
    const { agent } = await ipcRenderer.invoke('get-ai-agent');
    if (!agent) {
        showError('No AI agent is configured. Run `podium ai-set` in a terminal first.');
        return;
    }

    // resume takes the project name and cds itself, so run it from the projects
    // directory rather than inside the project.
    const projectsDir = await ipcRenderer.invoke('get-projects-dir');
    await openAgentTerminal({
        title: `✨ ${projectName}`,
        status: 'Resuming the AI session in this project.',
        cwd: projectsDir,
        command: 'podium',
        args: ['resume', projectName],
        sessionKey: `resume-${projectName}`,
        fallbackHint: `cd ${projectsDir} && podium resume ${projectName}`
    });
}

// Phase 3 of create: hand the original idea to the agent inside the finished
// project, which picks up the AGENTS.md handoff file written there.
async function openBuildTerminal(projectName: string, idea: string): Promise<void> {
    const projectsDir = await ipcRenderer.invoke('get-projects-dir');
    await openAgentTerminal({
        title: `🛠️ ${projectName}`,
        status: 'Session running — type to answer the agent.',
        cwd: `${projectsDir}/${projectName}`,
        command: 'podium',
        args: ['ai', idea],
        sessionKey: `build-${projectName}`,
        fallbackHint: `cd ${projectsDir}/${projectName} && podium ai`
    });
}

ipcRenderer.on('pty-data', (_event: any, payload: { sessionId: string; data: string }) => {
    terminalSessions.get(payload.sessionId)?.term.write(payload.data);
});

ipcRenderer.on('pty-exit', (_event: any, payload: { sessionId: string; exitCode: number }) => {
    const session = terminalSessions.get(payload.sessionId);
    if (!session) return;

    session.exited = true;
    session.status = payload.exitCode === 0
        ? 'Session finished.'
        : `Session exited with code ${payload.exitCode}.`;
    session.term.writeln(`\r\n\x1b[2m[session ended: ${payload.exitCode}]\x1b[0m`);

    if (session.id === activeTerminalId) {
        const status = document.getElementById('build-terminal-status');
        if (status) status.textContent = session.status;
    }
    renderTerminalTabs();
    loadProjects();
});

// ---------------------------------------------------------------------------
// Install an app (`podium install <app> [name]`)
//
// Distinct from New Project on purpose: `new` scaffolds a framework you write,
// `install` deploys finished software. The database is fixed by each installer,
// so it is shown as information and never offered as a choice.
// ---------------------------------------------------------------------------

interface CatalogApp {
    slug: string;
    display: string;
    database: string;
    note: string;
}

let appCatalog: CatalogApp[] = [];
let selectedApp: CatalogApp | null = null;
let installInProgress = false;

async function showInstallApp(): Promise<void> {
    selectedApp = null;
    installInProgress = false;

    // Reset the modal from any previous run
    const search = document.getElementById('install-search') as HTMLInputElement;
    const nameInput = document.getElementById('install-project-name') as HTMLInputElement;
    const output = document.getElementById('install-output');
    if (search) search.value = '';
    if (nameInput) nameInput.value = '';
    if (output) output.textContent = '';

    setInstallView('picker');
    showModal('install-app-modal');

    if (appCatalog.length === 0) {
        const result = await ipcRenderer.invoke('get-app-catalog');
        appCatalog = result.apps || [];

        if (result.error) {
            console.error('Failed to load app catalogue:', result.error);
            const list = document.getElementById('install-app-list');
            if (list) {
                list.innerHTML = `<p class="app-list-empty">Could not read the app catalogue.<br><small>${escapeHtml(result.error)}</small></p>`;
            }
            return;
        }
    }

    renderAppCatalog();
}

function setInstallView(view: 'picker' | 'progress'): void {
    const picker = document.getElementById('install-picker');
    const progress = document.getElementById('install-progress');
    const submit = document.getElementById('install-submit-btn') as HTMLButtonElement;
    const cancel = document.getElementById('install-cancel-btn') as HTMLButtonElement;

    if (picker) picker.style.display = view === 'picker' ? 'block' : 'none';
    if (progress) progress.style.display = view === 'progress' ? 'block' : 'none';
    if (submit) submit.style.display = view === 'picker' ? '' : 'none';
    if (cancel) cancel.textContent = view === 'picker' ? 'Cancel' : 'Close';
}

function escapeHtml(value: string): string {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}

function renderAppCatalog(): void {
    const list = document.getElementById('install-app-list');
    const countLabel = document.getElementById('install-app-count');
    if (!list) return;

    const query = ((document.getElementById('install-search') as HTMLInputElement)?.value || '')
        .trim()
        .toLowerCase();

    const matches = query === ''
        ? appCatalog
        : appCatalog.filter((app: CatalogApp) =>
            app.slug.toLowerCase().includes(query) ||
            app.display.toLowerCase().includes(query) ||
            app.note.toLowerCase().includes(query));

    if (countLabel) {
        countLabel.textContent = query === ''
            ? `(${appCatalog.length} apps)`
            : `(${matches.length} of ${appCatalog.length})`;
    }

    if (matches.length === 0) {
        list.innerHTML = '<p class="app-list-empty">No apps match that search.</p>';
        return;
    }

    list.innerHTML = matches.map((app: CatalogApp) => {
        const selected = selectedApp?.slug === app.slug ? ' selected' : '';
        // Empty database means the app manages its own storage internally.
        const database = app.database
            ? `<span class="app-db">${escapeHtml(app.database)}</span>`
            : '<span class="app-db app-db-none">self-contained</span>';
        const note = app.note ? `<p class="app-note">${escapeHtml(app.note)}</p>` : '';

        return `
            <div class="app-entry${selected}" onclick="selectApp('${escapeHtml(app.slug)}')" data-testid="app-${escapeHtml(app.slug)}">
                <div class="app-entry-header">
                    <strong>${escapeHtml(app.display)}</strong>
                    <code class="app-slug">${escapeHtml(app.slug)}</code>
                    ${database}
                </div>
                ${note}
            </div>
        `;
    }).join('');
}

function selectApp(slug: string): void {
    selectedApp = appCatalog.find((app: CatalogApp) => app.slug === slug) || null;

    const submit = document.getElementById('install-submit-btn') as HTMLButtonElement;
    if (submit) {
        submit.disabled = selectedApp === null;
        submit.textContent = selectedApp ? `Install ${selectedApp.display}` : 'Install';
    }

    renderAppCatalog();
}

async function handleInstallApp(): Promise<void> {
    if (!selectedApp || installInProgress) return;

    clearFieldErrors();

    const projectName = (document.getElementById('install-project-name') as HTMLInputElement)?.value?.trim() || '';
    if (projectName) {
        const validation = validateProjectName(projectName);
        if (!validation.valid) {
            showFieldError('install-project-name', validation.error!);
            return;
        }
    }

    // Installing writes /etc/hosts through setup + up.
    const sudoOk = await ipcRenderer.invoke('ensure-sudo');
    if (!sudoOk) {
        showError('Could not authenticate for the hosts file change. Run the install from a terminal instead.');
        return;
    }

    const app = selectedApp;
    const target = projectName || app.slug;

    installInProgress = true;
    setInstallView('progress');

    const title = document.getElementById('install-progress-title');
    if (title) title.textContent = `Installing ${app.display} as "${target}"… this can take several minutes.`;

    // Deliberately NOT --json-output: it suppresses all human-readable output,
    // including the URL, credentials and notes printed at the end, and would
    // leave a failure with an empty stdout. --one-off skips the AI handoff,
    // which has nothing to attach to in a GUI.
    const args = ['install', app.slug];
    if (projectName) args.push(projectName);
    args.push('--one-off');

    try {
        const result = await ipcRenderer.invoke('execute-command-stream', 'podium', args);

        installInProgress = false;

        if (result.code === 0) {
            showSuccess(`${app.display} installed at http://${target}/`);
            if (title) title.textContent = `${app.display} is installed — http://${target}/`;
        } else {
            showError(`Install failed (exit ${result.code}). See the output above.`);
            if (title) title.textContent = `Install of ${app.display} failed (exit ${result.code}).`;
        }

        loadProjects();
        loadServices();
    } catch (error) {
        installInProgress = false;
        showError('Error installing app: ' + (error as Error).message);
    }
}

// Live output from the streamed install
ipcRenderer.on('command-stream-data', (_event: any, payload: { type: string; data: string }) => {
    const output = document.getElementById('install-output');
    if (!output || !installInProgress) return;

    output.textContent += payload.data;
    output.scrollTop = output.scrollHeight;
});

function cloneProject(): void {
    showModal('clone-project-modal');
}

async function submitCloneProject(): Promise<void> {
    const form = document.getElementById('clone-project-form') as HTMLFormElement;
    const formData = new FormData(form);
    
    const repoUrl = formData.get('repoUrl') as string;
    const projectName = formData.get('projectName') as string;
    
    // Clear previous errors
    clearFieldErrors();
    
    // Validate URL
    if (!repoUrl || !repoUrl.trim()) {
        showFieldError('clone-repo-url', 'Repository URL is required');
        return;
    }
    
    try {
        new URL(repoUrl); // This will throw if invalid URL
    } catch {
        showFieldError('clone-repo-url', 'Please enter a valid URL');
        return;
    }
    
    // Validate project name if provided
    if (projectName && projectName.trim()) {
        if (!/^[a-zA-Z0-9_\s-]+$/.test(projectName.trim())) {
            showFieldError('clone-project-name', 'Project name can only contain letters, numbers, spaces, underscores, and dashes');
            return;
        }
        if (projectName.trim().length > 50) {
            showFieldError('clone-project-name', 'Project name must be 50 characters or less');
            return;
        }
    }
    
    try {
        closeModal();
        showLoadingOverlay('Cloning Project', `Cloning ${repoUrl}...`);
        
        // Signature is `podium clone <mode> <repo> [name]` — the mode positional
        // is required and the command hard-errors without it.
        const cloneMode = (document.getElementById('clone-mode') as HTMLSelectElement)?.value || 'work-directly';

        const args = [cloneMode, repoUrl];
        if (projectName && projectName.trim()) {
            args.push(projectName.trim());
        }
        args.push('--json-output');

        const result = await ipcRenderer.invoke('execute-podium', 'clone', args);
        
        hideLoadingOverlay();
        
        if (result.code === 0) {
            const finalProjectName = projectName?.trim() || repoUrl.split('/').pop()?.replace('.git', '') || 'cloned-project';
            showSuccess(`Project "${finalProjectName}" cloned successfully!`);
            // Clear form
            form.reset();
            // Refresh project list
            setTimeout(() => {
                loadProjects();
            }, 1000);
        } else {
            showError(`Failed to clone project: ${result.stderr || result.stdout}`);
        }
    } catch (error) {
        hideLoadingOverlay();
        showError('Error cloning project: ' + (error as Error).message);
    }
}

function closeModal(): void {
    // Close all modals
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        (modal as HTMLElement).classList.remove('show');
    });
}

// Function to validate project name: only allow alpha, numbers, underscore, space, dash
function validateProjectName(name: string): { valid: boolean; error?: string } {
    if (!name || name.trim().length === 0) {
        return { valid: false, error: 'Project name is required' };
    }
    
    if (name.length > 50) {
        return { valid: false, error: 'Project name must be 50 characters or less' };
    }
    
    const validPattern = /^[a-zA-Z0-9_\s-]+$/;
    if (!validPattern.test(name)) {
        return { valid: false, error: 'Project name can only contain letters, numbers, spaces, underscores, and dashes' };
    }
    
    return { valid: true };
}

// Function to validate description: anything except double quotes (since it goes in YAML as description: "VALUE")
function validateDescription(description: string): { valid: boolean; error?: string } {
    if (description.length > 200) {
        return { valid: false, error: 'Description must be 200 characters or less' };
    }
    
    if (description.includes('"')) {
        return { valid: false, error: 'Description cannot contain double quotes (used in YAML formatting)' };
    }
    
    return { valid: true };
}

// Function to validate version input
function validateVersion(version: string, framework: string): { valid: boolean; error?: string } {
    // Allow "latest" for all frameworks
    if (version === 'latest') return { valid: true };
    
    // Empty version defaults to "latest" so it's valid
    if (version.trim() === '') return { valid: true };
    
    if (framework === 'laravel') {
        // Laravel versions: major.minor.patch (e.g., 11.2.1)
        if (!/^\d+(\.\d+){0,2}$/.test(version)) {
            return { valid: false, error: 'Laravel version must be in format: major.minor.patch (e.g., 11.2.1)' };
        }
    } else if (framework === 'wordpress') {
        // WordPress versions: major.minor or major.minor.patch (e.g., 6.4 or 6.4.2)
        if (!/^\d+\.\d+(\.\d+)?$/.test(version)) {
            return { valid: false, error: 'WordPress version must be in format: major.minor or major.minor.patch (e.g., 6.4.2)' };
        }
    }
    
    return { valid: true };
}

// Function to sanitize container name: remove special chars, spaces to dashes, lowercase
function sanitizeContainerName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove all special characters except spaces and dashes
        .replace(/\s+/g, '-') // Convert spaces to dashes
        .replace(/-+/g, '-') // Convert multiple dashes to single dash
        .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
}

// Function to sanitize metadata strings: escape quotes and problematic characters
function sanitizeMetadata(text: string): string {
    return text
        .replace(/"/g, '\\"') // Escape double quotes
        .replace(/\\/g, '\\\\') // Escape backslashes
        .replace(/\n/g, '\\n') // Escape newlines
        .replace(/\r/g, '\\r'); // Escape carriage returns
}

// Function to show form validation errors
function showFieldError(fieldId: string, message: string): void {
    const field = document.getElementById(fieldId) as HTMLInputElement;
    if (!field) return;

    field.style.borderColor = '#e74c3c';

    // Reuse the markup's own <div id="<field>-error"> when it exists. The
    // previous version removed it and appended a replacement with no id, which
    // made every id in the HTML dead weight and the errors unaddressable.
    const named = document.getElementById(`${fieldId}-error`);
    if (named) {
        named.textContent = message;
        named.classList.add('field-error');
        return;
    }

    const existingError = field.parentNode?.querySelector('.field-error');
    if (existingError) {
        existingError.remove();
    }

    const errorDiv = document.createElement('div');
    errorDiv.className = 'field-error';
    errorDiv.textContent = message;
    field.parentNode?.appendChild(errorDiv);
}

// Function to clear field errors
function clearFieldErrors(): void {
    // Clear every error slot rather than a hardcoded pair of fields — the forms
    // have grown well past project-name/description, and errors on the others
    // used to persist across reopening a modal.
    //
    // Empty the markup's own <div id="…-error"> instead of removing it; those
    // elements are addressable and must survive.
    document.querySelectorAll('.field-error').forEach((el) => {
        if (el.id.endsWith('-error')) {
            el.textContent = '';
        } else {
            el.remove();
        }
    });

    document.querySelectorAll<HTMLElement>('input, select, textarea').forEach((field) => {
        field.style.borderColor = '';
    });
}

async function submitNewProject(): Promise<void> {
    console.log('DEBUG: submitNewProject called');
    
    // Clear any previous errors
    clearFieldErrors();
    
    const projectName = (document.getElementById('project-name') as HTMLInputElement)?.value;
    const projectDescription = (document.getElementById('project-description') as HTMLInputElement)?.value || '';
    const projectEmoji = (document.getElementById('project-emoji') as HTMLSelectElement)?.value || '🚀';
    const projectType = (document.querySelector('input[name="project-type"]:checked') as HTMLInputElement)?.value;
    
    console.log('DEBUG: Form values:', { projectName, projectDescription, projectEmoji, projectType });
    
    // Validate project name
    const nameValidation = validateProjectName(projectName);
    console.log('DEBUG: Name validation:', nameValidation);
    if (!nameValidation.valid) {
        console.log('DEBUG: Name validation failed');
        showFieldError('project-name', nameValidation.error!);
        return;
    }
    
    // Validate description
    const descriptionValidation = validateDescription(projectDescription);
    if (!descriptionValidation.valid) {
        showFieldError('project-description', descriptionValidation.error!);
        return;
    }
    
    // Validate version if applicable
    if (projectType === 'laravel') {
        const versionInput = document.getElementById('laravel-version') as HTMLInputElement;
        const version = versionInput?.value?.trim() || 'latest';
        const versionValidation = validateVersion(version, 'laravel');
        if (!versionValidation.valid) {
            showFieldError('laravel-version', versionValidation.error!);
            return;
        }
    } else if (projectType === 'wordpress') {
        const versionInput = document.getElementById('wordpress-version') as HTMLInputElement;
        const version = versionInput?.value?.trim() || 'latest';
        const versionValidation = validateVersion(version, 'wordpress');
        if (!versionValidation.valid) {
            showFieldError('wordpress-version', versionValidation.error!);
            return;
        }
    }
    
    // Check project type is selected
    if (!projectType) {
        showError('Please select a project type');
        return;
    }
    
    // Sanitize the project name for use as container name
    const sanitizedContainerName = sanitizeContainerName(projectName);
    if (!sanitizedContainerName) {
        showFieldError('project-name', 'Project name must contain at least one valid character');
        return;
    }
    
    try {
        closeModal();
        showLoadingOverlay('Creating Project', `Creating ${projectType} project: ${projectName}...`, true);
        
        // Signature is `podium new <framework> <name>` — framework is the FIRST
        // positional, not a flag. There is no --framework option, and the
        // display-name/description/emoji flags no longer exist; the GUI stores
        // that metadata itself after creation (see updateMetadataAfterCreate).
        const args = [projectType, sanitizedContainerName, '--json-output'];

        // Only send --database when the user picked a specific engine. Left on
        // "Auto" the CLI applies its own per-framework default, which is better
        // than the GUI guessing: it used to hardcode mysql for every framework,
        // and the CLI silently coerced it to something the framework supports.
        const database = (document.getElementById('project-database') as HTMLSelectElement)?.value || '';
        if (database) {
            args.push('--database', database);
        }

        // --version only means something for these three.
        if (projectType === 'laravel' || projectType === 'wordpress') {
            const versionInput = document.getElementById(`${projectType}-version`) as HTMLInputElement;
            const version = versionInput?.value?.trim();
            if (version) {
                args.push('--version', version);
            }
        }

        // GitHub: exactly one of these, never both. The org flag is
        // --github-org (not --org, which the CLI rejects as unknown).
        const createGithub = (document.getElementById('create-github-repo') as HTMLInputElement)?.checked;
        if (createGithub) {
            const org = (document.getElementById('organization') as HTMLInputElement)?.value?.trim();
            if (org) {
                args.push('--github-org', org);
            } else {
                args.push('--github');
            }
        } else {
            args.push('--no-github');
        }

        // Streamed rather than buffered, so the overlay can show progress.
        // --json-output is dropped here: it suppresses exactly the human-readable
        // output we now want to display, and success is judged by exit code.
        const result = await ipcRenderer.invoke('execute-command-stream', 'podium',
            ['new', ...args.filter((a) => a !== '--json-output')]);

        if (result.code !== 0) {
            // Leave the overlay up: the output pane above already holds the real
            // reason, and it is far more use than a toast full of progress bars.
            failLoadingOverlay(
                'Could not create the project',
                `podium new exited with code ${result.code}. The output above shows why.`
            );
            return;
        }

        hideLoadingOverlay();

        if (result.code === 0) {
            // The CLI no longer stores display metadata, so persist it here.
            await ipcRenderer.invoke('update-project-metadata', sanitizedContainerName, {
                display_name: sanitizeMetadata(projectName),
                description: projectDescription ? sanitizeMetadata(projectDescription) : '',
                emoji: projectEmoji
            });

            showSuccess(`Project "${projectName}" created successfully!`);
        }
        
        // Refresh project list
        setTimeout(() => {
            loadProjects();
            loadServices();
        }, 3000);
    } catch (error) {
        hideLoadingOverlay();
        showError('Error creating project: ' + (error as Error).message);
    }
}

// Variables to track current project being edited/removed
let currentProjectName = '';
let currentServiceName = '';

// Show manage service modal
async function showManageModal(serviceName: string): Promise<void> {
    currentServiceName = serviceName;
    
    const titleElement = document.getElementById('manage-service-title');
    if (titleElement) {
        titleElement.textContent = `Manage ${serviceName.charAt(0).toUpperCase() + serviceName.slice(1)}`;
    }
    
    showModal('manage-service-modal');
    
    // Load initial stats
    await refreshServiceStats();
}

// Refresh service statistics
async function refreshServiceStats(): Promise<void> {
    if (!currentServiceName) return;
    
    const statsContainer = document.getElementById('service-stats');
    if (!statsContainer) return;
    
    try {
        // Show loading state
        statsContainer.innerHTML = '<div class="stat-item"><div class="stat-value">...</div><div class="stat-label">Loading</div></div>';
        
        // Get service statistics
        const result = await ipcRenderer.invoke('get-service-stats', currentServiceName);
        
        if (result.success) {
            renderServiceStats(result.stats);
        } else {
            statsContainer.innerHTML = `<div class="stat-item"><div class="stat-value">Error</div><div class="stat-label">${result.error}</div></div>`;
        }
    } catch (error) {
        statsContainer.innerHTML = `<div class="stat-item"><div class="stat-value">Error</div><div class="stat-label">Failed to load stats</div></div>`;
        console.error('Failed to load service stats:', error);
    }
}

// Render service statistics in the modal
function renderServiceStats(stats: any): void {
    const statsContainer = document.getElementById('service-stats');
    if (!statsContainer) return;
    
    if (currentServiceName === 'redis') {
        statsContainer.innerHTML = `
            <div class="stat-item">
                <div class="stat-value">${stats.used_memory_human || 'N/A'}</div>
                <div class="stat-label">Memory Used</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.total_commands_processed || '0'}</div>
                <div class="stat-label">Commands Processed</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.connected_clients || '0'}</div>
                <div class="stat-label">Connected Clients</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.keyspace_hits || '0'}</div>
                <div class="stat-label">Keyspace Hits</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.keyspace_misses || '0'}</div>
                <div class="stat-label">Keyspace Misses</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.total_keys || '0'}</div>
                <div class="stat-label">Total Keys</div>
            </div>
        `;
    } else if (currentServiceName === 'memcached') {
        statsContainer.innerHTML = `
            <div class="stat-item">
                <div class="stat-value">${stats.bytes || 'N/A'}</div>
                <div class="stat-label">Memory Used</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.cmd_get || '0'}</div>
                <div class="stat-label">GET Commands</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.cmd_set || '0'}</div>
                <div class="stat-label">SET Commands</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.curr_connections || '0'}</div>
                <div class="stat-label">Current Connections</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.get_hits || '0'}</div>
                <div class="stat-label">Cache Hits</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.get_misses || '0'}</div>
                <div class="stat-label">Cache Misses</div>
            </div>
        `;
    }
}

// Flush service data
async function flushServiceData(): Promise<void> {
    if (!currentServiceName) return;
    
    const confirmed = confirm(`⚠️ Are you sure you want to flush ALL data from ${currentServiceName}?\n\nThis action cannot be undone!`);
    if (!confirmed) return;
    
    try {
        showLoadingOverlay('Flushing Data', `Clearing all data from ${currentServiceName}...`);
        
        const result = await ipcRenderer.invoke('flush-service-data', currentServiceName);
        
        hideLoadingOverlay();
        
        if (result.success) {
            showSuccess(`${currentServiceName} data flushed successfully!`);
            // Refresh stats to show empty state
            await refreshServiceStats();
        } else {
            showError(`Failed to flush ${currentServiceName}: ${result.error}`);
        }
    } catch (error) {
        hideLoadingOverlay();
        showError('Error flushing service data: ' + (error as Error).message);
    }
}

// Show remove project modal
function showRemoveProjectModal(projectName: string): void {
    currentProjectName = projectName;
    const nameElement = document.getElementById('remove-project-name');
    if (nameElement) {
        nameElement.textContent = projectName;
    }
    
    // Reset checkbox
    const preserveCheckbox = document.getElementById('preserve-database') as HTMLInputElement;
    if (preserveCheckbox) {
        preserveCheckbox.checked = false;
    }
    
    showModal('remove-project-modal');
}

// Confirm project removal
async function confirmRemoveProject(): Promise<void> {
    if (!currentProjectName) return;
    
    try {
        closeModal();
        showLoadingOverlay('Removing Project', `Removing ${currentProjectName}...`);
        
        const preserveDatabase = (document.getElementById('preserve-database') as HTMLInputElement)?.checked || false;
        const args = [currentProjectName, '--json-output'];
        
        if (preserveDatabase) {
            args.push('--preserve-database');
        }
        
        const result = await ipcRenderer.invoke('execute-podium', 'remove', args);
        
        hideLoadingOverlay();
        
        if (result.code === 0) {
            showSuccess(`Project "${currentProjectName}" removed successfully!`);
        } else {
            showError(`Failed to remove project: ${result.stderr || result.stdout}`);
        }
        
        // Refresh project list
        setTimeout(() => {
            loadProjects();
            loadServices();
        }, 1000);
    } catch (error) {
        hideLoadingOverlay();
        showError('Error removing project: ' + (error as Error).message);
    }
}

// Show edit project modal
function editProject(projectName: string): void {
    currentProjectName = projectName;
    
    // Find the project data
    const parsed = projects.find(p => p.name === projectName);
    if (!parsed) {
        showError('Project not found');
        return;
    }

    // Same reason as renderProjects: read display metadata from the cache, not
    // from the parsed status object, which does not carry it.
    const project = withMetadata(parsed);

    // Populate the form
    const displayNameField = document.getElementById('edit-display-name') as HTMLInputElement;
    const descriptionField = document.getElementById('edit-description') as HTMLInputElement;
    const emojiField = document.getElementById('edit-emoji') as HTMLSelectElement;
    
    if (displayNameField) displayNameField.value = project.display_name || project.name;
    if (descriptionField) descriptionField.value = project.description || '';
    if (emojiField) emojiField.value = project.emoji || '🚀';
    
    showModal('edit-project-modal');
}

// Submit edit project changes
async function submitEditProject(): Promise<void> {
    if (!currentProjectName) return;
    
    const displayName = (document.getElementById('edit-display-name') as HTMLInputElement)?.value;
    const description = (document.getElementById('edit-description') as HTMLInputElement)?.value || '';
    const emoji = (document.getElementById('edit-emoji') as HTMLSelectElement)?.value || '🚀';
    
    // Validate inputs
    const nameValidation = validateProjectName(displayName);
    if (!nameValidation.valid) {
        showError(nameValidation.error!);
        return;
    }
    
    const descriptionValidation = validateDescription(description);
    if (!descriptionValidation.valid) {
        showError(descriptionValidation.error!);
        return;
    }
    
    try {
        closeModal();
        showLoadingOverlay('Updating Project', `Updating ${displayName}...`);
        
        // Update the docker-compose.yaml file directly
        const result = await ipcRenderer.invoke('update-project-metadata', currentProjectName, {
            display_name: displayName,
            description: description,
            emoji: emoji
        });
        
        hideLoadingOverlay();
        
        if (result.success) {
            // Keep the cache in step with what was just written to disk, so the
            // grid reflects the edit immediately rather than after a refresh.
            projectMetadata[currentProjectName] = {
                display_name: displayName,
                description: description,
                emoji: emoji
            };

            showSuccess(`Project "${displayName}" updated successfully!`);
            renderProjects();

            // Refresh project list
            setTimeout(() => {
                loadProjects();
            }, 1000);
        } else {
            showError(`Failed to update project: ${result.error}`);
        }
    } catch (error) {
        hideLoadingOverlay();
        showError('Error updating project: ' + (error as Error).message);
    }
}

// Export functions for global access
(window as any).showLoadingOverlay = showLoadingOverlay;
(window as any).failLoadingOverlay = failLoadingOverlay;
(window as any).hideLoadingOverlay = hideLoadingOverlay;
// Test hook: feed the overlay as if execute-command-stream had emitted.
(window as any).__feedOverlay = (data: string) => {
    const output = document.getElementById('loading-output');
    if (overlayStreaming && output) output.textContent += data;
};
(window as any).showAiSettings = showAiSettings;
(window as any).onAiAgentChange = onAiAgentChange;
(window as any).applyAiPreset = applyAiPreset;
(window as any).saveAiSettings = saveAiSettings;
(window as any).showCreateWithAI = showCreateWithAI;
(window as any).handleClassifyIdea = handleClassifyIdea;
(window as any).selectCandidate = selectCandidate;
(window as any).handleCreateFromChoice = handleCreateFromChoice;
(window as any).renderClassification = renderClassification;
(window as any).setCreateStage = setCreateStage;
(window as any).hideTerminals = hideTerminals;
(window as any).showTerminals = showTerminals;
(window as any).activateTerminal = activateTerminal;
(window as any).killTerminal = killTerminal;
(window as any).closeActiveTerminal = closeActiveTerminal;
(window as any).openAgentTerminal = openAgentTerminal;
// Small hooks so the e2e suite can inspect and tear down sessions without
// reaching into module state.
(window as any).__terminalCount = () => terminalSessions.size;
(window as any).__killFirstTerminal = () => {
    const first = [...terminalSessions.keys()][0];
    if (first) killTerminal(first);
};
(window as any).__killAllTerminals = () => {
    [...terminalSessions.keys()].forEach((id) => killTerminal(id));
};
(window as any).modifyWithAI = modifyWithAI;
(window as any).showInstallApp = showInstallApp;
(window as any).renderAppCatalog = renderAppCatalog;
(window as any).selectApp = selectApp;
(window as any).handleInstallApp = handleInstallApp;
(window as any).refreshProjects = refreshProjects;
(window as any).manualRefresh = manualRefresh;
(window as any).startAutoRefresh = startAutoRefresh;
(window as any).stopAutoRefresh = stopAutoRefresh;
(window as any).showCreateProject = showCreateProject;
(window as any).onFrameworkChange = onFrameworkChange;
(window as any).loadFrameworkCatalog = loadFrameworkCatalog;
(window as any).startProject = startProject;
(window as any).stopProject = stopProject;
(window as any).removeProject = removeProject;
(window as any).showRemoveProjectModal = showRemoveProjectModal;
(window as any).confirmRemoveProject = confirmRemoveProject;
(window as any).editProject = editProject;
(window as any).submitEditProject = submitEditProject;
(window as any).showManageModal = showManageModal;
(window as any).refreshServiceStats = refreshServiceStats;
(window as any).flushServiceData = flushServiceData;

// Dropdown and Modal functions
function toggleDropdown(): void {
    const dropdown = document.getElementById('help-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

function showAboutModal(): void {
    console.log('DEBUG: showAboutModal called');
    const modal = document.getElementById('about-modal');
    console.log('DEBUG: about-modal element found:', !!modal);
    if (modal) {
        modal.classList.add('show');
        console.log('DEBUG: about-modal show class added');
    }
    // Close dropdown when opening modal (if it exists)
    const dropdown = document.getElementById('help-dropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
    }
}

// Make showAboutModal available globally immediately
(window as any).showAboutModal = showAboutModal;

function closeAboutModal(): void {
    console.log('DEBUG: closeAboutModal called');
    const modal = document.getElementById('about-modal');
    if (modal) {
        modal.classList.remove('show');
    }
}

// Make closeAboutModal available globally immediately
(window as any).closeAboutModal = closeAboutModal;

// Close dropdown when clicking outside
document.addEventListener('click', function(event: Event) {
    const dropdown = document.getElementById('help-dropdown');
    const target = event.target as HTMLElement;
    
    if (dropdown && !target.closest('.dropdown')) {
        dropdown.classList.remove('show');
    }
});

// Close modal when clicking outside content
document.addEventListener('click', function(event: Event) {
    const modal = document.getElementById('about-modal');
    const target = event.target as HTMLElement;
    
    if (modal && target === modal) {
        closeAboutModal();
    }
});

// Help modal functions
function showHelpModal(): void {
    showModal('help-modal');
}

function openTerminal(): void {
    // Try to open terminal application
    if (process.platform === 'win32') {
        shell.openExternal('cmd://');
    } else if (process.platform === 'darwin') {
        shell.openExternal('terminal://');
    } else {
        // Linux - try common terminal applications
        shell.openExternal('gnome-terminal://') || shell.openExternal('xterm://') || shell.openExternal('konsole://');
    }
}

async function showCliHelp(): Promise<void> {
    try {
        const result = await ipcRenderer.invoke('execute-command', 'podium', ['help']);
        if (result.success) {
            // Create a new modal to show the CLI help output
            const helpOutput = result.output || 'No help output available';
            
            // Create and show a modal with the CLI help
            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.id = 'cli-help-output-modal';
            modal.innerHTML = `
                <div class="modal-content modal-large">
                    <div class="modal-header">
                        <h3>📋 Podium CLI Help</h3>
                        <button class="modal-close" onclick="closeModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <pre style="background: rgba(15, 15, 35, 0.8); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.5rem; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; line-height: 1.4; overflow-x: auto; white-space: pre-wrap;">${helpOutput}</pre>
                        <div style="text-align: center; margin-top: 1rem;">
                            <button class="btn btn-primary" onclick="closeModal()">Close</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Remove the modal when closed
            const closeButtons = modal.querySelectorAll('.modal-close, .btn');
            closeButtons.forEach(button => {
                button.addEventListener('click', () => {
                    modal.remove();
                });
            });
        } else {
            console.error('Failed to get CLI help:', result.error);
            alert('Failed to get CLI help. Please run "podium help" in your terminal.');
        }
    } catch (error) {
        console.error('Error showing CLI help:', error);
        alert('Error showing CLI help. Please run "podium help" in your terminal.');
    }
}

(window as any).showModal = showModal;
(window as any).hideModal = hideModal;
(window as any).openUrl = openUrl;
(window as any).startServices = startServices;
(window as any).stopServices = stopServices;
(window as any).startAllProjects = startAllProjects;
(window as any).stopAllProjects = stopAllProjects;
(window as any).createNewProject = createNewProject;
(window as any).cloneProject = cloneProject;
(window as any).closeModal = closeModal;
(window as any).showFieldError = showFieldError;
(window as any).clearFieldErrors = clearFieldErrors;
(window as any).submitNewProject = submitNewProject;
(window as any).submitCloneProject = submitCloneProject;
(window as any).handleCreateProject = handleCreateProject;
(window as any).toggleDropdown = toggleDropdown;
(window as any).showAboutModal = showAboutModal;
(window as any).closeAboutModal = closeAboutModal;
(window as any).showModal = showModal;
(window as any).showHelpModal = showHelpModal;
(window as any).openTerminal = openTerminal;
(window as any).showCliHelp = showCliHelp;
