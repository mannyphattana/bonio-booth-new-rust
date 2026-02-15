import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";

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
                transactionId: statusTransactionId || paymentTransactionId || referenceId,
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
      <button className="back-button" onClick={handleBack}>
        ←
      </button>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          padding: 24,
        }}
      >
        <h1 style={{ color: theme.fontColor, fontSize: 24 }}>
          สแกน QR Code เพื่อชำระเงิน
        </h1>
        <p style={{ color: theme.fontColor, opacity: 0.8, fontSize: 16 }}>
          SCAN QR CODE TO PAY
        </p>

        {/* Price display */}
        <div
          style={{
            background: "rgba(0,0,0,0.4)",
            padding: "12px 32px",
            borderRadius: 12,
            fontSize: 28,
            fontWeight: 700,
            color: theme.fontColor,
          }}
        >
          {state.totalPrice || 0} ฿
        </div>

        {/* QR Code Display */}
        <div
          style={{
            width: 280,
            height: 280,
            borderRadius: 16,
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            filter: status === "TIMEOUT" ? "blur(8px)" : "none",
          }}
        >
          {status === "CREATING" ? (
            <div style={{ color: "#333", fontSize: 16 }}>
              กำลังสร้าง QR Code...
            </div>
          ) : qrCodeUrl ? (
            <img
              src={qrCodeUrl}
              alt="QR Code"
              style={{ width: "90%", height: "90%", objectFit: "contain" }}
            />
          ) : (
            <div style={{ color: "#333", fontSize: 16 }}>QR Code</div>
          )}
        </div>

        {/* Timer */}
        {status === "PENDING" && (
          <div
            style={{
              fontSize: 20,
              color: timeLeft < 60 ? "#e94560" : "#fff",
              fontWeight: 600,
            }}
          >
            ⏱ {formatTime(timeLeft)}
          </div>
        )}

        {/* Status messages */}
        {status === "SUCCESS" && (
          <div
            style={{
              background: "rgba(46,204,113,0.2)",
              border: "2px solid #2ecc71",
              padding: "16px 32px",
              borderRadius: 12,
              color: "#2ecc71",
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            ✅ ชำระเงินสำเร็จ!
          </div>
        )}

        {status === "TIMEOUT" && (
          <div style={{ textAlign: "center" }}>
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

        {error && status === "ERROR" && (
          <p style={{ color: "#e94560", fontSize: 16 }}>{error}</p>
        )}
      </div>
    </div>
  );
}
