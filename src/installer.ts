// Using lazy-loaded requires to avoid module initialization issues

const Convert = require('ansi-to-html');

// Docker progress parsing function
function parseDockerProgress(logContent: string): { overall_percent: number; message: string } | null {
    if (!logContent) return null;
    
    const lines = logContent.split('\n');
    let pullingCount = 0;
    let downloadedCount = 0;
    let layerProgress = new Map<string, { current: number; total: number }>();
    let downloadingLayers = new Set<string>();
    let extractingLayers = new Map<string, { current: number; total: number }>();
    
    // Helper function to parse size strings like "45.2MB" to bytes
    function parseBytes(sizeStr: string): number {
        const match = sizeStr.match(/([0-9.]+)\s*([KMGT]?i?B)/i);
        if (!match || !match[1] || !match[2]) return 0;
        
        const [, numStr, unit] = match;
        const size = parseFloat(numStr);
        
        switch (unit.toUpperCase()) {
            case 'B': return size;
            case 'KB': return size * 1000;
            case 'MB': return size * 1000000;
            case 'GB': return size * 1000000000;
            case 'KIB': return size * 1024;
            case 'MIB': return size * 1024 * 1024;
            case 'GIB': return size * 1024 * 1024 * 1024;
            default: return size;
        }
    }
    
    for (const line of lines) {
        // Count pulling operations
        if (line.includes('Pulling from')) {
            pullingCount++;
        }
        
        // Count completed downloads
        if (line.match(/(Downloaded|Pull complete|Already exists)/)) {
            downloadedCount++;
        }
        
        // Parse downloading progress: " df20fa9351a1 Downloading [====>    ] 901.3MB/1.092GB"
        const downloadMatch = line.match(/^\s*([a-f0-9]{12})\s+Downloading\s+\[.*?\]\s+([0-9.]+[KMGT]?i?B)\/([0-9.]+[KMGT]?i?B)/i);
        if (downloadMatch && downloadMatch[1] && downloadMatch[2] && downloadMatch[3]) {
            const layerId = downloadMatch[1];
            const current = parseBytes(downloadMatch[2]);
            const total = parseBytes(downloadMatch[3]);
            
            layerProgress.set(layerId, { current: Math.min(current, total), total });
            downloadingLayers.add(layerId);
        }
        
        // Parse extracting progress: " df20fa9351a1 Extracting [====>    ] 901.3MB/1.092GB"  
        const extractMatch = line.match(/^\s*([a-f0-9]{12})\s+Extracting\s+\[.*?\]\s+([0-9.]+[KMGT]?i?B)\/([0-9.]+[KMGT]?i?B)/i);
        if (extractMatch && extractMatch[1] && extractMatch[2] && extractMatch[3]) {
            const layerId = extractMatch[1];
            const current = parseBytes(extractMatch[2]);
            const total = parseBytes(extractMatch[3]);
            
            extractingLayers.set(layerId, { current: Math.min(current, total), total });
        }
        
        // Mark download complete
        const completeMatch = line.match(/^\s*([a-f0-9]{12})\s+(Download complete|Verifying Checksum)/i);
        if (completeMatch && completeMatch[1]) {
            const layerId = completeMatch[1];
            const existing = layerProgress.get(layerId);
            if (existing) {
                layerProgress.set(layerId, { current: existing.total, total: existing.total });
            }
        }
    }
    
    // Two-phase calculation: Downloads first (0-100%), then extractions
    let totalDownloadBytes = 0;
    let currentDownloadBytes = 0;
    let totalExtractBytes = 0;
    let currentExtractBytes = 0;
    
    // Calculate download progress
    for (const [layerId, progress] of layerProgress) {
        totalDownloadBytes += progress.total;
        currentDownloadBytes += progress.current;
    }
    
    // Calculate extraction progress
    for (const [layerId, progress] of extractingLayers) {
        totalExtractBytes += progress.total;
        currentExtractBytes += progress.current;
    }
    
    const downloadPercent = totalDownloadBytes > 0 ? (currentDownloadBytes / totalDownloadBytes) * 100 : 0;
    const extractPercent = totalExtractBytes > 0 ? (currentExtractBytes / totalExtractBytes) * 100 : 0;
    
    console.log(`🔍 Downloads: ${layerProgress.size} layers, ${downloadPercent.toFixed(1)}%`);
    console.log(`🔍 Extractions: ${extractingLayers.size} layers, ${extractPercent.toFixed(1)}%`);
    
    let percent = 0;
    let message = 'Starting services...';
    
    if (downloadPercent < 100 && layerProgress.size > 0) {
        // Phase 1: Downloading (0-100%)
        percent = Math.min(Math.round(downloadPercent), 100);
        const currentMB = (currentDownloadBytes / 1000000).toFixed(1);
        const totalMB = (totalDownloadBytes / 1000000).toFixed(1);
        message = `Downloading images: ${percent}% (${currentMB}MB/${totalMB}MB)`;
        console.log(`📊 DOWNLOAD PHASE: ${percent}% (${currentMB}MB/${totalMB}MB)`);
    } else if (extractingLayers.size > 0) {
        // Phase 2: Extracting (continue from where downloads left off)
        percent = Math.min(Math.round(extractPercent), 100);
        const currentMB = (currentExtractBytes / 1000000).toFixed(1);
        const totalMB = (totalExtractBytes / 1000000).toFixed(1);
        message = `Extracting images: ${percent}% (${currentMB}MB/${totalMB}MB)`;
        console.log(`📊 EXTRACT PHASE: ${percent}% (${currentMB}MB/${totalMB}MB)`);
    } else if (pullingCount > 0) {
        // Fallback: estimate progress based on pulling vs downloaded count
        percent = downloadedCount > 0 ? Math.min(Math.round((downloadedCount / pullingCount) * 100), 90) : 10;
        message = `Pulling Docker images... (${downloadedCount}/${pullingCount} completed)`;
        console.log(`📊 FALLBACK: ${percent}% based on completed pulls`);
    } else if (lines.some(line => line.includes('Creating') || line.includes('Starting'))) {
        percent = 95;
        message = 'Starting containers...';
        console.log(`📊 CONTAINERS: Starting containers...`);
    }
    
    // Ensure minimum progress
    percent = Math.max(percent, 10);
    
    return { overall_percent: percent, message };
}

