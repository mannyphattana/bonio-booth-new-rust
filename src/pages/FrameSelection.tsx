import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData, FrameData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import BackButton from "../components/BackButton";
import Countdown from "../components/Countdown"; 

interface Props {
  theme: ThemeData;
  machineData: MachineData;
}

export default function FrameSelection({ theme }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  useIdleTimeout();
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<FrameData | null>(null);
  const [loading, setLoading] = useState(true);

  // --- ระบบ Drag & Scroll ---
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setScrollLeft(scrollRef.current.scrollLeft);
  };

  const handleMouseLeave = () => setIsDragging(false);
  const handleMouseUp = () => setIsDragging(false);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - startX) * 2; 
    scrollRef.current.scrollLeft = scrollLeft - walk;
  };

  const scrollBy = (offset: number) => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: offset, behavior: "smooth" });
    }
  };

  useEffect(() => {
    loadFrames();
  }, []);

  const loadFrames = async () => {
    try {
      const result: any = await invoke("get_frames");
      if (result.success && result.data) {
        const frameList = Array.isArray(result.data)
          ? result.data
          : result.data.frames || [];
        setFrames(frameList);
        if (frameList.length > 0) {
          setSelectedFrame(frameList[0]);
        }
      }
    } catch (err) {
      console.error("Load frames error:", err);
    }
    setLoading(false);
  };

  const handleNext = () => {
    if (!selectedFrame) return;
    navigate("/prepare-shooting", {
      state: { ...state, selectedFrame },
    });
  };

  const arrowButtonStyle: React.CSSProperties = {
    background: "rgba(0,0,0,0.4)",
    color: "white",
    border: "1px solid rgba(255,255,255,0.3)",
    width: "50px",
    height: "50px",
    borderRadius: "50%",
    fontSize: "24px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    zIndex: 20,
    transition: "background 0.2s"
  };

  return (
    <div
      className="page-container page-space-between"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        height: "100vh",
        overflow: "hidden"
      }}
    >
      {/* 1. Header Bar: จัดปุ่มซ้ายขวาให้ตรงกันเป๊ะ! */}
      <div className="header-bar">
        <BackButton onBackClick={() => navigate("/payment-selection", { state })} />
        <Countdown seconds={300} onTimeout={() => navigate("/")} />
      </div>

      {/* 2. ส่วนหัวข้อ (Title) */}
      <div style={{ width: "100%", textAlign: "center", marginTop: "80px", zIndex: 10, height: "80px", flexShrink: 0 }}>
        <h1 style={{ color: "#e94560", fontSize: "42px", fontWeight: "bold", margin: 0, lineHeight: 1 }}>
          เลือกกรอบรูป
        </h1>
        <p style={{ color: theme.fontColor, letterSpacing: "2px", opacity: 0.8, fontSize: "16px", marginTop: "5px" }}>
          SELECT YOUR FRAME
        </p>
      </div>

      {loading ? (
        <div style={{ color: "white", flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>กำลังโหลด...</div>
      ) : (
        <>
          {/* 3. Container สำหรับแถบเลือกรูปและปุ่มลูกศร */}
          <div style={{ 
            width: "100%", 
            height: "160px",
            flexShrink: 0, 
            marginTop: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 20px"
          }}>
            
            <button 
              onClick={() => scrollBy(-200)} 
              style={{ ...arrowButtonStyle, marginRight: "10px" }}
              onMouseOver={(e) => e.currentTarget.style.background = "rgba(233, 69, 96, 0.8)"}
              onMouseOut={(e) => e.currentTarget.style.background = "rgba(0,0,0,0.4)"}
            >
              &#8249;
            </button>

            <div 
              className="no-scrollbar"
              ref={scrollRef}
              onMouseDown={handleMouseDown}
              onMouseLeave={handleMouseLeave}
              onMouseUp={handleMouseUp}
              onMouseMove={handleMouseMove}
              style={{ 
                flex: 1,
                height: "100%", 
                display: "flex",
                alignItems: "center",
                overflowX: "auto",
                cursor: isDragging ? "grabbing" : "grab",
                paddingLeft: "0",
                paddingRight: "0",
                scrollBehavior: "smooth"
              }}
            >
              {frames.map((frame) => (
                <div
                  key={frame._id}
                  onClick={() => setSelectedFrame(frame)}
                  style={{
                    flexShrink: 0,
                    width: "100px",
                    height: "130px",
                    margin: "0 8px",
                    cursor: "pointer",
                    border: selectedFrame?._id === frame._id ? `4px solid #e94560` : "2px solid rgba(255,255,255,0.3)",
                    borderRadius: "12px",
                    overflow: "hidden",
                    transition: "transform 0.2s, border 0.2s",
                    transform: selectedFrame?._id === frame._id ? "scale(1.05)" : "scale(1)",
                    opacity: selectedFrame?._id === frame._id ? 1 : 0.7
                  }}
                >
                  <img 
                    src={frame.previewUrl || frame.imageUrl} 
                    alt={frame.name}
                    style={{ 
                      width: "100%", 
                      height: "100%", 
                      objectFit: "cover", 
                      pointerEvents: "none",
                      backgroundColor: "white"
                    }} 
                  />
                </div>
              ))}
            </div>

            <button 
              onClick={() => scrollBy(200)} 
              style={{ ...arrowButtonStyle, marginLeft: "10px" }}
              onMouseOver={(e) => e.currentTarget.style.background = "rgba(233, 69, 96, 0.8)"}
              onMouseOut={(e) => e.currentTarget.style.background = "rgba(0,0,0,0.4)"}
            >
              &#8250;
            </button>

          </div>

          {/* 4. รูปพรีวิว (Preview) */}
          <div 
            style={{ 
              flex: 1, 
              width: "100%", 
              display: "flex", 
              justifyContent: "center", 
              alignItems: "center",
              minHeight: 0, 
              overflow: "hidden",
              padding: "10px 0"
            }}
          >
            {selectedFrame && (
              <img
                src={selectedFrame.imageUrl}
                alt="Selected"
                style={{ 
                  height: "auto",
                  width: "auto",
                  maxHeight: "30vh",
                  maxWidth: "85%",
                  objectFit: "contain",
                  filter: "drop-shadow(0 10px 30px rgba(0,0,0,0.3))",
                  backgroundColor: "white"
                }}
              />
            )}
          </div>

          {/* 5. ปุ่ม Next (Footer) */}
          <div 
            style={{ 
              width: "100%", 
              height: "100px", 
              display: "flex", 
              justifyContent: "center", 
              alignItems: "center",
              flexShrink: 0,
              position: "relative",
              zIndex: 20
            }}
          >
            <button
              onClick={handleNext}
              disabled={!selectedFrame}
              style={{
                background: "#e94560",
                color: "white",
                padding: "15px 100px",
                borderRadius: "50px",
                fontSize: "26px",
                fontWeight: "bold",
                boxShadow: "0 5px 20px rgba(233, 69, 96, 0.4)",
                border: "none",
                cursor: "pointer"
              }}
            >
              Next
            </button>
             
             <div style={{ position: "absolute", bottom: "10px", right: "40px", opacity: 0.8 }}>
                <span style={{ fontSize: "24px", fontWeight: "bold", color: "#fff" }}>timelab</span>
             </div>
          </div>
        </>
      )}
    </div>
  );
}