<#
.SYNOPSIS
  ตั้งให้เครื่องบูธยกสิทธิ์ Administrator แบบไม่ถาม (ไม่เด้ง "Do you want to allow this app...")

.DESCRIPTION
  ตั้งค่า UAC policy ค่าเดียว:
      HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System
        ConsentPromptBehaviorAdmin = 0   (Elevate without prompting)

  ผลคือโปรแกรมที่ขอสิทธิ์ admin จะได้สิทธิ์ทันทีโดยไม่เด้งหน้าต่างถาม
  ทำให้ auto-update ของ Bonio Booth (ที่ลงแบบ per-machine ใน C:\Program Files)
  รัน installer ได้เองโดยไม่ต้องมีคนกด Yes

  สคริปต์นี้ *ไม่* แตะ EnableLUA คือไม่ได้ปิด UAC ทั้งระบบ เพราะ EnableLUA=0
  ทำให้ WebView2 (ตัวเรนเดอร์ UI ของแอป) ทำงานผิดปกติ

  ข้อจำกัดสำคัญ: ค่านี้มีผลกับ account ที่เป็นสมาชิกกลุ่ม Administrators เท่านั้น
  ถ้าบูธล็อกอินด้วย standard user จะไม่เงียบ แต่จะถามรหัสผ่าน admin แทน
  สคริปต์จะตรวจให้และเตือนถ้าเจอกรณีนี้

.PARAMETER Revert
  คืนค่ากลับเป็นค่ามาตรฐานของ Windows (ConsentPromptBehaviorAdmin = 5)

.PARAMETER Yes
  ข้ามการถามยืนยัน (สำหรับรันแบบ automate ไล่ทีละเครื่อง)

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\set-uac-silent-elevation.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File .\set-uac-silent-elevation.ps1 -Revert
#>
[CmdletBinding()]
param(
  [switch]$Revert,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$RegPath   = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
$ValueName = 'ConsentPromptBehaviorAdmin'
$Target    = if ($Revert) { 5 } else { 0 }
$TargetTxt = if ($Revert) { '5 (ถามแบบปกติ - ค่ามาตรฐาน Windows)' } else { '0 (ยกสิทธิ์เงียบ ไม่ถาม)' }

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltinRole]::Administrator)
}

Write-Host ''
Write-Host '=== Bonio Booth - UAC silent elevation ===' -ForegroundColor Cyan
Write-Host ("Computer : {0}" -f $env:COMPUTERNAME)
Write-Host ("User     : {0}\{1}" -f $env:USERDOMAIN, $env:USERNAME)
Write-Host ''

# --- ยกสิทธิ์ตัวเองถ้ายังไม่ได้รันแบบ admin (เด้ง UAC ครั้งนี้ครั้งเดียว) ---
if (-not (Test-IsAdmin)) {
  Write-Host 'สคริปต์นี้ต้องรันแบบ Administrator - กำลังขอสิทธิ์ (กด Yes ที่หน้าต่าง UAC)' -ForegroundColor Yellow
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  if ($Revert) { $argList += '-Revert' }
  if ($Yes)    { $argList += '-Yes' }
  try {
    $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -PassThru -Wait
    exit $p.ExitCode
  } catch {
    Write-Host 'ยกสิทธิ์ไม่สำเร็จ (ผู้ใช้กดยกเลิก UAC หรือ account นี้ไม่ใช่ admin)' -ForegroundColor Red
    Read-Host 'กด Enter เพื่อปิด'
    exit 1
  }
}

# --- เตือนถ้า account ที่ใช้งานบูธไม่ใช่ admin ---
# หมายเหตุ: ตอนนี้เรารันแบบยกสิทธิ์แล้ว จึงเช็คจากกลุ่ม Administrators ของเครื่องแทน
$localAdmins = @()
try {
  $group = [ADSI]"WinNT://./Administrators,group"
  $localAdmins = @($group.Invoke('Members') | ForEach-Object {
    $_.GetType().InvokeMember('Name', 'GetProperty', $null, $_, $null)
  })
} catch { }
if ($localAdmins.Count -gt 0) {
  Write-Host '--- สมาชิกกลุ่ม Administrators บนเครื่องนี้ ---' -ForegroundColor Cyan
  $localAdmins | ForEach-Object { Write-Host ("  - {0}" -f $_) }
  Write-Host ''
  Write-Host 'ตรวจสอบว่า account ที่บูธล็อกอินอยู่มีชื่ออยู่ในรายการนี้ ถ้าไม่มี ค่านี้จะไม่ช่วย' -ForegroundColor Yellow
  Write-Host 'เพราะ standard user ยกสิทธิ์เงียบไม่ได้ Windows จะถามรหัสผ่าน admin แทน' -ForegroundColor Yellow
  Write-Host ''
}

