ช่วย Init project rust + react tauri ให้หน่อย โดยจะเป็น project photobooth ชื่อ bonio-booth-new-rust โดยให้ทำตามคำแนะนำนี้
0. เข้าโปรแกรมครั้งแรกต้องให้ส่ง machineId เพื่อ verify machine ครับ คุณสามารถดู api docs ได้ที่ https://api-booth.boniolabs.com/api/docs#/
    - ดูในส่วนของ machines-public ให้ยิง verify ก่อน verify เสร็จสิ้นให้ยิง init ต่อ
1. มีหน้า home ให้คลิกตรงไหนก็ได้เพื่อเริ่มต้นโดยที่ ดูจากข้อมูลจาก API docs ส่วนของ machines-public theme
    {
        "_id": "69247c9602dd728488995e3c",
        "machineName": "M-02",
        "siteName": "999s",
        "serialNumber": "x89-398249203",
        "location": "123",
        "status": "offline",
        "softwareVersion": 1,
        "paperLevel": 125,
        "setTimer": "disabled",
        "cameraCountdown": 5,
        "isMaintenanceMode": false,
        "createdBy": null,
        "lastUpdate": "2026-02-15T06:20:25.151Z",
        "createdAt": "2025-11-24T15:41:10.038Z",
        "updatedAt": "2026-02-15T06:20:28.606Z",
        "__v": 0,
        "localIpAddress": "49.230.44.37",
        "localPort": 33331,
        "prices": [
            {
                "quantity": 1,
                "price": 10,
                "_id": "698e02bfcf3dec3da5b7539c"
            },
            {
                "quantity": 2,
                "price": 2,
                "_id": "698e02bfcf3dec3da5b7539d"
            },
            {
                "quantity": 3,
                "price": 3,
                "_id": "698e02bfcf3dec3da5b7539e"
            },
            {
                "quantity": 4,
                "price": 4,
                "_id": "698e02bfcf3dec3da5b7539f"
            },
            {
                "quantity": 5,
                "price": 50000,
                "_id": "698e02bfcf3dec3da5b753a0"
            }
        ],
        "tuyaDeviceId": "a390d58c10e3bb853bg60j",
        "isActive": true,
        "machineType": "pc",
        "period": {
            "startTime": "10:20",
            "endTime": "04:57"
        },
        "isDisabledNotification": true,
        "theme": {
            "_id": "694a541bb4af84a5dd6c2c73",
            "name": "Timelab",
            "code": "Timelab01",
            "background": "https://sgp1.digitaloceanspaces.com/boniolabs/themes/7b6b10a9-33f4-4d4e-a4e5-600c3376534c.png",
            "backgroundSecond": "https://sgp1.digitaloceanspaces.com/boniolabs/themes/1e467f92-4236-4341-884a-fa983d1674cc.png",
            "primaryColor": "#dd3334",
            "fontColor": "#dd3334",
            "textButtonColor": "#ffffff",
            "frames": [],
            "isActive": true,
            "createdBy": "693eaae0b2c6369250474d76",
            "createdAt": "2025-12-23T08:34:35.974Z",
            "updatedAt": "2025-12-23T08:54:39.140Z",
            "__v": 0
        },
        "workspace": {
            "paperAlertThreshold": 20,
            "telegramNotificationEnabled": true,
            "_id": "6924782002dd728488995d64",
            "name": "Timelabs02",
            "code": "0002",
            "createdBy": "6923420e3c1afa8a8cc1f0d9",
            "isActive": true,
            "totalRevenue": 0,
            "createdAt": "2025-11-24T15:22:08.678Z",
            "updatedAt": "2026-01-24T17:00:24.235Z",
            "__v": 0,
            "encryptedKsherPrivateKey": "Wl800mmlZXiccwESzv/aGZ6xTuziuJF3mWxx3zEK3gt821+iYpaPWNub2HeMrJjoOR620tLwtllSIhks0YA/7gmVkr3AyoPfuQZbFpCExsmoB77KieVA93y1OEcX19EJwD2asEToAh2Dzxfp1gHIJraW0FsTzu0zn6xyC8NplnBvXUULnNL051edBiwtUCyb/e7V1nUDQunQNkENjW2hsyQKJF+4IBqPj9K27VpBkjVf9g6k3yVm/u+3fGiMlIDI/1h6n4TlYc2wxve6ZY81vhJFP524BRt0aXPG13iMywQg5LGD1jYkqDBCjrFTEp+l+I1plxX0TpV8MznkkIvR5SCv5owgt7iHdX30B9ZTI2hVnvbrU3Q3coNARZNdnueg8Z9zxdQg/nDzVYl8jOxeSoQICgl0pDpCBnM8Lxy38nHeSfptLGi8hde1h/qnOpUt1+VnVTR5rrCs7IlKwXPQS72A+YaWoyWAIcofZODqroS0xO1DYFvi94ZsKqidrNGQwseUV09IaHLZuxanPtbPcLulsT0MoG2qEmq1Fce6iWD9sOW3pLJJ6HYNKuHSsc6R4CUz0fiSox+qbnMSmt2JfJ/v+7DlOyobYBdQA17bxwaa7pW8ZPK0K+ah8f0uL/hjr5hDEAXqIHbPAfvZ0L9REhETfnhB1fqmHV8OPRX4+rv8He9ErwzUrjc4iF1LPDiown5QZokErcaX6jLgIROfnOezpA2h37ufWe5LlsbrAPkS5sKTNTkRx08myN1q3SiIOjiuaj2skfo0cvv0XJcFhZgCGLX+/NZOPzOKRhclWuv+Jffc+zyVCuYLiIhNCpv5aR7zx/HPzhlNlsTboSTp/yqseQBe7VNejRsPmoc6lEj2hCovezv4WFNqZic+4pcDhujUCfvc3vHwjzOK4mjeYBRNkIhCkpQdsyvQTUdXQ4qsMWTiP+Vr/wN8hmw5CTl4aKQlKM0m+ViSFAaccxiopyd0If3CJqPdK+ISED4HWfejjyZ74oQ6QjpAgiNI5TmTewgJHZJKdm2qJ9kf+ckZt/AMjm8k0pOD/OYmdYvnpYQdaBoalsNAmgnneqR0I4MS0FBYs/3P3FByKCs1A+wlcscOnldkAHtua16FfL369DCsoJ9YfT91K+JLuVwzWWgiAXV/CbWJSxdqHqcwzVeN+60scbd50bHxTB3Un52Vig==|xlRkmH3QNORoBxMo|Eix1n2+C6uP0iyhAfi5TUg==",
            "ksherAppId": "mch37500",
            "ksherPrivateKeyEncryptedAt": "2025-12-10T11:28:06.374Z",
            "lineUrl": "https://lin.ee/jLEB8RM"
        },
        "frames": [
            "69410abd4df79109ef847b7b",
            "69329ed2cb8ff4ab1986879a",
            "69329be2cb8ff4ab1986865f",
            "69329d93cb8ff4ab19868712",
            "69418017f9d28ff88a1eb114",
            "69313816fdac7e1ef954255b",
            "693297f1cb8ff4ab198684bb",
            "694a56c6b4af84a5dd6c30b2",
            "694a4de2b4af84a5dd6c1ea1",
            "69750bc6e12ca9d66d7269ab",
            "694a4ed8b4af84a5dd6c1fe3",
            "694a5b83b4af84a5dd6c3599",
            "694a5ca2b4af84a5dd6c3658",
            "6957c8f27abb5a7d71ee4f91",
            "694a44f5b4af84a5dd6c1611",
            "698206419ca8a4c885f4cd5d",
            "694a566bb4af84a5dd6c3064",
            "694a49f2b4af84a5dd6c1b77",
            "694a5263b4af84a5dd6c2afd",
            "694a55cfb4af84a5dd6c3016",
            "694a55adb4af84a5dd6c2feb",
            "694a60d9b4af84a5dd6c3a92",
            "694a61a6b4af84a5dd6c3b07",
            "694aab7db4af84a5dd6cdcef",
            "694ab985b4af84a5dd6cefcd"
        ],
        "paperPosition": null
    }
    - ต่อ theme apply background สำหรับหน้า HOME และหลังจากหน้า HOME ให้ใช้ backgroundSecond และสิ่งที่มีผลกับระบบจะเป็น primaryColor, fontColor, textButtonColor

