# แผน Implementation: แสดง 2x6 เป็น 4x6 (duplicate) ตั้งแต่หลังถ่ายเสร็จ

> อ้างอิงเอกสาร `2x6 - 4x6 flow _1.pdf` (5 หน้า mockup) — timelab / House of Savoy
> แนวทางที่เลือก: **Presentation-only** (ไม่แก้ data model / type / backend contract)
> สถานะ: แผนพร้อมสั่งงาน — ยังไม่แตะโค้ด

---

## 1. เป้าหมาย

ปัจจุบัน frame 2x6 (3 ช่อง คอลัมน์เดียว) จะถูก duplicate เป็น 4x6 (2 คอลัมน์ซ้าย‑ขวา) **เฉพาะตอนปริ้นที่ backend** (`printer.rs`) เท่านั้น. ทุกหน้าจอก่อนหน้ายังเห็นเป็น 2x6 เดี่ยว.

ต้องการให้ผู้ใช้ **มองเห็นเป็น 4x6 duplicate ตั้งแต่หลังถ่ายเสร็จเป็นต้นไป** ทุก touchpoint:

| หน้า (จาก PDF) | หน้าจอในระบบ | ปัจจุบัน | เป้าหมาย |
|---|---|---|---|
| 1. Select Frame | `FrameSelection` | 2x6 เดี่ยว | **ไม่เปลี่ยน** (เลือกกรอบเป็น 2x6) |
| 2. Select Your Photos | `SlotSelection` | 2x6 เดี่ยว | 4x6 duplicate (2 คอลัมน์) |
| 3. Print complete | `PhotoResult` | preview 2x6 | 4x6 duplicate |
| 4. Request Image (เว็บ) | web download page (backend repo) | 2x6 | 4x6 (ได้อัตโนมัติ) |
| 5. Video File (เว็บ) | web download page (backend repo) | 2x6 | 4x6 (ได้อัตโนมัติ) |

---

## 2. หลักการออกแบบ (สำคัญที่สุด)

ยึด **หลัก single-source-of-truth ของภาพที่ผลิตออกมา (composed image/video) = 4x6 duplicate** แล้วให้ทุกอย่าง downstream ไหลตามเอง:

1. **`compose_frame` (ภาพ) และ `compose_frame_video` (วิดีโอ) ผลิต output เป็น 4x6 duplicate สำหรับกรอบ 2x6/6x2**
   → ผลพลอยได้: preview ใน `PhotoResult`, ไฟล์ที่ save ลงเครื่อง, ไฟล์ที่ upload ขึ้น backend, GIF/วิดีโอ — **เป็น 4x6 ทั้งหมดโดยอัตโนมัติ** (รวมถึงหน้าเว็บ request-image หน้า 4–5 ที่ backend repo ดึงภาพเดียวกันไปแสดง)

2. **`SlotSelection` เป็นการ render สด (ก่อน compose)** → ต้องแก้ที่ layer การแสดงผล: วาดกรอบ + ช่องซ้ำ 2 คอลัมน์ (mirror) โดย **ไม่แตะ data** (`selectedPhotos`, `photoAssignments`, `selectedCaptureIndexes` ยังเป็นชุด 3 ช่องเหมือนเดิม)

3. **การ duplicate ใน `printer.rs` ต้องเป็น idempotent (ratio-based)** — ป้องกัน double-duplicate. เปลี่ยนเงื่อนไข dup จาก "เชื่อ `frame_type` string" เป็น "**ตรวจ aspect ratio ของภาพจริงที่ decode มา** แล้ว dup เฉพาะเมื่อภาพยังเป็น 2x6 เดี่ยว (สูงแคบ ratio < 0.5)". ภาพ 4x6 ที่ compose มาแล้วจะถูกข้าม, ส่วนภาพ 2x6 เก่า (transaction เดิม/reprint) ยังทำงานถูกต้อง.

