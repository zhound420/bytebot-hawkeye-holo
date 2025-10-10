#Requires -Version 5.1
<#
.SYNOPSIS
    Builds the Bytebotd MSI installer package using WiX Toolset.

.DESCRIPTION
    This script:
    1. Builds TypeScript packages (shared, bytebot-cv, bytebotd)
    2. Installs Windows-specific node_modules
    3. Compiles WiX source files into MSI installer
    4. Outputs bytebotd-installer.msi (~80MB)

.PARAMETER SkipBuild
    Skip TypeScript compilation (use existing dist/ folders)

.PARAMETER SkipNodeModules
    Skip npm install (use existing node_modules/)

.PARAMETER WixPath
    Path to WiX Toolset bin directory (default: auto-detect)

.EXAMPLE
    .\build-msi.ps1
    .\build-msi.ps1 -SkipBuild
    .\build-msi.ps1 -WixPath "C:\Program Files (x86)\WiX Toolset v3.11\bin"
#>

[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipNodeModules,
    [string]$WixPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Colors
function Write-Info { param($msg) Write-Host $msg -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host $msg -ForegroundColor Green }
function Write-Warning { param($msg) Write-Host $msg -ForegroundColor Yellow }
function Write-Error { param($msg) Write-Host $msg -ForegroundColor Red }

Write-Info "================================================"
Write-Info "   Building Bytebotd MSI Installer"
Write-Info "================================================"
Write-Host ""

# Detect script and repo root
$ScriptRoot = $PSScriptRoot
$RepoRoot = Split-Path $ScriptRoot -Parent
$WixSourceDir = Join-Path $ScriptRoot "wix"
$BuildRoot = Join-Path $RepoRoot "build-temp"
$OutputDir = Join-Path $RepoRoot "docker\windows-installer"
$OutputMsi = Join-Path $OutputDir "bytebotd-installer.msi"

Write-Info "Paths:"
Write-Host "  Repo root: $RepoRoot"
Write-Host "  Build temp: $BuildRoot"
Write-Host "  Output: $OutputMsi"
Write-Host ""

# Check for WiX Toolset
if (-not $WixPath) {
    $PossiblePaths = @(
        "${env:ProgramFiles(x86)}\WiX Toolset v3.11\bin",
        "${env:ProgramFiles(x86)}\WiX Toolset v3.14\bin",
        "${env:ProgramFiles}\WiX Toolset v3.11\bin",
        "${env:ProgramFiles}\WiX Toolset v3.14\bin",
        "C:\Program Files (x86)\WiX Toolset v3.11\bin",
        "C:\Program Files (x86)\WiX Toolset v3.14\bin"
    )

    foreach ($Path in $PossiblePaths) {
        if (Test-Path (Join-Path $Path "candle.exe")) {
            $WixPath = $Path
            break
        }
    }
}

if (-not $WixPath -or -not (Test-Path (Join-Path $WixPath "candle.exe"))) {
    Write-Error "❌ WiX Toolset not found!"
    Write-Host ""
    Write-Host "Please install WiX Toolset v3.11 or later:"
    Write-Host "  https://wixtoolset.org/releases/"
    Write-Host ""
    Write-Host "Or specify path manually:"
    Write-Host "  .\build-msi.ps1 -WixPath 'C:\Path\To\WiX\bin'"
    exit 1
}

Write-Success "✓ WiX Toolset found: $WixPath"
Write-Host ""

# Check for Node.js
$NodeVersion = node --version 2>$null
if (-not $NodeVersion) {
    Write-Error "❌ Node.js not found! Please install Node.js 20.0.0 or later."
    exit 1
}

Write-Success "✓ Node.js found: $NodeVersion"
Write-Host ""

# Step 1: Build TypeScript packages
if (-not $SkipBuild) {
    Write-Info "[1/5] Building TypeScript packages..."
    Write-Host ""

    # Build shared
    Write-Host "Building shared package..."
    Push-Location (Join-Path $RepoRoot "packages\shared")
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "❌ Failed to build shared package"
        exit 1
    }
    Pop-Location
    Write-Success "  ✓ Shared built"

    # Build bytebot-cv
    Write-Host "Building bytebot-cv package..."
    Push-Location (Join-Path $RepoRoot "packages\bytebot-cv")
    if (-not (Test-Path "node_modules")) {
        npm install
    }
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "❌ Failed to build bytebot-cv package"
        exit 1
    }
    Pop-Location
    Write-Success "  ✓ Bytebot-cv built"

    # Build bytebotd
    Write-Host "Building bytebotd package..."
    Push-Location (Join-Path $RepoRoot "packages\bytebotd")
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "❌ Failed to build bytebotd package"
        exit 1
    }
    Pop-Location
    Write-Success "  ✓ Bytebotd built"

    Write-Host ""
} else {
    Write-Warning "[1/5] Skipping TypeScript build (using existing dist/ folders)"
    Write-Host ""
}

