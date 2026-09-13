import { useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { ThemeData, MachineData } from "../App";
import BackButton from "../components/BackButton";
import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";
import qrIcon from "../assets/icons/svg/qrcode.svg";
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";
import {
  PAYMENT_OPTION_COPY,
  getEnabledPaymentOptions,
  type PaymentOption,
} from "../config/paymentOptions";

const ICON_SIZE = 64;

function renderOptionIcon(option: PaymentOption, color: string) {
  if (option === "coupon") {
    return (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M19,4 C20.597725,4 21.903664,5.24892392 21.9949075,6.82372764 L22,7 L22,8.81712 C22,9.42348923 21.6476686,9.89537609 21.224032,10.1466323 L21.1168,10.2048 C20.4531,10.5323 20,11.2142 20,12 C20,12.7296714 20.3906832,13.3697556 20.9778904,13.7196882 L21.1168,13.7952 C21.5503692,14.0090769 21.9360521,14.4507976 21.9928224,15.0341588 L22,15.1829 L22,17 C22,18.597725 20.7511226,19.903664 19.1762773,19.9949075 L19,20 L5,20 C3.40232321,20 2.09633941,18.7511226 2.00509271,17.1762773 L2,17 L2,15.1829 C2,14.5765308 2.35233136,14.1046183 2.77595223,13.8533661 L2.88318,13.7952 C3.54691,13.4677 4,12.7858 4,12 C4,11.2703286 3.60932546,10.6302444 3.02209542,10.2803118 L2.88318,10.2048 C2.44962923,9.99091385 2.06394781,9.54921799 2.0071776,8.96586074 L2,8.81712 L2,7 C2,5.40232321 3.24892392,4.09633941 4.82372764,4.00509271 L5,4 L19,4 Z M19,6 L5,6 C4.48716857,6 4.06449347,6.38604429 4.0067278,6.88337975 L4,7 L4,8.53534 C5.1939,9.22587 6,10.518 6,12 C6,13.404 5.27651967,14.6375634 4.18522683,15.3507193 L4,15.4647 L4,17 C4,17.51285 4.38604429,17.9355092 4.88337975,17.9932725 L5,18 L19,18 C19.51285,18 19.9355092,17.613973 19.9932725,17.1166239 L20,17 L20,15.4647 C18.8061,14.7741 18,13.482 18,12 C18,10.596 18.7234803,9.36240964 19.8147732,8.64931897 L20,8.53535 L20,7 C20,6.48716857 19.613973,6.06449347 19.1166239,6.0067278 L19,6 Z M10,9 C10.51285,9 10.9355092,9.38604429 10.9932725,9.88337975 L11,10 L11,14 C11,14.5523 10.5523,15 10,15 C9.48716857,15 9.06449347,14.613973 9.0067278,14.1166239 L9,14 L9,10 C9,9.44772 9.44772,9 10,9 Z"
          fill={color}
        />
      </svg>
    );
  }

  if (option === "qr_credit_card") {
    // A card with a QR on it: says "scan this" and "credit card" at once, so the button
    // does not read as a slot to insert a card into.
    return (
      <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="5" width="20" height="14" rx="2.5" stroke={color} strokeWidth="1.8" />
        <path d="M2 9.5H22" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <rect x="5" y="12" width="3.6" height="3.6" rx="0.8" stroke={color} strokeWidth="1.4" />
        <rect x="11" y="12" width="3.6" height="3.6" rx="0.8" stroke={color} strokeWidth="1.4" />
        <path d="M17 12H19V14" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 15.6V15.61" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <img
      src={qrIcon}
      alt=""
      style={{
        width: ICON_SIZE,
        height: ICON_SIZE,
        // The PromptPay asset is a dark glyph; invert it on the filled button.
        filter: "brightness(0) invert(1)",
      }}
    />
  );
}

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

  // Payment Option ที่เปิดให้ตู้นี้ — หลังบ้านตั้งค่าไว้ระดับ workspace แล้วส่งมากับ init
  const enabledOptions = getEnabledPaymentOptions(machineData);

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

  const handleSelectOption = (option: PaymentOption) => {
    const nextState = { ...state, quantity: selectedQuantity, totalPrice: currentPrice };

    if (option === "coupon") {
      navigate("/coupon-entry", { state: nextState });
      return;
    }

    // PaymentQR creates the payment, so it needs to know which rail to ask Ksher for.
    navigate("/payment-qr", { state: { ...nextState, paymentOption: option } });
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

        {/* Payment Options — which ones show is decided by the backend, per workspace */}
        <div className="action-buttons-container action-buttons-stacked">
          {enabledOptions.map((option) => {
            const copy = PAYMENT_OPTION_COPY[option];
            const filled = option !== "coupon";

            return (
              <button
                key={option}
                onClick={() => handleSelectOption(option)}
                className="option-button option-button-wide"
                style={{
                  border: `2px solid ${theme.primaryColor}`,
                  background: filled ? theme.primaryColor : "transparent",
                  color: filled ? theme.textButtonColor || "#fff" : theme.primaryColor,
                }}
              >
                <div className="option-button-icon">
                  {renderOptionIcon(option, filled ? theme.textButtonColor || "#fff" : theme.primaryColor)}
                </div>
                <div className="option-button-copy">
                  <span className="option-button-text">{copy.action}</span>
                  <span className="option-button-subtext">{copy.name}</span>
                  {copy.hint && <span className="option-button-hint">{copy.hint}</span>}
                </div>
              </button>
            );
          })}
        </div>
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
