<#
.SYNOPSIS
  เตรียม WebView2 แบบ Fixed Version ให้ build ฝังไปกับตัวติดตั้ง (และโหมดทดสอบที่ตู้)

.DESCRIPTION
  WebView2 ที่ตู้ใช้อยู่เดิมเป็นแบบ Evergreen คืออัปเดตตัวเองเงียบๆ ผ่าน scheduled task
  ทุกเครื่องจึงเปลี่ยนเวอร์ชันพร้อมกันได้โดยที่เราไม่ได้ปล่อยอะไรเลย ตัวอัดวิดีโอ
  (MediaRecorder), การดึงภาพจาก webcam (getUserMedia) และ canvas ล้วนอยู่ใน WebView2
  ทั้งหมด การล็อกเวอร์ชันจึงทำให้พฤติกรรมของตู้นิ่งและทำซ้ำได้

  โหมดปกติ (สำหรับเครื่องที่ใช้ build):
    แตกไฟล์ .cab ของ Fixed Version Runtime ไปไว้ที่ src-tauri\webview2-fixed
    ซึ่ง tauri.conf.json ชี้ไว้แล้วผ่าน bundle.windows.webviewInstallMode
    ตัว runtime จะถูกฝังเข้าไปในตัวติดตั้ง แอปจะใช้ runtime ตัวนี้ตัวเดียวเสมอ
    ไม่ขึ้นกับ WebView2 ที่ Windows ติดตั้งไว้ในเครื่อง
    โฟลเดอร์นี้ไม่ได้เข้า git (ใหญ่ราว 661 MB) เครื่อง build ต้องรันสคริปต์นี้ก่อน 1 ครั้ง

  โหมด -BoothOverride (สำหรับทดสอบที่ตู้ โดยไม่ต้อง build ใหม่):
    ตั้ง environment variable WEBVIEW2_BROWSER_EXECUTABLE_FOLDER ให้ชี้ไปที่ runtime
    ที่แตกไว้ ใช้ตอนอยากลองเวอร์ชันอื่นกับตัวติดตั้งเดิม ถอนออกด้วย -Revert
    ตัว runtime ที่ Windows ติดตั้งไว้ไม่ถูกแตะในทุกโหมด

  ดาวน์โหลดไฟล์ .cab ได้จากช่อง Fixed Version (เลือก x64) ที่
  https://developer.microsoft.com/microsoft-edge/webview2

.PARAMETER CabPath
  ไฟล์ .cab ของ Fixed Version Runtime ที่ดาวน์โหลดมา

.PARAMETER DestRoot
  ที่แตกไฟล์ ค่าเริ่มต้นคือ src-tauri\webview2-fixed ของ repo นี้
  ถ้าใช้ -BoothOverride ที่ตู้ ให้ชี้ไปที่ที่เก็บถาวร เช่น C:\boniobooth\webview2

.PARAMETER BoothOverride
  ตั้ง env var ให้แอปที่ติดตั้งอยู่แล้วหันมาใช้ runtime ที่แตกไว้ (ไม่ต้อง build ใหม่)

.PARAMETER Revert
  ยกเลิก -BoothOverride กลับไปใช้ runtime ตามที่ตัวติดตั้งกำหนด

.EXAMPLE
  # เครื่อง build: เตรียม runtime ก่อน build ครั้งแรก
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-fixed-webview2.ps1 -CabPath C:\Downloads\Microsoft.WebView2.FixedVersionRuntime.151.0.4129.107.x64.cab

.EXAMPLE
  # ตู้: ทดลองใช้ runtime ที่ล็อกไว้กับตัวติดตั้งเดิม แล้วถอนกลับ
  powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-fixed-webview2.ps1 -CabPath C:\Downloads\rt.cab -DestRoot C:\boniobooth\webview2 -BoothOverride
  powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-fixed-webview2.ps1 -Revert

.NOTES
  ถ้าเปลี่ยนเวอร์ชัน runtime ต้องแก้ path ใน tauri.conf.json ให้ตรงกับชื่อโฟลเดอร์ใหม่ด้วย
  ตรวจว่าแอปใช้เวอร์ชันไหนอยู่ได้จาก log ตอนเปิดแอป บรรทัด "[startup] WebView2 runtime:"
