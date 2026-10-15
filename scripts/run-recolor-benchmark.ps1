param([Parameter(Mandatory = $true)][string]$Job)
$ErrorActionPreference = 'Stop'
$buildOutput = & node (Join-Path $PSScriptRoot 'build-recolor-harness.js') --benchmark $Job
if ($LASTEXITCODE -ne 0) { throw 'Benchmark build failed' }
$artifact = $buildOutput | ConvertFrom-Json
Write-Output ('Benchmark artifacts: ' + $artifact.directory)
$launcherError = ''
try {
  # Attach to the designer's existing licensed instance. Never launch or restart it.
  $photoshop = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application')
  $null = $photoshop.DoJavaScriptFile($artifact.scriptPath)
} catch {
  $launcherError = $_.Exception.Message
} finally {
  & node (Join-Path $PSScriptRoot 'recolor-run-status.js') $artifact.reportPath $launcherError
  $statusExitCode = $LASTEXITCODE
}
if ($launcherError) { Write-Output $launcherError }
exit $statusExitCode