2. หน้า paymentSelection ให้เลือกว่าจะจ่ายผ่าน QRCODE หรือ COUPON
    - COUPON ให้เป็นหน้ามี ON-SCREEN KEYBOARD และกดใส่โค้ด แล้วมีช่องแสดงโค้ดบนหน้าจอด้วย โดยดูจาก API docs แล้วลองดู coupon/check, coupon/use ถ้าสำเร็จ ให้ไปหน้าต่อไป
    - QRCODE ใช้ /api/machines-public/payment/create และ /api/machines-public/payment/status/{mchOrderNo} ถ้าสำเร็จให้ไปหน้าต่อไป

3. หน้า frameSelection ดึง /api/machines-public/frames มาและแสดงรูปตัวอย่าง โดยจะมี 2 ส่วน เป็น vertical ส่วนบนให้แสดง frames ตัวอย่างขนาดเล็กเป็น scollable เมื่อกดเลือก ให้แสดง frame นั้นๆในขนาดปกติด้านล่าง เมื่อเลือกเสร็จกด NEXT เพื่อเข้าหน้า prepareShooting

4. prepareShooting [text](../bonio-booth/src/renderer/components/photoprepare/PhotoPrepare.tsx) ให้ดูโค้ดจากที่นี่ครับ ลอกมาเลยก็ได้ ในนี้เราจะ set ค่า countdown timer ลงไปใน text วิเคราะห์จากไฟล์ข้างต้นได้เลย