// IMMEDIATE TEST LOG - This should execute right away
console.log('🔥 INSTALLER.TS: File loaded and executing!');





interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}

interface StreamCommandResult extends CommandResult {
    success: boolean;
    exitCode: number;
}

var currentStep: number = 0;

// Initialize ANSI to HTML converter with dark theme colors
const convert = new Convert({
    fg: '#f8f9fa',
    bg: '#1a1a1a',
    newline: true,
    escapeXML: false,
    colors: {
        0: '#1a1a1a',  // black
        1: '#ff6b6b',  // red
        2: '#51cf66',  // green
        3: '#ffd43b',  // yellow
        4: '#74c0fc',  // blue
        5: '#d0bfff',  // magenta
        6: '#66d9ef',  // cyan
        7: '#f8f9fa'   // white
    }
});

type ZeltroStatus = 'configured' | 'not-configured' | 'not-installed';

// Initialize installer
document.addEventListener('DOMContentLoaded', async (): Promise<void> => {
    console.log('🚀 INSTALLER: DOMContentLoaded event fired!');
    console.log('🚀 INSTALLER: Starting initialization...');
    
    // Test IPC communication
    console.log('🔄 Testing IPC communication...');
    try {

        const { ipcRenderer } = require('electron');
        const testResult = await ipcRenderer.invoke('execute-command', 'echo', ['IPC test successful']);
        console.log('IPC test result:', testResult);
    } catch (error) {
        console.error('IPC test failed:', error);
    }
    
    // Check if Zeltro CLI is already installed
    const zeltroStatus: ZeltroStatus = await checkZeltroInstallation();
    
    if (zeltroStatus === 'not-configured') {
        // Skip to configuration step if CLI is installed but not configured
        const titleElement = document.querySelector('#step-welcome .step-content h2') as HTMLElement;
        const descriptionElement = document.querySelector('#step-welcome .step-description') as HTMLElement;
        const buttonElement = document.querySelector('#step-welcome .btn') as HTMLElement;
        
        if (titleElement) titleElement.textContent = 'Configure Zeltro';
        if (descriptionElement) {
            descriptionElement.textContent = 'Zeltro CLI is installed but needs configuration. Let\'s set up your development environment.';
        }
        if (buttonElement) buttonElement.textContent = 'Configure Now';
        
        // CLI is already installed, we can skip directly to configuration
    }
    
    await showStep(0);
});

