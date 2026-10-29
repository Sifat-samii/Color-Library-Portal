param([Parameter(Mandatory = $true)][string]$Folder)
$ErrorActionPreference = 'Stop'
$buildOutput = & node (Join-Path $PSScriptRoot 'audit-recolor-training.js') $Folder
if ($LASTEXITCODE -ne 0) { throw 'Training audit build failed' }
$artifact = $buildOutput | ConvertFrom-Json
Write-Output ('Training audit artifacts: ' + $artifact.directory)
$launcherError = ''
try {
  # Attach to the designer's existing licensed instance. Never launch or restart it.
  $photoshop = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application')
  $null = $photoshop.DoJavaScriptFile($artifact.scriptPath)
} catch {
  $launcherError = $_.Exception.Message
}
if ($launcherError) { throw $launcherError }
if (-not (Test-Path -LiteralPath $artifact.reportPath)) {
  throw ('Photoshop did not write a report: ' + $artifact.reportPath)
}
$report = Get-Content -LiteralPath $artifact.reportPath -Raw | ConvertFrom-Json
$errors = @($report.documents | Where-Object { $_.status -ne 'INSPECTED' })
Write-Output ('Training TIFFs inspected: ' + (@($report.documents).Count - $errors.Count) + '; errors: ' + $errors.Count)
Write-Output ('Report: ' + $artifact.reportPath)
if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Output ('[ERROR] ' + $_.label + ': ' + $_.error) }
  exit 1
}
