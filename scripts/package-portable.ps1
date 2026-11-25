[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$BinaryPath = "desktop/target/release/youtube-shorts-desktop.exe",
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

    $ver = if ($null -eq $ExplicitVersion) { "" } else { $ExplicitVersion.Trim() }
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
        [string]$RootDir
    )

    $candidate = if ([string]::IsNullOrWhiteSpace($ExplicitBinaryPath)) {
        "desktop/target/release/youtube-shorts-desktop.exe"
    } else {
        $ExplicitBinaryPath.Trim()
    }

    if (-not [System.IO.Path]::IsPathRooted($candidate)) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
        $candidate = Join-Path $RootDir $candidate
    }

    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Release binary not found at '$candidate'. Build desktop first or pass -BinaryPath."
    }

    return (Resolve-Path -LiteralPath $candidate).Path
}

$CargoTomlPath = Join-Path $RepoRoot "desktop/Cargo.toml"
$ResolvedVersion = Resolve-PackageVersion -ExplicitVersion $Version -CargoTomlPath $CargoTomlPath
$ResolvedBinary = Resolve-BinaryExecutable -ExplicitBinaryPath $BinaryPath -RootDir $RepoRoot

$ResolvedOutputDir = if ([System.IO.Path]::IsPathRooted($OutputDir)) {
    $OutputDir
} else {
    Join-Path $RepoRoot $OutputDir
}
New-Item -ItemType Directory -Force -Path $ResolvedOutputDir | Out-Null
$ResolvedOutputDir = (Resolve-Path -LiteralPath $ResolvedOutputDir).Path

$AssetName = "youtube-shorts.exe"
$ExeDestPath = Join-Path $ResolvedOutputDir $AssetName
$ManifestPath = Join-Path $ResolvedOutputDir "portable-manifest.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if ($ResolvedBinary -ne $ExeDestPath) {
    Copy-Item -LiteralPath $ResolvedBinary -Destination $ExeDestPath -Force
}

$Sha256Alg = [System.Security.Cryptography.SHA256]::Create()
try {
    $ExeStream = [System.IO.File]::OpenRead($ExeDestPath)
    try {
        $HashBytes = $Sha256Alg.ComputeHash($ExeStream)
    } finally {
        $ExeStream.Dispose()
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
Write-Output "  Output:   $ExeDestPath"
Write-Output "  Manifest: $ManifestPath"
Write-Output "  SHA-256:  $Sha256"
