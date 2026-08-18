<#
.SYNOPSIS
    Builds the Android release APK and copies it into server/uploads.

.DESCRIPTION
    Runs the Gradle release build for the Expo/React Native app and copies the
    resulting app-release.apk into server/uploads so it is served at /uploads.

.PARAMETER NoBuild
    Skip the Gradle build and only copy an already-built APK into server/uploads.

.PARAMETER SkipCacheClean
    Skip clearing the Metro/bundler cache and the generated JS bundle. Use only
    when the JS/EXPO_PUBLIC_* env has not changed (e.g. quick native-only rebuilds).

.EXAMPLE
    .\scripts\build-release-apk.ps1

.EXAMPLE
    .\scripts\build-release-apk.ps1 -NoBuild

.EXAMPLE
    .\scripts\build-release-apk.ps1 -SkipCacheClean
#>
[CmdletBinding()]
param(
    [switch]$NoBuild,
    [switch]$SkipCacheClean
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $repoRoot 'app\android'
$apkSource = Join-Path $repoRoot 'app\android\app\build\outputs\apk\release\app-release.apk'
$uploadDir = Join-Path $repoRoot 'server\uploads'
$apkDest = Join-Path $uploadDir 'app-release.apk'

if (-not (Test-Path $androidDir)) {
    throw "Android project not found at $androidDir. Run 'npx expo prebuild' first."
}

function Clear-BundleCache {
    param([string]$Path)
    if (Test-Path $Path) {
        Write-Host "Clearing cache: $Path" -ForegroundColor DarkGray
        Remove-Item -Recurse -Force $Path
    }
}

if (-not $NoBuild) {
    if (-not $SkipCacheClean) {
        # EXPO_PUBLIC_* values are inlined into the JS bundle at bundle time, but
        # Gradle's up-to-date check does not treat .env as a bundle task input, so
        # env-only changes would otherwise be ignored. Force a fresh bundle with the
        # current .env by clearing the Metro cache and the generated JS bundle.
        Clear-BundleCache (Join-Path $env:LOCALAPPDATA 'Temp\metro-cache')
        Clear-BundleCache (Join-Path $repoRoot 'app\.expo')
        Clear-BundleCache (Join-Path $repoRoot 'app\android\app\build\generated\assets\react\release\index.android.bundle')
    }

    Write-Host "Building release APK with Gradle..." -ForegroundColor Cyan
    Push-Location $androidDir
    try {
        if ($env:OS -match 'Windows') {
            & '.\gradlew.bat' assembleRelease
        } else {
            & './gradlew' assembleRelease
        }
    } finally {
        Pop-Location
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Gradle build failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path $apkSource)) {
    throw "Release APK not found at $apkSource. Run the build first (or pass -NoBuild to skip)."
}

if (-not (Test-Path $uploadDir)) {
    New-Item -ItemType Directory -Path $uploadDir -Force | Out-Null
}

Copy-Item -Path $apkSource -Destination $apkDest -Force

$size = (Get-Item $apkDest).Length
Write-Host "Copied release APK to $apkDest" -ForegroundColor Green
Write-Host ("Size: {0:N1} MB" -f ($size / 1MB)) -ForegroundColor Green
Write-Host "Served locally at:  http://localhost:3001/uploads/app-release.apk" -ForegroundColor Yellow
Write-Host "Production URL:     https://oracle.leoswebsite.com/uploads/app-release.apk" -ForegroundColor Yellow
Write-Host "NOTE: Production still requires scp to the Oracle VM (server/uploads is gitignored)." -ForegroundColor Yellow