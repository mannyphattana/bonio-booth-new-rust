# ตรวจสอบว่าเครื่องนี้ติดตั้ง Bonio Booth แบบ per-machine หรือ per-user
# และตั้งค่า UAC ไว้อย่างไร — สคริปต์นี้ "อ่านอย่างเดียว" ไม่แก้ไขอะไรทั้งสิ้น
#
# วิธีใช้: คลิกขวาที่ไฟล์ > Run with PowerShell
#   หรือ: powershell -NoProfile -ExecutionPolicy Bypass -File .\check-install-mode.ps1

$ErrorActionPreference = 'SilentlyContinue'
$key = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\com.boniolabs.booth'

Write-Host ''
Write-Host '=== Bonio Booth — install mode check ===' -ForegroundColor Cyan
Write-Host ("Computer : {0}" -f $env:COMPUTERNAME)
Write-Host ("User     : {0}\{1}" -f $env:USERDOMAIN, $env:USERNAME)

# account นี้เป็นสมาชิกกลุ่ม Administrators หรือไม่
# ใช้ whoami /groups เพราะเช็คจาก token ได้แม้รันแบบไม่ยกสิทธิ์
# (IsInRole จะคืน false เสมอถ้ายังไม่ยกสิทธิ์ ถึงจะเป็น admin ก็ตาม)
$isAdminAccount = $null
try {
  # /nh + -Header เอง เพราะหัวตารางของ whoami เปลี่ยนตามภาษา Windows
  # (บูธที่เป็น Windows ภาษาไทย หัวคอลัมน์จะไม่ใช่ "SID")
  $groups = @(whoami /groups /fo csv /nh | ConvertFrom-Csv -Header 'Name','Type','SID','Attributes')
  $isAdminAccount = [bool]($groups | Where-Object { $_.SID -eq 'S-1-5-32-544' })
} catch { }

if ($isAdminAccount -eq $true) {
  Write-Host 'ประเภท    : Administrator' -ForegroundColor Green
  Write-Host '            -> ตั้ง ConsentPromptBehaviorAdmin = 0 แล้วจะไม่เด้ง UAC อีก'
} elseif ($isAdminAccount -eq $false) {
  Write-Host 'ประเภท    : Standard user' -ForegroundColor Red
  Write-Host '            -> เครื่องนี้จะไม่เด้ง UAC อยู่แล้ว แต่ถ้าแอปลงใน Program Files'
  Write-Host '               installer จะเขียนทับไม่ได้ = อัปเดตล้มเหลวเงียบ ๆ'
  Write-Host '               ตรวจ DisplayVersion ข้างล่างว่าค้างอยู่เวอร์ชันเก่าหรือไม่'
} else {
  Write-Host 'ประเภท    : ตรวจไม่ได้' -ForegroundColor Yellow
}
Write-Host ''

$found = $false

foreach ($hive in @('HKLM', 'HKCU')) {
  $entry = Get-ItemProperty -Path "${hive}:\$key"
  if ($null -eq $entry) { continue }
  $found = $true
  $mode = if ($hive -eq 'HKLM') { 'per-machine (All users)' } else { 'per-user (Just me)' }
  $uac  = if ($hive -eq 'HKLM') { 'ใช่ — เด้ง UAC ทุกครั้งที่อัปเดต' } else { 'ไม่ — อัปเดตเงียบได้' }
  Write-Host ("ติดตั้งแบบ    : {0}" -f $mode) -ForegroundColor Yellow
  Write-Host ("Version      : {0}" -f $entry.DisplayVersion)
  Write-Host ("Install dir  : {0}" -f $entry.InstallLocation)
  Write-Host ("ต้องใช้ admin : {0}" -f $uac)
  Write-Host ''
}

if (-not $found) {
  Write-Host 'ไม่พบ Bonio Booth ใน registry (อาจถูกลบไปแล้ว หรือใช้ชื่อ identifier อื่น)' -ForegroundColor Red
  Write-Host ''
}

# --- UAC policy ---
$sys = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
Write-Host '--- UAC policy ---' -ForegroundColor Cyan
Write-Host ("EnableLUA                  : {0}  (1 = UAC เปิดอยู่)" -f $sys.EnableLUA)
Write-Host ("ConsentPromptBehaviorAdmin : {0}  (0 = ยกสิทธิ์เงียบ, 5 = ถามแบบปกติ)" -f $sys.ConsentPromptBehaviorAdmin)
Write-Host ("PromptOnSecureDesktop      : {0}" -f $sys.PromptOnSecureDesktop)
Write-Host ''

# --- autostart ที่ชี้มาที่แอป ---
Write-Host '--- Autostart ---' -ForegroundColor Cyan
$hits = @()
foreach ($runKey in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
                      'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run')) {
  $props = Get-ItemProperty -Path $runKey
  if ($null -eq $props) { continue }
  foreach ($p in $props.PSObject.Properties) {
    if ($p.Name -like 'PS*') { continue }
    if ("$($p.Value)" -match 'Bonio') { $hits += "Run key : $runKey\$($p.Name) -> $($p.Value)" }
  }
}
foreach ($dir in @([Environment]::GetFolderPath('Startup'),
                   [Environment]::GetFolderPath('CommonStartup'))) {
  Get-ChildItem -Path $dir -Filter '*.lnk' | ForEach-Object {
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName).TargetPath
    if ("$target" -match 'Bonio' -or $_.Name -match 'Bonio') {
      $hits += "Shortcut: $($_.FullName) -> $target"
    }
  }
}
if ($hits.Count -eq 0) { Write-Host 'ไม่พบ autostart ที่ชี้มาที่ Bonio Booth' } else { $hits | ForEach-Object { Write-Host $_ } }
Write-Host ''
