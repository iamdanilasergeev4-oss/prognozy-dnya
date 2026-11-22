param(
    [Parameter(Mandatory)][string]$Store,
    [Parameter(Mandatory)][string]$Backup,
    [string[]]$Claims = @(),
    [string]$Inbox,
    [string]$RunKey,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$storePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Store)
$backupPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Backup)
$sep = [IO.Path]::DirectorySeparatorChar
$storePrefix = $storePath.TrimEnd($sep) + $sep
$backupPrefix = $backupPath.TrimEnd($sep) + $sep
if ($storePrefix.StartsWith($backupPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    $backupPrefix.StartsWith($storePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Хранилище и резервная копия должны находиться в отдельных каталогах.'
}
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$collector = Join-Path $PSScriptRoot 'collect-sports-research.mjs'
foreach ($claim in $Claims) {
    if (-not (Test-Path -LiteralPath $claim -PathType Leaf)) { throw "Не найден файл наблюдений: $claim" }
}
$Claims = @($Claims | ForEach-Object { (Resolve-Path -LiteralPath $_).ProviderPath })
if ($Inbox) {
    $inboxPath = (Resolve-Path -LiteralPath $Inbox).ProviderPath
    if (-not (Test-Path -LiteralPath $inboxPath -PathType Container)) { throw 'Входящий каталог недоступен.' }
    $Claims += @(Get-ChildItem -LiteralPath $inboxPath -File -Filter '*.json' | Sort-Object Name | Select-Object -ExpandProperty FullName)
}
$version = & $node -p 'Number(process.versions.node.split(".")[0])'
if ($LASTEXITCODE -ne 0 -or [int]$version -lt 24) { throw 'Требуется Node.js 24 или новее.' }
if ($ValidateOnly) {
    [pscustomobject]@{ Node = $node; Store = $storePath; Backup = $backupPath; Collector = $collector; ScheduleRegistered = $false }
    return
}

$previousStore = $env:SPORTS_RESEARCH_STORE
$previousKey = $env:SPORTS_RESEARCH_RUN_KEY
$env:SPORTS_RESEARCH_STORE = $storePath
$now = [DateTime]::UtcNow
$slot = 4 * [Math]::Floor($now.Hour / 4)
$env:SPORTS_RESEARCH_RUN_KEY = if ($RunKey) { $RunKey } else { 'utc-{0}-{1:00}' -f $now.ToString('yyyy-MM-dd'), $slot }
$logs = Join-Path $storePath 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$log = Join-Path $logs ('{0}-{1}.log' -f ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')), $PID)
try {
    "Запуск $env:SPORTS_RESEARCH_RUN_KEY" | Set-Content -LiteralPath $log
    $reportPath = Join-Path $logs ("collect-{0}.json" -f [IO.Path]::GetFileNameWithoutExtension($log))
    & $node $collector collect @Claims *> $reportPath
    $collectExit = $LASTEXITCODE
    if ($collectExit -notin @(0, 3)) { throw "Сбор завершился с кодом $collectExit. См. соседний файл collect." }
    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    foreach ($failure in $report.sourceRequests | Where-Object { $_.status -in @('error', 'restricted', 'backoff') }) {
        "$($failure.source) $($failure.status) $($failure.url) $($failure.error)" | Add-Content -LiteralPath $log
    }
    & $node $collector backup $backupPath *>> $log
    if ($LASTEXITCODE -ne 0) { throw "Резервирование завершилось с кодом $LASTEXITCODE." }
    if ($collectExit -eq 3) { throw 'Снимок и ошибки сохранены. Источники временно недоступны, требуется повтор.' }
    "Готово $([DateTime]::UtcNow.ToString('o'))" | Add-Content -LiteralPath $log
    Write-Output $log
} catch {
    $_.Exception.Message | Add-Content -LiteralPath $log
    throw
} finally {
    $env:SPORTS_RESEARCH_STORE = $previousStore
    $env:SPORTS_RESEARCH_RUN_KEY = $previousKey
}
