<#
.SYNOPSIS
    Windows interactive menu for Save To Server — equivalent of easy.sh.
    Double-click "Start Sync.bat" to launch this.
#>
Set-StrictMode -Version Latest

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RunScript   = Join-Path $ScriptDir "run.ps1"
$SyncScript  = Join-Path $ScriptDir "scripts\sync_to_smb.ps1"
$ConfigFile  = Join-Path $ScriptDir ".local.env"
$LogDir      = Join-Path $ScriptDir "logs"
$SyncLog     = Join-Path $LogDir "sync.log"
$TaskName    = "SaveToServerSync"

$null = New-Item -ItemType Directory -Force -Path $LogDir

# ── Helpers ───────────────────────────────────────────────────────────────────
function Show-Notification([string]$Message, [string]$Title = "Save To Server") {
    try {
        [Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null
        $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
            [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $xml.GetElementsByTagName("text")[0].AppendChild($xml.CreateTextNode($Title))  | Out-Null
        $xml.GetElementsByTagName("text")[1].AppendChild($xml.CreateTextNode($Message)) | Out-Null
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Save To Server").Show($toast)
    } catch {
        # Toast not available (e.g. older Windows) — silently skip
    }
}

function Get-ConfiguredSource {
    if (-not (Test-Path $ConfigFile)) { return "" }
    foreach ($line in (Get-Content $ConfigFile -Encoding UTF8)) {
        $line = $line.Trim()
        if ($line -match "^LOCAL_SOURCE=\"?([^\"]+)\"?$") { return $Matches[1] }
    }
    return ""
}

function Set-LocalWorkspace {
    Add-Type -AssemblyName System.Windows.Forms
    $browser = New-Object System.Windows.Forms.FolderBrowserDialog
    $browser.Description = "Select the local workspace folder you want to sync"
    $browser.ShowNewFolderButton = $false

    if ($browser.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        Write-Host ""
        Write-Host "Folder selection was canceled."
        return
    }

    $selected = $browser.SelectedPath.TrimEnd("\")
    $content  = "LOCAL_SOURCE=`"$selected`"`n"

    # Preserve other settings if config exists
    if (Test-Path $ConfigFile) {
        $existing = Get-Content $ConfigFile -Encoding UTF8 |
            Where-Object { $_ -notmatch "^LOCAL_SOURCE=" }
        $content = ($existing -join "`n") + "`nLOCAL_SOURCE=`"$selected`"`n"
    }

    Set-Content $ConfigFile -Value $content -Encoding UTF8
    Write-Host ""
    Write-Host "Saved local workspace: $selected"
    Show-Notification "Local workspace saved" "Save To Server"
}

# ── Auto-sync via Windows Task Scheduler ──────────────────────────────────────
function Install-AutoSync {
    $action  = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$RunScript`""
    $trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) -Once `
        -At (Get-Date).AddMinutes(1)
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
        -StartWhenAvailable

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -RunLevel Limited -Force | Out-Null

    Write-Host ""
    Write-Host "Auto-sync installed and will run every 5 minutes."
    Write-Host "Task name: $TaskName"
}

function Remove-AutoSync {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host ""
        Write-Host "Auto-sync removed."
    } else {
        Write-Host ""
        Write-Host "Auto-sync task not found (already removed)."
    }
}

# ── Health check ──────────────────────────────────────────────────────────────
function Show-HealthCheck {
    Write-Host ""
    Write-Host "Health check"
    Write-Host "------------"

    if (Test-Path $SyncScript) {
        Write-Host "- Sync script:   OK"
    } else {
        Write-Host "- Sync script:   MISSING ($SyncScript)"
    }

    if (Get-Command robocopy -ErrorAction SilentlyContinue) {
        Write-Host "- robocopy:      OK (built-in)"
    } else {
        Write-Host "- robocopy:      MISSING"
    }

    if (Test-Path (Join-Path $ScriptDir ".syncignore")) {
        Write-Host "- .syncignore:   OK"
    } else {
        Write-Host "- .syncignore:   MISSING"
    }

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Write-Host "- Auto-sync:     INSTALLED"
    } else {
        Write-Host "- Auto-sync:     NOT INSTALLED"
    }

    $src = Get-ConfiguredSource
    if ($src) {
        Write-Host "- Local workspace: $src"
    } else {
        Write-Host "- Local workspace: NOT SET"
    }
}

# ── Menu ──────────────────────────────────────────────────────────────────────
function Show-Header {
    Write-Host ""
    Write-Host "==========================================="
    Write-Host " Save To Server - Simple Menu (Windows)"
    Write-Host "==========================================="
}

function Show-Menu {
    Write-Host "1) Sync now"
    Write-Host "2) Check sync status"
    Write-Host "3) Open logs folder"
    Write-Host "4) Install auto-sync (every 5 minutes)"
    Write-Host "5) Remove auto-sync"
    Write-Host "6) Run health check"
    Write-Host "7) Set local workspace folder"
    Write-Host "0) Exit"
    Write-Host ""
}

# Prompt for workspace on first run
if (-not (Get-ConfiguredSource)) {
    Write-Host ""
    Write-Host "No local workspace is saved yet."
    Write-Host "A folder picker will open now."
    Set-LocalWorkspace
}

while ($true) {
    Show-Header
    Show-Menu
    $choice = Read-Host "Pick an option"

    switch ($choice) {
        "1" {
            Write-Host ""
            if (& powershell.exe -ExecutionPolicy Bypass -NoProfile -File "$RunScript") {
                Show-Notification "Sync completed successfully" "Save To Server"
            } else {
                Show-Notification "Sync failed. Check logs for details." "Save To Server"
            }
        }
        "2" {
            Write-Host ""
            & powershell.exe -ExecutionPolicy Bypass -NoProfile -File "$RunScript" "status"
        }
        "3" {
            Start-Process explorer.exe $LogDir
        }
        "4" { Install-AutoSync }
        "5" { Remove-AutoSync }
        "6" { Show-HealthCheck }
        "7" { Set-LocalWorkspace }
        "0" {
            Write-Host "Bye."
            exit 0
        }
        default { Write-Host "Invalid option." }
    }

    Write-Host ""
    Read-Host "Press Enter to continue..."
}
