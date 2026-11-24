param([string]$Destination = ".sports-update/cs2-research/demo-parquet")

$ErrorActionPreference = "Stop"
$revision = "c9aa55e4e8f9bd5e784f0d66d8bf4e40f9b7a8f5"
$archive = "https://huggingface.co/datasets/blanchon/opencs2_dataset_demo/resolve/$revision/default/train"
$directory = (New-Item -ItemType Directory -Force -Path $Destination).FullName

0..136 | ForEach-Object -Parallel {
    $ErrorActionPreference = "Stop"
    $file = "{0:D4}.parquet" -f $_
    $target = Join-Path $using:directory $file
    if (Test-Path -LiteralPath $target) { return }
    $pending = $target + ".download"
    $url = $using:archive + "/" + $file
    curl.exe --fail --location --silent --show-error --retry 2 --max-time 25 --max-filesize 200000 -o $pending $url
    if ($LASTEXITCODE -ne 0) { throw "OpenCS2 download failed for $file" }
    Move-Item -LiteralPath $pending -Destination $target -ErrorAction Stop
} -ThrottleLimit 4
if (@(Get-ChildItem -LiteralPath $directory -Filter "????.parquet" -File).Count -ne 137) {
    throw "Incomplete OpenCS2 metadata archive"
}
