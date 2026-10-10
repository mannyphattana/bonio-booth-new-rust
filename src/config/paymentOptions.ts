import type { MachineData } from "../App";

/**
 * Payment Options — the choices a customer can make on the payment screen.
 *
 * The backend decides which ones this booth offers (configured per workspace) and sends
 * them in the init response. This file only knows how to read that list and what to
 * print on the buttons.
 */
export type PaymentOption =
  | "coupon"
  | "promptpay"
  | "qr_credit_card"
  | "alipay"
  | "wechat_pay"
  | "alipay_plus"
  | "shopeepay";

/** What a booth offered before Payment Options existed — used for older backends. */
const LEGACY_OPTIONS_WITH_KSHER: PaymentOption[] = ["coupon", "promptpay"];
const LEGACY_OPTIONS_WITHOUT_KSHER: PaymentOption[] = ["coupon"];

// Order here is the order the buttons appear in. Thai rails first: they are what almost
// every customer uses, and a booth in a tourist spot can turn the others on per workspace.
const ALL_OPTIONS: PaymentOption[] = [
  "coupon",
  "promptpay",
  "qr_credit_card",
  "alipay",
  "alipay_plus",
  "wechat_pay",
  "shopeepay",
];

/**
 * What each Payment Option says, on its card and on its QR screen.
 *
 * English leads and Thai follows, as on the rest of the booth's screens: the name of the
 * rail on top, what to do with it in English underneath, then both again in Thai.
 */
export interface PaymentOptionCopy {
  /** Card title and QR-screen title. */
  name: string;
  /** Card: what the customer does, in English. */
  sub: string;
  /** Card: the Thai line under it. */
  thai: string;
  /** QR screen: the English instruction under the title. */
  scan: string;
  /** QR screen: the Thai instruction under that. */
  scanThai: string;
  /**
   * QR screen: which cards or wallets the code works with. It belongs where a customer
   * who cannot scan is standing with their phone out, not on the card, where it would
   * crowd out the other ways to pay.
   */
  accepts?: { en: string; th: string };
}

export const PAYMENT_OPTION_COPY: Record<PaymentOption, PaymentOptionCopy> = {
  coupon: {
    name: "Discount Coupon",
    sub: "Enter your coupon code",
    thai: "ใช้คูปองส่วนลด",
    scan: "SCAN TO PAY",
    scanThai: "สแกนจ่ายได้เลย!",
  },
  promptpay: {
    name: "PromptPay",
    sub: "Scan with any banking app",
    thai: "พร้อมเพย์ · สแกนด้วยแอปธนาคารได้ทุกธนาคาร",
    scan: "SCAN WITH ANY BANKING APP",
    scanThai: "สแกนจ่ายด้วยแอปธนาคารได้ทุกธนาคาร",
  },
  qr_credit_card: {
    name: "QR Credit",
    // Says "scan" before "credit card" because UAT found customers did not read this
    // button as something to scan at all — they were looking for a slot to insert a card.
    sub: "Scan QR, then pay by credit card",
    thai: "บัตรเครดิต · สแกน QR แล้วตัดบัตรในแอปธนาคาร",
    scan: "SCAN WITH YOUR BANKING APP",
    scanThai: "สแกนด้วยแอปธนาคาร แล้วเลือกตัดบัตรเครดิต",
    accepts: {
      en: "Accepted cards: KTC · KBank · Krungsri · First Choice",
      th: "รองรับบัตรเครดิต KTC · กสิกรไทย · กรุงศรี · เฟิร์สช้อยส์",
    },
  },
  // Wallets for foreign visitors. The English line keeps each wallet's own name, including
  // the Chinese one: someone who can pay with it reads that name, and a Thai customer
  // needs no translation to see it is not for them.
  alipay: {
    name: "Alipay",
    sub: "Scan with Alipay 支付宝",
    thai: "อาลีเพย์ · สแกนด้วยแอป Alipay",
    scan: "SCAN WITH ALIPAY 支付宝",
    scanThai: "สแกนด้วยแอป Alipay",
  },
  wechat_pay: {
    name: "WeChat Pay",
    sub: "Scan with WeChat 微信支付",
    thai: "วีแชทเพย์ · สแกนด้วยแอป WeChat",
    scan: "SCAN WITH WECHAT 微信支付",
    scanThai: "สแกนด้วยแอป WeChat",
  },
  alipay_plus: {
    name: "Alipay+",
    sub: "Alipay · GCash · Kakao Pay · TrueMoney · Touch 'n Go",
    thai: "อาลีเพย์ พลัส · วอลเล็ตต่างประเทศ",
    scan: "SCAN WITH YOUR WALLET APP",
    scanThai: "สแกนด้วยแอปวอลเล็ตของคุณ",
    accepts: {
      en: "Alipay · GCash · Kakao Pay · TrueMoney · Touch 'n Go",
      th: "รองรับวอลเล็ตในเครือ Alipay+",
    },
  },
  shopeepay: {
    name: "ShopeePay",
    sub: "Scan with the Shopee app",
    thai: "ช้อปปี้เพย์ · สแกนด้วยแอป Shopee",
    scan: "SCAN WITH THE SHOPEE APP",
    scanThai: "สแกนด้วยแอป Shopee",
  },
};

/**
 * Which Payment Options this booth should show.
 *
 * Falls back to the pre-Payment-Options behaviour when the backend does not send a list,
 * so a booth pointed at an older backend keeps taking money exactly as it did.
 */
/** Narrows whatever arrived on navigation state to a Payment Option we know. */
export function toPaymentOption(value: unknown): PaymentOption | null {
  return typeof value === "string" && value in PAYMENT_OPTION_COPY
    ? (value as PaymentOption)
    : null;
}

export function getEnabledPaymentOptions(machineData: MachineData): PaymentOption[] {
  const fromBackend = machineData.enabledPaymentOptions;

  if (Array.isArray(fromBackend)) {
    const enabled = new Set(fromBackend);
    return ALL_OPTIONS.filter((option) => enabled.has(option));
  }

  return machineData.isKsherEnabled ? LEGACY_OPTIONS_WITH_KSHER : LEGACY_OPTIONS_WITHOUT_KSHER;
}

export function isPaymentOptionEnabled(
  machineData: MachineData,
  option: PaymentOption,
): boolean {
  return getEnabledPaymentOptions(machineData).includes(option);
}

/** The Payment Options that can settle a bill on their own (i.e. not Coupon). */
export function getPayableOptions(machineData: MachineData): PaymentOption[] {
  return getEnabledPaymentOptions(machineData).filter((option) => option !== "coupon");
}
