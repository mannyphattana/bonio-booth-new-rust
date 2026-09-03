# ตั้งเครื่องบูธไม่ให้เด้ง UAC ตอนอัปเดต

> ทำครั้งเดียวต่อเครื่อง ใช้เวลา ~1 นาที

## ปัญหา

ทุกครั้งที่ auto-update รัน installer ตัวใหม่ Windows เด้ง

> Do you want to allow this app to make changes to your device?

ซึ่งไม่มีใครยืนอยู่หน้าบูธไปกด Yes → อัปเดตค้าง

### กลไกที่แท้จริง

`"installMode": "both"` ใน `src-tauri/tauri.conf.json` ทำให้ installer ที่ generate ออกมาใช้
`MULTIUSER_EXECUTIONLEVEL Highest` (`installer.nsi` บรรทัด ~115) ซึ่งใน `MultiUser.nsh`
แปลว่า:

```
RequestExecutionLevel highest
```

Windows จะยกสิทธิ์ให้สูงสุดเท่าที่ account นั้นทำได้ **ตั้งแต่ตอนรันไฟล์ setup.exe** —
คือเด้ง UAC ก่อนหน้าต่าง installer จะเปิดด้วยซ้ำ **ก่อนที่จะได้เลือก Just me / All users**
ดังนั้นการเลือก "Just me" ตอนติดตั้งไม่ได้ช่วยอะไรกับ UAC เลย

ตัวแปรจริงคือ **account ที่บูธล็อกอินอยู่**:

| account | ตอนรัน installer | ผลลัพธ์ |
|---|---|---|
| Administrator | `highest` → ยกสิทธิ์ | **เด้ง UAC** |
| Standard user | `highest` → ยกไม่ได้ รันแบบธรรมดา | ไม่เด้ง แต่เขียนทับ `C:\Program Files` ไม่ได้ → **อัปเดตล้มเหลวเงียบ ๆ** |

> เครื่องที่ "ไม่เคยเด้ง UAC" จึงอาจไม่ใช่เครื่องที่ปกติ แต่เป็นเครื่องที่อัปเดตไม่ขึ้นมานาน
> โดยไม่มีใครรู้ — ตรวจ `DisplayVersion` ด้วย `check-install-mode.ps1` ว่าค้างอยู่เวอร์ชันไหน

### ทางเลือกอื่นที่ไม่ได้เลือก

เปลี่ยนเป็น `"installMode": "currentUser"` แล้ว build ใหม่ จะได้ installer ที่มี
`RequestExecutionLevel user` ซึ่งไม่เด้ง UAC กับใครเลย แต่ต้องไป uninstall + ลงใหม่ทุกเครื่อง
และย้าย shortcut autostart — เลยเลือกวิธีข้างล่างแทนเพราะไม่ต้องแตะตัวแอป

## วิธีแก้ที่เลือกใช้

คงการติดตั้งแบบ per-machine ไว้เหมือนเดิม แล้วตั้ง Windows ให้ยกสิทธิ์ admin โดยไม่ถาม:

```
HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System
  ConsentPromptBehaviorAdmin = 0    (Elevate without prompting)
```

เทียบเท่ากับใน `secpol.msc` > Local Policies > Security Options >
**"User Account Control: Behavior of the elevation prompt for administrators in Admin Approval Mode"**
> **Elevate without prompting**

**ไม่แตะ `EnableLUA`** (ไม่ปิด UAC ทั้งระบบ) เพราะ `EnableLUA=0` ทำให้ WebView2 —
ตัวเรนเดอร์ UI ทั้งหมดของแอป — ทำงานผิดปกติ และต้องรีบูตด้วย
ส่วน `ConsentPromptBehaviorAdmin` มีผลทันทีไม่ต้องรีบูต

## เงื่อนไขที่ต้องมี

**account ที่บูธล็อกอินอยู่ต้องเป็นสมาชิกกลุ่ม Administrators**

Windows ไม่มีทางให้ standard user ยกสิทธิ์เงียบได้เลย ถ้าบูธล็อกอินด้วย standard user
ค่านี้จะไม่ช่วย — จะกลายเป็นถาม *รหัสผ่าน admin* แทน ซึ่งแย่กว่าเดิม
สคริปต์จะพิมพ์รายชื่อสมาชิกกลุ่ม Administrators ออกมาให้ตรวจสอบ

## ขั้นตอนหน้างาน — ทำในแอปได้เลย (วิธีหลัก)

