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
    
    // Initialize app components
    Promise.all([
        loadProjects(),
        startServicesOnLoad(),
        loadServices()
    ]).then(() => {
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

function toggleVersionGroups(): void {
    const projectType: string = (document.querySelector('input[name="project-type"]:checked') as HTMLInputElement).value;
    const laravelGroup: HTMLElement | null = document.getElementById('laravel-version-group');
    const wordpressGroup: HTMLElement | null = document.getElementById('wordpress-version-group');
    
    // Hide all version groups first
    if (laravelGroup) laravelGroup.style.display = 'none';
    if (wordpressGroup) wordpressGroup.style.display = 'none';
    
    // Show the appropriate version group and reset to "latest"
    if (projectType === 'laravel' && laravelGroup) {
        laravelGroup.style.display = 'block';
        const versionInput = document.getElementById('laravel-version') as HTMLInputElement;
        if (versionInput) versionInput.value = 'latest';
    } else if (projectType === 'wordpress' && wordpressGroup) {
        wordpressGroup.style.display = 'block';
        const versionInput = document.getElementById('wordpress-version') as HTMLInputElement;
        if (versionInput) versionInput.value = 'latest';
    }
    // Note: PHP doesn't need version selection
}

async function loadProjects(): Promise<void> {
    try {
        // Use podium status command with JSON output for cleaner parsing
        const result = await ipcRenderer.invoke('execute-podium', 'status', ['--json-output']);
        
        // Check if command succeeded
        if (result.code !== 0) {
            console.log('Podium status command failed, likely no projects or services stopped');
            projects = [];
            sharedServices = {};
            renderProjects();
            return;
        }
        
        parseProjectStatusJSON(result.stdout);
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
                
                // Determine overall status
                if (project.dockerRunning && project.portMapped) {
                    project.status = 'running';
                } else if (project.dockerRunning) {
                    project.status = 'starting';
                } else {
                    project.status = 'stopped';
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

    grid.innerHTML = projects.map((project: Project) => {
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
                        ${project.status === 'running' && project.localUrl ? `<a href="#" class="url-link" onclick="event.preventDefault(); openUrl('${project.localUrl}'); return false;">${project.localUrl}</a>` : ''}
                        ${project.status === 'running' && project.lanUrl ? `<a href="#" class="url-link" onclick="event.preventDefault(); openUrl('${project.lanUrl}'); return false;">${project.lanUrl}</a>` : ''}
                    </div>
                    <div class="project-actions">
                        ${project.status === 'running' ? 
                            `<button class="btn btn-warning btn-sm" onclick="stopProject('${project.name}')">Stop</button>` :
                            `<button class="btn btn-success btn-sm" onclick="startProject('${project.name}')">Start</button>`
                        }
                        <button class="btn btn-secondary btn-sm" onclick="editProject('${project.name}')">Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="showRemoveProjectModal('${project.name}')">Remove</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function startServicesOnLoad(): Promise<void> {
    try {
        console.log('Starting services on dashboard load...');
        const result = await ipcRenderer.invoke('execute-podium', 'start-services', ['--no-coloring']);
        
        if (result.code !== 0) {
            console.warn('Failed to start services:', result.stderr);
        } else {
            console.log('Services started successfully');
        }
    } catch (error) {
        console.warn('Error starting services:', error);
        // Don't fail the dashboard load if services fail to start
    }
}

async function loadServices(): Promise<void> {
    try {
        const result = await ipcRenderer.invoke('execute-podium', 'status', ['--json-output']);
        
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

    servicesGrid.innerHTML = Object.entries(sharedServices).map(([serviceName, service]: [string, SharedService]) => {
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
        
        const args = [projectName, '--force', '--json-output'];
        if (preserveDatabase) {
            args.push('--preserve-database');
        }
        
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

function showCreateProject(): void {
    showModal('create-project-modal');
}



// Modal management
function showModal(modalId: string): void {
    const modal: HTMLElement | null = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
    }
}

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
function showLoadingOverlay(message: string = 'Please wait...', details: string = 'Processing your request'): void {
    const overlay = document.getElementById('loading-overlay');
    const messageEl = document.getElementById('loading-message');
    const detailsEl = document.getElementById('loading-details');
    
    if (overlay && messageEl && detailsEl) {
        messageEl.textContent = message;
        detailsEl.textContent = details;
        overlay.style.display = 'flex';
    }
}

function hideLoadingOverlay(): void {
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
        const result = await ipcRenderer.invoke('execute-command', 'podium', ['start', projectName]);
        console.log('✅ Command result:', result);
    } catch (error) {
        console.error('❌ Command failed:', error);
    }
}

// Service management functions
async function startServices(): Promise<void> {
    try {
        showLoadingOverlay('Starting Services', 'Starting all shared services...');
        const result = await ipcRenderer.invoke('execute-podium', 'start-services', ['--json-output']);
        
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
        const result = await ipcRenderer.invoke('execute-podium', 'stop-services', ['--json-output']);
        
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
function createNewProject(): void {
    showModal('new-project-modal');
}

function handleCreateProject(): void {
    console.log('DEBUG: handleCreateProject called');
    submitNewProject().catch(error => {
        console.error('Error creating project:', error);
        showError(`Failed to create project: ${error.message}`);
    });
}

// Make functions globally available
(window as any).handleCreateProject = handleCreateProject;
(window as any).createNewProject = createNewProject;
(window as any).cloneProject = cloneProject;
(window as any).startAllProjects = startAllProjects;
(window as any).stopAllProjects = stopAllProjects;
(window as any).closeModal = closeModal;
(window as any).openUrl = openUrl;
(window as any).toggleDropdown = toggleDropdown;
(window as any).showAboutModal = showAboutModal;

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
        
        const args = [repoUrl];
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
    if (field) {
        field.style.borderColor = '#e74c3c';
        
        // Remove any existing error message
        const existingError = field.parentNode?.querySelector('.field-error');
        if (existingError) {
            existingError.remove();
        }
        
        // Add new error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'field-error';
        errorDiv.textContent = message;
        field.parentNode?.appendChild(errorDiv);
    }
}

// Function to clear field errors
function clearFieldErrors(): void {
    const fields = ['project-name', 'project-description'];
    fields.forEach(fieldId => {
        const field = document.getElementById(fieldId) as HTMLInputElement;
        if (field) {
            field.style.borderColor = '';
            const errorDiv = field.parentNode?.querySelector('.field-error');
            if (errorDiv) {
                errorDiv.remove();
            }
        }
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
        showLoadingOverlay('Creating Project', `Creating ${projectType} project: ${projectName}...`);
        
        // Use the sanitized container name for the actual project creation
        const args = [sanitizedContainerName, '--framework', projectType, '--database', 'mysql', '--no-github', '--json-output'];
        
        // Add metadata parameters (use original projectName as display name)
        args.push('--display-name', sanitizeMetadata(projectName));
        if (projectDescription) {
            args.push('--description', sanitizeMetadata(projectDescription));
        }
        args.push('--emoji', projectEmoji);
        
        // Add version if specified
        if (projectType === 'laravel') {
            const versionInput = document.getElementById('laravel-version') as HTMLInputElement;
            const version = versionInput?.value?.trim();
            if (version && version !== '') {
                args.push('--version', version);
            }
        } else if (projectType === 'wordpress') {
            const versionInput = document.getElementById('wordpress-version') as HTMLInputElement;
            const version = versionInput?.value?.trim();
            if (version && version !== '') {
                args.push('--version', version);
            }
        }
        
        // Add GitHub options if specified
        const createGithub = (document.getElementById('create-github-repo') as HTMLInputElement)?.checked;
        if (createGithub) {
            args.push('--github');
            const org = (document.getElementById('organization') as HTMLInputElement)?.value;
            if (org) args.push('--org', org);
        }
        
        const result = await ipcRenderer.invoke('execute-podium', 'new', args);
        
        hideLoadingOverlay();
        
        if (result.code === 0) {
            showSuccess(`Project "${projectName}" created successfully!`);
        } else {
            showError(`Failed to create project: ${result.stderr || result.stdout}`);
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
    const project = projects.find(p => p.name === projectName);
    if (!project) {
        showError('Project not found');
        return;
    }
    
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
            showSuccess(`Project "${displayName}" updated successfully!`);
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
(window as any).refreshProjects = refreshProjects;
(window as any).manualRefresh = manualRefresh;
(window as any).startAutoRefresh = startAutoRefresh;
(window as any).stopAutoRefresh = stopAutoRefresh;
(window as any).showCreateProject = showCreateProject;
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
    const modal = document.getElementById('about-modal');
    if (modal) {
        modal.classList.add('show');
    }
    // Close dropdown when opening modal
    const dropdown = document.getElementById('help-dropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
    }
}

function closeAboutModal(): void {
    const modal = document.getElementById('about-modal');
    if (modal) {
        modal.classList.remove('show');
    }
}

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
(window as any).submitNewProject = submitNewProject;
(window as any).submitCloneProject = submitCloneProject;
(window as any).toggleDropdown = toggleDropdown;
(window as any).showAboutModal = showAboutModal;
(window as any).closeAboutModal = closeAboutModal;
