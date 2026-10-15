param()
$ErrorActionPreference = "Stop"
$buildOutput = & node (Join-Path $PSScriptRoot 'build-recolor-harness.js')
if ($LASTEXITCODE -ne 0) { throw 'Recolor harness build failed' }
$artifact = $buildOutput | ConvertFrom-Json
Write-Output ('Running real Photoshop UXP fixtures: ' + $artifact.scriptPath)
# Tested locally on Photoshop 25.3.1. Other installations can run the same
# generated .psjs through File > Scripts > Browse, Adobe's documented route.
$photoshop = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application')
$null = $photoshop.DoJavaScriptFile($artifact.scriptPath)
if (-not (Test-Path -LiteralPath $artifact.reportPath)) {
  throw ('Photoshop did not write a report. Run the script using File > Scripts > Browse: ' + $artifact.scriptPath)
}
$report = Get-Content -LiteralPath $artifact.reportPath -Raw | ConvertFrom-Json
foreach ($case in $report.cases) {
  Write-Output ('[' + $case.status + '] ' + $case.milliseconds + ' ms: ' + $case.name)
  if ($case.error) { Write-Output $case.error }
}
Write-Output ('Technical fixtures passed: ' + $report.passed + '; failed: ' + $report.failed)
if ($report.fatal) { Write-Output $report.fatal }
Write-Output ('Report: ' + $artifact.reportPath)
if (-not $report.technicalGatePassed) { exit 1 }
