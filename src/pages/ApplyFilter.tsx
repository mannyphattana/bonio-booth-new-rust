import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData, Capture, FrameData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import { FILTERS, type FilterConfig } from "../config/filters";
import BackButton from "../components/BackButton";
import Countdown from "../components/Countdown";

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
  
  const selectedFrame: FrameData = state.selectedFrame;

  const getFrameDimensions = () => {
    if (selectedFrame?.imageSize) {
      const parts = selectedFrame.imageSize.split("x");
      if (parts.length === 2) {
        const w = parseInt(parts[0], 10);
        const h = parseInt(parts[1], 10);
        if (w > 0 && h > 0) return { w, h };
      }
    }
    return { w: 3, h: 4 }; 
  };
  const { w: frameW, h: frameH } = getFrameDimensions();
  const frameAspectRatioCSS = `${frameW} / ${frameH}`;

  const [selectedFilter, setSelectedFilter] = useState<FilterConfig>(FILTERS[0]);
  const [previewImage, setPreviewImage] = useState(firstPhoto);
  const [filterPreviews, setFilterPreviews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [applyingAll, setApplyingAll] = useState(false);
  const [applyProgress, setApplyProgress] = useState("");
  
  const previewCacheRef = useRef<Record<string, string>>({});
  const resolvedPathsRef = useRef<Record<string, string>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useIdleTimeout();

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
      if (firstPhoto) {
        generateFilterPreviews();
      }
    };
    resolvePaths();
  }, [firstPhoto]);

  const generateFilterPreviews = async () => {
    const promises = FILTERS.map(async (filter) => {
      const lutPath = resolvedPathsRef.current[filter.id] || "";
      try {
        const result: string = await invoke("apply_lut_filter_preview", {
          imageDataBase64: firstPhoto,
          lutFilePath: lutPath,
          maxSize: 150, 
        });
        setFilterPreviews((prev) => ({ ...prev, [filter.id]: result }));
        previewCacheRef.current[filter.id] = result;
      } catch (err) {
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
      let ffmpegAvailable = false;
      try {
        setApplyProgress("กำลังตรวจสอบ FFmpeg...");
        ffmpegAvailable = await invoke<boolean>("ensure_ffmpeg");
      } catch (err) {
        try {
          ffmpegAvailable = await invoke<boolean>("check_ffmpeg_available");
        } catch {
          ffmpegAvailable = false;
        }
      }

      if (selectedFilter && selectedFilter.type === "lut") {
        const lutPath = resolvedPathsRef.current[selectedFilter.id] || "";
        setApplyProgress("Processing...");
        const photoPromises = frameCaptures.map(async (cap, idx) => {
          setApplyProgress(`Processing${idx + 1}/${frameCaptures.length}...`);
          const filteredPhoto: string = await invoke("apply_lut_filter", {
            imageDataBase64: cap.photo,
            lutFilePath: lutPath,
          });
          return { ...cap, photo: filteredPhoto };
        });

        filteredCaptures = await Promise.all(photoPromises);
      }

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
        state: { ...state, selectedFilter: selectedFilter || null },
      });
    }

    setApplyingAll(false);
  };

  // --- ปุ่มเลื่อนซ้ายขวา ---
  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -250, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 250, behavior: "smooth" });
    }
  };

  // --- ระบบ Click & Drag (รองรับเมาส์และทัชสกรีน) ---
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeftPos, setScrollLeftPos] = useState(0);
  const dragDistanceRef = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft);
    setScrollLeftPos(scrollContainerRef.current.scrollLeft);
    dragDistanceRef.current = 0; 
  };

  const onMouseLeave = () => {
    setIsDragging(false);
  };

  const onMouseUp = () => {
    setIsDragging(false);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault(); 
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - startX) * 2; 
    scrollContainerRef.current.scrollLeft = scrollLeftPos - walk;
    dragDistanceRef.current = Math.abs(x - startX); 
  };

  const handleFilterClick = (filter: FilterConfig) => {
    if (dragDistanceRef.current > 5) return; 
    handleSelectFilter(filter);
  };

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        justifyContent: "flex-start",
        padding: 0, 
        position: "relative",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        userSelect: "none", 
      }}
    >
      <style>
        {`
          .hide-scrollbar::-webkit-scrollbar { display: none; }
          .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          * { outline: none !important; -webkit-tap-highlight-color: transparent !important; }
        `}
      </style>

      {/* 1. Header */}
      <div style={{ position: "relative", width: "100%", padding: "50px 40px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start", zIndex: 100 }}>
        <div style={{ zIndex: 10 }}>
          <BackButton onBackClick={() => navigate("/slot-selection", { state })} />
        </div>
        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", textAlign: "center", top: "45px", width: "100%", zIndex: 5 }}>
          <h1 style={{ color: "#e94560", fontSize: "2.6rem", fontWeight: "bold", margin: 0, lineHeight: 1 }}>
            ตกแต่งรูปของคุณ
          </h1>
          <p style={{ color: "#e94560", opacity: 0.8, fontSize: "1rem", marginTop: "5px", textTransform: "uppercase", letterSpacing: "1px" }}>
            DECORATE YOUR PHOTO
          </p>
        </div>
        <div style={{ zIndex: 10 }}>
           <Countdown seconds={300} onTimeout={() => navigate("/")} />
        </div>
      </div>

      {/* 2. แถบเลือก Filter */}
      <div style={{ position: "relative", width: "100%", padding: "0 30px", marginTop: "130px", marginBottom: "30px", zIndex: 50 }}>
        
        <button onClick={scrollLeft} style={{
            position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)",
            width: "45px", height: "45px", borderRadius: "50%", backgroundColor: "#f13b4f", color: "white", border: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", cursor: "pointer", zIndex: 10, boxShadow: "0 4px 10px rgba(0,0,0,0.2)"
        }}>❮</button>

        <div 
          ref={scrollContainerRef} 
          className="hide-scrollbar" 
          onMouseDown={onMouseDown}
          onMouseLeave={onMouseLeave}
          onMouseUp={onMouseUp}
          onMouseMove={onMouseMove}
          style={{
            display: "flex", gap: "15px", overflowX: "auto", scrollBehavior: "smooth",
            padding: "15px 60px", WebkitOverflowScrolling: "touch", width: "100%",
            alignItems: "stretch", touchAction: "pan-x",
            cursor: isDragging ? "grabbing" : "grab"
        }}>
          {FILTERS.map((filter) => {
            const isSelected = selectedFilter?.id === filter.id;
            return (
              <div 
                key={filter.id} 
                onClick={() => handleFilterClick(filter)} 
                style={{
                  flexShrink: 0, width: "auto", display: "flex", flexDirection: "column", alignItems: "center",
                  padding: 0, background: "transparent", cursor: "pointer", position: "relative",
                  outline: "none", WebkitTapHighlightColor: "transparent"
              }}>
                {/* เครื่องหมายถูก ตรงกลางด้านบน */}
                {isSelected && (
                  <div style={{
                    position: "absolute", top: "-10px", left: "50%", transform: "translateX(-50%)", zIndex: 10,
                    width: "24px", height: "24px", backgroundColor: "#f13b4f",
                    borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    color: "white", fontSize: "12px", border: "2px solid white", boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
                    pointerEvents: "none"
                  }}>
                    ✔
                  </div>
                )}

                {/* กรอบ Filter Card - ขนาดคงที่ตลอดเวลา */}
                <div style={{
                    boxSizing: "border-box", // สำคัญ: รวม border และ padding ในขนาด
                    width: "110px", 
                    aspectRatio: frameAspectRatioCSS,
                    borderRadius: "12px", overflow: "hidden", position: "relative",
                    
                    // ถ้าเลือก: พื้นหลังใส (มองทะลุ), ถ้าไม่เลือก: พื้นหลังขาว
                    backgroundColor: isSelected ? "transparent" : "white", 
                    
                    // ถ้าเลือก: เส้นขอบแดง, ถ้าไม่เลือก: เส้นขอบใส (จองพื้นที่ไว้)
                    border: isSelected ? `3px solid #f13b4f` : "3px solid transparent", 
                    
                    // Padding คงที่ตลอดเวลา เพื่อสร้างระยะห่างที่เท่ากัน
                    padding: "6px 6px 0 6px", 
                    
                    boxShadow: isSelected ? "0 8px 20px rgba(241, 59, 79, 0.4)" : "0 4px 12px rgba(0,0,0,0.1)",
                    transition: "all 0.2s ease",
                    display: "flex", flexDirection: "column", 
                    pointerEvents: "none" 
                  }}>
                  
                  {/* ส่วนรูปภาพ */}
                  <div style={{ flex: 1, width: "100%", position: "relative", backgroundColor: "#f0f0f0", borderRadius: "6px", overflow: "hidden" }}>
                    <img 
                      src={filterPreviews[filter.id] || firstPhoto} 
                      alt={filter.name} 
                      draggable={false} 
                      style={{ position: "absolute", top:0, left:0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} 
                    />
                  </div>
                  
                  {/* ส่วนชื่อ Filter */}
                  <div style={{
                    // ถ้าเลือก: พื้นหลังใส, ถ้าไม่เลือก: พื้นหลังขาว
                    backgroundColor: isSelected ? "transparent" : "white",
                    color: isSelected ? "#f13b4f" : "#666", 
                    padding: "8px 0 6px", 
                    fontSize: "12px", fontWeight: "bold", textAlign: "center",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    flexShrink: 0 
                  }}>
                    {filter.name}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={scrollRight} style={{
            position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)",
            width: "45px", height: "45px", borderRadius: "50%", backgroundColor: "#f13b4f", color: "white", border: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", cursor: "pointer", zIndex: 10, boxShadow: "0 4px 10px rgba(0,0,0,0.2)"
        }}>❯</button>
      </div>

      {/* 3. รูป Preview ขนาดใหญ่ด้านล่าง */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 30px 20px", width: "100%" }}>
        <div style={{
          width: "100%", maxWidth: "800px", height: "auto", maxHeight: "40vh", 
          aspectRatio: "16 / 9",
          borderRadius: "15px", overflow: "hidden",
          boxShadow: "0 10px 30px rgba(0,0,0,0.3)", position: "relative", background: "black"
        }}>
          {loading && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2, color: "#fff", fontSize: "16px" }}>
              Applying...
            </div>
          )}
          <img 
            src={previewImage} 
            alt="Preview" 
            draggable={false} 
            style={{ width: "100%", height: "100%", objectFit: "contain" }} 
          />
        </div>
      </div>

      {/* 4. Footer Button: ปุ่ม Print */}
      <div style={{ width: "100%", display: "flex", justifyContent: "center", paddingBottom: "50px", paddingTop: "10px", zIndex: 100 }}>
        <button
          onClick={handleNext}
          disabled={applyingAll}
          style={{
            backgroundColor: applyingAll ? "#666" : "#f13b4f",
            color: "white", padding: "14px 70px", borderRadius: "14px",
            fontSize: "22px", fontWeight: "600", border: "none",
            cursor: applyingAll ? "not-allowed" : "pointer",
            boxShadow: "0 8px 20px rgba(241, 59, 79, 0.3)",
            display: "flex", alignItems: "center", gap: "12px", transition: "all 0.3s",
            outline: "none"
          }}
        >
          {applyingAll ? (
            <span>{applyProgress || "Processing..."}</span>
          ) : (
            <>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
              Print
            </>
          )}
        </button>
      </div>

    </div>
  );
}