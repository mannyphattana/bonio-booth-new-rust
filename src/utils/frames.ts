import type { FrameData } from "../App";

/** data ของ get_frames / get_cached_frames เป็นได้ทั้ง array และ { frames: [...] } */
export function toFrameList(data: any): FrameData[] {
  return Array.isArray(data) ? data : data?.frames || [];
}
