use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct Lut3D {
    pub size: usize,
    pub data: Vec<[f32; 3]>,
}

/// Post-LUT shadow correction: removes a green cast in dark shadow regions
/// (e.g. dark clothing / background) by pulling shadow tones toward neutral luma.
/// Applied to the LUT's own output color, so it can be baked directly into the
/// LUT grid entries (see `Lut3D::with_shadow_fix`) instead of being reapplied
/// per-pixel after interpolation.
pub fn apply_shadow_fix(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let luma = 0.299 * r + 0.587 * g + 0.114 * b;
    let shadow_threshold = 0.28;

    if luma < shadow_threshold {
        let t = luma / shadow_threshold;
        let curve = t * t;

        (
            luma + (r - luma) * curve,
            luma + (g - luma) * curve,
            luma + (b - luma) * curve,
        )
    } else {
        (r, g, b)
    }
}

impl Lut3D {
    pub fn parse_cube_file(path: &str) -> Result<Self, String> {
        let content = fs::read_to_string(path).map_err(|e| format!("Read LUT file error: {}", e))?;
        let mut size: usize = 0;
        let mut data: Vec<[f32; 3]> = Vec::new();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if line.starts_with("LUT_3D_SIZE") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    size = parts[1].parse().map_err(|e| format!("Parse size error: {}", e))?;
                }
                continue;
            }
            if line.starts_with("TITLE") || line.starts_with("DOMAIN_MIN") || line.starts_with("DOMAIN_MAX") {
                continue;
            }

            let values: Vec<f32> = line
                .split_whitespace()
                .filter_map(|v| v.parse::<f32>().ok())
                .collect();

            if values.len() == 3 {
                data.push([values[0], values[1], values[2]]);
            }
        }

        if size == 0 || data.is_empty() {
            return Err("Invalid LUT file".to_string());
        }

        Ok(Lut3D { size, data })
    }

    pub fn apply(&self, r: f32, g: f32, b: f32) -> (f32, f32, f32) {
        let max_idx = (self.size - 1) as f32;

        let ri = r.clamp(0.0, 1.0) * max_idx;
        let gi = g.clamp(0.0, 1.0) * max_idx;
        let bi = b.clamp(0.0, 1.0) * max_idx;

        let r0 = ri.floor() as usize;
        let g0 = gi.floor() as usize;
        let b0 = bi.floor() as usize;
        let r1 = (r0 + 1).min(self.size - 1);
        let g1 = (g0 + 1).min(self.size - 1);
        let b1 = (b0 + 1).min(self.size - 1);

        let rf = ri - r0 as f32;
        let gf = gi - g0 as f32;
        let bf = bi - b0 as f32;

        let idx = |r: usize, g: usize, b: usize| -> usize {
            b * self.size * self.size + g * self.size + r
        };

        let c000 = self.data[idx(r0, g0, b0)];
        let c100 = self.data[idx(r1, g0, b0)];
        let c010 = self.data[idx(r0, g1, b0)];
        let c110 = self.data[idx(r1, g1, b0)];
        let c001 = self.data[idx(r0, g0, b1)];
        let c101 = self.data[idx(r1, g0, b1)];
        let c011 = self.data[idx(r0, g1, b1)];
        let c111 = self.data[idx(r1, g1, b1)];

        let lerp = |a: f32, b: f32, t: f32| a + (b - a) * t;

        let mut result = [0.0f32; 3];
        for i in 0..3 {
            let c00 = lerp(c000[i], c100[i], rf);
            let c10 = lerp(c010[i], c110[i], rf);
            let c01 = lerp(c001[i], c101[i], rf);
            let c11 = lerp(c011[i], c111[i], rf);

            let c0 = lerp(c00, c10, gf);
            let c1 = lerp(c01, c11, gf);

            result[i] = lerp(c0, c1, bf);
        }

        (
            result[0].clamp(0.0, 1.0),
            result[1].clamp(0.0, 1.0),
            result[2].clamp(0.0, 1.0),
        )
    }

    /// Returns a copy of this LUT with the shadow-fix baked into every grid entry,
    /// so that trilinear interpolation over the corrected grid reproduces (very
    /// closely) the effect of applying `apply_shadow_fix` after interpolation.
    pub fn with_shadow_fix(&self) -> Lut3D {
        let data = self
            .data
            .iter()
            .map(|&[r, g, b]| {
                let (nr, ng, nb) = apply_shadow_fix(r, g, b);
                [nr.clamp(0.0, 1.0), ng.clamp(0.0, 1.0), nb.clamp(0.0, 1.0)]
            })
            .collect();

        Lut3D { size: self.size, data }
    }

    /// Writes this LUT out as a standard .cube file (R fastest, then G, then B),
    /// matching the row order this struct expects when parsing.
    pub fn write_cube_file(&self, path: &Path) -> Result<(), String> {
        let mut out = String::with_capacity(self.data.len() * 24 + 32);
        out.push_str(&format!("LUT_3D_SIZE {}\n", self.size));

        let idx = |r: usize, g: usize, b: usize| -> usize {
            b * self.size * self.size + g * self.size + r
        };

        for b in 0..self.size {
            for g in 0..self.size {
                for r in 0..self.size {
                    let c = self.data[idx(r, g, b)];
                    out.push_str(&format!("{:.6} {:.6} {:.6}\n", c[0], c[1], c[2]));
                }
            }
        }

        fs::write(path, out).map_err(|e| format!("Write LUT file error: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_shadow_fix_matches_post_process_at_grid_points() {
        // identity LUT: entry (r,g,b) == grid coordinate itself
        let size = 5usize;
        let mut data = Vec::with_capacity(size * size * size);
        for b in 0..size {
            for g in 0..size {
                for r in 0..size {
                    let s = (size - 1) as f32;
                    data.push([r as f32 / s, g as f32 / s, b as f32 / s]);
                }
            }
        }
        let lut = Lut3D { size, data };
        let corrected = lut.with_shadow_fix();

        assert_eq!(corrected.size, lut.size);
        assert_eq!(corrected.data.len(), lut.data.len());

        for (orig, fixed) in lut.data.iter().zip(corrected.data.iter()) {
            let expected = apply_shadow_fix(orig[0], orig[1], orig[2]);
            assert!((fixed[0] - expected.0).abs() < 1e-6);
            assert!((fixed[1] - expected.1).abs() < 1e-6);
            assert!((fixed[2] - expected.2).abs() < 1e-6);
        }
    }

    #[test]
    fn write_and_reparse_roundtrip() {
        let lut = Lut3D {
            size: 2,
            data: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [1.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
                [1.0, 0.0, 1.0],
                [0.0, 1.0, 1.0],
                [1.0, 1.0, 1.0],
            ],
        };
        let path = std::env::temp_dir().join("bonio_lut_roundtrip_test.cube");
        lut.write_cube_file(&path).unwrap();
        let reparsed = Lut3D::parse_cube_file(path.to_str().unwrap()).unwrap();
        let _ = fs::remove_file(&path);

        assert_eq!(reparsed.size, lut.size);
        for (a, b) in lut.data.iter().zip(reparsed.data.iter()) {
            assert!((a[0] - b[0]).abs() < 1e-5);
            assert!((a[1] - b[1]).abs() < 1e-5);
            assert!((a[2] - b[2]).abs() < 1e-5);
        }
    }

    #[test]
    fn shadow_fix_pulls_dark_green_cast_toward_neutral() {
        // A dark, green-tinted shadow color should be pulled toward its own luma
        let (r, g, b) = apply_shadow_fix(0.05, 0.20, 0.05);
        let luma = 0.299 * 0.05 + 0.587 * 0.20 + 0.114 * 0.05;
        // corrected green channel should move closer to luma than the original
        assert!((g - luma).abs() < (0.20f32 - luma).abs());
        // bright, above-threshold colors are untouched
        let (r2, g2, b2) = apply_shadow_fix(0.9, 0.5, 0.3);
        assert_eq!((r2, g2, b2), (0.9, 0.5, 0.3));
        let _ = (r, b);
    }
}