async function checkZeltroInstallation(): Promise<ZeltroStatus> {
    try {

        const { ipcRenderer } = require('electron');
        const result: CommandResult = await ipcRenderer.invoke('execute-command', 'zeltro', ['help', '--no-colors']);
        if (result.code === 0) {
            // Configured state lives in /etc/zeltro-cli/.env — the old
            // docker-stack/.env path no longer exists, so this check used to
            // report "not configured" on every machine.
            const configCheck: CommandResult = await ipcRenderer.invoke('execute-command', 'test', [
                '-f', '/etc/zeltro-cli/.env'
            ]);

            return configCheck.code === 0 ? 'configured' : 'not-configured';
        }
        return 'not-installed';
    } catch (error) {
        return 'not-installed';
    }
}

async function showStep(stepIndex: number): Promise<void> {
    console.log('🔄 SHOWSTEP: Called with stepIndex:', stepIndex);
    
    // Hide all steps
    document.querySelectorAll('.installer-step').forEach((step: Element) => {
        step.classList.remove('active');
    });
    
    // Show current step
    const currentStepElement = document.getElementById(`step-${getStepName(stepIndex)}`);
    if (currentStepElement) {
        currentStepElement.classList.add('active');
    }
    
    // Update step indicator
    document.querySelectorAll('.step-dot').forEach((dot: Element, index: number) => {
        dot.classList.remove('active', 'completed');
        if (index === stepIndex) {
            dot.classList.add('active');
        } else if (index < stepIndex) {
            dot.classList.add('completed');
        }
    });
    
    currentStep = stepIndex;
    
    // Execute step-specific logic
    switch (stepIndex) {
        case 1:
            await loadConfiguration();
            break;
        case 2:
            startInstallation();
            break;
    }
}

function getStepName(index: number): string {
    const steps: string[] = ['welcome', 'configuration', 'installation', 'complete'];
    return steps[index] || '';
}

async function nextStep(): Promise<void> {
    console.log('🔄 NEXTSTEP: Function called');
    
    // Ensure currentStep is initialized
    if (typeof currentStep === 'undefined') {
        currentStep = 0;
        console.log('🔄 NEXTSTEP: Initialized currentStep to 0');
    }
    
    console.log('🔄 NEXTSTEP: currentStep is:', currentStep);
    if (currentStep < 3) {
        const nextStepIndex: number = currentStep + 1;
        console.log('Moving to step:', nextStepIndex);
        await showStep(nextStepIndex);
    }
}

async function previousStep(): Promise<void> {
    if (currentStep > 0) {
        await showStep(currentStep - 1);
    }
}










async function startInstallation(): Promise<void> {
    const progressFill = document.getElementById('progress-fill') as HTMLElement;
    const progressText = document.getElementById('progress-text') as HTMLElement;
    
    let progress: number = 0;
    
    try {
        // Hide back button once installation starts
        const backBtn = document.querySelector('.btn-secondary') as HTMLButtonElement;
        if (backBtn && backBtn.textContent?.includes('Back')) {
            backBtn.style.display = 'none';
        }
        
        // The deb/mac installer should have already installed Zeltro CLI globally
        // Run configuration (now includes service startup)
        updateProgress(10, 'Configuring Zeltro environment...');
        await runZeltroConfig();
        
        // Installation complete
        updateProgress(100, 'Installation complete!');
        console.log('Installation process completed successfully');
        
        const finishBtn = document.getElementById('finish-btn') as HTMLButtonElement;
        if (finishBtn) {
            finishBtn.disabled = false;
            finishBtn.style.display = 'inline-block';
        }
        
    } catch (error) {
        showErrorMessage(`Installation failed: ${(error as Error).message}`);
        const logOutput = document.getElementById('installation-log') as HTMLElement;
        if (logOutput) {
            logOutput.textContent += `\n\nERROR: ${(error as Error).message}`;
        }
    }
}

function updateProgress(percentage: number, message: string): void {
    const progressFill = document.getElementById('progress-fill') as HTMLElement;
    const progressText = document.getElementById('progress-text') as HTMLElement;
    
    if (progressFill) progressFill.style.width = `${percentage}%`;
    if (progressText) progressText.textContent = message;
}