5. mainShooting ให้แสดงกล้องตรงกลาง และโชว์รูป preview ที่เราถ่ายใว้บริเวณด้านล่าง
    - ให้ดึง countdown จาก api ตอน init ชื่อ object cameraCountdown นับถอยหลังตามนั้น
    - ระหว่างนับถอยหลังจะมี flow webcam ตามนี้
        - countdown 3 วิ ระหว่าง countdown ให้ถ่าย video ไปด้วย และหลัง countdown จบแล้วให้หยุดถ่าย video และถ่ายภาพแทน และแสดง pewview ด้านล่าง
        - countdown 5 วิ ระหว่าง countdown ให้ถ่าย video ไปด้วย แต่ถ่ายตอน 3 วิ เช่น 5-4-3(เริ่มถ่าย)-2-1(หยุดถ่ายตอนหยุด countdown)-ถ่ายรูป และแสดง pewview ด้านล่าง
        - countdown 10 วิ ระหว่าง countdown ให้ถ่าย video ไปด้วย แต่ถ่ายตอน 3 วิ เช่น 10-9-...-5-4-3(เริ่มถ่าย)-2-1(หยุดถ่ายตอนหยุด countdown)-ถ่ายรูป และแสดง pewview ด้านล่าง
    - ระหว่างนับถอยหลังจะมี flow DSLR CANON ตามนี้
        - countdown 3 วิ ระหว่าง countdown ให้ถ่าย video live view ไปด้วย และหลัง countdown จบแล้วให้หยุดถ่าย video และถ่ายภาพแทน และแสดง pewview ด้านล่าง
        - countdown 5 วิ ระหว่าง countdown ให้ถ่าย video live view ไปด้วย แต่ถ่ายตอน 3 วิ เช่น 5-4-3(เริ่มถ่าย)-2-1(หยุดถ่ายตอนหยุด countdown)-ถ่ายรูป และแสดง pewview ด้านล่าง
        - countdown 10 วิ ระหว่าง countdown ให้ถ่าย video live view ไปด้วย แต่ถ่ายตอน 3 วิ เช่น 10-9-...-5-4-3(เริ่มถ่าย)-2-1(หยุดถ่ายตอนหยุด countdown)-ถ่ายรูป และแสดง pewview ด้านล่าง
    - การถ่ายรูปจะถ่ายตามจำนวนรูปที่อยู่ใน frame เช่น เลือก frame ที่มี slots 6 slots จะต้องถ่ายรูป 6 + 2 ครั้งเสมอ คือ x slots + 2
    - เก็บ object แบบ ถ้ามีการถ่าย 6 + 2 ให้นับเป็น captures
        - 1 capture ประกอบด้วย รูป original, video/video live view ถ้า 6 + 2 จะได้ทั้งหมด 8 captures

