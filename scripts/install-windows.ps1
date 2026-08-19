# Set up podium-gui on a fresh Windows box, and open SSH so it can be driven
# remotely afterwards.
#
# Windows is REMOTE-ONLY for Podium: there is no local CLI to install, because
# Podium is Docker plus bash scripts. The GUI here talks to Podium on other
# machines over SSH. So this installs the GUI and nothing else Podium-related —
# projects live on the Linux and Mac hosts you add under Settings.
#
# Every step is idempotent. Re-running is the supported way to update.
#
# Normally invoked by install-windows.bat, which handles elevation.

$ErrorActionPreference = 'Stop'

$REPO_URL  = 'https://github.com/CaneBayComputers/podium-gui.git'
$BRANCH    = 'dev'
$REPO_DIR  = 'C:\podium-gui'
$PUBKEY    = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCi2nq3XhW6VXz4eEgmqGdA3yrTXJMqCtIijKMaAgzbe2yv4o3vZzNVE5T4ap8Hg6zKXHwjinF2Iq4wzTXQ3XdA0tXcpc1Uj77bOgMBKu2Kp/Pcz4SLIhJ8wqctH1wV7gXOqj+y/b1qnsLLsTrp5RpVTzSdXUKdCiHpkcRpEnXbiGF2M51SW9tf10Q1h10J1NUrGrBrspkoOsoZfrXzuPjAUD2fdRr7fMHwRx5y5gHhFYhib+twfuZitgPQ+2tmuJVsjiTeh+G66sNnOQEiMVTTII+1JE3+JQJcXc/Lv1MMMr+t12LlIAnYYb0lfXGZX6qNWcMCo7g7fmVBmYwq6Wtp shawn@shrimpwagon'
$NODE_VER  = '20.19.3'

function Say  ($m) { Write-Host "  $m" }
function Step ($m) { Write-Host ""; Write-Host "== $m" -ForegroundColor Cyan }
function Warn ($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host ""; Write-Host "FAILED: $m" -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal]$id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Die "Not running as Administrator. Right-click install-windows.bat and Run as administrator." }

Write-Host ""
Write-Host "Podium GUI - Windows setup" -ForegroundColor Green
Say "user: $($id.Name)"
Say "windows: $((Get-CimInstance Win32_OperatingSystem).Caption)"

# --- SSH server ------------------------------------------------------------
# Installed so this machine can be reached for testing and updates. It is a
# built-in Windows optional feature, present on Home as well as Pro.
Step "OpenSSH Server"
$cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' | Select-Object -First 1
if ($cap.State -ne 'Installed') {
    Say "installing (this takes a minute)..."
    Add-WindowsCapability -Online -Name $cap.Name | Out-Null
    Say "installed"
} else { Say "already installed" }

Set-Service -Name sshd -StartupType Automatic
if ((Get-Service sshd).Status -ne 'Running') { Start-Service sshd; Say "service started" }
else { Say "service already running" }

