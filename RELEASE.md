# คำแนะนำการ Build และ Release ไปที่ GitHub

## ขั้นตอนการ Build และ Release

### 1. เตรียมความพร้อม

```bash
# ติดตั้ง dependencies (ถ้ายังไม่ได้ติดตั้ง)
npm install

# ตรวจสอบว่า Tauri CLI ติดตั้งแล้ว
npm run tauri -- --version
```

### 2. อัพเดท Version

แก้ไขไฟล์ `src-tauri/tauri.conf.json`:
```json
{
  "version": "0.4.0-16"  // เปลี่ยนเป็น version ใหม่
}
```

และแก้ไขไฟล์ `src-tauri/Cargo.toml`:
```toml
[package]
version = "0.4.0"  // เปลี่ยนเป็น version ใหม่
```

### 3. Build สำหรับ Release

```bash
# Build production (จะสร้าง installer และ updater artifacts)
npm run release

# หรือใช้คำสั่งเต็ม
npm run build && npm run tauri:build
```

**ผลลัพธ์ที่ได้:**
- `src-tauri/target/release/bundle/nsis/` - Windows installer (.exe)
- `src-tauri/target/release/bundle/updater/` - Updater artifacts (latest.json, .sig files)

### 4. สร้าง Release บน GitHub

#### วิธีที่ 1: ใช้ GitHub Web Interface

1. ไปที่ GitHub repository: `https://github.com/mannyphattana/bonio-booth-new-rust`
2. คลิก **"Releases"** → **"Create a new release"**
3. ตั้งค่า:
   - **Tag version**: `v0.4.0-16` (ตรงกับ version ใน tauri.conf.json)
   - **Release title**: `v0.4.0-16` หรือชื่อที่ต้องการ
   - **Description**: เขียน changelog หรือรายการเปลี่ยนแปลง
4. **อัพโหลดไฟล์**:
   - ลากไฟล์ installer จาก `src-tauri/target/release/bundle/nsis/Bonio Booth_0.4.0-16_x64-setup.exe`
   - ลากไฟล์ `latest.json` จาก `src-tauri/target/release/bundle/updater/latest.json`
   - ลากไฟล์ `.sig` จาก `src-tauri/target/release/bundle/updater/` (ถ้ามี)
5. คลิก **"Publish release"**

#### วิธีที่ 2: ใช้ GitHub CLI

```bash
# ติดตั้ง GitHub CLI (ถ้ายังไม่มี)
# Windows: winget install GitHub.cli
# หรือดาวน์โหลดจาก: https://cli.github.com/

# Login
gh auth login

# สร้าง release
gh release create v0.4.0-16 \
  "src-tauri/target/release/bundle/nsis/Bonio Booth_0.4.0-16_x64-setup.exe" \
  "src-tauri/target/release/bundle/updater/latest.json" \
  --title "v0.4.0-16" \
  --notes "Release notes here"
```

### 5. ตรวจสอบ Updater

หลังจาก release แล้ว ตรวจสอบว่า `latest.json` สามารถเข้าถึงได้ที่:
```
https://github.com/mannyphattana/bonio-booth-new-rust/releases/latest/download/latest.json
```

## คำสั่ง Build แบบต่างๆ

```bash
# Build production (release mode)
npm run release

# Build debug mode (สำหรับทดสอบ)
npm run tauri:build:debug

# Build เฉพาะ frontend
npm run build

# Run development mode
npm run dev
```

## สิ่งที่ต้องตรวจสอบก่อน Release

- [ ] อัพเดท version ใน `tauri.conf.json`
- [ ] อัพเดท version ใน `Cargo.toml`
- [ ] ทดสอบ build ผ่านแล้ว
- [ ] ทดสอบ installer ว่าติดตั้งได้ถูกต้อง
- [ ] ตรวจสอบว่า latest.json ถูกสร้างแล้ว
- [ ] เขียน release notes

## Troubleshooting

### Build ล้มเหลว
```bash
# ล้าง cache และ build ใหม่
cd src-tauri
cargo clean
cd ..
npm run release
```

### ไม่พบไฟล์ latest.json
- ตรวจสอบว่า `createUpdaterArtifacts: true` ใน `tauri.conf.json`
- ตรวจสอบว่า build สำเร็จแล้ว

### Updater ไม่ทำงาน
- ตรวจสอบ URL ใน `tauri.conf.json` ว่าถูกต้อง
- ตรวจสอบว่า `latest.json` อัพโหลดไปที่ GitHub แล้ว
- ตรวจสอบ pubkey ใน config

## หมายเหตุ

- Version format: `MAJOR.MINOR.PATCH-BUILD` (เช่น `0.4.0-16`)
- Tag format: `vMAJOR.MINOR.PATCH-BUILD` (เช่น `v0.4.0-16`)
- ไฟล์ installer จะอยู่ใน `src-tauri/target/release/bundle/nsis/`
- ไฟล์ updater จะอยู่ใน `src-tauri/target/release/bundle/updater/`
