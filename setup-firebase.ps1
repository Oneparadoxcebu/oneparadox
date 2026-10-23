$ErrorActionPreference = "Stop"

$projectId = "oneparadox-c5c48"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$accountsFile = Join-Path $repoRoot "data\accounts.json"

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
Require-Command "gcloud" "Install the Google Cloud CLI from https://cloud.google.com/sdk/docs/install"
Require-Command "npm" "Install Node.js 20 or later from https://nodejs.org/"
Require-Command "curl.exe" "Install curl or use a current Windows version that includes curl.exe."

if (-not (Test-Path -LiteralPath $accountsFile)) {
    throw "Missing $accountsFile. Create the local ignored account seed file before setup; never commit it."
}

Push-Location $repoRoot
try {
    Write-Output "Checking Firebase CLI sign-in..."
    & firebase login:list *> $null
    if ($LASTEXITCODE -ne 0) {
        Invoke-CheckedCommand "firebase" @("login")
    }

    Write-Output "Checking Google Cloud credentials for account seeding..."
    & gcloud auth application-default print-access-token *> $null
    if ($LASTEXITCODE -ne 0) {
        Invoke-CheckedCommand "gcloud" @("auth", "application-default", "login")
    }
    Invoke-CheckedCommand "gcloud" @("config", "set", "project", $projectId)

    Write-Output "Installing Functions dependencies and running tests..."
    Push-Location (Join-Path $repoRoot "functions")
    try {
        Invoke-CheckedCommand "npm" @("ci")
        Invoke-CheckedCommand "npm" @("test")
        Write-Output "Seeding accounts from the ignored local file..."
        Invoke-CheckedCommand "npm" @("run", "seed:accounts")
    } finally {
        Pop-Location
    }

    Write-Output "Deploying Functions and Firestore rules to $projectId..."
    Invoke-CheckedCommand "firebase" @(
        "deploy",
        "--only",
        "functions,firestore:rules",
        "--project",
        $projectId,
        "--non-interactive"
    )

    $endpoint = "https://us-central1-$projectId.cloudfunctions.net/api/login"
    $status = & curl.exe --silent --show-error --max-time 30 --output NUL --write-out "%{http_code}" $endpoint
    if ($LASTEXITCODE -ne 0) {
        throw "Could not contact the deployed login endpoint at $endpoint."
    }
    if ($status -ne "405") {
        throw "The login endpoint returned HTTP $status instead of 405. Check Firebase Functions deployment and region."
    }

    Write-Output "Firebase setup is complete. The deployed login endpoint is responding."
} finally {
    Pop-Location
}