if (-not (Get-NetFirewallRule -Name 'sshd-podium' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'sshd-podium' -DisplayName 'OpenSSH Server (Podium)' `
        -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
    Say "firewall rule added for port 22"
} else { Say "firewall rule already present" }

# --- Authorised key --------------------------------------------------------
# The gotcha that silently breaks key auth on Windows: for any account in the
# Administrators group, sshd ignores ~/.ssh/authorized_keys entirely and reads
# C:\ProgramData\ssh\administrators_authorized_keys instead — and it REFUSES
# that file unless its ACL grants only SYSTEM and Administrators. Get either
# wrong and sshd falls back to asking for a password with no error explaining
# why.
Step "Authorised key"
$inAdmins = ([Security.Principal.WindowsPrincipal]$id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if ($inAdmins) {
    $keyFile = "$env:ProgramData\ssh\administrators_authorized_keys"
    Say "account is an administrator -> $keyFile"
} else {
    $keyFile = "$env:USERPROFILE\.ssh\authorized_keys"
    New-Item -ItemType Directory -Force -Path (Split-Path $keyFile) | Out-Null
    Say "standard account -> $keyFile"
}

$existing = if (Test-Path $keyFile) { Get-Content $keyFile -Raw } else { '' }
if ($existing -notmatch [regex]::Escape($PUBKEY.Split(' ')[1])) {
    # ASCII deliberately. PowerShell 5.1's -Encoding UTF8 writes a BOM, and
    # sshd treats a BOM as part of the first key, so the key never matches.
    $lines = @()
    if ($existing.Trim()) { $lines += $existing.Trim() }
    $lines += $PUBKEY
    Set-Content -Path $keyFile -Value ($lines -join "`r`n") -Encoding ASCII
    Say "key added"
} else { Say "key already present" }

if ($inAdmins) {
    icacls $keyFile /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
    Say "permissions locked to SYSTEM + Administrators"
}

# PowerShell rather than cmd, because everything worth running remotely here
# (winget, Get-WindowsCapability, npm through a sane quoting model) is
# PowerShell. Without this, `ssh host "command"` lands in cmd.exe.
$sshReg = 'HKLM:\SOFTWARE\OpenSSH'
if (-not (Test-Path $sshReg)) { New-Item -Path $sshReg -Force | Out-Null }
Set-ItemProperty -Path $sshReg -Name DefaultShell `
    -Value "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
Say "default shell set to PowerShell"

Restart-Service sshd
Say "sshd restarted to pick up the key and shell"

# --- Git and Node ----------------------------------------------------------
Step "Git and Node.js"

function Have ($cmd) { $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }
function RefreshPath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path','User')
}

$haveWinget = Have winget

if (-not (Have git)) {
    if ($haveWinget) {
        Say "installing Git via winget..."
        winget install --id Git.Git -e --source winget --silent `
            --accept-source-agreements --accept-package-agreements | Out-Null
    } else {
        # winget ships with App Installer, which is absent on some Windows 10
        # builds. Fall back to the release the Git project publishes.
        Say "winget not available; downloading Git installer..."
        $rel = Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest'
        $url = ($rel.assets | Where-Object { $_.name -like '*64-bit.exe' } | Select-Object -First 1).browser_download_url
        if (-not $url) { Die "Could not find a Git installer to download." }
        $exe = "$env:TEMP\git-installer.exe"
        Invoke-WebRequest $url -OutFile $exe
        Start-Process $exe -ArgumentList '/VERYSILENT','/NORESTART' -Wait
    }
    RefreshPath
    if (Have git) { Say "git installed: $(git --version)" } else { Warn "git still not on PATH - a reboot may be needed" }
} else { Say "git already installed: $(git --version)" }

if (-not (Have node)) {
    if ($haveWinget) {
        Say "installing Node.js LTS via winget..."
        winget install --id OpenJS.NodeJS.LTS -e --source winget --silent `
            --accept-source-agreements --accept-package-agreements | Out-Null
    } else {
        Say "winget not available; downloading Node $NODE_VER..."
        $msi = "$env:TEMP\node-install.msi"
        Invoke-WebRequest "https://nodejs.org/dist/v$NODE_VER/node-v$NODE_VER-x64.msi" -OutFile $msi
        Start-Process msiexec.exe -ArgumentList '/i',"`"$msi`"",'/qn','/norestart' -Wait
    }
    RefreshPath
    if (Have node) { Say "node installed: $(node --version)" } else { Warn "node still not on PATH - a reboot may be needed" }
} else { Say "node already installed: $(node --version)" }

if (-not (Have git) -or -not (Have node)) {
    Die "git and node must both be on PATH. Reboot and re-run this script."
}

# --- The GUI itself --------------------------------------------------------
# From source rather than a packaged installer: there is no Windows build
# target configured, an unsigned .exe trips SmartScreen, and a checkout updates
# with `git pull` instead of a rebuild-and-reinstall cycle.
Step "Podium GUI"
if (Test-Path "$REPO_DIR\.git") {
    Say "updating existing checkout at $REPO_DIR"
    git -C $REPO_DIR fetch -q origin
    git -C $REPO_DIR checkout -q $BRANCH
    git -C $REPO_DIR reset -q --hard "origin/$BRANCH"
} else {
    Say "cloning into $REPO_DIR ..."
    git clone -q --branch $BRANCH $REPO_URL $REPO_DIR
}
Say "at $(git -C $REPO_DIR rev-parse --short HEAD) on $BRANCH"

Push-Location $REPO_DIR
try {
    Say "installing dependencies (several minutes on a first run)..."
    # node-pty ships win32 prebuilds, so this normally needs no compiler. If it
    # does fail, the app still runs - it loses in-tile terminals and falls back
    # to telling you the command to run yourself.
    npm install --no-audit --no-fund 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Warn "npm install reported errors - embedded terminals may not work" }
    else { Say "dependencies installed" }

    Say "building..."
    npm run build-ts 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Die "TypeScript build failed. Run 'npm run build-ts' in $REPO_DIR to see why." }
    Say "built"
} finally { Pop-Location }

# A launcher, so starting it is not a command to remember.
$launcher = "$REPO_DIR\podium-gui.bat"
Set-Content -Path $launcher -Encoding ASCII -Value @"
@echo off
cd /d "$REPO_DIR"
call npm run build-ts >nul 2>&1
start "" npx electron dist\main.js
"@
$desktop = [Environment]::GetFolderPath('Desktop')
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut("$desktop\Podium GUI.lnk")
$sc.TargetPath = $launcher
$sc.WorkingDirectory = $REPO_DIR
$sc.Save()
Say "desktop shortcut created"

# --- Summary ---------------------------------------------------------------
$ips = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Say "repo:     $REPO_DIR"
Say "launch:   the 'Podium GUI' desktop shortcut"
Say "ssh:      ssh $($id.Name.Split('\')[-1])@$($ips -join ' or ')"
Write-Host ""
Say "Podium projects live on the hosts you add under Settings > SSH Hosts."
Say "Windows has no local Podium - that is by design, not a missing step."
Write-Host ""
# The one change here that could make SSH awkward if PowerShell misbehaves on
# this machine, so the undo is printed rather than left to be looked up later.
Say "SSH sessions open in PowerShell. To switch back to cmd.exe:"
Say "  Remove-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell"
Write-Host ""
Read-Host "Press Enter to close"
