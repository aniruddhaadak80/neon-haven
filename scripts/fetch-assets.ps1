# Fetch Kenney (CC0) asset packs into public/assets.
# Packs used: https://kenney.nl/assets/<slug> — License: CC0 1.0 (public domain).

$ErrorActionPreference = 'Stop'

$packs = @(
    'car-kit',
    'city-kit-commercial',
    'city-kit-roads',
    'city-kit-suburban',
    'city-kit-industrial',
    'blaster-kit',
    'blocky-characters',
    'nature-kit',
    'mini-market',
    'retro-urban-kit',
    'food-kit',
    'prototype-kit',
    'mini-characters',
    'skyboxes'
)

$root  = Split-Path -Parent $PSScriptRoot
$dest  = Join-Path $root 'public/assets'
$cache = Join-Path $env:TEMP 'kenney-zips'
New-Item -ItemType Directory -Force -Path $dest, $cache | Out-Null

foreach ($pack in $packs) {
    $target = Join-Path $dest $pack
    if (Test-Path $target) { Write-Output "skip $pack (exists)"; continue }

    $page = "https://kenney.nl/assets/$pack"
    try {
        $html = curl.exe -s -L --max-time 30 $page
    } catch {
        Write-Output "FAIL page $pack : $_"; continue
    }
    $m = [regex]::Match($html, 'https?://[^''\s>"]+\.zip')
    if (-not $m.Success) { Write-Output "FAIL link $pack"; continue }
    $zipUrl = $m.Value
    $zip = Join-Path $cache "$pack.zip"

    Write-Output "downloading $pack ..."
    curl.exe -s -L --max-time 180 -o $zip $zipUrl
    if (-not (Test-Path $zip) -or (Get-Item $zip).Length -lt 1024) {
        Write-Output "FAIL download $pack"; continue
    }
    $out = Join-Path $cache $pack
    if (Test-Path $out) { Remove-Item -Recurse -Force $out }
    Expand-Archive -Path $zip -DestinationPath $out -Force
    Move-Item -Path $out -Destination $target -Force
    Write-Output ("ok {0} ({1:N1} MB)" -f $pack, ((Get-Item $zip).Length / 1MB))
}

Write-Output '--- extracted trees ---'
Get-ChildItem $dest -Directory | ForEach-Object {
    $count = (Get-ChildItem $_.FullName -Recurse -File).Count
    Write-Output ("{0,-26} {1,5} files" -f $_.Name, $count)
}