# Step 2: Create clean build temp directory
Write-Info "[2/5] Creating clean build temp directory..."
if (Test-Path $BuildRoot) {
    Remove-Item -Recurse -Force $BuildRoot
}
New-Item -ItemType Directory -Path $BuildRoot | Out-Null
New-Item -ItemType Directory -Path "$BuildRoot\packages\bytebotd" | Out-Null
New-Item -ItemType Directory -Path "$BuildRoot\packages\shared" | Out-Null
New-Item -ItemType Directory -Path "$BuildRoot\packages\bytebot-cv" | Out-Null
Write-Success "✓ Build temp created: $BuildRoot"
Write-Host ""

# Step 3: Copy compiled code
Write-Info "[3/5] Copying compiled code..."

# Copy bytebotd
Write-Host "Copying bytebotd..."
Copy-Item -Recurse "$RepoRoot\packages\bytebotd\dist" "$BuildRoot\packages\bytebotd\"
Copy-Item "$RepoRoot\packages\bytebotd\package.json" "$BuildRoot\packages\bytebotd\"
if (Test-Path "$RepoRoot\packages\bytebotd\tsconfig.json") {
    Copy-Item "$RepoRoot\packages\bytebotd\tsconfig.json" "$BuildRoot\packages\bytebotd\"
}
Write-Success "  ✓ Bytebotd copied"

# Copy shared
Write-Host "Copying shared..."
Copy-Item -Recurse "$RepoRoot\packages\shared\dist" "$BuildRoot\packages\shared\"
Copy-Item "$RepoRoot\packages\shared\package.json" "$BuildRoot\packages\shared\"
if (Test-Path "$RepoRoot\packages\shared\tsconfig.json") {
    Copy-Item "$RepoRoot\packages\shared\tsconfig.json" "$BuildRoot\packages\shared\"
}
Write-Success "  ✓ Shared copied"

# Copy bytebot-cv
Write-Host "Copying bytebot-cv..."
Copy-Item -Recurse "$RepoRoot\packages\bytebot-cv\dist" "$BuildRoot\packages\bytebot-cv\"
Copy-Item "$RepoRoot\packages\bytebot-cv\package.json" "$BuildRoot\packages\bytebot-cv\"
if (Test-Path "$RepoRoot\packages\bytebot-cv\tsconfig.json") {
    Copy-Item "$RepoRoot\packages\bytebot-cv\tsconfig.json" "$BuildRoot\packages\bytebot-cv\"
}
Write-Success "  ✓ Bytebot-cv copied"

Write-Host ""

