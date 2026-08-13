/**
 * Countdown Config in seconds
 */
export const COUNTDOWN = {
  GET_HELP: {
    DURATION: 300,
    VISIBLE: false,
  },
  TERMS_AND_SERVICES: {
    DURATION: 300,
    VISIBLE: false,
  },
  DISCOUNT_COUPON: {
    DURATION: 300,
    VISIBLE: false,
  },
  PAYMENT_QR: {
    DURATION: 300,
    VISIBLE: true, // not used
  },
  SELECT_PRINT: {
    DURATION: 300,
    VISIBLE: true,
  },
  FRAME_SELECTION: {
    DURATION: 300,
    VISIBLE: true,
  },
  SLOT_SELECTION: {
    DURATION: 300,
    VISIBLE: true,
  },
  PHOTO_PREPARE: {
    DURATION: 300,
    VISIBLE: true,
  },
  PHOTO_DECORATE: {
    DURATION: 300,
    VISIBLE: true,
  },
  PHOTO_FILTER: {
    DURATION: 300,
    VISIBLE: true,
  },
  PHOTO_RESULT: {
    DURATION: 300,
    VISIBLE: true,
  },
  REQUEST_IMAGE: {
    DURATION: 600,
    VISIBLE: true,
  },
};

/**
 * Refetch machine data Interval Config in seconds
 */
export const REFETCH_INTERVAL = {
  HOME: 10,
  SYSTEM_MAINTENANCE: 10,
  OUT_OF_PAPER: 10,
};

/**
 * Default PIN values (used when user has not configured custom PIN yet)
 */
export const DEFAULT_MENU_PIN = "7053";
export const DEFAULT_CLOSE_APP_PIN = "7053";

/**
 * Local storage keys for custom PIN values
 */
export const PIN_STORAGE_KEYS = {
  MENU_PIN: "menuPin",
  CLOSE_APP_PIN: "closeAppPin",
} as const;

const isValidPin = (value: string | null): value is string => {
  return !!value && /^\d{4}$/.test(value);
};

export const getMenuPin = (): string => {
  const savedPin = localStorage.getItem(PIN_STORAGE_KEYS.MENU_PIN);
  return isValidPin(savedPin) ? savedPin : DEFAULT_MENU_PIN;
};

export const setMenuPin = (pin: string): void => {
  if (!/^\d{4}$/.test(pin)) return;
  localStorage.setItem(PIN_STORAGE_KEYS.MENU_PIN, pin);
};

export const getCloseAppPin = (): string => {
  const savedPin = localStorage.getItem(PIN_STORAGE_KEYS.CLOSE_APP_PIN);
  return isValidPin(savedPin) ? savedPin : DEFAULT_CLOSE_APP_PIN;
};

export const setCloseAppPin = (pin: string): void => {
  if (!/^\d{4}$/.test(pin)) return;
  localStorage.setItem(PIN_STORAGE_KEYS.CLOSE_APP_PIN, pin);
};

/**
 * เปิด = true: ไม่ขึ้น maintenance เมื่อไม่เจอกล้อง/เครื่องปริ้น (ใช้เทสต่อเนื่องได้)
 * ปิด = false: ขึ้น maintenance เมื่อไม่เจออุปกรณ์ (โหมดใช้งานจริง)
 */
export const DEVICE_CHECK = {
  /** true = ข้าม maintenance เมื่อไม่เจอกล้อง/ปริ้น (สำหรับเทส) */
  ALLOW_TEST_WITHOUT_DEVICES: false,
};

/**
 * ตู้พิเศษ (A4 / กระดาษปกติ) ไม่ให้ลูกค้าเลือกฟิลเตอร์ —
 * ข้ามหน้า "Decorate your photo" แล้วบังคับใช้ฟิลเตอร์ตัวนี้ตัวเดียวเสมอ
 *
 * ค่าต้องตรงกับ `id` ใน src/config/filters.ts
 * ตั้งเป็น null = กลับไปใช้หน้าเลือกฟิลเตอร์ตามเดิม
 */
export const FORCED_FILTER_ID: string | null = "bw";

/**
 * ตู้พิเศษ (A4 / กระดาษปกติ) พิมพ์เต็มแผ่นไม่เหลือขอบ
 *
 * เปิดแล้วฝั่ง Rust จะ:
 *   - วาดลงขนาดกระดาษจริง (PHYSICALWIDTH/HEIGHT) แทนพื้นที่ที่พิมพ์ได้
 *   - ขยายรูปแบบ cover (ยอมให้ล้นออกนอกกระดาษ) แทนการย่อให้เห็นทั้งรูป
 *   - ข้าม logic ตัดกระดาษ 2x6/6x2 ทั้งหมด (ตู้นี้ไม่มีเครื่องตัด)
 *
 * เครื่องพิมพ์ที่ไม่รองรับ borderless จะยังเหลือขอบบางๆ ตามที่ฮาร์ดแวร์บังคับ
 * (ดูค่า hardware margin ได้จาก log "[Printer] Borderless: ...")
 */
export const BORDERLESS_PRINT = true;
