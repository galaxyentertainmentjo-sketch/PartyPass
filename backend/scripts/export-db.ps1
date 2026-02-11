param(
  [string]$OutputDir = "backups",
  [int]$KeepDays = 30
)

if (-not $env:DATABASE_URL) {
  Write-Error "DATABASE_URL is required."
  exit 1
}

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  Write-Error "pg_dump was not found in PATH. Install PostgreSQL client tools first."
  exit 1
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$filePath = Join-Path $OutputDir ("partypass-" + $timestamp + ".sql")

Write-Host "Exporting database to $filePath ..."
pg_dump "$env:DATABASE_URL" --no-owner --no-privileges --file "$filePath"

if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_dump failed."
  exit $LASTEXITCODE
}

Write-Host "Backup complete: $filePath"

Get-ChildItem -Path $OutputDir -File -Filter "*.sql" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
  Remove-Item -Force

Write-Host "Old backups older than $KeepDays days removed."
