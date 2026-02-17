import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

interface BackButtonProps {
  onBackClick?: () => void;
  backButtonPath?: string;
  disabled?: boolean;
}

export default function BackButton({
  onBackClick,
  backButtonPath,
  disabled = false,
}: BackButtonProps): React.JSX.Element {
  const navigate = useNavigate();
  const [isActive, setIsActive] = useState(false);

  const handleBackClick = React.useCallback(() => {
    if (disabled) return;
    if (onBackClick) {
      onBackClick();
    } else if (backButtonPath) {
      navigate(backButtonPath);
    } else {
      navigate(-1); // Go back to previous page
    }
  }, [onBackClick, backButtonPath, navigate, disabled]);

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    top: "3rem",
    left: "3rem",
    zIndex: 1000,
    background: "none",
    padding: "0.5rem",
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s ease",
    width: "76px",
    height: "76px",
    boxShadow: "none",
    border: "2px solid #374151",
    color: "#374151",
    backgroundColor: "#f9fafb",
    borderRadius: "50%",
    opacity: disabled ? 0.5 : 0.7,
    transform: isActive && !disabled ? "translateY(1px)" : "none",
  };

  return (
    <button
      type="button"
      style={baseStyle}
      onClick={handleBackClick}
      onMouseDown={() => setIsActive(true)}
      onMouseUp={() => setIsActive(false)}
      onMouseLeave={() => setIsActive(false)}
      disabled={disabled}
      aria-label="Go back"
    >
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
        <path
          d="M15 18L9 12L15 6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
