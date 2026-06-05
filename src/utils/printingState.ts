/**
 * Global printing state tracker
 * Used to prevent device check notifications during printing operations
 */

let isPrintingRef = { current: false };
let printingTimeoutRef: ReturnType<typeof setTimeout> | null = null;
let printingEndTimeRef: { current: number | null } = { current: null };
const GRACE_PERIOD_MS = 10000; // 10 seconds grace period after printing ends

/**
 * Set printing state to true (printer is currently printing)
 * Automatically resets after timeout if not manually cleared
 * Includes grace period after printing ends to prevent false notifications
 */
export function setPrinting(isPrinting: boolean, timeoutMs: number = 30000) {
  // Clear existing timeout
  if (printingTimeoutRef) {
    clearTimeout(printingTimeoutRef);
    printingTimeoutRef = null;
  }
  
  if (isPrinting) {
    isPrintingRef.current = true;
    printingEndTimeRef.current = null;
    // Auto-reset after timeout (safety measure)
    printingTimeoutRef = setTimeout(() => {
      isPrintingRef.current = false;
      printingEndTimeRef.current = null;
      printingTimeoutRef = null;
    }, timeoutMs);
  } else {
    // Set end time and keep printing state true for grace period
    printingEndTimeRef.current = Date.now();
    
    // After grace period, clear printing state
    printingTimeoutRef = setTimeout(() => {
      isPrintingRef.current = false;
      printingEndTimeRef.current = null;
      printingTimeoutRef = null;
    }, GRACE_PERIOD_MS);
  }
}

/**
 * Check if printer is currently printing or in grace period
 */
export function isPrinting(): boolean {
  // If explicitly printing, return true
  if (isPrintingRef.current && !printingEndTimeRef.current) {
    return true;
  }
  
  // If in grace period (recently finished printing), return true
  if (printingEndTimeRef.current) {
    const elapsed = Date.now() - printingEndTimeRef.current;
    if (elapsed < GRACE_PERIOD_MS) {
      return true;
    }
  }
  
  return false;
}
