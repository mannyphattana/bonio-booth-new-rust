import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import BackButton from "../components/BackButton";
import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";

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

  // const handleClear = () => {
  //   setCode("");
  //   setError("");
  // };

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

      console.log(
        "🎟️ [CouponEntry] Coupon check passed, couponCodeId:",
        couponCodeId,
      );

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
      const referenceId = payData.reference_id || payData.referenceId || "";
      const isFree =
        payData.netAmount === 0 || payData.qr_code === null || !payData.qr_code;

      console.log(
        "🎟️ [CouponEntry] transactionId:",
        transactionId,
        "isFree:",
        isFree,
      );

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
      <BackButton onBackClick={handleBack} />

      <Countdown
        seconds={COUNTDOWN.DISCOUNT_COUPON.DURATION}
        onComplete={() => navigate("/")}
        visible={COUNTDOWN.DISCOUNT_COUPON.VISIBLE}
      />

      <div
        className="page-main-content"
        style={{ gap: "10%", overflow: "hidden" }}
      >
        {/* Row 1: Title */}
        <div className="page-row-top">
          <div className="page-title-section">
            <h1 className="title-thai" style={{ color: theme.fontColor }}>
              ใช้คูปองส่วนลด
            </h1>
            <p className="title-english" style={{ color: theme.fontColor }}>
              USE DISCOUNT COUPON
            </p>
          </div>
        </div>

        {/* Row 2: code display */}
        <div
          className="page-row-body"
          style={{ flexDirection: "column", gap: "12px" }}
        >
          {/* Code display */}
          <div
            style={{
              width: "90%",
              display: "flex",
              justifyContent: "center",
              margin: "20px 0",
            }}
          >
            <div
              style={{
                width: "90%",
                minHeight: 80,
                padding: 20,
                background: "#f5f5f5",
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.5rem",
                fontWeight: 700,
                color: "#2c2c2c",
                letterSpacing: 2,
                border: error ? "2px solid #e74c3c" : "2px solid #e8e8e8",
                wordBreak: "break-all",
                textAlign: "center",
              }}
            >
              {code || (
                <span style={{ color: "#999", fontWeight: 400 }}>
                  Enter coupon code
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Row 3: keyboard */}
        <div
          className="page-row-bottom"
          style={{ width: "100%", marginBlockEnd: "10%" }}
        >
          {/* QWERTY Keyboard */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              width: "100%",
              maxWidth: 900,
              margin: "20px 0",
            }}
          >
            {KEYBOARD_ROWS.map((row, rowIdx) => (
              <div
                key={rowIdx}
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {rowIdx === 3
                  ? // Row 4 (ZXCVBNM): add invisible spacers for centering like old app
                    ["", ...row, ""].map((key, idx) => (
                      <button
                        key={idx}
                        onClick={() => key && handleKeyPress(key)}
                        style={{
                          minWidth: 30,
                          height: 70,
                          borderRadius: 12,
                          border: "2px solid #e8e8e8",
                          background: "#ffffff",
                          color: "#2c2c2c",
                          fontSize: 20,
                          fontWeight: 600,
                          cursor: key ? "pointer" : "default",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0 12px",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                          flex: 1,
                          margin: "0 4px",
                          visibility: key ? "visible" : "hidden",
                        }}
                      >
                        {key}
                      </button>
                    ))
                  : row.map((key) => (
                      <button
                        key={key}
                        onClick={() => handleKeyPress(key)}
                        style={{
                          minWidth: 30,
                          height: 70,
                          borderRadius: 12,
                          border: "2px solid #e8e8e8",
                          background: "#ffffff",
                          color: "#2c2c2c",
                          fontSize: 20,
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0 12px",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                          flex: 1,
                          margin: "0 4px",
                        }}
                      >
                        {key}
                      </button>
                    ))}
              </div>
            ))}

            {/* Bottom row: Delete + Confirm (both wide) */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={handleBackspace}
                style={{
                  flex: 2,
                  minWidth: 120,
                  height: 70,
                  borderRadius: 12,
                  border: "2px solid #e8e8e8",
                  background: "#ffffff",
                  color: "#2c2c2c",
                  fontSize: 20,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                  margin: "0 4px",
                }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !code.trim()}
                style={{
                  flex: 2,
                  minWidth: 120,
                  height: 70,
                  borderRadius: 12,
                  border: "2px solid #e8e8e8",
                  background:
                    loading || !code.trim() ? "#cccccc" : theme.primaryColor,
                  color:
                    loading || !code.trim() ? "#999" : theme.textButtonColor,
                  fontSize: 20,
                  fontWeight: 600,
                  cursor: loading || !code.trim() ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                  margin: "0 4px",
                  opacity: loading || !code.trim() ? 0.5 : 1,
                }}
              >
                {loading ? "Validating..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Error Modal */}
      {error && (
        <div
          onClick={() => setError("")}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: 20,
              padding: 40,
              maxWidth: 500,
              width: "90%",
              boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: "1.5rem",
                color: "red",
                marginInline: "auto",
                lineHeight: 1.5,
              }}
            >
              {error}
            </p>
            <button
              onClick={() => setError("")}
              style={{
                padding: "12px 40px",
                fontSize: 20,
                fontWeight: 600,
                color: "white",
                background: "linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)",
                border: "none",
                borderRadius: 50,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(231,76,60,0.3)",
                marginTop: 16,
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