async function startServicesAfterConfig(): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log('Starting Zeltro services after configuration...');
        

        
        // Update progress text to show we're starting services
        updateProgress(80, 'Starting services...');
        
        let serviceStarted = false;
        let progressInterval: NodeJS.Timeout;
        
        // Set up progress polling from temp file
        const { ipcRenderer } = require('electron');
        
        // Poll for progress updates by parsing the Docker log file directly
        progressInterval = setInterval(async () => {
            if (serviceStarted) {
                clearInterval(progressInterval);
                return;
            }
            
            try {
                // Read the Docker progress log file directly
                const fs = require('fs');
                if (fs.existsSync('/tmp/zeltro-docker-progress.log')) {
                    const logContent = fs.readFileSync('/tmp/zeltro-docker-progress.log', 'utf8');
                    const progressData = parseDockerProgress(logContent);
                    
                    if (progressData) {
                        // Map progress to installer range (80-94%)
                        const dockerPercent = progressData.overall_percent || 0;
                        const installerProgress = 80 + Math.round((dockerPercent / 100) * 14);
                        
                        console.log(`🐳 Docker progress: ${dockerPercent}% -> installer: ${installerProgress}%`);
                        updateProgress(installerProgress, progressData.message || 'Starting services...');
                    }
                }
            } catch (error) {
                console.log('Progress parsing error (normal during startup):', error);
            }
        }, 2000); // Check every 2 seconds
        
        // Start the service command with JSON output (which will create the log file)
        // No flags: the dispatcher runs start_services.sh without forwarding
        // arguments, so --json-output never reaches it. Judge by exit code.
        ipcRenderer.invoke('execute-command', 'zeltro', ['start-services']).then((result: any) => {
            console.log('Start services finished with result:', result);
            serviceStarted = true;
            
            // Clear the progress polling
            if (progressInterval) {
                clearInterval(progressInterval);
            }
            
            if (result.code === 0) {
                updateProgress(95, 'Services started successfully!');
                resolve();
            } else {
                // Don't fail the installation if services don't start - just log it
                console.warn('Services failed to start, but continuing...', result.stderr);
                updateProgress(95, 'Services startup completed (some may have failed)');
                resolve();
            }
        }).catch((error: Error) => {
            console.warn('Error invoking start-services command, but continuing...', error);
            serviceStarted = true;
            
            // Clear the progress polling
            if (progressInterval) {
                clearInterval(progressInterval);
            }
            
            updateProgress(95, 'Services startup completed');
            resolve();
        });
        
        // Fallback timeout to prevent hanging
        setTimeout(() => {
            if (!serviceStarted) {
                console.warn('Service startup timeout, continuing...');
                serviceStarted = true;
                
                // Clear the progress polling
                if (progressInterval) {
                    clearInterval(progressInterval);
                }
                
                updateProgress(95, 'Services startup completed (timeout)');
                resolve();
            }
        }, 300000); // 5 minute timeout (Docker can take a while)
    });
}

