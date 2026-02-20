# คำสั่ง Build อย่างเดียว (ไม่ Release)

สำหรับ build อย่างเดียวเพื่อทดสอบหรือใช้งานในเครื่อง ไม่ต้อง release ไปที่ GitHub

## Build เพื่อแค่รันได้ (ไม่ต้อง Sign / ไม่ต้อง Installer)

ใช้คำสั่งนี้ถ้าแค่อยาก build แล้วรันในเครื่อง **ไม่ต้องตั้งค่า TAURI_SIGNING_PRIVATE_KEY**

```bash
npm run build:only
```

**ผลลัพธ์:** ได้แค่ไฟล์ `src-tauri/target/release/bonio-booth.exe` (ไม่มี installer, ไม่มีขั้นตอน sign)

จากนั้นรันแอปด้วย:

```bash
npm run run:release
```

หรือดับเบิลคลิกที่ `src-tauri/target/release/bonio-booth.exe`

---

## Build Production เต็ม (พร้อม Installer / Auto-Update)

```bash
npm run build:app
```

หรือ

```bash
npm run build && npm run tauri:build
```

**ผลลัพธ์ที่ได้:**
- `src-tauri/target/release/bundle/nsis/Bonio Booth_0.4.0-15_x64-setup.exe` - Windows installer
- `src-tauri/target/release/bundle/updater/latest.json` - Updater config (ถ้ามี signing key)
- `src-tauri/target/release/bundle/updater/Bonio Booth_0.4.0-15_x64-setup.exe.sig` - Signature file (ถ้ามี signing key)

**หมายเหตุ:** คำสั่งนี้ต้องตั้งค่า `TAURI_SIGNING_PRIVATE_KEY` ถ้ามี pubkey ใน config

### Build Debug Mode (เร็วกว่า สำหรับทดสอบ)

```bash
npm run tauri:build:debug
```

**ผลลัพธ์ที่ได้:**
- `src-tauri/target/debug/bundle/nsis/Bonio Booth_0.4.0-15_x64-setup.exe` - Debug installer

## ใส่ Signing Key สำหรับ `build:app` (ต้องทำก่อนรัน build:app)

ถ้าต้องการใช้ `npm run build:app` เพื่อสร้าง installer + ไฟล์สำหรับ auto-update ต้องตั้งค่า signing key **ครั้งเดียว** ดังนี้

### ขั้นตอนที่ 1: สร้าง Key (ถ้ายังไม่มีไฟล์ `myapp.key`)

รันจากโฟลเดอร์โปรเจค (root):

```powershell
# สร้างโฟลเดอร์เก็บ key
New-Item -ItemType Directory -Force -Path "src-tauri\.tauri\keys"

# สร้างคู่ key
npm run tauri signer generate -- -w src-tauri/.tauri/keys/myapp.key
```

จะได้ 2 ไฟล์:
- `src-tauri/.tauri/keys/myapp.key` — private key (อย่าแชร์)
- `src-tauri/.tauri/keys/myapp.key.pub` — public key

**ถ้าเจอ error ว่า "myapp.key already exists":** แปลว่ามี key อยู่แล้ว ไม่ต้อง generate ใหม่ — ข้ามไปขั้นตอนที่ 3 (ตั้งค่า `TAURI_SIGNING_PRIVATE_KEY` จากไฟล์ที่มีอยู่) ได้เลย  

ถ้าต้องการสร้าง key ใหม่ทับของเดิมให้ใช้:  
`npm run tauri signer generate -- -w src-tauri/.tauri/keys/myapp.key --force`  
(หลังสร้างใหม่ต้องอัพเดท `pubkey` ใน tauri.conf.json ด้วย)

### ขั้นตอนที่ 2: ใส่ Public Key ใน config

1. เปิดไฟล์ `src-tauri/.tauri/keys/myapp.key.pub` แล้ว copy เนื้อหาทั้งหมด (บรรทัดเดียว)
2. เปิด `src-tauri/tauri.conf.json` หา `plugins.updater.pubkey`
3. เปลี่ยนค่าเป็นข้อความที่ copy จาก `myapp.key.pub`

```json
"updater": {
  "endpoints": ["..."],
  "pubkey": "วาง_public_key_ตรงนี้"
}
```

### ขั้นตอนที่ 3: ตั้งค่า Private Key ในเครื่อง (TAURI_SIGNING_PRIVATE_KEY)

**วิธีที่ 1 — ตั้งค่าถาวร (แนะนำ)**

เปิด PowerShell ที่โฟลเดอร์โปรเจค แล้วรัน:

```powershell
$key = Get-Content "src-tauri\.tauri\keys\myapp.key" -Raw
[System.Environment]::SetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY', $key, 'User')
```

จากนั้น **ปิดแล้วเปิด Terminal / VS Code ใหม่** แล้วรัน `npm run build:app`

**วิธีที่ 2 — ตั้งค่าแค่ session เดียว**

ใน Terminal เดิมที่ใช้ build:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "src-tauri\.tauri\keys\myapp.key" -Raw
npm run build:app
```

---

**สรุป:** ใส่ signing key = สร้าง key (ถ้ายังไม่มี) → ใส่ public key ใน `tauri.conf.json` → ตั้งค่า `TAURI_SIGNING_PRIVATE_KEY` จากไฟล์ `myapp.key` (แบบถาวรหรือแค่ session)

## คำสั่ง Build แบบต่างๆ

| คำสั่ง | คำอธิบาย |
|--------|----------|
| `npm run build:only` | Build เฉพาะ .exe (ไม่สร้าง installer/sign) — **ใช้ตัวนี้ถ้าแค่อยากรัน** |
| `npm run run:release` | รันแอปที่ build ด้วย build:only แล้ว |
| `npm run build` | Build เฉพาะ frontend (React/Vite) |
| `npm run build:app` | Build ทั้ง frontend + Tauri + installer (ต้องมี signing key — ดูด้านล่าง) |
| `npm run tauri:build` | Build เฉพาะ Tauri app (production) |
| `npm run tauri:build:debug` | Build Tauri app แบบ debug (เร็วกว่า) |
| `npm run release` | เหมือน `build:app` (ชื่อเดิม) |

## ตำแหน่งไฟล์ที่ Build แล้ว

### Production Build
```
src-tauri/target/release/bundle/nsis/Bonio Booth_[VERSION]_x64-setup.exe
src-tauri/target/release/bundle/updater/latest.json (ถ้ามี signing key)
src-tauri/target/release/bundle/updater/Bonio Booth_[VERSION]_x64-setup.exe.sig (ถ้ามี signing key)
```

### Debug Build
```
src-tauri/target/debug/bundle/nsis/Bonio Booth_[VERSION]_x64-setup.exe
```

## Troubleshooting

### Error: "A public key has been found, but no private key"

**วิธีแก้:**
1. ตั้งค่า `TAURI_SIGNING_PRIVATE_KEY` environment variable (ดูด้านบน)
2. **ปิดแล้วเปิด Terminal/VS Code ใหม่** (สำคัญ!)
3. Build ใหม่

### Build ช้า

- ใช้ `npm run tauri:build:debug` แทน (เร็วกว่า แต่ไฟล์ใหญ่กว่า)
- หรือล้าง cache: `cd src-tauri && cargo clean && cd ..`

### ไม่ต้องการ Auto-Update

- ไม่ต้องตั้งค่า signing key
- Build จะได้แค่ `.exe` installer เท่านั้น (ไม่มี `.sig` และ `latest.json`)
- ยังใช้ได้ตามปกติ แค่ไม่มี auto-update