# Step 4: Install Windows node_modules
if (-not $SkipNodeModules) {
    Write-Info "[4/5] Installing Windows-specific node_modules..."
    Write-Host "This will download Windows native binaries (~100-150MB)"
    Write-Host ""

    # Install bytebotd dependencies
    Push-Location "$BuildRoot\packages\bytebotd"
    Write-Host "Installing bytebotd production dependencies..."
    npm install --production
    if ($LASTEXITCODE -ne 0) {
        Write-Error "❌ npm install failed"
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Success "  ✓ Bytebotd dependencies installed"

    # Install shared dependencies
    Push-Location "$BuildRoot\packages\shared"
    Write-Host "Installing shared dependencies..."
    npm install --production 2>&1 | Out-Null
    Pop-Location

    # Install bytebot-cv dependencies
    Push-Location "$BuildRoot\packages\bytebot-cv"
    Write-Host "Installing bytebot-cv dependencies..."
    npm install --production
    if ($LASTEXITCODE -ne 0) {
        Write-Error "❌ bytebot-cv npm install failed"
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Success "  ✓ Bytebot-cv dependencies installed"

    Write-Host ""
} else {
    Write-Warning "[4/5] Skipping npm install (using existing node_modules/)"
    Write-Host ""
}

# Step 5: Build MSI with WiX
Write-Info "[5/5] Building MSI with WiX Toolset..."
Write-Host ""

# Ensure output directory exists
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# Set WiX environment variables
$env:PATH = "$WixPath;$env:PATH"
$CandleExe = Join-Path $WixPath "candle.exe"
$LightExe = Join-Path $WixPath "light.exe"
$HeatExe = Join-Path $WixPath "heat.exe"

# Create WiX objects directory
$WixObjDir = Join-Path $BuildRoot "wixobj"
New-Item -ItemType Directory -Path $WixObjDir -Force | Out-Null

Write-Host "Harvesting files with heat.exe..."

# Harvest bytebotd dist/
& $HeatExe dir "$BuildRoot\packages\bytebotd\dist" `
    -cg BytebotdDistFiles `
    -dr BYTEBOTDDIR `
    -gg -sfrag -srd -sreg `
    -var "var.BytebotdDist" `
    -out "$WixObjDir\bytebotd-dist.wxs"

# Harvest bytebotd node_modules/
& $HeatExe dir "$BuildRoot\packages\bytebotd\node_modules" `
    -cg BytebotdNodeModules `
    -dr BYTEBOTDDIR `
    -gg -sfrag -srd -sreg `
    -var "var.BytebotdNodeModules" `
    -out "$WixObjDir\bytebotd-node_modules.wxs"

# Harvest shared dist/
& $HeatExe dir "$BuildRoot\packages\shared\dist" `
    -cg SharedDistFiles `
    -dr SHAREDDIR `
    -gg -sfrag -srd -sreg `
    -var "var.SharedDist" `
    -out "$WixObjDir\shared-dist.wxs"

# Harvest bytebot-cv dist/
& $HeatExe dir "$BuildRoot\packages\bytebot-cv\dist" `
    -cg BytebotCvDistFiles `
    -dr BYTEBOTCVDIR `
    -gg -sfrag -srd -sreg `
    -var "var.BytebotCvDist" `
    -out "$WixObjDir\bytebot-cv-dist.wxs"

Write-Success "  ✓ Files harvested"

Write-Host "Compiling WiX source files with candle.exe..."

# Compile main WiX files
$WixFiles = @(
    "$WixSourceDir\Product.wxs",
    "$WixSourceDir\Components.wxs",
    "$WixSourceDir\CustomActions.wxs",
    "$WixObjDir\bytebotd-dist.wxs",
    "$WixObjDir\bytebotd-node_modules.wxs",
    "$WixObjDir\shared-dist.wxs",
    "$WixObjDir\bytebot-cv-dist.wxs"
)

foreach ($WixFile in $WixFiles) {
    & $CandleExe $WixFile `
        -dBuildRoot="$BuildRoot" `
        -dSourceRoot="$RepoRoot" `
        -dBytebotdDist="$BuildRoot\packages\bytebotd\dist" `
        -dBytebotdNodeModules="$BuildRoot\packages\bytebotd\node_modules" `
        -dSharedDist="$BuildRoot\packages\shared\dist" `
        -dBytebotCvDist="$BuildRoot\packages\bytebot-cv\dist" `
        -ext WixUtilExtension `
        -out "$WixObjDir\" `
        -arch x64

    if ($LASTEXITCODE -ne 0) {
        Write-Error "❌ candle.exe failed for $WixFile"
        exit 1
    }
}

Write-Success "  ✓ WiX files compiled"

Write-Host "Linking MSI with light.exe..."

# Link into MSI
$WixObjs = Get-ChildItem -Path $WixObjDir -Filter "*.wixobj" | Select-Object -ExpandProperty FullName

& $LightExe $WixObjs `
    -ext WixUtilExtension `
    -ext WixUIExtension `
    -cultures:en-US `
    -loc "$WixSourceDir\License.rtf" `
    -out $OutputMsi

if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ light.exe failed"
    exit 1
}

Write-Success "  ✓ MSI linked"
Write-Host ""

# Calculate size
$MsiSize = (Get-Item $OutputMsi).Length / 1MB
$MsiSizeMB = [math]::Round($MsiSize, 2)

Write-Success "================================================"
Write-Success "   MSI Installer Built Successfully!"
Write-Success "================================================"
Write-Host ""
Write-Host "Location: $OutputMsi"
Write-Host "Size: ${MsiSizeMB}MB"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Test MSI on Windows VM: msiexec /i bytebotd-installer.msi"
Write-Host "  2. Build pre-baked Docker image: .\build-windows-prebaked-image.sh"
Write-Host ""

# Cleanup build temp (optional)
$CleanupPrompt = Read-Host "Clean up build temp directory? (y/N)"
if ($CleanupPrompt -eq "y" -or $CleanupPrompt -eq "Y") {
    Remove-Item -Recurse -Force $BuildRoot
    Write-Success "✓ Build temp cleaned up"
}
