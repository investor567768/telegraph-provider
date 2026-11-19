# Accuracy check for the grid-price miner.
# For each case it asks the LIVE miner for a price, then downloads the operator's own file
# separately and compares the two. Nothing here reuses the miner's code.
# Run from the repo folder:  powershell -ExecutionPolicy Bypass -File test\accuracy.ps1

$ErrorActionPreference = 'Stop'
$IC = [Globalization.CultureInfo]::InvariantCulture   # fixed date format whatever the PC's region settings
$Miner = 'https://telegraph-provider.vercel.app/api/grid-price'
$Results = @()
$Temp = Join-Path $env:TEMP 'grid-accuracy'
New-Item -ItemType Directory -Force -Path $Temp | Out-Null

function Ask-Miner($loc, $startUtc, $market) {
  $u = "$Miner`?node_or_zone=$([uri]::EscapeDataString($loc))&interval_start=$($startUtc.ToString("yyyy-MM-dd'T'HH':'mm':'ss'Z'", $IC))"
  if ($market) { $u += "&market=$market" }
  try { return Invoke-RestMethod -Uri $u -TimeoutSec 60 } catch { return $null }
}
function Add-Result($op, $loc, $startUtc, $minerVal, $truthVal, $truthUrl) {
  $ok = ($minerVal -ne $null) -and ($truthVal -ne $null) -and ([math]::Abs([double]$minerVal - [double]$truthVal) -lt 0.000001)
  $script:Results += [pscustomobject]@{
    operator = $op; location = $loc; interval_start_utc = $startUtc.ToString("yyyy-MM-dd'T'HH':'mm':'ss'Z'", $IC)
    miner = $minerVal; operator_file = $truthVal; match = $(if ($ok) { 'YES' } else { 'NO' }); source = $truthUrl
  }
  Write-Host ("{0,-6} {1,-18} {2}  miner={3,-10} file={4,-10} {5}" -f $op, $loc, $startUtc.ToString("yyyy-MM-dd HH':'mm", $IC), $minerVal, $truthVal, $(if ($ok) { 'MATCH' } else { 'DIFFERENT' }))
}

