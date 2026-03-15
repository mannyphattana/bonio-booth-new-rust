import type { Capture } from "../App";

export type DualMonitorMsg =
  | { type: "start_shooting"; locationState: any }
  | {
      type: "shooting_done";
      captures: Capture[];
      selectedFrame: any;
      locationState: any;
    };

export interface DisplayMonitorConfig {
  enabled: boolean;
  displayName: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const CHANNEL_NAME = "bonio_dual_monitor";

/** ส่ง message ไปยัง window อื่น (fire-and-forget) */
export function emitDualMonitor(msg: DualMonitorMsg): void {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage(msg);
  channel.close();
}

/** Subscribe รับ message จาก window อื่น — คืน unsubscribe function */
export function subscribeDualMonitor(
  cb: (msg: DualMonitorMsg) => void
): () => void {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => cb(event.data as DualMonitorMsg);
  return () => channel.close();
}

/** ตรวจสอบว่าเปิดใช้งาน dual monitor ไว้หรือไม่ */
export function isDualMonitorEnabled(): boolean {
  try {
    const raw = localStorage.getItem("displayMonitorConfig");
    if (!raw) return false;
    const cfg: DisplayMonitorConfig = JSON.parse(raw);
    return cfg?.enabled === true;
  } catch {
    return false;
  }
}

/** อ่าน config ของ display monitor (null ถ้าไม่ได้เปิดใช้งาน) */
export function getDisplayMonitorConfig(): DisplayMonitorConfig | null {
  try {
    const raw = localStorage.getItem("displayMonitorConfig");
    if (!raw) return null;
    const cfg: DisplayMonitorConfig = JSON.parse(raw);
    return cfg?.enabled ? cfg : null;
  } catch {
    return null;
  }
}

/** ปิดการใช้งาน dual monitor (ลบ config ออกจาก localStorage) */
export function disableDualMonitor(): void {
  localStorage.removeItem("displayMonitorConfig");
}
