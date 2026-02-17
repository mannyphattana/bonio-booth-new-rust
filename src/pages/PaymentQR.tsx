import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import BackButton from "../components/BackButton";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
}

const POLL_INTERVAL = 3000; // 3 seconds

export default function PaymentQR({ theme }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [status, setStatus] = useState<string>("CREATING");
  const [referenceId, setReferenceId] = useState<string>("");
  const [paymentTransactionId, setPaymentTransactionId] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState(300);
  const [error, setError] = useState("");
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useIdleTimeout();

  const createPayment = useCallback(async () => {
    // If payment was already created (e.g. from coupon flow), reuse it
    if (state.referenceId && state.qrcode) {
      console.log("💳 [PaymentQR] Reusing existing payment from state");
      setQrCodeUrl(state.qrcode);
      setReferenceId(state.referenceId);
      setPaymentTransactionId(state.transactionId || "");
      setStatus("PENDING");
      return;
    }

    try {
      const result: any = await invoke("create_payment", {
        amount: state.totalPrice || 0,
        numberPhoto: state.quantity || 1,
        couponCodeId: state.couponCodeId || null,
      });

      if (result.success && result.data) {
        setQrCodeUrl(result.data.qr_code || "");
        setReferenceId(result.data.reference_id || "");
        setPaymentTransactionId(result.data.transactionId || "");
        setStatus("PENDING");
      } else {
        setError("ไม่สามารถสร้าง QR Code ได้");
        setStatus("ERROR");
      }
    } catch (err: any) {
      setError(err?.toString() || "Payment creation failed");
      setStatus("ERROR");
    }
  }, [state.totalPrice, state.quantity]);

  const checkStatus = useCallback(async () => {
    if (!referenceId || status !== "PENDING") return;

    try {
      const result: any = await invoke("check_payment_status", {
        mchOrderNo: referenceId,
      });

      if (result.success && result.data) {
        const paymentStatus = result.data.status || result.data.trade_state;

        if (paymentStatus === "SUCCESS" || paymentStatus === "success") {
          setStatus("SUCCESS");

          // Extract transactionId from status check response (may be in nested data)
          const statusTransactionId =
            result.data.transactionId ||
            result.data.data?.transactionId ||
            result.data.transaction_id ||
            "";

          // Clear polling
          if (pollRef.current) clearInterval(pollRef.current);
          if (timerRef.current) clearInterval(timerRef.current);

          // Navigate after 2 seconds
          setTimeout(() => {
            navigate("/frame-selection", {
              state: {
                ...state,
                paymentMethod: "qrcode",
                transactionId:
                  statusTransactionId || paymentTransactionId || referenceId,
                referenceId,
              },
            });
          }, 2000);
        } else if (
          paymentStatus === "FAIL" ||
          paymentStatus === "CLOSED" ||
          paymentStatus === "PAYERROR"
        ) {
          setStatus("FAILED");
          setError("การชำระเงินไม่สำเร็จ");
        }
      }
    } catch (err) {
      console.error("Payment check error:", err);
    }
  }, [referenceId, paymentTransactionId, status, navigate, state]);

  useEffect(() => {
    createPayment();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (status === "PENDING" && referenceId) {
      pollRef.current = setInterval(checkStatus, POLL_INTERVAL);
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setStatus("TIMEOUT");
            if (pollRef.current) clearInterval(pollRef.current);
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, referenceId, checkStatus]);

  const handleBack = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    navigate("/payment-selection", { state });
  };

  const handleCancelClick = () => {
    setIsCancelModalOpen(true);
  };

  const handleConfirmCancel = () => {
    setIsCancelModalOpen(false);
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    navigate("/payment-selection", { state });
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
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
          gap: 24,
          padding: "0 40px",
          flex: 1,
        }}
      >
        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <h1
            style={{
              color: theme.fontColor,
              fontSize: "3rem",
              fontWeight: 600,
              margin: "0 0 8px 0",
            }}
          >
            สแกนจ่ายได้เลย!
          </h1>
          <p
            style={{
              color: theme.fontColor,
              fontSize: "1.2rem",
              fontWeight: 500,
              margin: 0,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              opacity: 0.8,
            }}
          >
            SCAN TO PAY!
          </p>
        </div>

        {/* QR Code Display */}
        <div style={{ marginBottom: 20 }}>
          {status === "CREATING" && (
            <div
              style={{
                position: "relative",
                width: 280,
                height: 280,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <div
                className="payment-spinner-ring"
                style={{
                  position: "absolute",
                  width: "100%",
                  height: "100%",
                  border: "4px solid transparent",
                  borderTopColor: theme.primaryColor,
                  borderRadius: "50%",
                  animationDelay: "0s",
                }}
              />
              <div
                className="payment-spinner-ring"
                style={{
                  position: "absolute",
                  width: "80%",
                  height: "80%",
                  border: "4px solid transparent",
                  borderTopColor: theme.primaryColor,
                  borderRadius: "50%",
                  animationDelay: "-0.4s",
                  animationDuration: "1s",
                }}
              />
              <div
                className="payment-spinner-ring"
                style={{
                  position: "absolute",
                  width: "60%",
                  height: "60%",
                  border: "4px solid transparent",
                  borderTopColor: theme.primaryColor,
                  borderRadius: "50%",
                  animationDelay: "-0.8s",
                  animationDuration: "0.8s",
                }}
              />
            </div>
          )}

          {error && status === "ERROR" && (
            <div
              style={{
                textAlign: "center",
                padding: 20,
                color: theme.textButtonColor,
                background: theme.primaryColor,
                borderRadius: 8,
                border: "2px solid white",
                width: 280,
                height: 280,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <p
                style={{
                  margin: "0 0 15px 0",
                  fontSize: "1.1rem",
                  fontWeight: 500,
                }}
              >
                {error}
              </p>
              <button
                onClick={() => {
                  setError("");
                  setStatus("CREATING");
                }}
                style={{
                  padding: "10px 20px",
                  color: theme.textButtonColor,
                  background: theme.primaryColor,
                  border: "none",
                  borderRadius: 5,
                  cursor: "pointer",
                  fontSize: "1.5rem",
                  fontWeight: 500,
                }}
              >
                Retry
              </button>
            </div>
          )}

          {status === "SUCCESS" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                width: 240,
                height: 240,
                padding: 20,
              }}
            >
              <svg width="120" height="120" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="#2ecc71" />
                <path
                  d="M8 12l3 3 5-5"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <p style={{ color: "#2ecc71", fontSize: 20, fontWeight: 600 }}>
                ชำระเงินสำเร็จ!
              </p>
            </div>
          )}

          {status !== "CREATING" &&
            status !== "ERROR" &&
            status !== "SUCCESS" &&
            qrCodeUrl && (
              <div
                style={{
                  padding: 20,
                  background: "white",
                  borderRadius: 8,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  filter: status === "TIMEOUT" ? "blur(8px)" : "none",
                  transition: "filter 0.5s ease-in-out",
                }}
              >
                <img
                  src={qrCodeUrl}
                  alt="QR Code"
                  style={{
                    width: 240,
                    height: 240,
                    display: "block",
                    borderRadius: 4,
                  }}
                />
              </div>
            )}
        </div>

        {/* Price Display */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 24px",
            borderRadius: 12,
          }}
        >
          <span
            style={{
              fontSize: "3rem",
              fontWeight: 600,
              color: theme.fontColor,
            }}
          >
            {state.totalPrice || 0}
          </span>
          <span
            style={{ fontSize: "3rem", marginLeft: 10, color: theme.fontColor }}
          >
            THB
          </span>
        </div>

        {/* Timer circle */}
        {status !== "SUCCESS" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: 16,
            }}
          >
            <div
              style={{
                width: 100,
                height: 100,
                border: `3px solid ${theme.primaryColor}`,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "white",
                marginBottom: 16,
              }}
            >
              <span
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 600,
                  color: theme.primaryColor,
                }}
              >
                {status === "TIMEOUT" ? "Timeout" : formatTime(timeLeft)}
              </span>
            </div>
            <p
              style={{
                fontSize: "1.5rem",
                fontWeight: 500,
                color: theme.fontColor,
                margin: 0,
                textAlign: "center",
              }}
            >
              กรุณาชำระเงินภายในเวลาที่กำหนด
            </p>
            <p
              style={{
                fontSize: "1.2rem",
                fontWeight: 500,
                color: theme.fontColor,
                margin: 0,
                opacity: 0.8,
                textAlign: "center",
              }}
            >
              Please complete your payment within the time limit.
            </p>
          </div>
        )}

        {/* Cancel button */}
        {status !== "SUCCESS" && (
          <button
            onClick={handleCancelClick}
            style={{
              color: "red",
              backgroundColor: "white",
              border: "2px solid red",
              fontSize: "1.5rem",
              marginTop: 24,
              padding: "12px 40px",
              borderRadius: 8,
              cursor: "pointer",
              boxShadow: "none",
            }}
          >
            Cancel Payment
          </button>
        )}

        {status === "TIMEOUT" && (
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <p style={{ color: "#e94560", fontSize: 18, marginBottom: 12 }}>
              หมดเวลาการชำระเงิน
            </p>
            <button
              className="primary-button"
              onClick={() => navigate("/")}
              style={{
                background: theme.primaryColor,
                color: theme.textButtonColor,
              }}
            >
              กลับหน้าหลัก
            </button>
          </div>
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      {isCancelModalOpen && (
        <div
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
          onClick={() => setIsCancelModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: 20,
              padding: 40,
              maxWidth: 500,
              width: "90%",
              textAlign: "center",
              boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: "1.5rem",
                fontWeight: 600,
                color: "#333",
              }}
            >
              ต้องการยกเลิกการชำระเงิน?
            </p>
            <p
              style={{ margin: "8px 0 24px", fontSize: "1rem", color: "#666" }}
            >
              Are you sure you want to cancel the payment?
            </p>
            <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
              <button
                onClick={() => setIsCancelModalOpen(false)}
                style={{
                  padding: "14px 40px",
                  borderRadius: 12,
                  fontSize: "1.2rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "none",
                  background: "#f3f4f6",
                  color: "#4b5563",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmCancel}
                style={{
                  padding: "14px 40px",
                  borderRadius: 12,
                  fontSize: "1.2rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "none",
                  background: "#e74c3c",
                  color: "#fff",
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .payment-spinner-ring {
          animation: paymentSpin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
        }
        @keyframes paymentSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
