import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
}

const KEYBOARD_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
];

export default function CouponEntry({ theme }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  useIdleTimeout();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleKeyPress = (key: string) => {
    if (code.length < 20) {
      setCode((prev) => prev + key);
      setError("");
    }
  };

  const handleBackspace = () => {
    setCode((prev) => prev.slice(0, -1));
    setError("");
  };

  const handleClear = () => {
    setCode("");
    setError("");
  };

  const handleSubmit = async () => {
    if (!code.trim()) {
      setError("กรุณาใส่โค้ดคูปอง");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // 1. Check coupon validity
      const checkResult: any = await invoke("check_coupon", { code });

      if (!checkResult.success) {
        setError("คูปองไม่ถูกต้องหรือหมดอายุ");
        setLoading(false);
        return;
      }

      // Extract couponCodeId from check response
      const couponCodeId =
        checkResult.data?.couponCodeId ||
        checkResult.data?.data?.couponCodeId ||
        checkResult.data?.couponCode?._id ||
        "";

      console.log("🎟️ [CouponEntry] Coupon check passed, couponCodeId:", couponCodeId);

      // 2. Create payment transaction with couponCodeId (matches reference flow)
      // This gives us a transactionId even for free/discounted transactions
      const paymentResult: any = await invoke("create_payment", {
        amount: state.totalPrice || 0,
        numberPhoto: state.quantity || 1,
        couponCodeId: couponCodeId || null,
      });

      console.log("🎟️ [CouponEntry] Payment result:", paymentResult);

      if (!paymentResult.success) {
        setError("ไม่สามารถสร้างรายการได้ กรุณาลองใหม่");
        setLoading(false);
        return;
      }

      const payData = paymentResult.data || {};
      const transactionId =
        payData.transactionId ||
        payData.data?.transactionId ||
        payData.transaction_id ||
        "";
      const referenceId =
        payData.reference_id ||
        payData.referenceId ||
        "";
      const isFree =
        payData.netAmount === 0 || payData.qr_code === null || !payData.qr_code;

      console.log("🎟️ [CouponEntry] transactionId:", transactionId, "isFree:", isFree);

      if (isFree) {
        // Free coupon — skip payment QR, go directly to frame selection
        navigate("/frame-selection", {
          state: {
            ...state,
            couponCode: code,
            paymentMethod: "coupon",
            transactionId,
            referenceId,
          },
        });
      } else {
        // Discounted but not free — go to payment QR with existing payment data
        navigate("/payment-qr", {
          state: {
            ...state,
            couponCode: code,
            paymentMethod: "coupon",
            transactionId,
            referenceId,
            qrcode: payData.qr_code || "",
            totalPrice: payData.netAmount || state.totalPrice,
          },
        });
      }
    } catch (err: any) {
      setError(err?.toString() || "เกิดข้อผิดพลาด");
    }

    setLoading(false);
  };

  const handleBack = () => {
    navigate("/payment-selection", { state });
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
          gap: 20,
          padding: 24,
          width: "100%",
          maxWidth: 600,
        }}
      >
        <h1 style={{ color: theme.fontColor, fontSize: 24 }}>
          ใส่โค้ดคูปอง
        </h1>
        <p style={{ color: theme.fontColor, opacity: 0.8 }}>ENTER COUPON CODE</p>

        {/* Code display */}
        <div
          style={{
            width: "100%",
            padding: "20px 24px",
            borderRadius: 16,
            background: "rgba(0,0,0,0.4)",
            border: error
              ? "2px solid #e94560"
              : "2px solid rgba(255,255,255,0.2)",
            textAlign: "center",
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: 4,
            color: "#fff",
            minHeight: 70,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {code || (
            <span style={{ color: "#555", fontSize: 20, letterSpacing: 1 }}>
              COUPON CODE
            </span>
          )}
        </div>

        {error && (
          <p style={{ color: "#e94560", fontSize: 14 }}>{error}</p>
        )}

        {/* On-screen keyboard */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            width: "100%",
          }}
        >
          {KEYBOARD_ROWS.map((row, rowIdx) => (
            <div
              key={rowIdx}
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {row.map((key) => (
                <button
                  key={key}
                  onClick={() => handleKeyPress(key)}
                  style={{
                    width: 48,
                    height: 52,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.15)",
                    color: "#fff",
                    fontSize: 18,
                    fontWeight: 600,
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  {key}
                </button>
              ))}
            </div>
          ))}

          {/* Bottom row: Clear, Space, Backspace */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 8,
              marginTop: 4,
            }}
          >
            <button
              onClick={handleClear}
              style={{
                padding: "12px 24px",
                borderRadius: 8,
                background: "rgba(233,69,96,0.3)",
                color: "#e94560",
                fontSize: 14,
                fontWeight: 600,
                border: "1px solid rgba(233,69,96,0.3)",
              }}
            >
              CLEAR
            </button>
            <button
              onClick={() => handleKeyPress("-")}
              style={{
                padding: "12px 48px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.1)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              —
            </button>
            <button
              onClick={handleBackspace}
              style={{
                padding: "12px 24px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.15)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              ⌫ DELETE
            </button>
          </div>
        </div>

        {/* Submit button */}
        <button
          className="primary-button"
          onClick={handleSubmit}
          disabled={loading || !code.trim()}
          style={{
            background:
              loading || !code.trim() ? "#444" : theme.primaryColor,
            color: theme.textButtonColor,
            width: "100%",
            marginTop: 8,
            fontSize: 20,
          }}
        >
          {loading ? "กำลังตรวจสอบ..." : "ยืนยัน / CONFIRM"}
        </button>
      </div>
    </div>
  );
}