async function runZeltroConfig(): Promise<void> {
    return new Promise(async (resolve, reject) => {
        console.log('Starting Zeltro configuration...');
        
        try {
            const { ipcRenderer } = require('electron');
            
            // Step 1: Ensure sudo is authenticated using timeout approach
            updateProgress(15, 'Authenticating system access...');
            const sudoCheck = await ipcRenderer.invoke('execute-command', 'sudo', ['-n', 'true']);
            
            if (sudoCheck.code !== 0) {
                // Need to authenticate - this will prompt for password
                updateProgress(15, 'System authentication required...');
                const sudoAuth = await ipcRenderer.invoke('execute-command', 'sudo', ['-v']);
                
                if (sudoAuth.code !== 0) {
                    throw new Error('System authentication failed. Please check your password and try again.');
                }
            }
            
            // Step 2: Collect configuration from form
            const gitName = (document.getElementById('git-name') as HTMLInputElement)?.value || '';
            const gitEmail = (document.getElementById('git-email') as HTMLInputElement)?.value || '';
            const projectsDir = (document.getElementById('projects-dir') as HTMLInputElement)?.value || '';

            // Step 3: Build config arguments.
            // `zeltro configure` no longer asks about AWS or GitHub, and its
            // parser silently swallows unknown flags — so anything stale here
            // fails invisibly rather than loudly. Only these three are real.
            // --non-interactive guarantees it never blocks on a prompt; the VPC
            // subnet is chosen automatically.
            const configArgs: string[] = ['configure', '--non-interactive', '--json-output'];
            if (gitName) configArgs.push('--git-name', gitName);
            if (gitEmail) configArgs.push('--git-email', gitEmail);
            if (projectsDir) configArgs.push('--projects-dir', projectsDir);

            // Step 4: Run zeltro configure (now includes service startup)
            updateProgress(20, 'Configuring Zeltro environment and starting services...');
            console.log('Running zeltro configure with args:', configArgs);
            
            // Start Docker progress monitoring immediately since configure now starts services
            const progressInterval = setInterval(async () => {
                try {
                    const fs = require('fs');
                    if (fs.existsSync('/tmp/zeltro-docker-progress.log')) {
                        const logContent = fs.readFileSync('/tmp/zeltro-docker-progress.log', 'utf8');
                        const progressData = parseDockerProgress(logContent);
                        
                        if (progressData) {
                            // Map progress to installer range (20-90%)
                            const dockerPercent = progressData.overall_percent || 0;
                            const installerProgress = 20 + Math.round((dockerPercent / 100) * 70);
                            
                            console.log(`🐳 Docker progress: ${dockerPercent}% -> installer: ${installerProgress}%`);
                            updateProgress(installerProgress, progressData.message || 'Configuring and starting services...');
                        }
                    }
                } catch (error) {
                    console.log('Progress parsing error (normal during startup):', error);
                }
            }, 2000);
            
            const result: StreamCommandResult = await ipcRenderer.invoke('execute-command-stream', 'zeltro', configArgs);
            
            // Clear progress monitoring
            clearInterval(progressInterval);
            
            console.log('Config finished with result:', result);
            
            if (result.code === 0) {
                updateProgress(95, 'Configuration and services completed successfully!');
                resolve();
            } else {
                throw new Error(`Configuration failed with code ${result.code}: ${result.stderr}`);
            }
            
        } catch (error) {
            reject(error);
        }
    });
}

function toggleOutput(): void {
    const logOutput = document.getElementById('installation-log') as HTMLElement;
    if (logOutput) {
        logOutput.style.display = logOutput.style.display === 'none' ? 'block' : 'none';
    }
}

// Debug output now goes to console only - no UI toggle needed

function openDashboard(): void {
    // Close installer and open main dashboard
    window.location.href = 'index.html';
}