# --- ค่าปัจจุบัน ---
$before = (Get-ItemProperty -Path $RegPath -Name $ValueName -ErrorAction SilentlyContinue).$ValueName
$enableLua = (Get-ItemProperty -Path $RegPath -Name 'EnableLUA' -ErrorAction SilentlyContinue).EnableLUA
Write-Host '--- ค่าปัจจุบัน ---' -ForegroundColor Cyan
Write-Host ("  {0} = {1}" -f $ValueName, $(if ($null -eq $before) { '(ไม่มีค่า)' } else { $before }))
Write-Host ("  EnableLUA                  = {0}   (สคริปต์นี้ไม่แตะค่านี้)" -f $enableLua)
Write-Host ''

if ($before -eq $Target) {
  Write-Host ("ค่าตรงตามที่ต้องการอยู่แล้ว: {0} = {1}" -f $ValueName, $TargetTxt) -ForegroundColor Green
  if (-not $Yes) { Read-Host 'กด Enter เพื่อปิด' }
  exit 0
}

Write-Host ("จะเปลี่ยนเป็น : {0} = {1}" -f $ValueName, $TargetTxt) -ForegroundColor Yellow
if (-not $Revert) {
  Write-Host ''
  Write-Host 'ผลข้างเคียงที่ต้องยอมรับ: โปรแกรม *ทุกตัว* ที่ขอสิทธิ์ admin บนเครื่องนี้' -ForegroundColor Yellow
  Write-Host 'จะได้สิทธิ์ทันทีโดยไม่ถาม ไม่ใช่แค่ Bonio Booth' -ForegroundColor Yellow
  Write-Host 'เหมาะกับเครื่องบูธที่ล็อกไว้ใช้งานแอปเดียว ไม่ควรใช้กับเครื่องทำงานทั่วไป' -ForegroundColor Yellow
}
Write-Host ''

if (-not $Yes) {
  $ans = Read-Host 'ยืนยันหรือไม่? (พิมพ์ YES แล้ว Enter)'
  if ($ans -ne 'YES') {
    Write-Host 'ยกเลิก - ไม่มีอะไรถูกเปลี่ยน' -ForegroundColor Red
    exit 1
  }
}

# --- เขียนค่า ---
if (-not (Test-Path $RegPath)) { New-Item -Path $RegPath -Force | Out-Null }
New-ItemProperty -Path $RegPath -Name $ValueName -Value $Target -PropertyType DWord -Force | Out-Null

# --- อ่านกลับมายืนยันว่าเขียนติดจริง ---
$after = (Get-ItemProperty -Path $RegPath -Name $ValueName).$ValueName
Write-Host ''
if ($after -eq $Target) {
  Write-Host ("สำเร็จ: {0} {1} -> {2}" -f $ValueName, $(if ($null -eq $before) { '(ไม่มีค่า)' } else { $before }), $after) -ForegroundColor Green
  Write-Host 'มีผลทันที ไม่ต้องรีบูต' -ForegroundColor Green
  if (-not $Revert) {
    Write-Host ''
    Write-Host 'ทดสอบ: เปิด admin menu ในแอป > ปุ่ม "เพิ่ม Windows Defender exclusion"' -ForegroundColor Cyan
    Write-Host 'ถ้าตั้งค่าติด ปุ่มนั้นจะทำงานจบโดยไม่เด้ง UAC อีก' -ForegroundColor Cyan
  }
} else {
  Write-Host ("ล้มเหลว: เขียนแล้วแต่ค่าที่อ่านได้คือ {0} (คาดว่า {1})" -f $after, $Target) -ForegroundColor Red
  Write-Host 'ถ้าเครื่องอยู่ใน domain อาจมี Group Policy เขียนทับ ต้องแก้ที่ GPO แทน' -ForegroundColor Red
  if (-not $Yes) { Read-Host 'กด Enter เพื่อปิด' }
  exit 1
}
Write-Host ''
if (-not $Yes) { Read-Host 'กด Enter เพื่อปิด' }
