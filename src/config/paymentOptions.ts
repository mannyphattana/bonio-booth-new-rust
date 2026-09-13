import type { MachineData } from "../App";

/**
 * Payment Options — the choices a customer can make on the payment screen.
 *
 * The backend decides which ones this booth offers (configured per workspace) and sends
 * them in the init response. This file only knows how to read that list and what to
 * print on the buttons.
 */
export type PaymentOption = "coupon" | "promptpay" | "qr_credit_card";

/** What a booth offered before Payment Options existed — used for older backends. */
const LEGACY_OPTIONS_WITH_KSHER: PaymentOption[] = ["coupon", "promptpay"];
const LEGACY_OPTIONS_WITHOUT_KSHER: PaymentOption[] = ["coupon"];

const ALL_OPTIONS: PaymentOption[] = ["coupon", "promptpay", "qr_credit_card"];

export const PAYMENT_OPTION_COPY: Record<
  PaymentOption,
  { action: string; name: string; hint?: string }
> = {
  coupon: { action: "ใช้", name: "Discount Coupon" },
  promptpay: { action: "ชำระเงินผ่าน", name: "QR Payment" },
  qr_credit_card: {
    action: "สแกนจ่ายด้วยบัตรเครดิต",
    name: "QR Credit Card",
    // A QR Credit Card is only readable by some bank apps, unlike PromptPay which every
    // app can scan. Saying so on the button is what stops a customer picking it, failing
    // to scan, and waiting out the timeout.
    hint: "SCB EASY · K PLUS · KTC Mobile · U CHOOSE · Bangkok Bank",
  },
};

/**
 * Which Payment Options this booth should show.
 *
 * Falls back to the pre-Payment-Options behaviour when the backend does not send a list,
 * so a booth pointed at an older backend keeps taking money exactly as it did.
 */
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
