import type { PaymentOption } from "../config/paymentOptions";
import { PAYMENT_BRAND_PATHS, type PaymentBrand } from "../config/paymentBrandIcons";

interface Props {
  option: PaymentOption;
  color: string;
  size?: number;
}

/** Which brand mark stands for which Payment Option, where we have one. */
const BRAND_BY_OPTION: Partial<Record<PaymentOption, PaymentBrand>> = {
  alipay: "alipay",
  wechat_pay: "wechatPay",
  shopeepay: "shopeePay",
};

function BrandMark({ brand, color, size }: { brand: PaymentBrand; color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d={PAYMENT_BRAND_PATHS[brand]} fill={color} />
    </svg>
  );
}

/**
 * The glyph on a Payment Option button.
 *
 * Brand marks where we have them, a generic QR otherwise — which is honest rather than
 * unfortunate, since scanning is what the customer does with all of these and the name
 * beside the glyph says which app to open. Everything is drawn in the button's own text
 * colour so the row reads as one set instead of a strip of mismatched logos.
 */
export default function PaymentOptionIcon({ option, color, size = 48 }: Props) {
  const brand = BRAND_BY_OPTION[option];
  if (brand) {
    return <BrandMark brand={brand} color={color} size={size} />;
  }

  if (option === "coupon") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M4 6h16a1 1 0 0 1 1 1v2.2a2.8 2.8 0 0 0 0 5.6V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.2a2.8 2.8 0 0 0 0-5.6V7a1 1 0 0 1 1-1Z"
          stroke={color}
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M10 9.5v5" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (option === "qr_credit_card") {
    // The two networks the customer's card will carry, rather than a drawing of a card:
    // it answers "will mine work?" at a glance. They sit on one line so the pair reads as
    // a single icon in the same box every other option gets.
    const markSize = size * 0.82;
    return (
      <span style={{ display: "flex", alignItems: "center", gap: size * 0.06 }}>
        <BrandMark brand="visa" color={color} size={markSize} />
        <BrandMark brand="mastercard" color={color} size={markSize} />
      </span>
    );
  }

  // PromptPay, TrueMoney, Alipay+ — no mark on hand, and a QR is what they all are.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="7" height="7" rx="1.4" stroke={color} strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="1.4" stroke={color} strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.4" stroke={color} strokeWidth="1.8" />
      <path d="M14 14h3v3h-3zM19.5 14h1.5v1.5h-1.5zM14 19.5h1.5V21H14zM18 18h3v3h-3z" fill={color} />
    </svg>
  );
}
