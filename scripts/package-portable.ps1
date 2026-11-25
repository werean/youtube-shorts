[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$BinaryPath = "",
    [string]$OutputDir = "dist-portable"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path

function Resolve-PackageVersion {
    param(
        [string]$ExplicitVersion,
        [string]$CargoTomlPath
    )

    $ver = $ExplicitVersion.Trim()
    if ([string]::IsNullOrWhiteSpace($ver)) {
        if (Test-Path -LiteralPath $CargoTomlPath -PathType Leaf) {
            $cargoText = Get-Content -LiteralPath $CargoTomlPath -Raw -Encoding UTF8
            if ($cargoText -match '(?ms)^\[package\].*?^\s*version\s*=\s*"([^"]+)"') {
                $ver = $Matches[1].Trim()
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($ver)) {
        $ver = "0.1.0"
    }

    if ($ver -match '^v(\d+\.\d+\.\d+.*)$') {
        $ver = $Matches[1]
    }

    return $ver
}

function Resolve-BinaryExecutable {
    param(
        [string]$ExplicitBinaryPath,
        [string]$RootDir,
        [string]$CargoTomlPath
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitBinaryPath)) {
        $candidate = $ExplicitBinaryPath
        if (-not [System.IO.Path]::IsPathRooted($candidate)) {
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                return (Resolve-Path -LiteralPath $candidate).Path
            }
            $candidate = Join-Path $RootDir $ExplicitBinaryPath
        }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "Release binary not found at '$candidate'."
        }
        return (Resolve-Path -LiteralPath $candidate).Path
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $CargoTomlPath -PathType Leaf) {
        $cargoText = Get-Content -LiteralPath $CargoTomlPath -Raw -Encoding UTF8
        if ($cargoText -match '(?ms)^\[\[bin\]\].*?^\s*name\s*=\s*"([^"]+)"') {
            $candidates.Add((Join-Path $RootDir "desktop/target/release/$($Matches[1]).exe"))
        }
        if ($cargoText -match '(?ms)^\[package\].*?^\s*name\s*=\s*"([^"]+)"') {
            $candidates.Add((Join-Path $RootDir "desktop/target/release/$($Matches[1]).exe"))
        }
    }
    $candidates.Add((Join-Path $RootDir "desktop/target/release/youtube-shorts-desktop.exe"))
    $candidates.Add((Join-Path $RootDir "desktop/target/release/youtube-shorts.exe"))

    foreach ($path in ($candidates | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            return (Resolve-Path -LiteralPath $path).Path
        }
    }

    throw "Release binary not found. Checked: $($candidates -join ', '). Build desktop first or pass -BinaryPath."
}

$CargoTomlPath = Join-Path $RepoRoot "desktop/Cargo.toml"
$ResolvedVersion = Resolve-PackageVersion -ExplicitVersion $Version -CargoTomlPath $CargoTomlPath
$ResolvedBinary = Resolve-BinaryExecutable -ExplicitBinaryPath $BinaryPath -RootDir $RepoRoot -CargoTomlPath $CargoTomlPath

$ResolvedOutputDir = if ([System.IO.Path]::IsPathRooted($OutputDir)) {
    $OutputDir
} else {
    Join-Path $RepoRoot $OutputDir
}
New-Item -ItemType Directory -Force -Path $ResolvedOutputDir | Out-Null
$ResolvedOutputDir = (Resolve-Path -LiteralPath $ResolvedOutputDir).Path

$BackendAppSrc = Join-Path $RepoRoot "backend/app"
$BackendPyprojectSrc = Join-Path $RepoRoot "backend/pyproject.toml"
$DefaultConfigsSrc = Join-Path $RepoRoot "data/default_configs.json"

foreach ($requiredPath in @($BackendAppSrc, $BackendPyprojectSrc, $DefaultConfigsSrc)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required source path missing: '$requiredPath'."
    }
}

$AssetName = "youtube-shorts-portable-win64.zip"
$ZipPath = Join-Path $ResolvedOutputDir $AssetName
$ManifestPath = Join-Path $ResolvedOutputDir "portable-manifest.json"
$StageDir = Join-Path $ResolvedOutputDir ".stage-portable"

if (Test-Path -LiteralPath $StageDir) {
    Remove-Item -LiteralPath $StageDir -Recurse -Force
}
if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