> **ทำไม presentation-only ปลอดภัยกว่า:** ไม่ต้องแตะ `FrameData`/`FrameSlot` type, ไม่ต้องแก้ payload upload/backend, ไม่ต้องแก้ pricing/quantity logic. ลดพื้นที่ผิดพลาดและ regression.

---

## 3. รายละเอียดงานแต่ละไฟล์

### 3.1 `src-tauri/src/image_processing.rs` — `compose_frame`
- หลัง compose ภาพ 2x6 เสร็จ (ก่อน return base64) เพิ่มขั้นตอน: ถ้ากรอบเป็นแนวตั้งแคบ (2x6) → สร้าง canvas กว้าง 2 เท่า วางภาพซ้ำซ้าย‑ขวา; ถ้าเป็นแนวนอน (6x2) → สูง 2 เท่า วางบน‑ล่าง.
- เกณฑ์ตัดสิน: ใช้ `frame_width/frame_height` ที่รับเข้ามา (ratio < 0.5 → 2x6, > 2 → 6x2) — สอดคล้องกับ logic ใน `PhotoResult.tsx`.
- ตรรกะการวางภาพซ้ำ = ยกมาจาก `printer.rs` block `"2x6"`/`"6x2"` (บรรทัด ~712–735) มาไว้ที่นี่.
- **ระวัง:** ทำ dup **หลัง** จากที่วางรูปลงช่องครบแล้ว (คือ dup ทั้งกรอบ+รูป ไม่ใช่แค่กรอบเปล่า).

### 3.2 `src-tauri/src/video.rs` — `compose_frame_video`
- ทำแบบเดียวกันกับข้อ 3.1 แต่กับวิดีโอ: output ต้องเป็น layout 4x6 duplicate.
- ใช้ FFmpeg filter — วิธีที่เป็นไปได้: หลัง compose วิดีโอ 2x6 เสร็จ ใช้ `hstack` (2x6→4x6) หรือ `vstack` (6x2) กับตัวมันเอง; หรือปรับ filtergraph ให้ซ้อน 2 ชุดตั้งแต่ต้น.
- ต้องให้มิติผลลัพธ์ match กับ composed image (อัตราส่วน 4x6) เพื่อให้ GIF/วิดีโอบนหน้าเว็บตรงกับภาพนิ่ง.
- **จุดเสี่ยงด้าน performance:** วิดีโอกว้างขึ้น 2 เท่า → เวลา encode เพิ่ม. ตรวจสอบว่าไม่ชน `printTimeout`/UX ตอนรวมวิดีโอ (สถานะ "กำลังรวมวิดีโอ...").

### 3.3 `src-tauri/src/printer.rs` — ทำ dup ให้ idempotent
- แก้ block บรรทัด ~712–735: เปลี่ยนจาก `match frame_type.as_str()` เป็นการ **ตรวจ ratio ของ `img` จริง**:
  - ถ้า `img` สูงแคบ (`w/h < 0.5`) และ `needs_cut` → duplicate แนวนอน (เหมือนเดิม)
  - ถ้า `img` กว้าง (`w/h > 2`) และ 6x2 → duplicate แนวตั้ง
  - ถ้า `img` เป็น 4x6 อยู่แล้ว (ratio ~0.67) → **ข้าม** (ไม่ dup ซ้ำ)
- **คง `needs_cut` / การเลือก CUT driver ไว้เหมือนเดิม** (ตัดกระดาษยังต้องทำงาน). `frame_type == "2x6"` จาก `PhotoResult` ยังส่งมาเพื่อบอกให้เลือก CUT driver + กระดาษ 4x6 — แค่ block dup ที่เป็น idempotent.