$now = [DateTime]::UtcNow
$five = [DateTime]::new($now.Year, $now.Month, $now.Day, $now.Hour, [math]::Floor($now.Minute / 5) * 5, 0, [DateTimeKind]::Utc)
$recent = @(1, 2, 3, 4) | ForEach-Object { $five.AddMinutes(-35 * $_) }   # four 5-minute intervals in the last ~2.5 hours
$eastern = [TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')

# ---------- NYISO real-time: 2 zones x 4 intervals, against NYISO's daily file ----------
foreach ($zone in @('N.Y.C.', 'CAPITL')) {
  foreach ($t in $recent) {
    $m = Ask-Miner $zone $t $null
    $endLocal = [TimeZoneInfo]::ConvertTimeFromUtc($t.AddMinutes(5), $eastern)   # NYISO stamps the END of the interval, Eastern time
    $url = "http://mis.nyiso.com/public/csv/realtime/$($endLocal.ToString('yyyyMMdd', $IC))realtime_zone.csv"
    try { $rows = (Invoke-WebRequest -Uri $url -UseBasicParsing).Content | ConvertFrom-Csv }
    catch { Write-Host "  could not download $url : $($_.Exception.Message)"; $rows = @() }
    $row = $rows | Where-Object { $_.Name -eq $zone -and $_.'Time Stamp' -eq $endLocal.ToString("MM'/'dd'/'yyyy HH':'mm':'ss", $IC) } | Select-Object -First 1
    Add-Result 'NYISO' $zone $t $m.lmp_usd_per_mwh $(if ($row) { [double]$row.'LBMP ($/MWHr)' } else { $null }) $url
  }
}

# ---------- MISO real-time: 2 hubs x 4 intervals, against MISO's rolling feed ----------
$misoUrl = 'https://public-api.misoenergy.org/api/MarketPricing/GetRealTimeFiveMinExPost/Rolling'
foreach ($hub in @('INDIANA.HUB', 'ILLINOIS.HUB')) {
  foreach ($t in $recent) {
    $m = Ask-Miner $hub $t $null
    try { $j = Invoke-RestMethod -Uri $misoUrl } catch { Write-Host "  could not download MISO feed: $($_.Exception.Message)"; $j = [pscustomobject]@{ headers = @(); data = @() } }
    $h = @($j.headers)
    $iI = [array]::IndexOf($h, 'INTERVAL'); $iN = [array]::IndexOf($h, 'CPNODE'); $iL = [array]::IndexOf($h, 'LMP')
    $stamp = $t.AddHours(-5).ToString("yyyy-MM-dd'T'HH':'mm':'ss", $IC)   # MISO publishes in EST (UTC-5) all year
    $row = $j.data | Where-Object {
      $iv = $_[$iI]; if ($iv -is [datetime]) { $iv = $iv.ToString("yyyy-MM-dd'T'HH':'mm':'ss", $IC) }   # newer PowerShell turns dates into objects
      $_[$iN] -eq $hub -and $iv -eq $stamp } | Select-Object -First 1
    Add-Result 'MISO' $hub $t $m.lmp_usd_per_mwh $(if ($row) { [double]$row[$iL] } else { $null }) $misoUrl
  }
}

# ---------- CAISO day-ahead: 3 hubs + the Intent's own sample question, against OASIS ----------
$caisoCases = @(
  @('CAISO', '2026-09-13T14:00:00Z'),            # the Intent's sample question (no location -> NP15)
  @('TH_NP15_GEN-APND', '2026-11-18T20:00:00Z'),
  @('TH_SP15_GEN-APND', '2026-11-18T20:00:00Z'),
  @('TH_ZP26_GEN-APND', '2026-11-18T20:00:00Z'),
  @('TH_NP15_GEN-APND', '2026-11-01T03:00:00Z'),
  @('TH_SP15_GEN-APND', '2026-10-15T23:00:00Z'),
  @('TH_NP15_GEN-APND', '2026-08-20T01:00:00Z'),
  @('TH_SP15_GEN-APND', '2026-11-19T12:00:00Z')
)
foreach ($c in $caisoCases) {
  $t = [DateTime]::Parse($c[1], $IC, [Globalization.DateTimeStyles]::AdjustToUniversal)
  $m = Ask-Miner $c[0] $t $null
  Start-Sleep -Seconds 6                               # CAISO allows about one request every 5 seconds
  $node = if ($c[0] -eq 'CAISO') { 'TH_NP15_GEN-APND' } else { $c[0] }
  $s = $t.ToString("yyyyMMdd'T'HH':'mm", $IC) + '-0000'; $e = $t.AddHours(1).ToString("yyyyMMdd'T'HH':'mm", $IC) + '-0000'
  $url = "http://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_LMP&market_run_id=DAM&startdatetime=$s&enddatetime=$e&version=1&node=$node&resultformat=6"
  $zip = Join-Path $Temp 'caiso.zip'; $dir = Join-Path $Temp 'caiso'
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  $csv = $null
  try {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $dir -Force
    $csv = Get-ChildItem $dir -Filter *.csv | Select-Object -First 1
  } catch { Write-Host "  could not download CAISO file: $($_.Exception.Message)" }
  $val = $null
  if ($csv) {
    $row = Import-Csv $csv.FullName | Where-Object { $_.LMP_TYPE -eq 'LMP' -and $_.NODE -eq $node } | Select-Object -First 1
    if ($row) { $val = [double]$row.MW }
  }
  Add-Result 'CAISO' $c[0] $t $m.lmp_usd_per_mwh $val $url
  Start-Sleep -Seconds 6
}

$file = "accuracy-$((Get-Date).ToString('yyyy-MM-dd', $IC)).csv"
$Results | Export-Csv -Path $file -NoTypeInformation
$hits = @($Results | Where-Object { $_.match -eq 'YES' }).Count
$noFile = @($Results | Where-Object { $_.operator_file -eq $null }).Count
Write-Host ''
Write-Host "Matched $hits of $($Results.Count) checks exactly ($noFile had no operator file to compare). Saved to $file"

# On GitHub Actions, also publish the table on the run's public summary page
if ($env:GITHUB_STEP_SUMMARY) {
  $md = @("## Grid price accuracy: $hits of $($Results.Count) matched the operator's own file exactly", '',
    "Run at $([DateTime]::UtcNow.ToString("yyyy-MM-dd HH':'mm", $IC)) UTC. Each row asks the live miner, then downloads the operator's file separately and compares.", '',
    '| Operator | Location | Interval start (UTC) | Miner | Operator file | Match |', '|---|---|---|---|---|---|')
  foreach ($r in $Results) { $md += "| $($r.operator) | $($r.location) | $($r.interval_start_utc) | $($r.miner) | $($r.operator_file) | $($r.match) |" }
  $md | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
}
# Fail the run only when a price differs from a file we could read (a missing file is reported, not hidden)
$wrong = @($Results | Where-Object { $_.operator_file -ne $null -and $_.match -eq 'NO' }).Count
if ($wrong -gt 0) { Write-Host "$wrong price(s) differed from the operator's file."; exit 1 }
