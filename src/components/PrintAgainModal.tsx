import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData } from "../App";

const CTX = "[PrintAgainModal]";

/** อายุของ modal ทั้งหมด (วินาที) — ครบแล้วยังไม่จ่าย จะปิด modal เอง */
const MODAL_LIFETIME_SEC = 300; // 5 นาที
const POLL_INTERVAL_MS = 3000;

type Step = "select" | "coupon" | "qr" | "success";

interface PaidInfo {
  transactionId: string;
  quantity: number;
}

interface Props {
  theme: ThemeData;
  machineData: MachineData;
  /** transaction ต้นทางที่จะพิมพ์ซ้ำ — ใช้ผูก reprintFromTransactionId */
  originalTransactionId: string;
  /** ปิด modal โดยยังไม่มีการชำระเงิน (กดยกเลิก / ครบ 5 นาที) */
  onClose: () => void;
  /** ชำระเงินสำเร็จ — ให้ผู้เรียกไปสั่งพิมพ์ซ้ำตามจำนวน */
  onPaid: (info: PaidInfo) => void;
}

const KEYBOARD_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
];

export default function PrintAgainModal({
  theme,
  machineData,
  originalTransactionId,
  onClose,
  onPaid,
}: Props) {
  const [step, setStep] = useState<Step>("select");
  const [quantity, setQuantity] = useState<number>(1);
  const [timeLeft, setTimeLeft] = useState<number>(MODAL_LIFETIME_SEC);

  // QR state
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [referenceId, setReferenceId] = useState<string>("");
  const [reprintTxId, setReprintTxId] = useState<string>("");
  const [qrAmount, setQrAmount] = useState<number>(0);

  // Coupon state
  const [couponCode, setCouponCode] = useState<string>("");
  const [couponLoading, setCouponLoading] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const isCheckingRef = useRef(false);
  const paidRef = useRef(false); // กันยิง onPaid ซ้ำ
  const onCloseRef = useRef(onClose);
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onCloseRef.current = onClose;
    onPaidRef.current = onPaid;
  }, [onClose, onPaid]);

  // ---- ราคา/จำนวน (ตรรกะเดียวกับหน้า PaymentSelection) ----
  const maxPriceQuantity =
    machineData.prices.length > 0
      ? Math.max(...machineData.prices.map((p) => p.quantity))
      : 10;
  const availablePaper =
    machineData.paperLevel !== undefined ? machineData.paperLevel : 999;
  const actualMaxQuantity = Math.max(1, Math.min(maxPriceQuantity, availablePaper));
  const currentPrice =
    machineData.prices.find((p) => p.quantity === quantity)?.price || 0;
  // ตู้ A4 ส่วนใหญ่ไม่ได้ส่ง flag นี้มา — ถือว่าเปิด QR ไว้ ยกเว้นถูกปิดชัดเจน
  const hasKsher = machineData.isKsherEnabled !== false;

  const handleDecrease = () => setQuantity((q) => (q > 1 ? q - 1 : q));
  const handleIncrease = () =>
    setQuantity((q) => (q < actualMaxQuantity ? q + 1 : q));

  // ---- Master timer: อายุ modal 5 นาที ----
  useEffect(() => {
    if (step === "success") return; // จ่ายสำเร็จแล้ว หยุดจับเวลา
    const t = setInterval(() => {
      setTimeLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [step]);

  useEffect(() => {
    if (timeLeft === 0 && step !== "success" && !paidRef.current) {
      console.log(CTX, "Modal expired (5 min) — closing without payment");
      onCloseRef.current();
    }
  }, [timeLeft, step]);

  const finishPaid = useCallback(
    (txId: string) => {
      if (paidRef.current) return;
      paidRef.current = true;
      setStep("success");
      console.log(CTX, "Reprint payment success — txId:", txId, "qty:", quantity);
      setTimeout(() => {
        onPaidRef.current({ transactionId: txId, quantity });
      }, 1500);
    },
    [quantity],
  );

  // ---- สร้าง payment (ใช้ทั้ง QR และคูปองที่ยังต้องจ่าย) ----
  const startQrPayment = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result: any = await invoke("create_payment", {
        amount: currentPrice,
        numberPhoto: quantity,
        couponCodeId: null,
        isReprint: true,
        reprintFromTransactionId: originalTransactionId || null,
      });
      const data = result?.data || {};
      if (!result?.success || !data.qr_code) {
        setError("ไม่สามารถสร้าง QR Code ได้");
        setBusy(false);
        return;
      }
      setQrCodeUrl(data.qr_code || "");
      setReferenceId(data.reference_id || "");
      setReprintTxId(data.transactionId || "");
      setQrAmount(data.netAmount ?? currentPrice);
      setStep("qr");
    } catch (err) {
      console.error(CTX, "startQrPayment failed:", err);
      setError("เกิดข้อผิดพลาดในการสร้างการชำระเงิน");
    } finally {
      setBusy(false);
    }
  }, [busy, currentPrice, quantity, originalTransactionId]);

  // ---- คูปอง ----
  const submitCoupon = useCallback(async () => {
    if (couponLoading || !couponCode.trim()) return;
    setCouponLoading(true);
    setError("");
    try {
      const checkResult: any = await invoke("check_coupon", { code: couponCode });
      if (!checkResult?.success) {
        setError("คูปองไม่สามารถใช้งานได้");
        setCouponLoading(false);
        return;
      }
      const couponCodeId =
        checkResult.data?.couponCodeId ||
        checkResult.data?.data?.couponCodeId ||
        checkResult.data?.couponCode?._id ||
        "";
      if (!couponCodeId) {
        setError("คูปองไม่สามารถใช้งานได้");
        setCouponLoading(false);
        return;
      }

      const payResult: any = await invoke("create_payment", {
        amount: currentPrice,
        numberPhoto: quantity,
        couponCodeId,
        isReprint: true,
        reprintFromTransactionId: originalTransactionId || null,
      });
      const data = payResult?.data || {};
      if (!payResult?.success) {
        setError("ไม่สามารถสร้างรายการได้ กรุณาลองใหม่");
        setCouponLoading(false);
        return;
      }

      const txId = data.transactionId || "";
      const isFree = data.netAmount === 0 || !data.qr_code;

      if (isFree) {
        // คูปองฟรี — สำเร็จทันที
        finishPaid(txId);
      } else {
        setQrCodeUrl(data.qr_code || "");
        setReferenceId(data.reference_id || "");
        setReprintTxId(txId);
        setQrAmount(data.netAmount ?? currentPrice);
        setStep("qr");
      }
    } catch (err) {
      console.error(CTX, "submitCoupon failed:", err);
      setError("คูปองไม่สามารถใช้งานได้");
    } finally {
      setCouponLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [couponLoading, couponCode, currentPrice, quantity, originalTransactionId, finishPaid]);

  // ---- Poll สถานะ QR ----
  useEffect(() => {
    if (step !== "qr" || !referenceId) return;
    const poll = setInterval(async () => {
      if (isCheckingRef.current || paidRef.current) return;
      isCheckingRef.current = true;
      try {
        const result: any = await invoke("check_payment_status", {
          mchOrderNo: referenceId,
        });
        if (result?.success && result.data) {
          const s = result.data.status || result.data.trade_state;
          if (s === "SUCCESS" || s === "success") {
            const statusTxId =
              result.data.transactionId ||
              result.data.data?.transactionId ||
              result.data.transaction_id ||
              reprintTxId;
            clearInterval(poll);
            finishPaid(statusTxId);
          } else if (s === "PAYERROR" || s === "CLOSED") {
            clearInterval(poll);
            setError(
              s === "CLOSED"
                ? "QR Code หมดอายุ กรุณาลองใหม่อีกครั้ง"
                : "การชำระเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
            );
            setStep("select");
            setQrCodeUrl("");
            setReferenceId("");
          }
        }
      } catch (err) {
        console.error(CTX, "check_payment_status error:", err);
      } finally {
        isCheckingRef.current = false;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [step, referenceId, reprintTxId, finishPaid]);

  const formatTime = (sec: number) =>
    `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;

  const handleKeyPress = (key: string) => {
    setCouponCode((prev) => (prev.length < 20 ? prev + key : prev));
    setError("");
  };
  const handleBackspace = () => {
    setCouponCode((prev) => prev.slice(0, -1));
    setError("");
  };

  // ================= UI =================
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 24,
          width: "90%",
          maxWidth: 640,
          maxHeight: "92vh",
          overflowY: "auto",
          padding: "28px 24px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        {/* Header + master timer */}
        <div style={{ textAlign: "center", width: "100%" }}>
          <h2 style={{ margin: 0, fontSize: "1.8rem", color: "#2c2c2c" }}>
            พิมพ์อีกครั้ง
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: "1rem", color: "#888" }}>
            PRINT AGAIN
          </p>
          {step !== "success" && (
            <p style={{ margin: "8px 0 0", fontSize: "0.95rem", color: "#e07b00" }}>
              เหลือเวลา {formatTime(timeLeft)}
            </p>
          )}
        </div>

        {/* -------- STEP: select quantity + payment method -------- */}
        {step === "select" && (
          <>
            <div className="quantity-selector">
              <button
                onClick={handleDecrease}
                disabled={quantity <= 1}
                className="quantity-button"
                style={{ opacity: quantity <= 1 ? 0.3 : 1 }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <div className="quantity-display">{quantity}</div>
              <button
                onClick={handleIncrease}
                disabled={quantity >= actualMaxQuantity}
                className="quantity-button"
                style={{ opacity: quantity >= actualMaxQuantity ? 0.3 : 1 }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="price-display-row">
              <span className="price-value" style={{ color: "#2c2c2c" }}>
                {currentPrice}
              </span>
              <span className="price-currency" style={{ color: "#2c2c2c" }}>
                THB
              </span>
            </div>

            <div style={{ display: "flex", gap: 16, width: "100%", justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  setError("");
                  setCouponCode("");
                  setStep("coupon");
                }}
                className="option-button"
                style={{ border: `2px solid ${theme.primaryColor}`, color: theme.primaryColor }}
              >
                <span className="option-button-text">ใช้</span>
                <span className="option-button-subtext">Discount Coupon</span>
              </button>

              {hasKsher && (
                <button
                  onClick={startQrPayment}
                  disabled={busy || currentPrice <= 0}
                  className="option-button"
                  style={{
                    border: `2px solid ${theme.primaryColor}`,
                    background: theme.primaryColor,
                    color: theme.textButtonColor || "#fff",
                    opacity: busy || currentPrice <= 0 ? 0.6 : 1,
                  }}
                >
                  <span className="option-button-text">
                    {busy ? "กำลังสร้าง..." : "ชำระเงินผ่าน"}
                  </span>
                  <span className="option-button-subtext">QR Payment</span>
                </button>
              )}
            </div>

            {error && <p style={{ color: "#e94560", fontSize: 14, margin: 0 }}>{error}</p>}

            <button onClick={() => onClose()} style={cancelBtnStyle}>
              ยกเลิก / Cancel
            </button>
          </>
        )}

        {/* -------- STEP: coupon -------- */}
        {step === "coupon" && (
          <>
            <div
              style={{
                width: "90%",
                minHeight: 60,
                padding: 16,
                background: "#f5f5f5",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3rem",
                fontWeight: 700,
                color: "#2c2c2c",
                letterSpacing: 2,
                border: error ? "2px solid #e74c3c" : "2px solid #e8e8e8",
                wordBreak: "break-all",
                textAlign: "center",
              }}
            >
              {couponCode || <span style={{ color: "#999", fontWeight: 400 }}>Enter coupon code</span>}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
              {KEYBOARD_ROWS.map((row, rowIdx) => (
                <div key={rowIdx} style={{ display: "flex", justifyContent: "center", gap: 6 }}>
                  {row.map((key) => (
                    <button key={key} onClick={() => handleKeyPress(key)} style={keyBtnStyle}>
                      {key}
                    </button>
                  ))}
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
                <button onClick={handleBackspace} style={{ ...keyBtnStyle, flex: 2 }}>
                  ⌫
                </button>
                <button
                  onClick={submitCoupon}
                  disabled={couponLoading || !couponCode.trim()}
                  style={{
                    ...keyBtnStyle,
                    flex: 2,
                    background: couponLoading || !couponCode.trim() ? "#ccc" : theme.primaryColor,
                    color: couponLoading || !couponCode.trim() ? "#999" : theme.textButtonColor,
                  }}
                >
                  {couponLoading ? "..." : "Confirm"}
                </button>
              </div>
            </div>

            {error && <p style={{ color: "#e94560", fontSize: 14, margin: 0 }}>{error}</p>}

            <button onClick={() => { setError(""); setStep("select"); }} style={cancelBtnStyle}>
              ย้อนกลับ / Back
            </button>
          </>
        )}

        {/* -------- STEP: qr -------- */}
        {step === "qr" && (
          <>
            <p style={{ margin: 0, fontSize: "1.3rem", color: "#2c2c2c" }}>สแกนจ่ายได้เลย!</p>
            <div style={{ padding: 16, background: "#fff", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
              {qrCodeUrl ? (
                <img src={qrCodeUrl} alt="QR Code" style={{ width: 220, height: 220, display: "block" }} />
              ) : (
                <div style={{ width: 220, height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#999" }}>
                  กำลังโหลด...
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "2rem", fontWeight: 600, color: "#2c2c2c" }}>{qrAmount}</span>
              <span style={{ fontSize: "1.4rem", color: "#2c2c2c" }}>THB</span>
            </div>
            <p style={{ margin: 0, color: "#888", fontSize: "0.95rem" }}>
              กรุณาชำระเงินภายในเวลาที่กำหนด
            </p>
            {error && <p style={{ color: "#e94560", fontSize: 14, margin: 0 }}>{error}</p>}
            <button onClick={() => onClose()} style={cancelBtnStyle}>
              ยกเลิก / Cancel
            </button>
          </>
        )}

        {/* -------- STEP: success -------- */}
        {step === "success" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 24 }}>
            <svg width="100" height="100" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="#2ecc71" />
              <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p style={{ color: "#2ecc71", fontSize: 20, fontWeight: 600, margin: 0 }}>
              ชำระเงินสำเร็จ! กำลังพิมพ์...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const cancelBtnStyle: React.CSSProperties = {
  marginTop: 4,
  padding: "10px 32px",
  borderRadius: 10,
  border: "2px solid #e74c3c",
  background: "#fff",
  color: "#e74c3c",
  fontSize: "1.05rem",
  fontWeight: 600,
  cursor: "pointer",
};

const keyBtnStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 28,
  height: 54,
  borderRadius: 10,
  border: "2px solid #e8e8e8",
  background: "#fff",
  color: "#2c2c2c",
  fontSize: 18,
  fontWeight: 600,
  cursor: "pointer",
};
