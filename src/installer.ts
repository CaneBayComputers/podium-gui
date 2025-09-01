import { ipcRenderer } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
const Convert = require('ansi-to-html');

interface SystemCheck {
    success: boolean;
    message: string;
}

interface SystemChecks {
    [key: string]: SystemCheck | boolean;
    skipSystemCheck?: boolean;
}

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
var installationPath: string = '';
var systemChecks: SystemChecks = {};
var podiumInstalled: boolean = false;

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
        
        // Hide system check step since CLI is already installed
        systemChecks.skipSystemCheck = true;
    }
    
    showStep(0);
});

async function checkPodiumInstallation(): Promise<PodiumStatus> {
    try {
        const result: CommandResult = await ipcRenderer.invoke('execute-command', 'podium', ['help', '--no-coloring']);
        if (result.code === 0) {
            podiumInstalled = true;
            
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

function showStep(stepIndex: number): void {
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
            // Disable continue button during system check
            const continueBtn = document.getElementById('continue-btn') as HTMLButtonElement;
            if (continueBtn) continueBtn.disabled = true;
            runSystemCheck();
            break;
        case 2:
            loadConfiguration();
            break;
        case 3:
            startInstallation();
            break;
    }
}

function getStepName(index: number): string {
    const steps: string[] = ['welcome', 'system-check', 'configuration', 'installation', 'complete'];
    return steps[index] || '';
}

function nextStep(): void {
    // Ensure currentStep is initialized
    if (typeof currentStep === 'undefined') {
        currentStep = 0;
    }
    
    console.log('nextStep called, currentStep:', currentStep);
    if (currentStep < 4) {
        let nextStepIndex: number = currentStep + 1;
        
        // Skip system check if CLI is already installed
        if (nextStepIndex === 1 && systemChecks.skipSystemCheck) {
            nextStepIndex = 2;
        }
        
        console.log('Moving to step:', nextStepIndex);
        showStep(nextStepIndex);
    }
}

function previousStep(): void {
    if (currentStep > 0) {
        showStep(currentStep - 1);
    }
}

interface SystemCheckItem {
    id: string;
    name: string;
    test: () => Promise<SystemCheck>;
}

async function runSystemCheck(): Promise<void> {
    const checks: SystemCheckItem[] = [
        { id: 'check-os', name: 'Operating System', test: checkOperatingSystem },
        { id: 'check-git', name: 'Git Installation', test: checkGit },
        { id: 'check-docker', name: 'Docker Installation', test: checkDocker },
        { id: 'check-permissions', name: 'Permissions', test: checkPermissions }
    ];
    
    let allPassed: boolean = true;
    
    for (const check of checks) {
        const element = document.getElementById(check.id);
        if (!element) continue;
        
        const icon = element.querySelector('.check-icon') as HTMLElement;
        const text = element.querySelector('.check-text') as HTMLElement;
        
        // Show loading
        if (icon) icon.textContent = '⏳';
        if (text) text.textContent = `Checking ${check.name}...`;
        
        try {
            const result: SystemCheck = await check.test();
            systemChecks[check.id] = result;
            
            if (result.success) {
                if (icon) icon.textContent = '✅';
                if (text) text.textContent = result.message;
                element.classList.add('success');
            } else {
                if (icon) icon.textContent = '❌';
                if (text) text.textContent = result.message;
                element.classList.add('error');
                allPassed = false;
            }
        } catch (error) {
            if (icon) icon.textContent = '❌';
            if (text) text.textContent = `Error checking ${check.name}: ${(error as Error).message}`;
            element.classList.add('error');
            allPassed = false;
        }
        
        // Small delay for better UX
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Enable and show continue button if all checks passed
    const continueBtn = document.getElementById('continue-btn') as HTMLButtonElement;
    if (continueBtn) {
        continueBtn.disabled = !allPassed;
        continueBtn.style.display = allPassed ? 'inline-block' : 'none';
    }
    
    if (!allPassed) {
        showErrorMessage('Some system checks failed. Please resolve the issues before continuing.');
    }
}

async function checkOperatingSystem(): Promise<SystemCheck> {
    const platform: string = process.platform;
    const supported: string[] = ['darwin', 'linux', 'win32'];
    
    if (supported.includes(platform)) {
        let osName: string = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux';
        return { success: true, message: `${osName} detected - supported platform` };
    } else {
        return { success: false, message: `Unsupported platform: ${platform}` };
    }
}

async function checkGit(): Promise<SystemCheck> {
    try {
        const result: CommandResult = await ipcRenderer.invoke('execute-command', 'git', ['--version']);
        if (result.code === 0) {
            return { success: true, message: 'Git is installed and ready' };
        } else {
            return { success: false, message: 'Git is not installed or not accessible' };
        }
    } catch (error) {
        return { success: false, message: 'Git check failed' };
    }
}

async function checkDocker(): Promise<SystemCheck> {
    try {
        const result: CommandResult = await ipcRenderer.invoke('execute-command', 'docker', ['--version']);
        if (result.code === 0) {
            return { success: true, message: 'Docker is installed and ready' };
        } else {
            return { success: false, message: 'Docker is not installed - will be installed automatically' };
        }
    } catch (error) {
        return { success: true, message: 'Docker will be installed during setup' };
    }
}

async function checkPermissions(): Promise<SystemCheck> {
    // Check if user has sudo access (for Linux/Mac)
    if (process.platform === 'win32') {
        return { success: true, message: 'Windows permissions ready' };
    }
    
    try {
        const result: CommandResult = await ipcRenderer.invoke('execute-command', 'sudo', ['-v']);
        if (result.code === 0) {
            return { success: true, message: 'Sudo access available' };
        } else {
            return { success: false, message: 'Sudo access required for installation' };
        }
    } catch (error) {
        return { success: false, message: 'Unable to check sudo access' };
    }
}

async function startInstallation(): Promise<void> {
    const progressFill = document.getElementById('progress-fill') as HTMLElement;
    const progressText = document.getElementById('progress-text') as HTMLElement;
    
    let progress: number = 0;
    
    try {
        if (podiumInstalled) {
            // CLI is already installed, just run configuration
            updateProgress(20, 'Configuring Podium environment...');
            await runPodiumConfig();
        } else {
            // Step 1: Clone Podium CLI
            updateProgress(10, 'Downloading Podium CLI...');
            await clonePodiumCLI();
            
            // Step 2: Run installer
            updateProgress(20, 'Running Podium installer...');
            await runPodiumInstaller();
        }
        
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

async function clonePodiumCLI(): Promise<void> {
    // For development/demo purposes, create symbolic link to existing cbc-development
    const existingCLI: string = '/home/shawn/repos/cbc/cbc-development';
    installationPath = '/home/shawn/repos/cbc/podium-cli';
    
    // Create symbolic link using -f flag
    const result: CommandResult = await ipcRenderer.invoke('execute-command', 'ln', [
        '-sf', 
        existingCLI,
        installationPath
    ]);
    
    if (result.code !== 0) {
        throw new Error('Failed to create Podium CLI link');
    }
    
    // Verify the link was created and install script exists
    const checkResult: CommandResult = await ipcRenderer.invoke('execute-command', 'test', [
        '-f', 
        path.join(installationPath, 'scripts', 'configure.sh')
    ]);
    
    if (checkResult.code !== 0) {
        throw new Error('Podium CLI installation files not found');
    }
}

async function runPodiumInstaller(): Promise<void> {
    const installerScript: string = path.join(installationPath, 'scripts', 'configure.sh');
    
    return new Promise((resolve, reject) => {
        console.log('Starting Podium installer...');
        
        // Collect configuration from form
        const gitName = (document.getElementById('git-name') as HTMLInputElement)?.value || '';
        const gitEmail = (document.getElementById('git-email') as HTMLInputElement)?.value || '';
        const awsAccessKey = (document.getElementById('aws-access-key') as HTMLInputElement)?.value || '';
        const awsSecretKey = (document.getElementById('aws-secret-key') as HTMLInputElement)?.value || '';
        const awsRegion = (document.getElementById('aws-region') as HTMLInputElement)?.value || '';
        const skipAws = (document.getElementById('skip-aws') as HTMLInputElement)?.checked || false;
        // Database engine selection removed - all engines are now available
        
        // Build installer arguments
        let installerArgs: string[] = ['--gui-mode', '--no-coloring'];
        if (gitName) installerArgs.push('--git-name', gitName);
        if (gitEmail) installerArgs.push('--git-email', gitEmail);
        if (!skipAws && awsAccessKey && awsSecretKey) {
            installerArgs.push('--aws-access-key', awsAccessKey);
            installerArgs.push('--aws-secret-key', awsSecretKey);
            installerArgs.push('--aws-region', awsRegion);
        }
        if (skipAws) installerArgs.push('--skip-aws');
        // Database engine argument removed - all engines are now available
        
        console.log('Running installer with args:', installerArgs);
        
        // Start the installation with configuration
        const command: string = `echo "y" | bash ${installerScript} ${installerArgs.join(' ')}`;
        ipcRenderer.invoke('execute-command-stream', 'bash', ['-c', command], {
            cwd: installationPath
        }).then((result: StreamCommandResult) => {
            console.log('Installer finished with result:', result);
            
            if (result.code === 0) {
                resolve();
            } else {
                reject(new Error(`Installation script exited with code ${result.code}`));
            }
        }).catch((error: Error) => {
            reject(error);
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
        // Database engine argument removed - all engines are now available
        
        // Run podium config command
        configArgs.push('--no-coloring'); // Add no-coloring flag
        console.log('Running podium config with args:', configArgs);
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
    try {
        const gitName: CommandResult = await ipcRenderer.invoke('execute-command', 'git', ['config', '--global', 'user.name']);
        if (gitName.code === 0 && gitName.stdout.trim()) {
            const gitNameInput = document.getElementById('git-name') as HTMLInputElement;
            if (gitNameInput) gitNameInput.value = gitName.stdout.trim();
        }
        
        const gitEmail: CommandResult = await ipcRenderer.invoke('execute-command', 'git', ['config', '--global', 'user.email']);
        if (gitEmail.code === 0 && gitEmail.stdout.trim()) {
            const gitEmailInput = document.getElementById('git-email') as HTMLInputElement;
            if (gitEmailInput) gitEmailInput.value = gitEmail.stdout.trim();
        }
    } catch (error) {
        console.log('Could not pre-fill Git config:', error);
    }

    // Pre-fill AWS configuration
    try {
        const awsAccessKey: CommandResult = await ipcRenderer.invoke('execute-command', 'aws', ['configure', 'get', 'aws_access_key_id']);
        if (awsAccessKey.code === 0 && awsAccessKey.stdout.trim()) {
            const awsAccessKeyInput = document.getElementById('aws-access-key') as HTMLInputElement;
            if (awsAccessKeyInput) awsAccessKeyInput.value = awsAccessKey.stdout.trim();
        }
        
        const awsSecretKey: CommandResult = await ipcRenderer.invoke('execute-command', 'aws', ['configure', 'get', 'aws_secret_access_key']);
        if (awsSecretKey.code === 0 && awsSecretKey.stdout.trim()) {
            const awsSecretKeyInput = document.getElementById('aws-secret-key') as HTMLInputElement;
            if (awsSecretKeyInput) awsSecretKeyInput.value = awsSecretKey.stdout.trim();
        }
        
        const awsRegion: CommandResult = await ipcRenderer.invoke('execute-command', 'aws', ['configure', 'get', 'region']);
        if (awsRegion.code === 0 && awsRegion.stdout.trim()) {
            const awsRegionInput = document.getElementById('aws-region') as HTMLInputElement;
            if (awsRegionInput) awsRegionInput.value = awsRegion.stdout.trim();
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