เปิด admin menu (คลิกขวา + PIN) > ปุ่ม **"เตรียมเครื่องให้อัปเดตเองได้"** 🛡️

ใต้ปุ่มจะบอกสถานะจริงของเครื่องนั้นอยู่แล้ว (อ่านจาก registry ทุกครั้งที่เปิดเมนู):

| ที่เห็นใต้ปุ่ม | แปลว่า |
|---|---|
| ✅ เครื่องนี้ตั้งค่าไว้แล้ว | ไม่ต้องทำอะไร |
| ⚠️ ยังไม่ได้ตั้งค่า | กดปุ่ม > ยืนยัน > กด Yes ที่ UAC (ครั้งสุดท้าย) |
| ⛔ account นี้เป็น standard user | ปุ่มช่วยไม่ได้ ต้องแก้ที่ account ก่อน |

กดแล้วมันจะทำ 2 อย่างใน UAC ครั้งเดียว แล้วรายงานผลเป็นบรรทัด ๆ ว่าอันไหนผ่าน/ไม่ผ่าน
(`prepare_unattended_updates` ใน `src-tauri/src/lib.rs`)

**ทดสอบ:** ปิดเมนูแล้วเปิดใหม่ ต้องขึ้น ✅ และถ้ากดปุ่มซ้ำต้องไม่เด้ง UAC อีก

## ขั้นตอนหน้างาน — ผ่านสคริปต์ (สำรอง / ตอน provisioning)

ใช้เมื่อยังไม่ได้ลงแอป หรือเมื่อต้องการ revert

### 1. เช็คสถานะเครื่อง

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-install-mode.ps1
```

อ่านอย่างเดียว ไม่แก้อะไร — บอก admin/standard user, install mode, path, version,
ค่า UAC ปัจจุบัน, autostart

### 2. ตั้งค่า

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\set-uac-silent-elevation.ps1
```

- ถ้ายังไม่ได้รันแบบ admin สคริปต์จะขอสิทธิ์เอง (**เด้ง UAC ครั้งนี้เป็นครั้งสุดท้าย**)
- แสดงค่าก่อน/หลัง แล้วให้พิมพ์ `YES` ยืนยัน
- อ่านค่ากลับมาตรวจสอบว่าเขียนติดจริง ไม่ได้เคลมว่าสำเร็จลอย ๆ

รันไล่หลายเครื่องแบบไม่ต้องตอบคำถาม: เติม `-Yes`

## ผลข้างเคียงที่ต้องยอมรับ

ค่านี้มีผลกับ **โปรแกรมทุกตัวบนเครื่องนั้น** ไม่ใช่แค่ Bonio Booth — อะไรก็ตามที่ขอสิทธิ์
admin จะได้ไปเลยโดยไม่ถาม เหมาะกับเครื่องบูธที่ล็อกไว้ใช้งานแอปเดียวและไม่มีคนทั่วไป
มานั่งใช้ **ไม่ควรใช้กับเครื่องทำงานทั่วไป**

## ย้อนกลับ

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\set-uac-silent-elevation.ps1 -Revert
```

คืนค่าเป็น `5` ซึ่งเป็นค่ามาตรฐานของ Windows

## หมายเหตุ

- **เครื่องใหม่**: การติดตั้งครั้งแรกยังต้องกด UAC หนึ่งครั้งอยู่ดี (เพราะยังไม่ได้ตั้งค่า)
  ทางที่ดีคือรันสคริปต์นี้ตอน setup เครื่อง หรือใส่ไว้ใน image เลย
- **เครื่องที่อยู่ใน domain**: Group Policy อาจเขียนทับค่านี้ตอน gpupdate — ถ้าเจอกรณีนี้
  สคริปต์จะรายงานว่าเขียนไม่ติด ต้องไปตั้งที่ GPO แทน
- **code signing certificate ไม่ช่วย** — การเซ็น installer แค่เปลี่ยนกล่อง UAC สีเหลือง
  "Unknown publisher" เป็นสีน้ำเงินที่มีชื่อบริษัท ยังต้องกด Yes เหมือนเดิม
- ปุ่ม Defender whitelist เป็นคนละเรื่องกับ UAC (แก้ปัญหา Defender กักไฟล์ installer)
  แต่หลังตั้งค่านี้แล้ว ปุ่มนั้นจะไม่เด้ง UAC อีกเป็นผลพลอยได้
