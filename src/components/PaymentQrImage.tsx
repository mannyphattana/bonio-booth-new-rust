interface Props {
  /** The QR image Ksher returned, as a data URL. */
  src: string;
  /** Rendered size in px. Never smaller than the image Ksher sent: see below. */
  size: number;
}

/**
 * The payment QR, drawn so a phone can actually read it.
 *
 * Ksher's image is shown exactly as it comes, logo and all. The only thing done to it is
 * size. A QR is a bitmap of hard-edged squares, and the browser resamples it when the box
 * does not match the image — Ksher sends 300–357px and the screens drew 220–240, so every
 * module edge came out grey and soft. Dense codes suffered most, which is why Alipay on
 * the reprint modal was unscannable while PromptPay usually survived. Drawing larger than
 * the source with `pixelated` keeps the edges hard, and a bigger code on a glossy kiosk
 * screen is easier to scan at an angle anyway.
 */
export default function PaymentQrImage({ src, size }: Props) {
  return (
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
  );
}
