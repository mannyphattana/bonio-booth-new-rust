import { PAYMENT_OPTION_COPY, type PaymentOption } from "../config/paymentOptions";
import PaymentOptionIcon from "./PaymentOptionIcon";

/**
 * How much room each card gets, chosen from how many there are to show.
 *
 * The screen is 720x1280 and nothing may scroll — a customer mid-purchase must see every
 * way to pay without discovering that the list moves. Cards therefore shrink instead.
 */
export type PaymentCardDensity = "comfortable" | "compact" | "dense";

interface Props {
  option: PaymentOption;
  density: PaymentCardDensity;
  iconSize: number;
  background: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
  /** Replaces the title while this card's payment is being created. */
  busyLabel?: string;
}

/**
 * One way to pay: the rail's glyph, its name, what to do in English, and the same in Thai.
 * Shared by the payment screen and the Print Again modal so a customer who paid one way
 * the first time finds the same card the second time.
 */
export default function PaymentMethodCard({
  option,
  density,
  iconSize,
  background,
  color,
  onClick,
  disabled = false,
  busyLabel,
}: Props) {
  const copy = PAYMENT_OPTION_COPY[option];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`payment-method-card payment-method-card-${density}`}
      style={{
        background,
        border: `2px solid ${background}`,
        color,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {/* A fixed-width slot, so every card's text starts at the same line even though the
          card networks' glyph is about twice as wide as the others. */}
      <span className="payment-method-card-icon" style={{ width: iconSize * 1.9 }}>
        <PaymentOptionIcon option={option} color={color} size={iconSize} />
      </span>
      <span className="payment-method-card-copy">
        <span className="payment-method-card-name">{busyLabel ?? copy.name}</span>
        {/* Seven cards at once leave room for two lines, not three. Thai stays: it is what
            most customers read. */}
        {density !== "dense" && <span className="payment-method-card-sub">{copy.sub}</span>}
        <span className="payment-method-card-thai">{copy.thai}</span>
      </span>
    </button>
  );
}
