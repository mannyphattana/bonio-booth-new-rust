import { useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { ThemeData, MachineData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import BackButton from "../components/BackButton";
import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";
import qrIcon from "../assets/icons/svg/qrcode.svg";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
}

export default function PaymentSelection({ theme, machineData }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  useIdleTimeout();

  const selectedQuantity = state.quantity || 1;

  // Calculate max quantity from available prices
  const maxQuantity =
    machineData.prices.length > 0
      ? Math.max(...machineData.prices.map((p) => p.quantity))
      : 10;

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
    if (selectedQuantity < maxQuantity) handleSetQuantity(selectedQuantity + 1);
  };

  const handleQRCode = () => {
    navigate("/payment-qr", {
      state: { ...state, quantity: selectedQuantity, totalPrice: currentPrice },
    });
  };

  const handleCoupon = () => {
    navigate("/coupon-entry", {
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
            disabled={selectedQuantity >= maxQuantity}
            className="quantity-button"
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

        {/* Action Buttons - side by side */}
        <div className="action-buttons-container">
          {/* Coupon button - outlined */}
          <button
            onClick={handleCoupon}
            className="option-button"
            style={{
              border: `2px solid ${theme.primaryColor}`,
              color: theme.primaryColor,
            }}
          >
            <div className="option-button-icon">
              <svg
                width="100"
                height="100"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M19,4 C20.597725,4 21.903664,5.24892392 21.9949075,6.82372764 L22,7 L22,8.81712 C22,9.42348923 21.6476686,9.89537609 21.224032,10.1466323 L21.1168,10.2048 C20.4531,10.5323 20,11.2142 20,12 C20,12.7296714 20.3906832,13.3697556 20.9778904,13.7196882 L21.1168,13.7952 C21.5503692,14.0090769 21.9360521,14.4507976 21.9928224,15.0341588 L22,15.1829 L22,17 C22,18.597725 20.7511226,19.903664 19.1762773,19.9949075 L19,20 L5,20 C3.40232321,20 2.09633941,18.7511226 2.00509271,17.1762773 L2,17 L2,15.1829 C2,14.5765308 2.35233136,14.1046183 2.77595223,13.8533661 L2.88318,13.7952 C3.54691,13.4677 4,12.7858 4,12 C4,11.2703286 3.60932546,10.6302444 3.02209542,10.2803118 L2.88318,10.2048 C2.44962923,9.99091385 2.06394781,9.54921799 2.0071776,8.96586074 L2,8.81712 L2,7 C2,5.40232321 3.24892392,4.09633941 4.82372764,4.00509271 L5,4 L19,4 Z M19,6 L5,6 C4.48716857,6 4.06449347,6.38604429 4.0067278,6.88337975 L4,7 L4,8.53534 C5.1939,9.22587 6,10.518 6,12 C6,13.404 5.27651967,14.6375634 4.18522683,15.3507193 L4,15.4647 L4,17 C4,17.51285 4.38604429,17.9355092 4.88337975,17.9932725 L5,18 L19,18 C19.51285,18 19.9355092,17.613973 19.9932725,17.1166239 L20,17 L20,15.4647 C18.8061,14.7741 18,13.482 18,12 C18,10.596 18.7234803,9.36240964 19.8147732,8.64931897 L20,8.53535 L20,7 C20,6.48716857 19.613973,6.06449347 19.1166239,6.0067278 L19,6 Z M10,9 C10.51285,9 10.9355092,9.38604429 10.9932725,9.88337975 L11,10 L11,14 C11,14.5523 10.5523,15 10,15 C9.48716857,15 9.06449347,14.613973 9.0067278,14.1166239 L9,14 L9,10 C9,9.44772 9.44772,9 10,9 Z"
                  fill={theme.primaryColor}
                />
              </svg>
            </div>
            <span className="option-button-text">ใช้</span>
            <span className="option-button-subtext">Discount Coupon</span>
          </button>

          {/* QR Payment button - filled */}
          <button
            onClick={handleQRCode}
            className="option-button"
            style={{
              border: `2px solid ${theme.primaryColor}`,
              background: theme.primaryColor,
              color: theme.textButtonColor || "#fff",
            }}
          >
            <div className="option-button-icon">
              <img
                src={qrIcon}
                alt="QR Code Icon"
                style={{
                  width: 100,
                  height: 100,
                  filter: "brightness(0) invert(1)", // White icon for filled button
                }}
              />
            </div>
            <span className="option-button-text">ชำระเงินผ่าน</span>
            <span className="option-button-subtext">QR Payment</span>
          </button>
        </div>
      </div>
    </div>
  );
}
