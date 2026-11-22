param(
    [Parameter(Mandatory)][string]$Store,
    [Parameter(Mandatory)][string]$Backup,
    [Parameter(Mandatory)][string]$TaskUser,
    [Parameter(Mandatory)][string]$OutputFile,
    [string]$Inbox,
    [switch]$Wake
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Для проверки XML нужен Windows Task Scheduler.' }
$esc = { param($value) [Security.SecurityElement]::Escape($value) }
$shell = (Get-Command pwsh -CommandType Application | Select-Object -First 1).Source
$runner = Join-Path $PSScriptRoot 'run-sports-research.ps1'
$configuration = & $runner -Store $Store -Backup $Backup -Inbox $Inbox -ValidateOnly
$arguments = '-NoProfile -NonInteractive -File "{0}" -Store "{1}" -Backup "{2}"' -f $runner, $configuration.Store, $configuration.Backup
if ($Inbox) { $arguments += ' -Inbox "{0}"' -f (Resolve-Path -LiteralPath $Inbox).ProviderPath }
$start = (Get-Date).Date.AddDays(1).ToString('yyyy-MM-ddTHH:mm:ss')
$wakeValue = $Wake.IsPresent.ToString().ToLowerInvariant()
$directory = Split-Path -Parent $PSScriptRoot
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Sports Intelligence Engine research only</Description></RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <Repetition><Interval>PT4H</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <StartBoundary>$start</StartBoundary><Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="ResearchUser"><UserId>$(& $esc $TaskUser)</UserId><LogonType>Password</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <StartWhenAvailable>true</StartWhenAvailable>
    <WakeToRun>$wakeValue</WakeToRun>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT30M</Interval><Count>3</Count></RestartOnFailure>
    <Enabled>false</Enabled>
  </Settings>
  <Actions Context="ResearchUser">
    <Exec><Command>$(& $esc $shell)</Command><Arguments>$(& $esc $arguments)</Arguments><WorkingDirectory>$(& $esc $directory)</WorkingDirectory></Exec>
  </Actions>
</Task>
"@
$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()
$definition = $service.NewTask(0)
$definition.XmlText = $xml
if ($definition.Settings.Enabled) { throw 'Проверка выявила включённое задание.' }
$path = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputFile)
$stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try {
    $writer = [IO.StreamWriter]::new($stream, [Text.Encoding]::Unicode)
    try { $writer.Write($xml) } finally { $writer.Dispose() }
} finally {
    $stream.Dispose()
}
Write-Output $path
