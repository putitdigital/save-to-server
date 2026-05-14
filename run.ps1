# Windows entry point — delegates to the real sync script.
# Usage: powershell -ExecutionPolicy Bypass -File run.ps1 [mode]
param(
    [Parameter(Position = 0)][string]$Mode = ""
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
& "$ScriptDir\scripts\sync_to_smb.ps1" $Mode
exit $LASTEXITCODE
