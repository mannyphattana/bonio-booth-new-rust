# คู่มือการ Release แบบไม่ใช้ Auto-Update (แบบง่าย)

คู่มือนี้สำหรับการ release แบบไม่ใช้ auto-update ซึ่งจะง่ายกว่าเพราะไม่ต้องจัดการกับ signing keys และ updater artifacts

## Release แบบเก่า vs แบบใหม่ (ไม่ใช้ auto-update)

| รายการ | แบบเก่า (มี auto-update) | แบบใหม่ (ไม่ใช้ auto-update) |
|--------|---------------------------|-------------------------------|
| จำนวน Assets | 5 ไฟล์ | 3 ไฟล์ |
| ไฟล์ที่ได้ | installer + `.sig` + `latest.json` + source zip + source tar.gz | **installer ที่คุณอัพโหลด** + source zip + source tar.gz |
| หมายเหตุ | มี .sig และ latest.json สำหรับ updater | ไม่มี .sig และ latest.json — **ถือว่าถูกต้อง** |

แบบใหม่คุณแค่อัพโหลดไฟล์ `.exe` installer เอง ส่วน Source code (zip/tar.gz) GitHub สร้างให้อัตโนมัติ

## ขั้นตอนการ Release

### 1. อัพเดท Version ก่อน (สำคัญ!)

**ต้องอัพเดท version ก่อน build เสมอ** เพื่อให้ชื่อไฟล์ installer ตรงกับ release tag (เช่น tag `v0.4.0-16` ควรได้ไฟล์ `Bonio.Booth_0.4.0-16_x64-setup.exe`)

แก้ไขไฟล์ `src-tauri/tauri.conf.json`:
```json
{
  "version": "0.4.0-16"  // เปลี่ยนเป็น version ใหม่
}
```

และแก้ไขไฟล์ `src-tauri/Cargo.toml`:
```toml
[package]
version = "0.4.0"  // เปลี่ยนเป็น version ใหม่ (ลบ build number)
```

### 2. Build สำหรับ Release

```bash
# Build production
npm run release
```

**ผลลัพธ์ที่ได้:**
- `src-tauri/target/release/bundle/nsis/Bonio Booth_0.4.0-16_x64-setup.exe` - Windows installer

**หมายเหตุ:** 
- อาจมี warning เกี่ยวกับ signing key แต่ไม่เป็นไร (เพราะไม่ใช้ updater)
- Installer ที่สร้างแล้วใช้ได้ตามปกติ

### 3. Push Tag ไปที่ GitHub ก่อน

เพราะ GitHub บาง repo ไม่มีปุ่ม "Create new tag" ดังนั้นให้ **สร้างและ push tag ก่อน** แล้วค่อยสร้าง release

```bash
# 1. สร้าง tag (ตรงกับ version ใน tauri.conf.json)
git tag v0.4.0-16

# 2. Push tag ไปที่ GitHub
git push origin v0.4.0-16
```

### 4. สร้าง Release บน GitHub

#### วิธีที่ 1: ใช้ GitHub Web Interface (หลัง push tag แล้ว)

1. ไปที่ GitHub repository: `https://github.com/mannyphattana/bonio-booth-new-rust`
2. คลิก **"Releases"** → **"Create a new release"**
3. ตั้งค่า:
   - **Tag version**: เลือก **tag ที่ push ไปแล้ว** เช่น `v0.4.0-16` (จะอยู่ใน dropdown)
   - **Release title**: `v0.4.0-16` หรือชื่อที่ต้องการ
   - **Description**: เขียน changelog หรือรายการเปลี่ยนแปลง
4. **อัพโหลดไฟล์ installer เท่านั้น**:
   - ลากไฟล์ installer จาก `src-tauri/target/release/bundle/nsis/Bonio Booth_0.4.0-16_x64-setup.exe`
   - **ไม่ต้องอัพโหลด** `latest.json` หรือ `.sig` files
5. คลิก **"Publish release"**

#### วิธีที่ 2: ใช้ GitHub CLI (หลัง push tag แล้ว)

```bash
# Login (ถ้ายังไม่ได้)
gh auth login

# สร้าง release จาก tag ที่มีอยู่แล้ว + อัพโหลด installer
gh release create v0.4.0-16 \
  "src-tauri/target/release/bundle/nsis/Bonio Booth_0.4.0-16_x64-setup.exe" \
  --title "v0.4.0-16" \
  --notes "Release notes here"
```

#### วิธีที่ 3: ใช้สคริปต์ PowerShell

```powershell
# Build และอัพเดท version
.\build-release.ps1 -Version "0.4.0-16"

# จากนั้น push tag แล้วไปสร้าง release ที่ GitHub
git tag v0.4.0-16
git push origin v0.4.0-16
# ไปที่ GitHub → Releases → Create new release → เลือก tag v0.4.0-16
```

### 5. แจ้งผู้ใช้ดาวน์โหลด

หลังจาก release แล้ว ผู้ใช้สามารถดาวน์โหลดได้จาก:
```
https://github.com/mannyphattana/bonio-booth-new-rust/releases/latest
```

หรือลิงก์เฉพาะ version:
```
https://github.com/mannyphattana/bonio-booth-new-rust/releases/tag/v0.4.0-16
```

## สรุปขั้นตอนแบบย่อ

```bash
# 1. อัพเดท version ใน tauri.conf.json และ Cargo.toml
# 2. Build
npm run release

# 3. Push tag ก่อน (เพราะไม่มีปุ่ม Create new tag บน GitHub)
git tag v0.4.0-16
git push origin v0.4.0-16

# 4. สร้าง Release ที่ GitHub
#    - ไปที่ GitHub → Releases → Create new release
#    - เลือก tag v0.4.0-16 ที่ push ไปแล้ว
#    - อัพโหลดแค่ไฟล์ .exe installer เท่านั้น
```

**สำคัญ:**  
1. อัพเดท version ใน `tauri.conf.json` ก่อน → แล้วค่อย build (จะได้ชื่อ .exe ตรงกับ version)  
2. Push tag ก่อน แล้วค่อยสร้าง release แล้วเลือก tag นั้น  
3. ถ้า release เป็น `v0.4.0-16` แต่ไฟล์เป็น `0.4.0-15` แปลว่าตอน build ยังไม่ได้เปลี่ยน version เป็น 0.4.0-16 ใน tauri.conf.json

## ข้อดีของการไม่ใช้ Auto-Update

✅ **ง่ายกว่า** - ไม่ต้องจัดการ signing keys  
✅ **เร็วกว่า** - Build ไม่ต้อง sign ไฟล์  
✅ **ปลอดภัยกว่า** - ไม่ต้องเก็บ private keys  
✅ **เหมาะสำหรับ** - การ release ที่ไม่บ่อย หรือต้องการควบคุมการอัพเดทเอง  

## ข้อเสีย

❌ ผู้ใช้ต้องดาวน์โหลดและติดตั้งเองทุกครั้งที่มี version ใหม่  
❌ ไม่มีการแจ้งเตือนอัตโนมัติเมื่อมี version ใหม่  

## คำแนะนำ

- ถ้าต้องการให้ผู้ใช้อัพเดทเอง → ใช้วิธีนี้ (ไม่ใช้ auto-update)
- ถ้าต้องการให้อัพเดทอัตโนมัติ → ใช้วิธีใน `RELEASE.md` (ต้องตั้งค่า signing keys)
