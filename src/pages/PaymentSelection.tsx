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

  const handleSelectQuantity = (quantity: number, price: number) => {
    navigate("/payment-selection", {
      state: { ...state, quantity, totalPrice: price },
      replace: true,
    });
  };

  const handleQRCode = () => {
    const price =
      machineData.prices.find((p) => p.quantity === selectedQuantity)?.price || 0;
    navigate("/payment-qr", {
      state: { ...state, quantity: selectedQuantity, totalPrice: price },
    });
  };

  const handleCoupon = () => {
    const price =
      machineData.prices.find((p) => p.quantity === selectedQuantity)?.price || 0;
    navigate("/coupon-entry", {
      state: { ...state, quantity: selectedQuantity, totalPrice: price },
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
          gap: 32,
          padding: 24,
          width: "100%",
          maxWidth: 500,
        }}
      >
        <h1 style={{ color: theme.fontColor, fontSize: 28, textAlign: "center" }}>
          เลือกจำนวนรูป
        </h1>
        <p style={{ color: theme.fontColor, opacity: 0.8, fontSize: 16 }}>
          SELECT QUANTITY
        </p>

        {/* Quantity selection */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 16,
            width: "100%",
          }}
        >
          {machineData.prices.map((p) => (
            <button
              key={p._id}
              onClick={() => handleSelectQuantity(p.quantity, p.price)}
              style={{
                padding: "20px 16px",
                borderRadius: 16,
                background:
                  selectedQuantity === p.quantity
                    ? theme.primaryColor
                    : "rgba(255,255,255,0.1)",
                color:
                  selectedQuantity === p.quantity
                    ? theme.textButtonColor
                    : "#fff",
                fontSize: 18,
                fontWeight: 700,
                border:
                  selectedQuantity === p.quantity
                    ? "none"
                    : "2px solid rgba(255,255,255,0.2)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span style={{ fontSize: 24 }}>{p.quantity}</span>
              <span style={{ fontSize: 14, opacity: 0.9 }}>
                {p.price} ฿
              </span>
            </button>
          ))}
        </div>

        {/* Payment method buttons */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            width: "100%",
            marginTop: 16,
          }}
        >
          <h2
            style={{
              color: theme.fontColor,
              fontSize: 20,
              textAlign: "center",
            }}
          >
            เลือกวิธีชำระเงิน
          </h2>

          <button
            className="primary-button"
            onClick={handleQRCode}
            style={{
              background: theme.primaryColor,
              color: theme.textButtonColor,
              width: "100%",
              fontSize: 20,
              padding: "20px",
            }}
          >
            💳 QR CODE
          </button>

          <button
            className="primary-button"
            onClick={handleCoupon}
            style={{
              background: "rgba(255,255,255,0.15)",
              color: "#fff",
              width: "100%",
              fontSize: 20,
              padding: "20px",
              border: "2px solid rgba(255,255,255,0.3)",
            }}
          >
            🎫 COUPON
          </button>
        </div>
      </div>
    </div>
  );
}