try {
    New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "backend/app") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "data") | Out-Null

    # 1. Main desktop executable
    Copy-Item -LiteralPath $ResolvedBinary -Destination (Join-Path $StageDir "youtube-shorts.exe") -Force

    # 2. Backend Python application (excluding __pycache__ and compiled bytecode)
    $BackendAppRootLen = $BackendAppSrc.TrimEnd('\', '/').Length + 1
    $BackendFiles = Get-ChildItem -LiteralPath $BackendAppSrc -Recurse -File | Where-Object {
        $_.FullName -notmatch '([\\/])__pycache__([\\/]|$)' -and
        $_.FullName -notmatch '([\\/])\.pytest_cache([\\/]|$)' -and
        $_.Extension -notin @('.pyc', '.pyo')
    }
    foreach ($file in $BackendFiles) {
        $relPath = $file.FullName.Substring($BackendAppRootLen)
        $destFile = Join-Path (Join-Path $StageDir "backend/app") $relPath
        $destParent = Split-Path -Path $destFile -Parent
        if (-not (Test-Path -LiteralPath $destParent)) {
            New-Item -ItemType Directory -Force -Path $destParent | Out-Null
        }
        Copy-Item -LiteralPath $file.FullName -Destination $destFile -Force
    }

    # 3. Backend pyproject.toml and default configs
    Copy-Item -LiteralPath $BackendPyprojectSrc -Destination (Join-Path $StageDir "backend/pyproject.toml") -Force
    Copy-Item -LiteralPath $DefaultConfigsSrc -Destination (Join-Path $StageDir "data/default_configs.json") -Force

    # 4. Portable README
    $ReadmeContent = @"
YouTube Shorts - Portable Edition (v$ResolvedVersion)
====================================================

1. Extract ALL contents of youtube-shorts-portable-win64.zip into a permanent folder
   (for example: C:\Apps\youtube-shorts). Do not run from inside the ZIP preview.
2. Double-click youtube-shorts.exe to launch the desktop app.
   The app automatically starts the local Python FastAPI backend on port 8000.
3. On first run, open Settings -> Dependencies inside the app to install
   Python 3.12 (if needed), yt-dlp, faster-whisper, FFmpeg, and PyTorch CUDA.
   All Python packages are installed inside backend\.venv\ within this folder.
4. For local AI cut analysis, keep Ollama or LM Studio running locally.
5. Auto-updates preserve your user data (data\settings.json, data\jobs\,
   data\profile\, and backend\.venv\).
"@
    [System.IO.File]::WriteAllText((Join-Path $StageDir "README-PORTABLE.txt"), $ReadmeContent, $Utf8NoBom)

    # 5. Create zip with normalized forward-slash entry paths
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $StageRootLen = $StageDir.TrimEnd('\', '/').Length + 1
    $Archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $StageFiles = Get-ChildItem -LiteralPath $StageDir -Recurse -File | Sort-Object FullName
        foreach ($stageFile in $StageFiles) {
            $entryName = $stageFile.FullName.Substring($StageRootLen).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $Archive,
                $stageFile.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally {
        $Archive.Dispose()
    }

    # 6. Compute SHA-256 and write portable-manifest.json
    $Sha256Alg = [System.Security.Cryptography.SHA256]::Create()
    try {
        $ZipStream = [System.IO.File]::OpenRead($ZipPath)
        try {
            $HashBytes = $Sha256Alg.ComputeHash($ZipStream)
        } finally {
            $ZipStream.Dispose()
        }
    } finally {
        $Sha256Alg.Dispose()
    }
    $Sha256 = ([System.BitConverter]::ToString($HashBytes) -replace '-', '').ToLowerInvariant()
    $ManifestObj = [ordered]@{
        version    = $ResolvedVersion
        asset_name = $AssetName
        sha256     = $Sha256
    }
    $ManifestJson = ($ManifestObj | ConvertTo-Json -Depth 2) -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($ManifestPath, "$ManifestJson`n", $Utf8NoBom)

    Write-Output "Packaged portable release v$ResolvedVersion"
    Write-Output "  Binary:   $ResolvedBinary"
    Write-Output "  Archive:  $ZipPath"
    Write-Output "  Manifest: $ManifestPath"
    Write-Output "  SHA-256:  $Sha256"
} finally {
    if (Test-Path -LiteralPath $StageDir) {
        Remove-Item -LiteralPath $StageDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