### 3.4 `src/pages/SlotSelection.tsx` — render 2 คอลัมน์
- ปัจจุบัน (บรรทัด ~240–320): render `<img frame>` 1 ชุด + `slots.map()` overlay 1 ชุด ใน container ที่มี `aspectRatio: frameAspectRatio`.
- แก้เป็น: ถ้ากรอบเป็น 2x6 → เปลี่ยน container ให้มี aspectRatio ของ 4x6 (คือ `frameAspectRatio * 2`) แล้ววาด **กรอบ 2 ชุดวางข้างกัน + slots overlay 2 ชุด** (ชุดที่สอง offset ไปครึ่งขวา). ทั้งสองชุดผูกกับ `photoAssignments` ตัวเดียวกัน → เลือกรูปทีเดียวเติมเหมือนกันทั้งสองฝั่ง (ตรงกับ PDF หน้า 2).
- `calculateScaleFactor` / `scaleFactor` / `imageOffset` ต้องคำนวณใหม่ให้เข้ากับ container ใหม่ (ระวังตำแหน่งช่องไม่เพี้ยน).
- **data ไม่เปลี่ยน:** `slots.length` ยัง = 3, `selectedPhotos`/`(x/3)` counter ยังเหมือนเดิม. เป็นแค่ visual.
- Thumbnails ด้านล่าง (ตัวเลือกรูป 1/2/3) — ไม่เปลี่ยน.

### 3.5 `src/pages/PhotoResult.tsx` — preview
- Preview ใช้ `composedImage` (บรรทัด ~805–820) โดยตรง → **ได้ 4x6 อัตโนมัติ** เมื่อ `compose_frame` output 4x6. โดยหลักไม่ต้องแก้.
- ตรวจ: CSS ที่แสดง `composedImage` ต้องรองรับ aspect ratio ที่กว้างขึ้น (object-fit/contain) ไม่ถูก crop.
- **คงไว้:** logic คำนวณ `frameType = "2x6"` จาก ratio ของ `frameWidth/frameHeight` (ค่าเดิมของกรอบ 2x6) เพื่อส่งให้ `print_photo` เลือก CUT driver. อย่าคำนวณจากภาพ composed.

### 3.6 หน้าเว็บ Request Image / Video (PDF หน้า 4–5)
- อยู่ที่ **backend/web repo (คนละ repo)** — แสดงภาพ/วิดีโอที่ upload ขึ้นไป.
- เมื่อไฟล์ที่ upload เป็น 4x6 duplicate แล้ว → **ได้ 4x6 อัตโนมัติ ไม่ต้องแก้ repo นี้.**
- ✅ ยืนยัน scope: งานในเอกสารครอบคลุมได้จาก repo นี้ทั้งหมด (ไม่ต้องแก้ web repo) — *แต่ต้องทดสอบ end-to-end ว่าเว็บแสดงผลถูก.*

---

## 4. ความเสี่ยง & การป้องกัน

| # | ความเสี่ยง | ผลกระทบ | การป้องกัน |
|---|---|---|---|
| 1 | **Double-duplicate** (compose ทำ 4x6 แล้ว printer ทำซ้ำอีก) | ปริ้นออกมาเป็น 4 รูปเล็ก/เพี้ยน | ทำ printer dup เป็น **ratio-based idempotent** (ข้อ 3.3) |
| 2 | **ภาพ 2x6 เก่า / admin reprint จาก URL** (`RequestImage.tsx`) | reprint ภาพเก่าได้ครึ่งเดียว | idempotent dup รองรับทั้งภาพ 2x6 เก่า และ 4x6 ใหม่โดยดูจาก ratio ภาพจริง |
| 3 | **CUT driver หยุดตัด** | 4x6 ไม่ถูกตัดเป็น 2 แผ่น | คง `needs_cut`/การเลือก `(CUT)` driver ไว้ ไม่แตะ |
| 4 | **paper scale/offset config** (`PaperPositionModal`, `paperStore`) ตั้งค่าไว้กับ 2x6 | ตำแหน่งภาพบนกระดาษเพี้ยน | ทดสอบ scale/vertical/horizontal offset กับ composed 4x6 จริง; อาจต้อง re-calibrate ค่า default |
| 5 | **SlotSelection ตำแหน่งช่องเพี้ยน** ตอนคำนวณ scaleFactor ใหม่ | ผู้ใช้แตะช่องไม่ตรง | ทดสอบบน viewport 720×1280 จริง; เทียบพิกัดช่องซ้าย/ขวา |
| 6 | **Video encode ช้าลง/หน่วง UX** | รอนานตอนรวมวิดีโอ | วัดเวลา encode 4x6; ปรับ resolution/bitrate ถ้าจำเป็น |
| 7 | **GIF vs ภาพนิ่ง ไม่ match** | หน้าเว็บ 4–5 layout ไม่ตรงกัน | ให้ compose_frame กับ compose_frame_video ใช้ตรรกะ dup เดียวกัน |

