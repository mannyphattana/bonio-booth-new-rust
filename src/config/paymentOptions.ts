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

export const PAYMENT_OPTION_COPY: Record<
  PaymentOption,
  { action: string; nameThai: string; name: string; hint?: string }
> = {
  coupon: { action: "ใช้", nameThai: "ใช้คูปองส่วนลด", name: "Discount Coupon" },
  promptpay: {
    action: "ชำระเงินผ่าน",
    nameThai: "พร้อมเพย์",
    name: "PromptPay",
    hint: "สแกนด้วยแอปธนาคารได้ทุกธนาคาร",
  },
  qr_credit_card: {
    action: "สแกนจ่ายด้วยบัตรเครดิต",
    // Leads with the verb, in English, because UAT found customers did not read this
    // button as something to scan at all — they were looking for a slot to insert a card.
    nameThai: "SCAN TO PAY BY CARD",
    name: "QR Credit Card · Visa / Mastercard",
    // Which apps can read the code belongs on the QR screen, where a customer who cannot
    // scan it is standing. Here it would crowd out the other ways to pay.
  },
  // Wallets for foreign visitors. The Latin line keeps each wallet's own name, including
  // the Chinese one: someone who can pay with it reads that name, and a Thai customer
  // needs no translation to see it is not for them.
  alipay: { action: "สแกนจ่ายด้วย", nameThai: "อาลีเพย์", name: "Alipay 支付宝" },
  wechat_pay: { action: "สแกนจ่ายด้วย", nameThai: "วีแชทเพย์", name: "WeChat Pay 微信支付" },
  alipay_plus: {
    action: "สแกนจ่ายด้วย",
    nameThai: "อาลีเพย์ พลัส",
    name: "Alipay+",
    hint: "Alipay · GCash · Kakao Pay · TrueMoney · Touch 'n Go",
  },
  shopeepay: { action: "สแกนจ่ายด้วย", nameThai: "ช้อปปี้เพย์", name: "ShopeePay" },
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