6. slotSelection นำ captures ทั้งหมดที่ได้ให้ user เลือกว่าจะใส่ capture ไหนลง slot อะไร
    - ถ้าเรามีการเก็บข้อมูล frame ที่เลือกใว้ จะมีส่วนของ grid ในนั้นจะมี slot อยู่ "slots": [
        {
        "x": 100,
        "y": 200,
        "width": 500,
        "height": 600,
        "radius": 10,
        "zIndex": 1
        },
        {
        "x": 700,
        "y": 200,
        "width": 500,
        "height": 600,
        "radius": 10,
        "zIndex": 1
        }
    ] x y คือตำแหน่ง w h คือขนาดของรูปที่จะใส่ลงกรอบ radius คือความโค้งของรูป z-index จะบอกว่ารูปที่จะใส่ลงกรอบ จะอยู่บนกรอบหรือใต้กรอบ
    - ถ้า frame มี 6 slot ให้ User เลือกรูปได้แค่ 6 รูป โดยกดรูปไหนก็ตาม จะเซ็ทรูปเรียงจาก slot แรกไป ถ้า user กดที่รูปที่เลือกไปแล้ว ให้เอารูปนั้นออกจาก frame แล้วเลื่อนรูปที่อยู่ slot ต่อไป ขึ้นมาแทนที่
    - ถ้าเลือก captures ลง frame แล้ว ให้เลือก video ใน capture นั้นลง frame ด้วย โดยใน step สุดท้าย เราจะส่งทั้งรูปใน frame และ video ใน frame upload ให้ผู้ใช้

7. applyFilter ให้เลือกได้ เป็น scrollable เหมือน หน้า frameSelection แสดงตัวอย่าง filter ด้านบน โดยใช้รูปจาก captures แรก มาเป็น preview แบบไม่ติด filter และติด filter โดยให้ตัวเลือกแรกเป็น ไม่ใส่ filter โดยให้แสดงรูปจาก captures แรกที่เลือกลง frame มาแสดงตรงกลางหน้าจอด้วย โดย filter file คือ lut file จะอยู่ใน C:\Users\User\Documents\GitHub\bonio-booth-new-rust\filters
    - ตัวเลือกไม่ใส่ filter apply no filter show original photo
    - เลือก filter จาก List ให้ apply ใส่รูปแรกและแสดงกลางหน้าจอถึงการเปลี่ยนแปลง
    - กดถัดไป ให้ apply filter (ถ้าเลือก) ลงใน video ด้วย โดย apply เฉพาะ video ที่ใส่ลง frame ไม่ apply filter ลง frame

8. photoResult ให้แสดงรูป final process ที่อยู่ในกรอบและใส่ filter แล้ว (ถ้ามี) ตรงกลางหน้าจอ และถัดมาข้างล่างให้ gen qr code และอัพโหลดรูปทั้งหมดที่อยู่ใน frame (original photo ที่ apply filter แล้วเท่านั้น) และ framePhoto (รูปที่ apply filter แล้วและอยู่ใน frame) และ อัพโหลดตัว video (เฉพาะที่อยู่ใน frame และ apply filter แล้ว) โดยที่
    - frame video ต้องมีระยะเวลา 9 วินาที โดยจาก mainShooting เราจะได้ video/live-view เวลา 3 วิมา ให้ loop ซ้ำ 3 รอบ ให้เป็น 9 วิ และ apply filter ส่งให้ลูกค้า ระยะเวลา video ต้อง 9 วิเป้ะนะครับ
    - ปริ้นรูป frame photo (รูปที่อยู่ใน frame และ apply filter แล้ว)

***ถ้าสงสัยหน้าไหนให้คุณตรวจสอบในโปรเจ็ค C:\Users\User\Documents\GitHub\bonio-booth

**** กล้องจะมีทั้ง webcam และ canon eos r50 โดยการควบคุมกล้อง canon ให้ใช้ C:\Users\User\Documents\GitHub\bonio-booth-new-rust\EDSDK edsdk ในนี้ครับ

***** ทำ context menu หน้าแรกให้เลือกว่าจะใช้ webcam หรือ canon ได้ด้วยก็จะดี

****** โปรเจ็คนี้มีการใช้เครื่องปริ้น โดยจะเป็นรุ่น QW-410 DNP มีการตัดกระดาษได้ โดยกระดาษที่ใช้ default จะเป็น 4ป6 ถ้า frame ที่เลือกมาเป็น 2x6 ต้องให้เครื่องปริ้นตัดกระดาษ แต่ถ้าเป็น 4x6/6x4 ไม่ต้องตัด

******* ถ้าระหว่างนี้เครื่องปริ้นหรือกล้องถูกถอดออก ให้แจ้ง error และกลับหน้าแรกทันที