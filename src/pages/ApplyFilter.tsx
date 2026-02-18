import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData, Capture } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import { FILTERS, type FilterConfig } from "../config/filters";
import HorizontalScroll from "../components/HorizontalScroll";

import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
}

export default function ApplyFilter({ theme }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};

  const frameCaptures: Capture[] = state.frameCaptures || [];
  const firstPhoto = frameCaptures[0]?.photo || "";

  const [selectedFilter, setSelectedFilter] = useState<FilterConfig>(
    FILTERS[0],
  );
  const [previewImage, setPreviewImage] = useState(firstPhoto);
  const [filterPreviews, setFilterPreviews] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [applyingAll, setApplyingAll] = useState(false);
  const [applyProgress, setApplyProgress] = useState("");
  const previewCacheRef = useRef<Record<string, string>>({});
  // Cache resolved LUT paths: id -> absolute path
  const resolvedPathsRef = useRef<Record<string, string>>({});
  useIdleTimeout();

  // Resolve LUT paths for all filters on mount
  useEffect(() => {
    const resolvePaths = async () => {
      for (const filter of FILTERS) {
        if (filter.type === "none" || !filter.lutFile) continue;
        try {
          const resolved: string = await invoke("resolve_lut_path", {
            lutFile: filter.lutFile,
          });
          resolvedPathsRef.current[filter.id] = resolved;
        } catch (err) {
          console.warn(`LUT not found for ${filter.id}:`, err);
        }
      }

      // Generate previews after paths are resolved
      if (firstPhoto) {
        generateFilterPreviews();
      }
    };
    resolvePaths();
  }, []); // eslint-disable-line

  // Generate actual LUT-applied preview thumbnails for each filter (fast - resized)
  const generateFilterPreviews = async () => {
    const promises = FILTERS.map(async (filter) => {
      const lutPath = resolvedPathsRef.current[filter.id] || "";
      try {
        const result: string = await invoke("apply_lut_filter_preview", {
          imageDataBase64: firstPhoto,
          lutFilePath: lutPath,
          maxSize: 200,
        });
        setFilterPreviews((prev) => ({ ...prev, [filter.id]: result }));
        previewCacheRef.current[filter.id] = result;
      } catch (err) {
        console.error(`Preview for ${filter.name} failed:`, err);
        setFilterPreviews((prev) => ({ ...prev, [filter.id]: firstPhoto }));
      }
    });
    await Promise.all(promises);
  };

  const handleSelectFilter = async (filter: FilterConfig) => {
    setSelectedFilter(filter);
    setLoading(true);

    try {
      if (filter.type === "none") {
        setPreviewImage(firstPhoto);
      } else {
        // Use cached preview if available
        if (previewCacheRef.current[`full_${filter.id}`]) {
          setPreviewImage(previewCacheRef.current[`full_${filter.id}`]);
        } else {
          const lutPath = resolvedPathsRef.current[filter.id] || "";
          const result: string = await invoke("apply_lut_filter_preview", {
            imageDataBase64: firstPhoto,
            lutFilePath: lutPath,
            maxSize: 800,
          });
          setPreviewImage(result);
          previewCacheRef.current[`full_${filter.id}`] = result;
        }
      }
    } catch (err) {
      console.error("Apply filter preview error:", err);
      setPreviewImage(firstPhoto);
    }

    setLoading(false);
  };

  const handleNext = async () => {
    setApplyingAll(true);

    try {
      let filteredCaptures = [...frameCaptures];

      // Ensure FFmpeg is available (auto-download if needed)
      let ffmpegAvailable = false;
      try {
        setApplyProgress("กำลังตรวจสอบ FFmpeg...");
        ffmpegAvailable = await invoke<boolean>("ensure_ffmpeg");
      } catch (err) {
        console.warn("⚠️ FFmpeg not available, trying fallback check...", err);
        try {
          ffmpegAvailable = await invoke<boolean>("check_ffmpeg_available");
        } catch {
          ffmpegAvailable = false;
        }
      }
      if (!ffmpegAvailable) {
        console.warn("⚠️ FFmpeg not found - skipping video processing");
      }

      if (selectedFilter && selectedFilter.type === "lut") {
        const lutPath = resolvedPathsRef.current[selectedFilter.id] || "";
        if (!lutPath) {
          console.warn(`No resolved path for filter ${selectedFilter.id}`);
        }

        // Apply filter to all frame captures - photos only
        // Video LUT filter is applied in compose_frame_video (single FFmpeg pass)
        setApplyProgress("กำลังใส่ฟิลเตอร์รูปภาพ...");
        const photoPromises = frameCaptures.map(async (cap, idx) => {
          setApplyProgress(
            `กำลังใส่ฟิลเตอร์รูป ${idx + 1}/${frameCaptures.length}...`,
          );
          const filteredPhoto: string = await invoke("apply_lut_filter", {
            imageDataBase64: cap.photo,
            lutFilePath: lutPath,
          });
          return { ...cap, photo: filteredPhoto };
        });

        filteredCaptures = await Promise.all(photoPromises);
      }

      // Video processing (loop + LUT + compose) is done in PhotoResult via compose_frame_video
      // No per-video FFmpeg passes needed here anymore

      navigate("/photo-result", {
        state: {
          ...state,
          frameCaptures: filteredCaptures,
          selectedFilter: selectedFilter || null,
        },
      });
    } catch (err) {
      console.error("Apply filter error:", err);
      navigate("/photo-result", {
        state: {
          ...state,
          selectedFilter: selectedFilter || null,
        },
      });
    }

    setApplyingAll(false);
  };

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        justifyContent: "flex-start",
        padding: "120px 0",
      }}
    >
      <Countdown
        seconds={COUNTDOWN.PHOTO_FILTER.DURATION}
        onComplete={() => navigate("/")}
        visible={COUNTDOWN.PHOTO_FILTER.VISIBLE}
      />

      <h1
        style={{
          color: theme.fontColor,
          fontSize: 22,
          marginTop: 60,
          marginBottom: 4,
        }}
      >
        เลือก Filter
      </h1>
      <p
        style={{
          color: theme.fontColor,
          opacity: 0.8,
          fontSize: 14,
          marginBottom: 12,
        }}
      >
        SELECT FILTER
      </p>

      {/* Filter thumbnails (scrollable) */}
      <HorizontalScroll padding="0 48px" arrowColor={theme.fontColor}>
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            onClick={() => handleSelectFilter(filter)}
            style={{
              flexShrink: 0,
              width: 90,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              padding: 0,
              background: "transparent",
              border:
                selectedFilter?.id === filter.id
                  ? `2px solid ${theme.primaryColor}`
                  : "2px solid transparent",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: 86,
                height: 100,
                borderRadius: 10,
                overflow: "hidden",
                background: "#222",
              }}
            >
              {(filterPreviews[filter.id] || firstPhoto) && (
                <img
                  src={filterPreviews[filter.id] || firstPhoto}
                  alt={filter.name}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              )}
            </div>
            <span
              style={{
                color:
                  selectedFilter?.id === filter.id
                    ? theme.primaryColor
                    : "#aaa",
                fontSize: 10,
                fontWeight: 600,
                textAlign: "center",
                padding: "0 4px 4px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                width: "100%",
              }}
            >
              {filter.name}
            </span>
          </button>
        ))}
      </HorizontalScroll>

      {/* Preview image (center) */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px 24px",
          width: "100%",
        }}
      >
        <div
          style={{
            maxWidth: "80%",
            maxHeight: "55vh",
            borderRadius: 12,
            overflow: "hidden",
            // boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            position: "relative",
          }}
        >
          {loading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 2,
                color: "#fff",
                fontSize: 16,
              }}
            >
              Applying...
            </div>
          )}
          <img
            src={previewImage}
            alt="Preview"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
          />
        </div>
      </div>

      {/* Selected filter name */}
      <p
        style={{
          color: theme.fontColor,
          fontSize: 16,
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {selectedFilter?.name || "No Filter"}
      </p>

      {/* Next button */}
      <button
        className="primary-button"
        onClick={handleNext}
        disabled={applyingAll}
        style={{
          background: applyingAll ? "#444" : theme.primaryColor,
          color: theme.textButtonColor,
          marginBottom: 20,
        }}
      >
        {applyingAll ? applyProgress || "กำลังประมวลผล..." : "ถัดไป / NEXT"}
      </button>
    </div>
  );
}
