import React from "react";

interface Props {
  message: string;
}

/** Full-screen error overlay shown when a device is disconnected */
const ErrorOverlay: React.FC<Props> = ({ message }) => {
  if (!message) return null;

  return (
    <div className="error-modal-overlay">
      <div className="error-modal">
        <h2>⚠️ Error</h2>
        <p>{message}</p>
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
          กำลังกลับหน้าหลัก...
        </p>
      </div>
    </div>
  );
};

export default ErrorOverlay;
