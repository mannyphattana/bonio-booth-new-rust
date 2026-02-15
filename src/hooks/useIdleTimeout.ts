import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Auto-navigate to home ("/") after 5 minutes of user inactivity.
 * Resets timer on mouse/touch/keyboard events.
 */
export function useIdleTimeout(redirectTo = "/") {
  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      navigate(redirectTo);
    }, IDLE_TIMEOUT_MS);
  }, [navigate, redirectTo]);

  useEffect(() => {
    const events = ["mousedown", "mousemove", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer(); // start timer immediately

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);
}
