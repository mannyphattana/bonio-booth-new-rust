/**
 * Static filter configuration
 * Each filter maps to a .cube LUT file in the /filters directory
 * Using config-based approach avoids filesystem scanning and
 * issues with special characters in filenames (e.g., B&W, Orange & Teal)
 */

export interface FilterConfig {
  id: string;
  name: string;
  lutFile: string; // filename in /filters directory (e.g., 'B&W.cube')
  type: "lut" | "none";
}

export const FILTERS: FilterConfig[] = [
  { id: "none", name: "No Filter", lutFile: "", type: "none" },
  {
    id: "matte-brown-mono",
    name: "Matte Brown",
    lutFile: "Matte_Brown_Mono.cube",
    type: "lut",
  },
  {
    id: "sepia-brown",
    name: "Sepia Brown",
    lutFile: "Sepia_Brown.cube",
    type: "lut",
  },
  {
    id: "timelab-1",
    name: "Classic",
    lutFile: "Timelab 1.cube",
    type: "lut",
  },
  {
    id: "timelab-2",
    name: "Cool",
    lutFile: "Timelab 2.cube",
    type: "lut",
  },
  {
    id: "warm-light",
    name: "Warm Light",
    lutFile: "Warm Light.cube",
    type: "lut",
  },
  {
    id: "bw",
    name: "Black & White",
    lutFile: "B&W.cube",
    type: "lut",
  },
  {
    id: "evolution",
    name: "Evolution",
    lutFile: "Evolution.cube",
    type: "lut",
  },
  {
    id: "orange-teal",
    name: "Orange & Teal",
    lutFile: "Orange & Teal.cube",
    type: "lut",
  },
];