#>
[CmdletBinding()]
param(
    [string]$CabPath,
    [string]$DestRoot,
    [switch]$BoothOverride,
    [switch]$Revert
)

$ErrorActionPreference = "Stop"
$envVarName = "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"

if ($Revert) {
    [Environment]::SetEnvironmentVariable($envVarName, $null, "Machine")
    Write-Host "ถอน override แล้ว — แอปจะกลับไปใช้ runtime ตามที่ตัวติดตั้งกำหนด" -ForegroundColor Green
    Write-Host "ปิดแอปแล้วเปิดใหม่เพื่อให้มีผล" -ForegroundColor Yellow
    return
}

if (-not $CabPath) {
    throw "ต้องระบุ -CabPath ของไฟล์ Fixed Version Runtime (.cab) ดาวน์โหลดได้จาก https://developer.microsoft.com/microsoft-edge/webview2"
}
if (-not (Test-Path $CabPath)) {
    throw "ไม่พบไฟล์: $CabPath"
}

if (-not $DestRoot) {
    $DestRoot = Join-Path (Split-Path $PSScriptRoot -Parent) "src-tauri\webview2-fixed"
}

# path ของ runtime ห้ามมี \Edge\Application\ ไม่งั้น WebView2 จะปฏิเสธด้วย ERROR_NOT_SUPPORTED
if ($DestRoot -match [regex]::Escape("\Edge\Application\")) {
    throw "path ปลายทางห้ามมี \Edge\Application\ — เปลี่ยน -DestRoot"
}

if (-not (Test-Path $DestRoot)) {
    New-Item -ItemType Directory -Path $DestRoot -Force | Out-Null
}

Write-Host "กำลังแตกไฟล์ runtime (ใช้เวลาสักครู่ ประมาณ 661 MB) ..." -ForegroundColor Cyan
& "$env:SystemRoot\System32\expand.exe" $CabPath -F:* $DestRoot | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) {
    throw "แตกไฟล์ไม่สำเร็จ (exit $LASTEXITCODE)"
}

$runtimeExe = Get-ChildItem -Path $DestRoot -Filter "msedgewebview2.exe" -Recurse -File |
    Select-Object -First 1
if (-not $runtimeExe) {
    throw "แตกไฟล์แล้วแต่ไม่เจอ msedgewebview2.exe ใน $DestRoot — ไฟล์ .cab อาจไม่ใช่ Fixed Version Runtime"
}
$runtimeDir = $runtimeExe.Directory.FullName
$runtimeVersion = $runtimeExe.VersionInfo.ProductVersion

Write-Host ""
Write-Host "เตรียม runtime เรียบร้อย" -ForegroundColor Green
Write-Host "  โฟลเดอร์ : $runtimeDir"
Write-Host "  เวอร์ชัน : $runtimeVersion"

if ($BoothOverride) {
    [Environment]::SetEnvironmentVariable($envVarName, $runtimeDir, "Machine")
    Write-Host ""
    Write-Host "ตั้ง override ที่เครื่องนี้แล้ว ($envVarName)" -ForegroundColor Green
    Write-Host "ปิดแอปแล้วเปิดใหม่ จากนั้นเช็ค log บรรทัด '[startup] WebView2 runtime:' ว่าตรงกับเวอร์ชันนี้ไหม" -ForegroundColor Yellow
    Write-Host "ถอนออกด้วย: setup-fixed-webview2.ps1 -Revert" -ForegroundColor Yellow
} else {
    $folderName = Split-Path $runtimeDir -Leaf
    Write-Host ""
    Write-Host "ตรวจว่า tauri.conf.json ชี้ path ตรงกับโฟลเดอร์นี้:" -ForegroundColor Yellow
    Write-Host "  bundle.windows.webviewInstallMode.path = webview2-fixed/$folderName/"
    Write-Host "จากนั้น build ได้ตามปกติ: npm run build:app"
}
