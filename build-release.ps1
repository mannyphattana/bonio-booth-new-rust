# สคริปต์สำหรับ Build และ Release Bonio Booth

param(
    [Parameter(Mandatory=$true)]
    [string]$Version,
    
    [switch]$SkipBuild = $false,
    [switch]$CreateRelease = $false
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Bonio Booth Build & Release Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ตรวจสอบ version format
if ($Version -notmatch '^\d+\.\d+\.\d+(-\d+)?$') {
    Write-Host "❌ Error: Version format ไม่ถูกต้อง" -ForegroundColor Red
    Write-Host "   ควรเป็น: MAJOR.MINOR.PATCH หรือ MAJOR.MINOR.PATCH-BUILD" -ForegroundColor Yellow
    Write-Host "   ตัวอย่าง: 0.4.0 หรือ 0.4.0-16" -ForegroundColor Yellow
    exit 1
}

$TagVersion = "v$Version"
Write-Host "📦 Version: $Version" -ForegroundColor Green
Write-Host "🏷️  Tag: $TagVersion" -ForegroundColor Green
Write-Host ""

# อัพเดท version ใน tauri.conf.json
Write-Host "📝 อัพเดท version ใน tauri.conf.json..." -ForegroundColor Yellow
$tauriConfigPath = "src-tauri\tauri.conf.json"
if (Test-Path $tauriConfigPath) {
    $tauriConfig = Get-Content $tauriConfigPath | ConvertFrom-Json
    $tauriConfig.version = $Version
    $tauriConfig | ConvertTo-Json -Depth 10 | Set-Content $tauriConfigPath
    Write-Host "✅ อัพเดท tauri.conf.json แล้ว" -ForegroundColor Green
} else {
    Write-Host "❌ ไม่พบไฟล์ $tauriConfigPath" -ForegroundColor Red
    exit 1
}

# อัพเดท version ใน Cargo.toml (ถ้าต้องการ)
Write-Host "📝 อัพเดท version ใน Cargo.toml..." -ForegroundColor Yellow
$cargoTomlPath = "src-tauri\Cargo.toml"
if (Test-Path $cargoTomlPath) {
    $cargoContent = Get-Content $cargoTomlPath -Raw
    # Extract base version (remove build number)
    $baseVersion = $Version -replace '-\d+$', ''
    $cargoContent = $cargoContent -replace 'version = "[\d\.]+"', "version = `"$baseVersion`""
    Set-Content $cargoTomlPath -Value $cargoContent -NoNewline
    Write-Host "✅ อัพเดท Cargo.toml แล้ว" -ForegroundColor Green
}

Write-Host ""

# Build
if (-not $SkipBuild) {
    Write-Host "🔨 เริ่ม Build..." -ForegroundColor Yellow
    Write-Host ""
    
    npm run release
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "❌ Build ล้มเหลว!" -ForegroundColor Red
        exit 1
    }
    
    Write-Host ""
    Write-Host "✅ Build สำเร็จ!" -ForegroundColor Green
    Write-Host ""
}

# แสดงตำแหน่งไฟล์ที่ build แล้ว
$nsisPath = "src-tauri\target\release\bundle\nsis"
$updaterPath = "src-tauri\target\release\bundle\updater"

Write-Host "📁 ไฟล์ที่สร้างแล้ว:" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $nsisPath) {
    $installerFiles = Get-ChildItem $nsisPath -Filter "*.exe"
    foreach ($file in $installerFiles) {
        Write-Host "   📦 Installer: $($file.FullName)" -ForegroundColor Green
    }
}

if (Test-Path $updaterPath) {
    $updaterFiles = Get-ChildItem $updaterPath
    Write-Host ""
    Write-Host "   📄 Updater files:" -ForegroundColor Green
    foreach ($file in $updaterFiles) {
        Write-Host "      - $($file.Name)" -ForegroundColor Gray
    }
}

Write-Host ""

# สร้าง GitHub Release (ถ้าระบุ)
if ($CreateRelease) {
    Write-Host "🚀 สร้าง GitHub Release..." -ForegroundColor Yellow
    
    # ตรวจสอบว่า GitHub CLI ติดตั้งแล้วหรือยัง
    $ghInstalled = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $ghInstalled) {
        Write-Host "❌ ไม่พบ GitHub CLI (gh)" -ForegroundColor Red
        Write-Host "   ติดตั้งได้จาก: https://cli.github.com/" -ForegroundColor Yellow
        Write-Host "   หรือใช้ GitHub Web Interface แทน" -ForegroundColor Yellow
        exit 1
    }
    
    # สร้าง tag
    Write-Host "   สร้าง tag: $TagVersion" -ForegroundColor Gray
    git tag $TagVersion
    git push origin $TagVersion
    
    # สร้าง release
    $releaseNotes = Read-Host "   ใส่ Release Notes (Enter เพื่อข้าม)"
    
    $releaseArgs = @(
        "release", "create", $TagVersion,
        "$nsisPath\*.exe",
        "$updaterPath\latest.json",
        "--title", "Bonio Booth $TagVersion",
        "--notes", $releaseNotes
    )
    
    gh $releaseArgs
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ สร้าง GitHub Release สำเร็จ!" -ForegroundColor Green
        Write-Host "   URL: https://github.com/mannyphattana/bonio-booth-new-rust/releases/tag/$TagVersion" -ForegroundColor Cyan
    } else {
        Write-Host ""
        Write-Host "❌ สร้าง GitHub Release ล้มเหลว" -ForegroundColor Red
    }
} else {
    Write-Host "💡 คำแนะนำ:" -ForegroundColor Cyan
    Write-Host "   1. อัพโหลดไฟล์ installer และ latest.json ไปที่ GitHub Releases" -ForegroundColor White
    Write-Host "   2. สร้าง tag: git tag $TagVersion && git push origin $TagVersion" -ForegroundColor White
    Write-Host "   3. หรือใช้: .\build-release.ps1 -Version $Version -CreateRelease" -ForegroundColor White
}

Write-Host ""
Write-Host "✨ เสร็จสิ้น!" -ForegroundColor Green