---

## 5. Test / Verification Plan

1. **Print (สำคัญสุด):** ถ่าย 2x6 → ปริ้นจริง → ต้องได้กระดาษ 4x6 ที่มี 2x6 ซ้ำซ้าย‑ขวา + ถูกตัดเป็น 2 แผ่น (เท่าเดิมกับพฤติกรรมปัจจุบัน). เทียบ output กับของเดิม pixel-to-pixel ว่าไม่เปลี่ยน.
2. **ไม่ double-dup:** ตรวจ log `[Printer] 2x6 dup` — ต้อง**ไม่**ปรากฏสำหรับ flow ใหม่ (เพราะ compose ทำแล้ว).
3. **SlotSelection:** 720×1280 — เห็น 2 คอลัมน์, แตะเลือกรูปเติมทั้งสองฝั่ง, counter (x/3) ถูก.
4. **PhotoResult preview:** เห็น 4x6, ไม่ถูก crop.
5. **Save ลงเครื่อง:** `BonioBooth_{tx}_Frame.jpg` เป็น 4x6.
6. **Upload + เว็บ:** เปิดลิงก์ request-image (หน้า 4) + video (หน้า 5) → เห็น 4x6.
7. **Reprint เก่า:** ทดสอบ reprint ภาพ 2x6 เก่าจาก URL ผ่าน `RequestImage` → ยังปริ้น 4x6 ถูก (regression guard).
8. **Regression:** กรอบ 4x6/6x4 ปกติ (ไม่ใช่ cut) — ต้องไม่กระทบ.

---

## 6. ลำดับงานสำหรับ agent (Sonnet 5)

1. อ่าน/เข้าใจ pipeline: `image_processing.rs::compose_frame`, `video.rs::compose_frame_video`, `printer.rs` (dup block + needs_cut), `SlotSelection.tsx`, `PhotoResult.tsx`.
2. **printer.rs** — เปลี่ยน dup เป็น ratio-based idempotent (ทำก่อน เพราะเป็น safety net).
3. **image_processing.rs** — เพิ่ม dup ใน `compose_frame`.
4. ทดสอบ path ภาพนิ่ง (preview + print + save) ก่อน.
5. **video.rs** — เพิ่ม dup ใน `compose_frame_video`.
6. **SlotSelection.tsx** — render 2 คอลัมน์.
7. ตรวจ `PhotoResult.tsx` preview CSS.
8. รัน test plan ข้อ 5 ให้ครบ.

> PM/PO (ผม) จะ review diff ทุกขั้น เน้น: (a) ไม่ double-dup, (b) CUT driver คงอยู่, (c) data model ไม่ถูกแก้, (d) frameType ยังส่ง "2x6" ให้ printer.

---

## 7. Out of Scope
- ไม่แก้ backend/web repo (`bonio-booth-backend`, dashboard) — หน้า 4–5 ได้จาก composed image อัตโนมัติ.
- ไม่แก้ `FrameSelection` (หน้า 1 คงเลือกเป็น 2x6).
- ไม่แก้ data model / type / upload payload / pricing / quantity.
- ไม่แตะ debounce printer disconnect / shutdown logic.
