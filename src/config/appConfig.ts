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
 * เปิด = true: ไม่ขึ้น maintenance เมื่อไม่เจอกล้อง/เครื่องปริ้น (ใช้เทสต่อเนื่องได้)
 * ปิด = false: ขึ้น maintenance เมื่อไม่เจออุปกรณ์ (โหมดใช้งานจริง)
 */
export const DEVICE_CHECK = {
  /** true = ข้าม maintenance เมื่อไม่เจอกล้อง/ปริ้น (สำหรับเทส) */
  ALLOW_TEST_WITHOUT_DEVICES: false,
};
