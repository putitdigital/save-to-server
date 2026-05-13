<#
.SYNOPSIS
    SMB sync script for Windows — PowerShell equivalent of sync_to_smb.sh.
    Reads settings from .local.env, maps an SMB share to a drive letter,
    then uses robocopy to mirror the local folder to the server.

.PARAMETER Mode
    One of: (empty) = run sync, "status" = print running state,
    "changes-count" = print PENDING_COUNT=N for the Tauri app.
#>
param(
    [Parameter(Position = 0)][string]$Mode = ""
)

Set-StrictMode -Version Latest

$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Definition
$WorkspaceDir = Split-Path -Parent $ScriptDir

# ── Settings (read from .local.env) ─────────────────────────────────────────
$LocalSource  = ""
$SmbUrl       = ""
$MountName    = ""
$DestSubpath  = ""
$DeleteRemote = $false

$LocalEnvPath = Join-Path $WorkspaceDir ".local.env"

function Read-LocalEnv {
    if (-not (Test-Path $LocalEnvPath)) { return }
    foreach ($line in (Get-Content $LocalEnvPath -Encoding UTF8)) {
        $line = $line.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { continue }
        if ($line -notmatch "^([^=]+)=(.*)$") { continue }
        $key = $Matches[1].Trim()
        $val = $Matches[2].Trim().Trim('"')
        switch ($key) {
            "LOCAL_SOURCE"  { $script:LocalSource  = $val }
            "SMB_URL"       { $script:SmbUrl       = $val }
            "MOUNT_NAME"    { $script:MountName    = $val }
            "DEST_SUBPATH"  { $script:DestSubpath  = $val }
            "DELETE_REMOTE" { $script:DeleteRemote = ($val -eq "true") }
        }
    }
}

Read-LocalEnv

# ── Identity ──────────────────────────────────────────────────────────────────
$LogActor = if ($env:FLOWIT_USER) {
    $env:FLOWIT_USER
} else {
    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
}

# ── Paths ─────────────────────────────────────────────────────────────────────
$ExcludeFile = Join-Path $WorkspaceDir ".syncignore"
$LogDir      = Join-Path $WorkspaceDir "logs"
$LogFile     = Join-Path $LogDir "sync.log"
$PidFile     = Join-Path $LogDir "sync.pid"

$null = New-Item -ItemType Directory -Force -Path $LogDir

# MOUNT_NAME is the drive letter on Windows (e.g. "Z" or "Z:")
$DriveLetter = $MountName.TrimEnd(":").Trim().ToUpper()
$MountPoint  = if ($DriveLetter) { "${DriveLetter}:" } else { "" }

# ── Logging ───────────────────────────────────────────────────────────────────
function Get-Timestamp { Get-Date -Format "yyyy-MM-dd HH:mm:ss" }

function Write-Log([string]$Msg) {
    $entry = "[$(Get-Timestamp)] [user: $LogActor] $Msg"
    Write-Host $entry
    Add-Content -Path $LogFile -Value $entry -Encoding UTF8
    # Mirror to the server log when the destination folder is accessible
    $serverDest = Get-Destination
    if ($MountPoint -and (Test-Path $serverDest -ErrorAction SilentlyContinue)) {
        $serverLog = Join-Path $serverDest "syncAll.log"
        try { Add-Content -Path $serverLog -Value $entry -Encoding UTF8 } catch {}
    }
}

