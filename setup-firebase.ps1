$ErrorActionPreference = "Stop"

$projectId = "oneparadox-c5c48"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Require-Command {
    param(
        [string]$Name,
        [string]$InstallHint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required. $InstallHint"
    }
}

function Invoke-CheckedCommand {
    param(
        [string]$Name,
        [string[]]$Arguments
    )

    & $Name @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

Require-Command "firebase" "Install it with: npm install --global firebase-tools"

Push-Location $repoRoot
try {
    Write-Output "Checking Firebase CLI sign-in..."
    & firebase login:list *> $null
    if ($LASTEXITCODE -ne 0) {
        Invoke-CheckedCommand "firebase" @("login")
    }

    Write-Output "Deploying Firestore rules to $projectId..."
    Invoke-CheckedCommand "firebase" @(
        "deploy",
        "--only",
        "firestore:rules",
        "--project",
        $projectId,
        "--non-interactive"
    )

    Write-Output "Firebase Firestore rules are deployed."
} finally {
    Pop-Location
}
