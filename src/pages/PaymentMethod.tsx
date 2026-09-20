import { useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { ThemeData, MachineData } from "../App";
import BackButton from "../components/BackButton";
import Countdown from "../components/Countdown";
import ContextMenu from "../components/ContextMenu";
import { COUNTDOWN } from "../config/appConfig";
import { useContextMenu } from "../hooks/useContextMenu";
import { appLogger } from "../utils/appLogger";
import {
  PAYMENT_OPTION_COPY,
  getEnabledPaymentOptions,
  type PaymentOption,
} from "../config/paymentOptions";
import PaymentOptionIcon from "../components/PaymentOptionIcon";

const CTX = "[PaymentMethod]";

/**
 * How much room each card gets, chosen from how many there are to show.
 *
 * The screen is 720x1280 and nothing may scroll — a customer mid-purchase must see every
 * way to pay without discovering that the list moves. Cards therefore shrink instead:
 * three of them can afford the full treatment, seven cannot, and the hint line is the
 * first thing to go since it only matters for the codes not every app can read.
 */
type Density = "comfortable" | "compact" | "dense";

function densityFor(count: number): Density {
  if (count <= 3) return "comfortable";
  if (count <= 5) return "compact";
  return "dense";
}

const ICON_SIZE_BY_DENSITY: Record<Density, number> = {
  comfortable: 56,
  compact: 44,
  dense: 36,
};

interface Props {
  theme: ThemeData;
  machineData: MachineData;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
}

export default function PaymentMethod({
  theme,
  machineData,
  onFormatReset,
  onBeforeClose,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  const { showContextMenu, setShowContextMenu, handleContextMenu, handleTouchStart } =
    useContextMenu();

  const quantity = state.quantity || 1;
  const totalPrice = state.totalPrice || 0;

  const enabledOptions = getEnabledPaymentOptions(machineData);
  // Coupon is not a way to pay, it is a discount that leads to one, so it sits apart from
  // the cards — see the button at the bottom.
  const payOptions = enabledOptions.filter((option) => option !== "coupon");
  const hasCoupon = enabledOptions.includes("coupon");

  // What the backend actually sent, so a missing button can be traced to the machine's
  // workspace config without guessing which side dropped it.
  useEffect(() => {
    appLogger.info(
      CTX,
      `Payment options from backend: ${
        machineData.enabledPaymentOptions
          ? machineData.enabledPaymentOptions.join(", ")
          : "(none — falling back to isKsherEnabled)"
      } → showing: ${enabledOptions.join(", ")}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const density = densityFor(payOptions.length);
  const iconSize = ICON_SIZE_BY_DENSITY[density];

  const goToPayment = useCallback(
    (option: PaymentOption) => {
      const nextState = { ...state, quantity, totalPrice };

      if (option === "coupon") {
        navigate("/coupon-entry", { state: nextState });
        return;
      }

      // PaymentQR creates the payment, so it needs to know which rail to ask Ksher for.
      navigate("/payment-qr", { state: { ...nextState, paymentOption: option } });
    },
    [navigate, quantity, state, totalPrice],
  );

  /**
   * A booth with one way to pay and no coupon has nothing to choose, so this screen would
   * be a tap that teaches the customer nothing. Skip straight to the QR, replacing the
   * history entry so Back still goes to the quantity screen rather than bouncing here.
   */
  useEffect(() => {
    if (payOptions.length === 1 && !hasCoupon) {
      appLogger.info(CTX, `Only ${payOptions[0]} enabled — skipping the choice`);
      navigate("/payment-qr", {
        state: { ...state, quantity, totalPrice, paymentOption: payOptions[0] },
        replace: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBack = useCallback(() => {
    navigate("/payment-selection", { state: { ...state, quantity, totalPrice } });
  }, [navigate, quantity, state, totalPrice]);

  const handleCountdownComplete = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const buttonTextColor = theme.textButtonColor || "#fff";

  return (
    <div
      className="page-container"
      style={{ backgroundImage: `url(${theme.backgroundSecond})` }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
    >
      <BackButton onBackClick={handleBack} />

      <Countdown
        seconds={COUNTDOWN.SELECT_PRINT.DURATION}
        onComplete={handleCountdownComplete}
        visible={COUNTDOWN.SELECT_PRINT.VISIBLE}
      />

      <div className="page-content" style={{ gap: 28, padding: "0 40px" }}>
        <div style={{ textAlign: "center" }}>
          <h1 className="title-thai" style={{ color: theme.fontColor }}>
            เลือกวิธีชำระ
          </h1>
          <p className="title-english" style={{ color: theme.fontColor }}>
            SELECT PAYMENT METHOD
          </p>
        </div>

        {/* What they are paying for, so nobody has to go back to check */}
        <div className="payment-method-summary" style={{ color: theme.fontColor }}>
          <span>{quantity} รูป</span>
          <span className="payment-method-summary-dot">·</span>
          <span className="payment-method-summary-price">{totalPrice}</span>
          <span className="payment-method-summary-unit">THB</span>
        </div>

        <div className={`payment-method-list payment-method-list-${density}`}>
          {payOptions.map((option) => {
            const copy = PAYMENT_OPTION_COPY[option];

            return (
              <button
                key={option}
                onClick={() => goToPayment(option)}
                className={`payment-method-card payment-method-card-${density}`}
                style={{
                  background: theme.primaryColor,
                  border: `2px solid ${theme.primaryColor}`,
                  color: buttonTextColor,
                }}
              >
                <span className="payment-method-card-icon">
                  <PaymentOptionIcon option={option} color={buttonTextColor} size={iconSize} />
                </span>
                <span className="payment-method-card-copy">
                  <span className="payment-method-card-name">{copy.nameThai}</span>
                  <span className="payment-method-card-sub">{copy.name}</span>
                  {density !== "dense" && copy.hint && (
                    <span className="payment-method-card-hint">{copy.hint}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/*
         * Coupon keeps the quieter treatment from option B — outlined instead of filled —
         * so it never competes with the ways to actually pay. Solid border, not dashed:
         * dashes read as a placeholder for something not built yet.
         */}
        {hasCoupon && (
          <button
            onClick={() => goToPayment("coupon")}
            className="payment-method-coupon"
            style={{
              border: `2px solid ${theme.primaryColor}`,
              color: theme.primaryColor,
            }}
          >
            <PaymentOptionIcon option="coupon" color={theme.primaryColor} size={28} />
            <span>{PAYMENT_OPTION_COPY.coupon.nameThai} · Discount Coupon</span>
          </button>
        )}
      </div>

      <ContextMenu
        open={showContextMenu}
        onClose={() => setShowContextMenu(false)}
        onFormatReset={onFormatReset}
        onBeforeClose={onBeforeClose}
      />
    </div>
  );
}
