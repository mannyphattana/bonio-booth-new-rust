import type { PaymentOption } from "../config/paymentOptions";
import PaymentOptionIcon from "./PaymentOptionIcon";

interface Props {
  /** The QR image Ksher returned, as a data URL. */
  src: string;
  /** Which rail this code belongs to — decides the mark in the middle. */
  option?: PaymentOption;
  /** Rendered size in px. Never smaller than the image Ksher sent: see below. */
  size: number;
}

/**
 * The payment QR, drawn so a phone can actually read it.
 *
 * Two things were wrong with showing Ksher's image directly in a smaller box. A QR is a
 * bitmap of hard-edged squares, and the browser resamples it when the box does not match
 * the image — Ksher sends 300–357px and we were drawing 220–240, so every module edge
 * came out grey and soft. Dense codes suffered most, which is why Alipay was unscannable
 * on the reprint modal while PromptPay usually survived. Drawing bigger than the source
 * with `pixelated` keeps the edges hard, and a bigger code on a glossy kiosk screen is
 * easier to scan at an angle anyway.
 *
 * The mark in the middle is ours rather than Ksher's, which puts a PromptPay logo on
 * every code it renders regardless of the rail. It covers the same area their logo did,
 * so the error correction budget is unchanged — the code still reads with the middle
 * obscured, which is the whole reason a logo can sit there at all.
 */
export default function PaymentQrImage({ src, option, size }: Props) {
  // Ksher's logo sits in a square about a fifth of the code across. Matching it keeps the
  // covered area the same as the code we know scans.
  const markBox = Math.round(size * 0.2);
  const markSize = Math.round(markBox * 0.66);

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <img
        src={src}
        alt="QR Code"
        style={{
          width: size,
          height: size,
          display: "block",
          imageRendering: "pixelated",
        }}
      />
      {option && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: markBox,
            height: markBox,
            borderRadius: Math.round(markBox * 0.22),
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // A hairline keeps the white box from bleeding into the surrounding modules.
            boxShadow: "0 0 0 2px #fff",
          }}
        >
          <PaymentOptionIcon option={option} color="#1a1a1a" size={markSize} />
        </div>
      )}
    </div>
  );
}