async function loadConfiguration(): Promise<void> {
    // Pre-fill Git configuration
    console.log('🔄 Loading configuration - pre-filling Git settings...');
    console.log('🔍 Current step:', currentStep);
    console.log('🔍 DOM ready state:', document.readyState);
    
    // Wait a bit for DOM to be fully ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check if configuration step elements exist
    const configStep = document.getElementById('step-configuration');
    console.log('🔍 Configuration step element:', configStep);
    
    const gitNameInputCheck = document.getElementById('git-name');
    const gitEmailInputCheck = document.getElementById('git-email');
    
    const projectsDirInputCheck = document.getElementById('projects-dir');
    
    console.log('🔍 Git name input found:', !!gitNameInputCheck, gitNameInputCheck);
    console.log('🔍 Git email input found:', !!gitEmailInputCheck, gitEmailInputCheck);
    
    console.log('🔍 Projects dir input found:', !!projectsDirInputCheck, projectsDirInputCheck);
    
    try {

        const { ipcRenderer } = require('electron');
        const gitName: CommandResult = await ipcRenderer.invoke('execute-command', 'git', ['config', '--global', 'user.name']);
        console.log('Git name result:', gitName);
        if (gitName.code === 0 && gitName.stdout.trim()) {
            const gitNameInput = document.getElementById('git-name') as HTMLInputElement;
            console.log('Git name input element:', gitNameInput);
            if (gitNameInput) {
                gitNameInput.value = gitName.stdout.trim();
                console.log('Pre-filled Git name:', gitName.stdout.trim());
                console.log('Input value after setting:', gitNameInput.value);
            } else {
                console.log('ERROR: git-name input element not found!');
            }
        }
        
        const gitEmail: CommandResult = await ipcRenderer.invoke('execute-command', 'git', ['config', '--global', 'user.email']);
        console.log('Git email result:', gitEmail);
        if (gitEmail.code === 0 && gitEmail.stdout.trim()) {
            const gitEmailInput = document.getElementById('git-email') as HTMLInputElement;
            console.log('Git email input element:', gitEmailInput);
            if (gitEmailInput) {
                gitEmailInput.value = gitEmail.stdout.trim();
                console.log('Pre-filled Git email:', gitEmail.stdout.trim());
                console.log('Email input value after setting:', gitEmailInput.value);
            } else {
                console.log('ERROR: git-email input element not found!');
            }
        }
    } catch (error) {
        console.log('Could not pre-fill Git config:', error);
    }

    // AWS pre-fill removed: `zeltro configure` no longer accepts AWS
    // credentials, so there is nothing to pre-fill them into.

    // Pre-fill projects directory with default
    console.log('🔄 Setting up default projects directory...');
    const projectsDirInputDefault = document.getElementById('projects-dir') as HTMLInputElement;
    console.log('🔍 Projects dir input element for default:', projectsDirInputDefault);
    
    if (projectsDirInputDefault) {
        try {
            console.log('🔄 Getting home directory...');
    
            const { ipcRenderer } = require('electron');
            const homeDir = await ipcRenderer.invoke('get-home-directory');
            console.log('🏠 Home directory:', homeDir);
            
            const defaultProjectsDir = `${homeDir}/podium-projects`;
            console.log('📁 Default projects directory:', defaultProjectsDir);
            
            projectsDirInputDefault.value = defaultProjectsDir;
            console.log('✅ Set default projects directory input value:', defaultProjectsDir);
            console.log('🔍 Input value after setting:', projectsDirInputDefault.value);
        } catch (error) {
            console.error('❌ Error getting home directory:', error);
            // Fallback to a reasonable default
            projectsDirInputDefault.value = '~/podium-projects';
            console.log('🔄 Fallback: Set projects directory to ~/podium-projects');
        }
    } else {
        console.error('❌ Projects directory input element not found for default setting!');
    }
}



async function browseProjectsDir(): Promise<void> {
    console.log('🔄 Browse projects directory button clicked');
    try {
        console.log('🔄 Invoking show-directory-dialog...');

        const { ipcRenderer } = require('electron');
        const result = await ipcRenderer.invoke('show-directory-dialog');
        console.log('📁 Directory dialog result:', result);
        
        if (result && result.filePaths && result.filePaths.length > 0) {
            const selectedPath = result.filePaths[0];
            console.log('✅ Selected path:', selectedPath);
            
            const projectsDirInput = document.getElementById('projects-dir') as HTMLInputElement;
            console.log('🔍 Projects dir input element:', projectsDirInput);
            
            if (projectsDirInput) {
                projectsDirInput.value = selectedPath;
                console.log('✅ Set projects directory input value to:', selectedPath);
                console.log('🔍 Input value after setting:', projectsDirInput.value);
            } else {
                console.error('❌ Projects directory input element not found!');
            }
        } else {
            console.log('❌ No directory selected or dialog cancelled');
        }
    } catch (error) {
        console.error('❌ Error browsing for directory:', error);
        console.error('❌ Error details:', {
            name: (error as Error).name,
            message: (error as Error).message,
            stack: (error as Error).stack
        });
        // Fallback: show error message to user
        showErrorMessage('Could not open directory browser. Please enter the path manually.');
    }
}

function showErrorMessage(message: string): void {
    const stepContent = document.querySelector('.installer-step.active .step-content') as HTMLElement;
    if (!stepContent) return;
    
    // Remove existing error messages
    stepContent.querySelectorAll('.error-message').forEach((el: Element) => el.remove());
    
    // Add new error message
    const errorDiv: HTMLDivElement = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    stepContent.appendChild(errorDiv);
}

// Export functions for global access
(window as any).nextStep = nextStep;
(window as any).previousStep = previousStep;
(window as any).toggleOutput = toggleOutput;
(window as any).openDashboard = openDashboard;
(window as any).browseProjectsDir = browseProjectsDir;
