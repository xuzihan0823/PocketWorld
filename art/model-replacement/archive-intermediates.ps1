$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$taskPublic = (Resolve-Path -LiteralPath (Join-Path $taskRoot 'public/models/replaced')).Path
$taskArchive = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'generated/optimized'))
if (-not $taskArchive.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive outside task workspace' }
New-Item -ItemType Directory -Path $taskArchive -Force | Out-Null
$taskNames = @('cabinet','computer','desk','journal','keyboard','lamp','lounge-chair','planner','rolling-chair','turntable')
foreach ($taskName in $taskNames) {
    $taskSource = [IO.Path]::GetFullPath((Join-Path $taskPublic ($taskName + '.glb')))
    $taskDestination = [IO.Path]::GetFullPath((Join-Path $taskArchive ($taskName + '.glb')))
    if (-not $taskSource.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not $taskDestination.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Move outside task workspace' }
    if (Test-Path -LiteralPath $taskSource) { Move-Item -LiteralPath $taskSource -Destination $taskDestination -Force }
}
Get-ChildItem -LiteralPath $taskPublic -Filter '*.glb' | Select-Object Name,Length
