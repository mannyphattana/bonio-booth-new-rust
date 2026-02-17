import { useNavigate, useLocation } from "react-router-dom";
import type { ThemeData, MachineData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import BackButton from "../components/BackButton";
import couponIcon from "../assets/icons/svg/coupon.svg";
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

  const handleBack = () => {
    navigate("/");
  };

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
      }}
    >
      <BackButton onBackClick={handleBack} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          padding: "0 40px",
          flex: 1,
        }}
      >
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
              <div
                className="icon-mask"
                role="img"
                aria-label="Coupon Icon"
                style={{
                  width: 100,
                  height: 100,
                  backgroundColor: theme.primaryColor,
                  WebkitMaskImage: `url(${couponIcon})`,
                  maskImage: `url(${couponIcon})`,
                }}
              />
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
