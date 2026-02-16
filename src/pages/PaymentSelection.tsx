import { useNavigate, useLocation } from "react-router-dom";
import type { ThemeData, MachineData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";

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
  const maxQuantity = machineData.prices.length > 0
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
      <button className="back-button" onClick={handleBack}>
        ←
      </button>

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
          <h1 style={{ color: theme.fontColor, fontSize: "3rem", fontWeight: 700, margin: "0 0 8px 0" }}>
            เลือกจำนวนการพิมพ์
          </h1>
          <p style={{ color: theme.fontColor, fontSize: "1.5rem", fontWeight: 500, margin: 0, letterSpacing: 0.5, textTransform: "uppercase" }}>
            SELECT NUMBER OF PRINT
          </p>
        </div>

        {/* Quantity selector with +/- buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 30, margin: "20px 0" }}>
          <button
            onClick={handleDecrease}
            disabled={selectedQuantity <= 1}
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: "white",
              border: "2px solid #2c2c2c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: selectedQuantity <= 1 ? "not-allowed" : "pointer",
              opacity: selectedQuantity <= 1 ? 0.4 : 1,
              boxShadow: "none",
              padding: 0,
              color: "#2c2c2c",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: "50%",
              border: "2px solid #e8e8e8",
              background: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "3rem",
              fontWeight: 700,
              color: "#2c2c2c",
            }}
          >
            {selectedQuantity}
          </div>

          <button
            onClick={handleIncrease}
            disabled={selectedQuantity >= maxQuantity}
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: "white",
              border: "2px solid #2c2c2c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: selectedQuantity >= maxQuantity ? "not-allowed" : "pointer",
              opacity: selectedQuantity >= maxQuantity ? 0.4 : 1,
              boxShadow: "none",
              padding: 0,
              color: "#2c2c2c",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Price Display */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "20px 0" }}>
          <span style={{ fontSize: "3rem", fontWeight: 600, color: theme.fontColor }}>{currentPrice}</span>
          <span style={{ fontSize: "1.2rem", fontWeight: 500, color: theme.fontColor }}>THB</span>
        </div>

        {/* Action Buttons - side by side */}
        <div style={{ display: "flex", gap: 20, width: "100%", maxWidth: 600, marginTop: 20 }}>
          {/* Coupon button - outlined */}
          <button
            onClick={handleCoupon}
            style={{
              flex: 1,
              border: `2px solid ${theme.primaryColor}`,
              padding: "20px 16px",
              borderRadius: 16,
              cursor: "pointer",
              background: "transparent",
              color: theme.primaryColor,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              minHeight: 140,
              justifyContent: "center",
              boxShadow: "none",
            }}
          >
            <div style={{ fontSize: 60, lineHeight: 1 }}>🎫</div>
            <span style={{ fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.2 }}>ใช้</span>
            <span style={{ fontSize: "1.5rem", fontWeight: 500, lineHeight: 1.2, opacity: 0.95 }}>Discount Coupon</span>
          </button>

          {/* QR Payment button - filled */}
          <button
            onClick={handleQRCode}
            style={{
              flex: 1,
              border: `2px solid ${theme.primaryColor}`,
              padding: "20px 16px",
              borderRadius: 16,
              cursor: "pointer",
              background: theme.primaryColor,
              color: theme.textButtonColor || "#fff",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              minHeight: 140,
              justifyContent: "center",
              boxShadow: "none",
            }}
          >
            <div style={{ fontSize: 60, lineHeight: 1 }}>💳</div>
            <span style={{ fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.2 }}>ชำระเงินผ่าน</span>
            <span style={{ fontSize: "1.5rem", fontWeight: 500, lineHeight: 1.2, opacity: 0.95 }}>QR Payment</span>
          </button>
        </div>
      </div>
    </div>
  );
}
