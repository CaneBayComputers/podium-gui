import * as fs from 'fs';
const Convert = require('ansi-to-html');

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

type PodiumStatus = 'configured' | 'not-configured' | 'not-installed';

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
    
    // Check if Podium CLI is already installed
    const podiumStatus: PodiumStatus = await checkPodiumInstallation();
    
    if (podiumStatus === 'not-configured') {
        // Skip to configuration step if CLI is installed but not configured
        const titleElement = document.querySelector('#step-welcome .step-content h2') as HTMLElement;
        const descriptionElement = document.querySelector('#step-welcome .step-description') as HTMLElement;
        const buttonElement = document.querySelector('#step-welcome .btn') as HTMLElement;
        
        if (titleElement) titleElement.textContent = 'Configure Podium';
        if (descriptionElement) {
            descriptionElement.textContent = 'Podium CLI is installed but needs configuration. Let\'s set up your development environment.';
        }
        if (buttonElement) buttonElement.textContent = 'Configure Now';
        
        // CLI is already installed, we can skip directly to configuration
    }
    
    await showStep(0);
});

async function checkPodiumInstallation(): Promise<PodiumStatus> {
    try {
        const { ipcRenderer } = require('electron');
        const result: CommandResult = await ipcRenderer.invoke('execute-command', 'podium', ['help', '--no-coloring']);
        if (result.code === 0) {
            // Check if configured by looking for docker-stack/.env
            const configCheck: CommandResult = await ipcRenderer.invoke('execute-command', 'test', [
                '-f', '/usr/local/share/podium-cli/docker-stack/.env'
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
        // The deb/mac installer should have already installed Podium CLI globally
        // Just run the configuration
        updateProgress(20, 'Configuring Podium environment...');
        await runPodiumConfig();
        
        // Start services after configuration
        updateProgress(80, 'Starting services...');
        await startServicesAfterConfig();
        
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
        console.log('Starting Podium services after configuration...');
        
        const { ipcRenderer } = require('electron');
        
        // Run podium start-services command
        ipcRenderer.invoke('execute-command-stream', 'podium', ['start-services', '--no-coloring']).then((result: StreamCommandResult) => {
            console.log('Start services finished with result:', result);
            
            if (result.code === 0) {
                resolve();
            } else {
                // Don't fail the installation if services don't start - just log it
                console.warn('Services failed to start, but continuing...', result.stderr);
                resolve();
            }
        }).catch((error: Error) => {
            console.warn('Error starting services, but continuing...', error);
            resolve();
        });
    });
}

async function runPodiumConfig(): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log('Starting Podium configuration...');
        
        // Collect configuration from form
        const gitName = (document.getElementById('git-name') as HTMLInputElement)?.value || '';
        const gitEmail = (document.getElementById('git-email') as HTMLInputElement)?.value || '';
        const awsAccessKey = (document.getElementById('aws-access-key') as HTMLInputElement)?.value || '';
        const awsSecretKey = (document.getElementById('aws-secret-key') as HTMLInputElement)?.value || '';
        const awsRegion = (document.getElementById('aws-region') as HTMLInputElement)?.value || '';
        const skipAws = (document.getElementById('skip-aws') as HTMLInputElement)?.checked || false;
        const projectsDir = (document.getElementById('projects-dir') as HTMLInputElement)?.value || '';
        // Database engine selection removed - all engines are now available
        
        // Build config arguments
        let configArgs: string[] = ['config', '--gui-mode'];
        if (gitName) configArgs.push('--git-name', gitName);
        if (gitEmail) configArgs.push('--git-email', gitEmail);
        if (!skipAws && awsAccessKey && awsSecretKey) {
            configArgs.push('--aws-access-key', awsAccessKey);
            configArgs.push('--aws-secret-key', awsSecretKey);
            configArgs.push('--aws-region', awsRegion);
        }
        if (skipAws) configArgs.push('--skip-aws');
        if (projectsDir) configArgs.push('--projects-dir', projectsDir);
        // Database engine argument removed - all engines are now available
        
        // Run podium config command
        configArgs.push('--no-coloring'); // Add no-coloring flag
        console.log('Running podium config with args:', configArgs);
        const { ipcRenderer } = require('electron');
        ipcRenderer.invoke('execute-command-stream', 'podium', configArgs).then((result: StreamCommandResult) => {
            console.log('Config finished with result:', result);
            
            if (result.code === 0) {
                resolve();
            } else {
                reject(new Error(`Configuration failed with code ${result.code}`));
            }
        }).catch((error: Error) => {
            reject(error);
        });
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
    console.log('🔄 Loading configuration - pre-filling Git and AWS settings...');
    console.log('🔍 Current step:', currentStep);
    console.log('🔍 DOM ready state:', document.readyState);
    
    // Wait a bit for DOM to be fully ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check if configuration step elements exist
    const configStep = document.getElementById('step-configuration');
    console.log('🔍 Configuration step element:', configStep);
    
    const gitNameInputCheck = document.getElementById('git-name');
    const gitEmailInputCheck = document.getElementById('git-email');
    const awsAccessKeyInputCheck = document.getElementById('aws-access-key');
    const projectsDirInputCheck = document.getElementById('projects-dir');
    
    console.log('🔍 Git name input found:', !!gitNameInputCheck, gitNameInputCheck);
    console.log('🔍 Git email input found:', !!gitEmailInputCheck, gitEmailInputCheck);
    console.log('🔍 AWS access key input found:', !!awsAccessKeyInputCheck, awsAccessKeyInputCheck);
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

    // Pre-fill AWS configuration
    try {
        const { ipcRenderer } = require('electron');
        const awsAccessKey: CommandResult = await ipcRenderer.invoke('execute-command', 'aws', ['configure', 'get', 'aws_access_key_id']);
        console.log('AWS access key result:', awsAccessKey);
        if (awsAccessKey.code === 0 && awsAccessKey.stdout.trim()) {
            const awsAccessKeyInput = document.getElementById('aws-access-key') as HTMLInputElement;
            console.log('AWS access key input element:', awsAccessKeyInput);
            if (awsAccessKeyInput) {
                awsAccessKeyInput.value = awsAccessKey.stdout.trim();
                console.log('Pre-filled AWS access key:', awsAccessKey.stdout.trim());
                console.log('AWS access key input value after setting:', awsAccessKeyInput.value);
            } else {
                console.log('ERROR: aws-access-key input element not found!');
            }
        }
        
        const awsSecretKey: CommandResult = await ipcRenderer.invoke('execute-command', 'aws', ['configure', 'get', 'aws_secret_access_key']);
        if (awsSecretKey.code === 0 && awsSecretKey.stdout.trim()) {
            const awsSecretKeyInput = document.getElementById('aws-secret-key') as HTMLInputElement;
            if (awsSecretKeyInput) {
                awsSecretKeyInput.value = awsSecretKey.stdout.trim();
                console.log('Pre-filled AWS secret key');
            }
        }
        
        const awsRegion: CommandResult = await ipcRenderer.invoke('execute-command', 'aws', ['configure', 'get', 'region']);
        console.log('AWS region result:', awsRegion);
        if (awsRegion.code === 0 && awsRegion.stdout.trim()) {
            const awsRegionInput = document.getElementById('aws-region') as HTMLInputElement;
            if (awsRegionInput) {
                awsRegionInput.value = awsRegion.stdout.trim();
                console.log('Pre-filled AWS region:', awsRegion.stdout.trim());
            }
        }
    } catch (error) {
        console.log('Could not pre-fill AWS config:', error);
    }

    // Set up AWS checkbox toggle
    const skipAwsCheckbox = document.getElementById('skip-aws') as HTMLInputElement;
    const awsFields = document.getElementById('aws-fields') as HTMLElement;
    
    if (skipAwsCheckbox && awsFields) {
        skipAwsCheckbox.addEventListener('change', (): void => {
            awsFields.style.display = skipAwsCheckbox.checked ? 'none' : 'block';
        });
    }

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
