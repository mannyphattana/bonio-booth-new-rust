import { useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { ThemeData, MachineData } from "../App";
import BackButton from "../components/BackButton";
import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
}

export default function PaymentSelection({ theme, machineData, onFormatReset, onBeforeClose }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  const { showContextMenu, setShowContextMenu, handleContextMenu, handleTouchStart } = useContextMenu();

  const selectedQuantity = state.quantity || 1;

  // 🚨 [จุดที่แก้ไข] คำนวณขีดจำกัดสูงสุด โดยเช็คจากกระดาษที่เหลือในตู้ด้วย
  const maxPriceQuantity =
    machineData.prices.length > 0
      ? Math.max(...machineData.prices.map((p) => p.quantity))
      : 10;
      
  const availablePaper = machineData.paperLevel !== undefined ? machineData.paperLevel : 999;
  
  // ให้เอาค่าที่น้อยกว่าระหว่าง "จำนวนแผ่นสูงสุดที่ตั้งราคาไว้" กับ "กระดาษที่เหลือจริงๆ"
  const actualMaxQuantity = Math.min(maxPriceQuantity, availablePaper);

  // Get current price for selected quantity
  const currentPrice =
    machineData.prices.find((p) => p.quantity === selectedQuantity)?.price || 0;

  const handleSetQuantity = (quantity: number) => {
    const price =
      machineData.prices.find((p) => p.quantity === quantity)?.price || 0;
    navigate("/payment-selection", {
      state: { ...state, quantity, totalPrice: price },
      replace: true,
    });
  };

  const handleDecrease = () => {
    if (selectedQuantity > 1) handleSetQuantity(selectedQuantity - 1);
  };

  const handleIncrease = () => {
    if (selectedQuantity < actualMaxQuantity) handleSetQuantity(selectedQuantity + 1);
  };

  const handleContinue = () => {
    navigate("/payment-method", {
      state: { ...state, quantity: selectedQuantity, totalPrice: currentPrice },
    });
  };

  const handleBack = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleCountdownComplete = useCallback(() => {
    handleBack();
  }, [handleBack]);

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
      }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
    >
      <BackButton onBackClick={handleBack} />

      <Countdown
        seconds={COUNTDOWN.SELECT_PRINT.DURATION}
        onComplete={handleCountdownComplete}
        visible={COUNTDOWN.SELECT_PRINT.VISIBLE}
      />

      <div className="page-content" style={{ gap: 40, padding: "0 40px" }}>
        {/* Title */}
        <div style={{ textAlign: "center" }}>
          <h1 className="title-thai" style={{ color: theme.fontColor }}>
            เลือกจำนวนการพิมพ์
          </h1>
          <p className="title-english" style={{ color: theme.fontColor }}>
            SELECT NUMBER OF PRINT
          </p>
        </div>

        {/* Quantity selector with +/- buttons */}
        <div className="quantity-selector">
          <button
            onClick={handleDecrease}
            disabled={selectedQuantity <= 1}
            className="quantity-button"
            style={{ opacity: selectedQuantity <= 1 ? 0.3 : 1 }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12H19"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="quantity-display">{selectedQuantity}</div>

          <button
            onClick={handleIncrease}
            disabled={selectedQuantity >= actualMaxQuantity}
            className="quantity-button"
            style={{ opacity: selectedQuantity >= actualMaxQuantity ? 0.3 : 1 }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5V19M5 12H19"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Price Display */}
        <div className="price-display-row">
          <span className="price-value" style={{ color: theme.fontColor }}>
            {currentPrice}
          </span>
          <span className="price-currency" style={{ color: theme.fontColor }}>
            THB
          </span>
        </div>

        {/*
         * Paying is its own screen (see PaymentMethod): with more than two or three ways
         * to pay, the choice does not fit under the quantity picker, and a customer
         * changing the count should not be reading payment copy at the same time.
         */}
        <button
          onClick={handleContinue}
          className="payment-continue-button"
          style={{
            background: theme.primaryColor,
            border: `2px solid ${theme.primaryColor}`,
            color: theme.textButtonColor || "#fff",
          }}
        >
          <span className="payment-continue-thai">ชำระเงิน</span>
          <span className="payment-continue-english">PAY</span>
        </button>
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