# ── Status ────────────────────────────────────────────────────────────────────
function Get-SyncStatus {
    if (Test-Path $PidFile) {
        $storedPid = (Get-Content $PidFile -Raw -ErrorAction SilentlyContinue).Trim()
        if ($storedPid -and (Get-Process -Id ([int]$storedPid) -ErrorAction SilentlyContinue)) {
            Write-Host "Running (PID: $storedPid)"
            return
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        Write-Host "Idle (stale state cleared)"
        return
    }
    Write-Host "Idle"
}

# ── SMB helpers ───────────────────────────────────────────────────────────────
function ConvertTo-UncPath([string]$Url) {
    # smb://server/share  ->  \\server\share
    if ($Url -match "^smb://(.+)$") {
        return "\\" + ($Matches[1] -replace "/", "\")
    }
    if ($Url.StartsWith("\\")) { return $Url }
    return $Url
}

function Test-DriveMapped {
    if (-not $DriveLetter) { return $false }
    return ($null -ne (Get-PSDrive -Name $DriveLetter -ErrorAction SilentlyContinue))
}

function Ensure-Mounted([bool]$SilentIfAlreadyMounted = $false) {
    if (-not $DriveLetter) {
        Write-Log "ERROR: MOUNT_NAME is empty. Set it in Flowit Settings (use a drive letter, e.g. Z)."
        return $false
    }
    if (Test-DriveMapped) {
        if (-not $SilentIfAlreadyMounted) { Write-Log "Share already mapped at $MountPoint" }
        return $true
    }
    if (-not $SmbUrl) {
        Write-Log "ERROR: SMB_URL is empty. Set it in Flowit Settings and click Save Settings."
        return $false
    }

    $uncPath = ConvertTo-UncPath $SmbUrl
    Write-Log "Mapping SMB share: $uncPath -> $MountPoint"

    $netResult = & net use "$MountPoint" "$uncPath" /persistent:no 2>&1
    if ($LASTEXITCODE -eq 0 -or (Test-DriveMapped)) {
        Write-Log "Mapped successfully: $MountPoint"
        return $true
    }

    Write-Log "ERROR: Could not map SMB share. net use output: $netResult"
    Write-Log "TIP: Open File Explorer, press Ctrl+L, enter $SmbUrl and sign in, then try again."
    return $false
}

# ── Destination ───────────────────────────────────────────────────────────────
function Get-Destination {
    if ($DestSubpath) { return "$MountPoint\$DestSubpath" }
    return $MountPoint
}

# ── Exclude args for robocopy ─────────────────────────────────────────────────
function Get-ExcludeArgs {
    $xfArgs = @()
    $xdArgs = @()
    if (Test-Path $ExcludeFile) {
        $patterns = Get-Content $ExcludeFile -Encoding UTF8 |
            Where-Object { $_.Trim() -ne "" -and -not $_.Trim().StartsWith("#") }
        foreach ($p in $patterns) {
            # Patterns ending in / are directories; others are treated as files
            if ($p.TrimEnd('/').Contains('/') -or $p.EndsWith('/')) {
                $xdArgs += $p.TrimEnd('/')
            } else {
                $xfArgs += $p
            }
        }
    }
    $result = @()
    if ($xfArgs.Count -gt 0) { $result += "/XF"; $result += $xfArgs }
    if ($xdArgs.Count -gt 0) { $result += "/XD"; $result += $xdArgs }
    return $result
}

# ── Sync ──────────────────────────────────────────────────────────────────────
function Run-Sync {
    if (-not $LocalSource -or -not (Test-Path $LocalSource)) {
        Write-Log "ERROR: Local source does not exist: $LocalSource"
        return $false
    }

    $destination = Get-Destination
    $null = New-Item -ItemType Directory -Force -Path $destination -ErrorAction SilentlyContinue

    # /E  = copy subdirectories including empty ones
    # /NDL /NJH /NJS /NS /NC = suppress all headers; output is filenames only
    $rcArgs = @(
        $LocalSource, $destination,
        "/E", "/NDL", "/NJH", "/NJS", "/NS", "/NC"
    )
    if ($DeleteRemote) {
        $rcArgs += "/PURGE"
        Write-Log "Delete mode enabled: remote files missing locally will be removed"
    }
    $rcArgs += Get-ExcludeArgs

    Write-Log "Starting sync: $LocalSource -> $destination"

    & robocopy @rcArgs | ForEach-Object {
        $line = $_.TrimStart("`t").Trim()
        if ($line -ne "" -and -not $line.StartsWith("-")) {
            # Emit each transferred file path so the Tauri app can track progress
            Write-Host $line
        }
        if ($line -ne "") {
            Add-Content -Path $LogFile -Value $line -Encoding UTF8
        }
    }

    # robocopy exit codes 0–7 indicate success; 8+ indicate errors
    if ($LASTEXITCODE -lt 8) {
        Write-Log "Sync finished"
        return $true
    }
    Write-Log "ERROR: Sync finished with robocopy exit code $LASTEXITCODE"
    return $false
}

# ── Changes count (dry run) ───────────────────────────────────────────────────
function Get-ChangesCount {
    if (-not $LocalSource -or -not (Test-Path $LocalSource)) {
        Write-Host "PENDING_COUNT=0"
        return
    }

    $destination = Get-Destination
    $null = New-Item -ItemType Directory -Force -Path $destination -ErrorAction SilentlyContinue

    $rcArgs = @(
        $LocalSource, $destination,
        "/E", "/L",   # /L = list only, no copy
        "/NDL", "/NJH", "/NJS", "/NS", "/NC"
    )
    if ($DeleteRemote) { $rcArgs += "/PURGE" }
    $rcArgs += Get-ExcludeArgs

    $count = 0
    & robocopy @rcArgs 2>$null | ForEach-Object {
        $line = $_.TrimStart("`t").Trim()
        if ($line -ne "" -and -not $line.StartsWith("-")) { $count++ }
    }

    Write-Host "PENDING_COUNT=$count"
}

# ── Main ──────────────────────────────────────────────────────────────────────
switch ($Mode) {
    "status" {
        Get-SyncStatus
        exit 0
    }
    "changes-count" {
        if (-not (Ensure-Mounted -SilentIfAlreadyMounted $true)) {
            Write-Host "PENDING_COUNT=0"
            exit 0
        }
        Get-ChangesCount
        exit 0
    }
    default {
        # Prevent concurrent sync runs using a PID file
        if (Test-Path $PidFile) {
            $existingPid = (Get-Content $PidFile -Raw -ErrorAction SilentlyContinue).Trim()
            if ($existingPid -and (Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue)) {
                Write-Log "Another sync is already running (PID: $existingPid)"
                exit 1
            }
            Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        }

        $PID | Set-Content $PidFile -Encoding UTF8
        try {
            Write-Log "==== Sync run start ===="
            if (-not (Ensure-Mounted)) { exit 1 }
            $ok = Run-Sync
            Write-Log "==== Sync run end ===="
            if (-not $ok) { exit 1 }
        } finally {
            Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        }
        exit 0
    }
}
