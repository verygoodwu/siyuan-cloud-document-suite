[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [switch]$VerifyOnly,

    [ValidatePattern('^[a-fA-F0-9]{40}$')]
    [string]$ExpectedRemoteHead
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$dist = [System.IO.Path]::GetFullPath((Join-Path $root 'dist'))
if (-not $dist.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Build output is outside the repository.'
}
Set-Location -LiteralPath $root

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

$packageVersion = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
$pluginVersion = (Get-Content -LiteralPath 'plugin.json' -Raw | ConvertFrom-Json).version
if ($packageVersion -ne $Version -or $pluginVersion -ne $Version) {
    throw "package.json ($packageVersion) and plugin.json ($pluginVersion) must both be $Version."
}
$currentNotes = Get-Content -LiteralPath 'RELEASE_NOTES_CURRENT.md' -Raw
if (-not $currentNotes.Contains("# 云文档套件 v$Version")) {
    throw "RELEASE_NOTES_CURRENT.md must describe v$Version."
}

if (-not $VerifyOnly) {
    Invoke-Checked 'gh' @('auth', 'status')
    if (-not $ExpectedRemoteHead) {
        throw 'Supply -ExpectedRemoteHead with the reviewed remote main SHA from gh api.'
    }
    $changes = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0 -or $changes.Count -ne 0) {
        throw 'Commit or remove working-tree changes before tagging.'
    }
    $tag = "v$Version"
    Invoke-Checked 'node' @('scripts/publish-github.mjs', '--version', $Version, '--expected-remote-head', $ExpectedRemoteHead, '--dry-run')
}

Invoke-Checked 'pnpm' @('install', '--frozen-lockfile')
Invoke-Checked 'pnpm' @('test')
Invoke-Checked 'pnpm' @('build')
Invoke-Checked 'node' @('tests/interaction-browser-regression.mjs')

$zipPath = Join-Path $root 'package.zip'
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $manifestEntry = $zip.GetEntry('plugin.json')
    if ($null -eq $manifestEntry -or $null -eq $zip.GetEntry('mm-editor.js') -or
        $null -eq $zip.GetEntry('RELEASE_NOTES.md')) {
        throw 'package.zip is missing a required plugin file.'
    }
    $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
    try {
        $builtVersion = ($reader.ReadToEnd() | ConvertFrom-Json).version
    } finally {
        $reader.Dispose()
    }
    if ($builtVersion -ne $Version) {
        throw "package.zip contains plugin version $builtVersion, expected $Version."
    }
} finally {
    $zip.Dispose()
}

$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
Write-Host "Verified package.zip v$Version (SHA-256: $hash)"
if ($VerifyOnly) { return }

Invoke-Checked 'node' @('scripts/publish-github.mjs', '--version', $Version, '--expected-remote-head', $ExpectedRemoteHead)
Write-Host "Created $tag through GitHub API. GitHub Actions will build and attach package.zip."

$deadline = [DateTime]::UtcNow.AddMinutes(10)
do {
    $assets = @(& gh release view $tag --json assets --jq '.assets[].name' 2>$null)
    if ($LASTEXITCODE -eq 0 -and $assets -contains 'package.zip') {
        Write-Host "Published: https://github.com/verygoodwu/siyuan-cloud-document-suite/releases/tag/$tag"
        return
    }
    Start-Sleep -Seconds 10
} while ([DateTime]::UtcNow -lt $deadline)

throw "Tag $tag was pushed, but package.zip is not visible on its Release yet. Check GitHub Actions before retrying; do not create the tag again."
