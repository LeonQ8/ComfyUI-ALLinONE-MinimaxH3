param([Parameter(Mandatory = $true)][string]$Root)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$stack = Get-Content (Join-Path $Root 'installer\stack.json') -Raw | ConvertFrom-Json
$zip = Join-Path $Root 'python-embed.zip'
Write-Host "Downloading Python $($stack.python.version) (embeddable package)" -ForegroundColor Cyan
Invoke-WebRequest -Uri $stack.python.url -OutFile $zip -UseBasicParsing
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($hash -ne $stack.python.sha256) {
    Remove-Item $zip
    throw 'Python download failed its checksum check.'
}
$megabytes = '{0:N1}' -f ((Get-Item $zip).Length / 1MB)
Write-Host "  Python $($stack.python.version) downloaded ($megabytes MB), checksum OK" -ForegroundColor Green
Expand-Archive -Path $zip -DestinationPath (Join-Path $Root 'python_embeded') -Force
Remove-Item $zip
