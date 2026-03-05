import { useNavigate } from "react-router-dom";
import { useCallback, useRef, useState } from "react";
import BackButton from "../components/BackButton";
import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";
import type { ThemeData } from "../App";
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";

interface Props {
  theme: ThemeData;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
}

export default function TermsAndServices({
  theme,
  onFormatReset,
  onBeforeClose,
}: Props) {
  const navigate = useNavigate();
  const {
    showContextMenu,
    setShowContextMenu,
    handleContextMenu,
    handleTouchStart,
  } = useContextMenu();

  const handleBack = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleCountdownComplete = useCallback(() => {
    handleBack();
  }, [handleBack]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startY, setStartY] = useState(0);
  const [scrollTopPos, setScrollTopPos] = useState(0);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setStartY(e.pageY - scrollContainerRef.current.offsetTop);
    setScrollTopPos(scrollContainerRef.current.scrollTop);
  };
  const onMouseLeave = () => setIsDragging(false);
  const onMouseUp = () => setIsDragging(false);
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const y = e.pageY - scrollContainerRef.current.offsetTop;
    const walk = (y - startY) * 2;
    scrollContainerRef.current.scrollTop = scrollTopPos - walk;
  };

  // Inline styles based on legacy CSS but using theme props
  const containerStyle: React.CSSProperties = {
    width: "100vw",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    // Use backgroundImage for theme.backgroundSecond as it is an image URL
    backgroundImage: theme?.backgroundSecond
      ? `url(${theme.backgroundSecond})`
      : "none",
    backgroundColor: "#000", // Fallback color
    color: theme?.fontColor || "#fff",
    position: "relative",
    backgroundSize: "cover",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center",
  };

  const contentWrapperStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    overflowY: "auto",
    padding: "4rem 2rem 2rem 2rem",
    width: "100%",
    maxWidth: "1200px",
    margin: "0 auto",
  };

  const contentStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: "720px",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: "16px",
    padding: "3rem",
  };

  const titleStyle: React.CSSProperties = {
    fontSize: "2rem",
    fontWeight: "bold",
    marginBottom: "1.5rem",
    textAlign: "center",
    color: theme?.fontColor || "#fff",
    paddingInline: "3rem",
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: "2rem",
  };

  const instructionStyle: React.CSSProperties = {
    fontSize: "1.1rem",
    lineHeight: "1.6",
    marginBottom: "1rem",
    color: theme?.fontColor || "#e5e7eb",
    textAlign: "justify",
    textJustify: "inter-character",
    wordBreak: "break-word",
    overflowWrap: "break-word",
    hyphens: "auto",
    opacity: 0.9,
  };

  const subHeaderStyle: React.CSSProperties = {
    fontSize: "1.25rem",
    fontWeight: "bold",
    marginTop: "1.5rem",
    marginBottom: "0.75rem",
    color: theme?.fontColor || "#fbbf24", // Application of theme font color
  };

  const listStyle: React.CSSProperties = {
    listStyleType: "disc",
    paddingLeft: "1.5rem",
    marginBottom: "1rem",
    color: theme?.fontColor || "#e5e7eb",
    opacity: 0.9,
  };

  const listItemStyle: React.CSSProperties = {
    marginBottom: "0.5rem",
    lineHeight: "1.5",
  };

  const termTitleStyle: React.CSSProperties = {
    ...subHeaderStyle,
  };

  const termContentStyle: React.CSSProperties = {
    ...instructionStyle,
  };

  return (
    <div
      style={containerStyle}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
    >
      <BackButton onBackClick={handleBack} />
      <Countdown
        seconds={COUNTDOWN.TERMS_AND_SERVICES.DURATION}
        onComplete={handleCountdownComplete}
        visible={COUNTDOWN.TERMS_AND_SERVICES.VISIBLE}
      />

      <div
        style={{
          ...contentWrapperStyle,
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
        ref={scrollContainerRef}
        onMouseDown={onMouseDown}
        onMouseLeave={onMouseLeave}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        className="hide-scrollbar"
      >
        <div style={contentStyle}>
          <h1 style={titleStyle}>
            ข้อกําหนดและเงื่อนไขการใช้บริการ "ตู้ถ่ายรูป Timelab Photobooth"
          </h1>

          <div style={sectionStyle}>
            <p style={instructionStyle}>
              ข้อกําหนดและเงื่อนไขการใช้บริการ "ตู้ถ่ายรูป Timelab Photobooth"
              ฉบับนี้ (ต่อไปนี้เรียกว่า "ข้อกําหนดและเงื่อนไข")
              เป็นข้อตกลงทางกฎหมายระหว่างผู้ใช้บริการ (ต่อไปนี้เรียกว่า
              "ผู้ใช้บริการ") กับ Timelab Photobooth
              ซึ่งเป็นผู้ประกอบการบริการตู้ถ่ายรูป (ต่อไปนี้เรียกว่า
              "ผู้ให้บริการ") เกี่ยวกับการใช้บริการตู้ถ่ายรูปของ Timelab
              Photobooth
            </p>
            <p style={instructionStyle}>
              โปรดอ่านข้อกําหนดและเงื่อนไขนี้อย่างละเอียดก่อนเริ่มใช้บริการ
              เนื่องจากเอกสารนี้กําหนดสิทธิ หน้าที่ ความรับผิดชอบ
              รวมถึงแนวทางการแก้ไขปัญหาต่าง ๆ ที่เกี่ยวข้องกับการใช้บริการ
              เมื่อคุณเริ่มใช้บริการตู้ถ่ายรูปของ Timelab Photobooth
              ไม่ว่าในส่วนใดส่วนหนึ่ง ถือว่าคุณยืนยันว่าได้อ่าน ทําความเข้าใจ
              และยอมรับข้อกําหนดและเงื่อนไขนี้โดยสมบูรณ์แล้ว
              หากคุณไม่ยอมรับข้อกําหนดดังกล่าว กรุณาหยุดการใช้บริการทันที
              ทั้งนี้ ผู้ให้บริการสงวนสิทธิ์ในการแก้ไข เพิ่มเติม
              หรือปรับปรุงข้อกําหนดและเงื่อนไขนี้ได้ทุกเมื่อ
              โดยจะมีผลเมื่อมีการประกาศผ่านช่องทางที่ผู้ให้บริการกําหนด
              การใช้บริการอย่างต่อเนื่องหลังจากมีการแก้ไขถือว่าคุณยอมรับเงื่อนไขที่มีการปรับปรุงแล้ว
            </p>
          </div>

          <div style={sectionStyle}>
            <div style={{ marginBottom: "2rem" }}>
              <h2 style={termTitleStyle}>1. คําจํากัดความ</h2>
              <p style={termContentStyle}>
                ข้อกําหนดและเงื่อนไขฉบับนี้
                ให้คําดังต่อไปนี้มีความหมายตามที่กําหนดไว้
                เว้นแต่บริบทจะระบุเป็นอย่างอื่น
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>"ผู้ให้บริการ"</strong> หมายถึง Timelab Photobooth
                ผู้ประกอบการบริการตู้ถ่ายรูป รวมถึงพนักงาน ตัวแทน ผู้จัดการ
                หรือบุคคลใด ๆ ที่ Timelab Photobooth มอบอํานาจให้ดําเนินการแทน
                ทั้งนี้ผู้ให้บริการมีสิทธิ์ในการบริหารจัดการ ควบคุมบริการ
                และเนื้อหาสาระทั้งหมดที่เกี่ยวข้องกับการให้บริการตู้ถ่ายรูป
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>"ผู้ใช้บริการ"</strong> หมายถึง
                บุคคลธรรมดาที่เข้าใช้งานหรือใช้บริการตู้ถ่ายรูปของ Timelab
                Photobooth ไม่ว่าจะโดยตรงหรือผ่านอุปกรณ์ใด ๆ
                โดยผู้ใช้บริการจะต้องปฏิบัติตามข้อกําหนดและเงื่อนไขของผู้ให้บริการทั้งหมด
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>"ข้อมูลของผู้ใช้บริการ"</strong> หมายถึง
                ข้อมูลส่วนบุคคลหรือข้อมูลอิเล็กทรอนิกส์ใด ๆ
                ที่ผู้ใช้บริการให้ไว้
                หรือที่เกิดขึ้นจากการใช้บริการตู้ถ่ายรูปของ Timelab Photobooth
                รวมถึงภาพถ่าย ข้อมูลการชําระเงิน และข้อมูลอื่น ๆ ที่เกี่ยวข้อง
                ทั้งนี้ Timelab Photobooth เป็นผู้ควบคุมข้อมูลส่วนบุคคล (Data
                Controller) ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
                และรับผิดชอบการดูแลข้อมูลดังกล่าวแต่เพียงผู้เดียว
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>"บริการตู้ถ่ายรูป Timelab Photobooth"</strong> หมายถึง
                บริการถ่ายภาพอัตโนมัติที่ Timelab Photobooth จัดให้
                ซึ่งรวมถึงการถ่ายภาพบุคคลหรือภาพกลุ่ม การเลือกธีม กรอบ ฟิลเตอร์
                หรือองค์ประกอบตกแต่งภาพ
                การแสดงตัวอย่างและเลือกภาพก่อนบันทึกหรือพิมพ์
                การจัดเตรียมไฟล์ภาพดิจิทัลเพื่อดาวน์โหลด
                รวมถึงการพิมพ์ภาพในรูปแบบและจํานวนที่เลือก ทั้งนี้
                บริการอาจมีการเปลี่ยนแปลง ปรับปรุง
                หรือเพิ่มเติมตามดุลพินิจของผู้ให้บริการ
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>"เหตุสุดวิสัย"</strong> หมายถึง เหตุการณ์หรือสถานการณ์ใด
                ๆ ที่อยู่นอกเหนือการควบคุมของผู้ให้บริการหรือผู้ใช้บริการ
                โดยรวมถึงแต่ไม่จํากัดเพียง ภัยธรรมชาติทุกชนิด
                เหตุการณ์ที่เกิดจากมนุษย์ เหตุการณ์ทางเทคนิค
                และเหตุการณ์ทางสุขภาพหรือโรคระบาด
                อันส่งผลให้ไม่สามารถปฏิบัติตามข้อกําหนดและเงื่อนไขได้อย่างสมบูรณ์
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>"ทรัพย์สินทางปัญญา"</strong> หมายถึง
                สิทธิทางกฎหมายหรือผลประโยชน์ทางเศรษฐกิจที่เกี่ยวข้องกับผลงานทางความคิดสร้างสรรค์
                รวมถึงแต่ไม่จํากัดเพียง สิทธิบัตร เครื่องหมายการค้า ลิขสิทธิ์
                ซอฟต์แวร์ แอปพลิเคชัน และสิทธิอื่น ๆ ที่คล้ายคลึงกัน
                ไม่ว่าจะสามารถจดทะเบียนได้หรือไม่ก็ตาม
              </p>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h2 style={termTitleStyle}>2. การใช้บริการ</h2>
              <p style={termContentStyle}>
                ผู้ใช้บริการสามารถใช้บริการตู้ถ่ายรูป Timelab Photobooth
                เพื่อถ่ายภาพ ดาวน์โหลด
                หรือรับภาพผ่านช่องทางที่ผู้ให้บริการกําหนดเท่านั้น
                ผู้ใช้บริการตกลงว่าจะไม่ใช้บริการเพื่อกระทําการใด ๆ ที่ผิดกฎหมาย
                ฝ่าฝืนข้อกําหนดและเงื่อนไขนี้ ขัดต่อศีลธรรมอันดี
                หรืออาจก่อให้เกิดความเสียหายแก่ผู้ให้บริการ บุคคลภายนอก
                หรือผู้ใช้บริการรายอื่น
              </p>
              <br />
              <p style={termContentStyle}>
                ในกรณีที่ผู้ให้บริการพบว่าผู้ใช้บริการละเมิดข้อกําหนดและเงื่อนไขนี้
                ผู้ให้บริการมีสิทธิระงับ ยกเลิก
                หรือจํากัดการเข้าถึงบริการทั้งหมดหรือบางส่วนได้ทันทีโดยไม่จําเป็นต้องแจ้งล่วงหน้า
                ทั้งนี้ ผู้ใช้บริการไม่มีสิทธิเรียกร้องค่าเสียหาย หรือค่าชดเชยใด
                ๆ จากผู้ให้บริการ
              </p>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h2 style={termTitleStyle}>
                3. การปฏิบัติตามกฎหมายที่ใช้บังคับ และสิทธิในการใช้งาน
              </h2>
              <p style={termContentStyle}>
                ผู้ใช้บริการตกลงว่าจะปฏิบัติตามกฎหมาย กฎระเบียบ ประกาศ
                และข้อบังคับที่มีผลบังคับใช้ในราชอาณาจักรไทย
                รวมถึงกฎหมายที่เกี่ยวข้องกับการคุ้มครองข้อมูลส่วนบุคคลและทรัพย์สินทางปัญญา
                ทั้งนี้
                ผู้ใช้บริการต้องไม่ใช้บริการเพื่อวัตถุประสงค์ที่ผิดกฎหมาย
                ไม่เหมาะสม หรืออาจก่อให้เกิดความเสียหายต่อผู้ให้บริการ บุคคลอื่น
                หรือระบบที่เกี่ยวข้อง
              </p>
              <br />
              <p style={termContentStyle}>
                ผู้ให้บริการให้สิทธิแก่ผู้ใช้บริการในการใช้บริการตู้ถ่ายรูป
                Timelab Photobooth เพื่อการใช้งานส่วนบุคคลเท่านั้น
                สิทธิดังกล่าวเป็นสิทธิแบบไม่ผูกขาด
                ไม่สามารถโอนต่อหรือให้สิทธิแก่บุคคลอื่นได้
                ผู้ให้บริการสงวนสิทธิในการระงับการให้บริการหรือดําเนินการทางกฎหมาย
                หากตรวจพบว่าผู้ใช้บริการใช้บริการโดยฝ่าฝืนกฎหมายหรือข้อกําหนดและเงื่อนไขนี้
              </p>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h2 style={termTitleStyle}>4. การอนุญาตให้ใช้งาน</h2>
              <p style={termContentStyle}>
                ผู้ให้บริการอนุญาตให้ผู้ใช้บริการเข้าถึงและใช้บริการตู้ถ่ายรูป
                Timelab Photobooth
                เพื่อการใช้งานส่วนบุคคลในเชิงความบันเทิงเท่านั้น
                การอนุญาตดังกล่าวเป็นสิทธิที่ไม่ผูกขาด ไม่สามารถโอนสิทธิได้
                และอาจถูกเพิกถอนได้ตามดุลยพินิจของผู้ให้บริการ
                ผู้ใช้บริการไม่มีสิทธิในการนําบริการไปใช้เพื่อวัตถุประสงค์ทางการค้า
                หรือการกระทําใด ๆ ที่อาจเป็นการละเมิดกฎหมายทรัพย์สินทางปัญญา
              </p>
              <br />
              <p style={termContentStyle}>
                ผู้ใช้บริการตกลงและรับทราบว่าผู้ให้บริการเป็นเจ้าของสิทธิในการดําเนินกิจการ
                อุปกรณ์ เทคโนโลยี เนื้อหา และสื่อที่ใช้ในตู้ถ่ายรูป Timelab
                Photobooth ทั้งหมด การใช้บริการไม่ถือเป็นการโอนสิทธิใด ๆ
                ให้แก่ผู้ใช้บริการ
                ผู้ใช้บริการต้องไม่ใช้บริการเพื่อสร้างหรือเผยแพร่เนื้อหาที่ผิดกฎหมาย
                ลามกอนาจาร ก่อให้เกิดความเกลียดชัง หรือละเมิดสิทธิของบุคคลอื่น
                โดยผู้ให้บริการมีสิทธิลบหรือไม่เปิดให้ดาวน์โหลดไฟล์ภาพใด ๆ
                ที่เข้าข่ายดังกล่าวทันทีโดยไม่ต้องแจ้งให้ทราบล่วงหน้า
                ในกรณีที่ผู้ใช้บริการฝ่าฝืน
                ผู้ใช้บริการจะต้องรับผิดชอบในความเสียหายทั้งหมดที่เกิดขึ้น
              </p>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h2 style={termTitleStyle}>5. การปรับปรุงแก้ไขและการให้บริการ</h2>
              <p style={termContentStyle}>
                ผู้ให้บริการขอสงวนสิทธิ์ในการปรับปรุง แก้ไข เปลี่ยนแปลง อัปเดต
                ระงับ หรือยุติการให้บริการทั้งหมดหรือบางส่วนได้ทุกเมื่อ
                โดยไม่จําเป็นต้องแจ้งให้ผู้ใช้บริการทราบล่วงหน้า
                ซึ่งรวมถึงระบบจัดเก็บรูปภาพ ระบบดาวน์โหลด ฟีเจอร์ต่าง ๆ
                ภายในตู้ถ่ายรูป และอัตราค่าบริการ
              </p>
              <br />
              <p style={termContentStyle}>
                ผู้ใช้บริการรับทราบและตกลงว่าผู้ให้บริการจะไม่รับผิดชอบต่อความสูญเสีย
                ความเสียหาย หรือความไม่สะดวกใด ๆ
                ที่อาจเกิดขึ้นจากการเปลี่ยนแปลงหรือระงับบริการดังกล่าว
                การใช้บริการภายหลังการเปลี่ยนแปลงถือเป็นการยอมรับข้อกําหนดและเงื่อนไขที่ได้มีการแก้ไขโดยสมบูรณ์แล้ว
              </p>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h2 style={termTitleStyle}>6. ข้อจํากัดในการใช้งาน</h2>
              <p style={termContentStyle}>
                ผู้ใช้บริการตกลงและยอมรับว่าการใช้งานบริการตู้ถ่ายรูป Timelab
                Photobooth จะต้องเป็นไปตามวัตถุประสงค์ที่ชอบด้วยกฎหมาย
                และต้องไม่กระทําการดังต่อไปนี้
              </p>
              <ul style={listStyle}>
                <li style={listItemStyle}>
                  ใช้บริการเพื่อถ่ายภาพหรือเผยแพร่เนื้อหาที่ผิดกฎหมาย ลามกอนาจาร
                  รุนแรง เหยียดหยาม สร้างความเกลียดชัง หรือคุกคามผู้อื่น
                </li>
                <li style={listItemStyle}>
                  กระทําการที่ละเมิดลิขสิทธิ์ สิทธิในภาพบุคคล ความเป็นส่วนตัว
                  หรือสิทธิทรัพย์สินทางปัญญาของบุคคลอื่น
                </li>
                <li style={listItemStyle}>
                  กระทําการที่ก่อให้เกิดความเสียหายต่อระบบหรืออุปกรณ์ของผู้ให้บริการ
                </li>
                <li style={listItemStyle}>
                  กระทําการปลอมแปลง แอบอ้างตัวตน
                  ใช้ข้อมูลผู้อื่นโดยไม่ได้รับอนุญาต
                  หรือกระทําการหลอกลวงในรูปแบบใด ๆ
                </li>
                <li style={listItemStyle}>
                  พยายามเข้าถึงระบบโดยไม่ได้รับอนุญาต
                  หรือเปลี่ยนแปลงการทํางานของบริการ
                </li>
                <li style={listItemStyle}>
                  กระทําการรบกวน ขัดขวาง
                  หรือทําให้บริการไม่สามารถใช้งานได้ตามปกติ
                </li>
              </ul>
              <p style={termContentStyle}>
                ในกรณีที่ผู้ให้บริการพบการฝ่าฝืน
                ผู้ให้บริการมีสิทธิระงับหรือยกเลิกการเข้าถึงบริการได้ทันที
                และสงวนสิทธิในการดําเนินการทางกฎหมายรวมถึงเรียกร้องค่าเสียหายจากผู้ใช้บริการ
              </p>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h2 style={termTitleStyle}>7. การระงับและยับยั้งการให้บริการ</h2>
              <p style={termContentStyle}>
                ผู้ให้บริการขอสงวนสิทธิ์ในการระงับ ยับยั้ง
                หรือยุติการให้บริการทั้งหมดหรือบางส่วนแก่ผู้ใช้บริการได้ทันที
                โดยไม่จําเป็นต้องแจ้งให้ทราบล่วงหน้าในกรณีดังต่อไปนี้
              </p>
              <ul style={listStyle}>
                <li style={listItemStyle}>
                  ผู้ใช้บริการฝ่าฝืนหรือไม่ปฏิบัติตามข้อกําหนดและเงื่อนไขการใช้งาน
                  หรือกฎหมายที่เกี่ยวข้อง
                </li>
                <li style={listItemStyle}>
                  การใช้งานบริการในลักษณะที่อาจก่อให้เกิดความเสียหายต่อผู้ให้บริการ
                  ผู้ใช้บริการรายอื่น หรือระบบ
                </li>
                <li style={listItemStyle}>
                  การพยายามเข้าถึงระบบโดยไม่ได้รับอนุญาต
                  หรือแทรกแซงการทํางานของตู้ถ่ายรูป
                </li>
                <li style={listItemStyle}>
                  การใช้บริการเพื่อวัตถุประสงค์ที่ผิดกฎหมาย หลอกลวง
                  หรือไม่เหมาะสม
                </li>
              </ul>
              <p style={termContentStyle}>
                ในกรณีที่มีการระงับหรือยับยั้งการให้บริการ
                ผู้ใช้บริการจะไม่มีสิทธิเรียกร้องค่าเสียหายหรือค่าชดเชยใด ๆ
                จากผู้ให้บริการ
              </p>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h2 style={termTitleStyle}>8. เว็บไซต์และบริการของบุคคลภายนอก</h2>
              <p style={termContentStyle}>
                บริการตู้ถ่ายรูป Timelab Photobooth
                อาจมีลิงก์เชื่อมต่อไปยังเว็บไซต์หรือบริการของบุคคลภายนอกเพื่อความสะดวกในการใช้งาน
                ผู้ให้บริการไม่เป็นเจ้าของหรือควบคุมเนื้อหา ความถูกต้อง
                หรือความปลอดภัยของบริการของบุคคลภายนอกเหล่านั้น
                ดังนั้นการเข้าถึงหรือใช้บริการของบุคคลภายนอก
                ถือเป็นความเสี่ยงของผู้ใช้บริการแต่เพียงผู้เดียว
                และผู้ให้บริการไม่รับผิดชอบต่อความเสียหายใด ๆ ที่เกิดขึ้น
              </p>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h2 style={termTitleStyle}>9. การรักษาความลับ</h2>
              <p style={termContentStyle}>
                ในระหว่างการใช้บริการ
                ผู้ใช้บริการตกลงที่จะรักษาความลับของข้อมูลที่อาจได้รับจากผู้ให้บริการ
                รวมถึงข้อมูลทางธุรกิจและข้อมูลที่ผู้ให้บริการระบุว่าเป็นความลับ
                ห้ามเปิดเผย เผยแพร่
                หรือใช้ข้อมูลดังกล่าวเพื่อประโยชน์ส่วนตัวหรือบุคคลภายนอก
                ข้อผูกพันนี้จะยังคงมีผลแม้ว่าการใช้บริการจะสิ้นสุดลงแล้ว
              </p>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h2 style={termTitleStyle}>
                10. การคุ้มครองข้อมูลส่วนบุคคล (PDPA) และการจัดเก็บภาพถ่าย
              </h2>
              <p style={termContentStyle}>
                Timelab Photobooth ในฐานะผู้ประกอบการและผู้ควบคุมข้อมูลส่วนบุคคล
                (Data Controller) ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ.
                2562 (PDPA) เป็นผู้รับผิดชอบแต่เพียงผู้เดียวในการเก็บรวบรวม ใช้
                และเปิดเผยข้อมูลส่วนบุคคลของผู้ใช้บริการ
                รวมถึงภาพถ่ายที่เกิดขึ้นจากการใช้บริการตู้ถ่ายรูปนี้
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>การจัดเก็บภาพถ่าย</strong>
                <br />
                ภาพถ่ายที่ได้จากการใช้บริการตู้ถ่ายรูปจะถูกจัดเก็บไว้ในอุปกรณ์ของ
                Timelab Photobooth Timelab Photobooth
                รับผิดชอบแต่เพียงผู้เดียวในการดูแลรักษาความปลอดภัย ความสมบูรณ์
                และการจัดการข้อมูลภาพถ่ายดังกล่าวตามมาตรฐานที่กฎหมาย PDPA กําหนด
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>วัตถุประสงค์การเก็บข้อมูล</strong>
                <br />
                ภาพถ่ายจะถูกเก็บรักษาไว้เพื่อวัตถุประสงค์ในการให้บริการ ได้แก่
                การพิมพ์ภาพ การดาวน์โหลด และการส่งภาพให้ผู้ใช้บริการ Timelab
                Photobooth จะไม่นําภาพถ่ายไปใช้เพื่อวัตถุประสงค์อื่นใด
                โดยไม่ได้รับความยินยอมจากผู้ใช้บริการ
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>ระยะเวลาการจัดเก็บ</strong>
                <br />
                Timelab Photobooth
                จะจัดเก็บภาพถ่ายไว้ตามระยะเวลาที่จําเป็นสําหรับการให้บริการ
                หลังจากนั้นภาพถ่ายจะถูกลบออกจากระบบ
                เว้นแต่กฎหมายกําหนดให้ต้องเก็บรักษาไว้นานกว่านั้น
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>สิทธิของเจ้าของข้อมูล</strong>
                <br />
                ผู้ใช้บริการมีสิทธิตามกฎหมาย PDPA ในการขอเข้าถึง แก้ไข ลบ
                หรือคัดค้านการประมวลผลข้อมูลส่วนบุคคลของตน รวมถึงภาพถ่าย
                โดยสามารถติดต่อ Timelab Photobooth
                ได้โดยตรงตามช่องทางที่ระบุไว้ด้านล่าง
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>ความรับผิดชอบ</strong>
                <br />
                Timelab Photobooth รับผิดชอบต่อการรั่วไหล สูญหาย
                หรือการเข้าถึงข้อมูลภาพถ่ายโดยไม่ได้รับอนุญาต
                อันเกิดจากการดําเนินงานของ Timelab Photobooth ตามที่กฎหมาย PDPA
                กําหนด
              </p>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h2 style={termTitleStyle}>11. การชําระค่าบริการ</h2>
              <p style={termContentStyle}>
                ผู้ใช้บริการตกลงชําระค่าบริการตามอัตราที่ Timelab Photobooth
                กําหนด สําหรับการใช้บริการทุกประเภท ทั้งการถ่ายภาพ
                การปรับแต่งภาพ หรือบริการเสริมอื่น ๆ
                โดยวิธีการชําระเงินสามารถทําได้ผ่านช่องทางที่ Timelab Photobooth
                กําหนด อาทิ QR Code, บัตรเครดิต, เดบิต
                หรือวิธีการชําระเงินอิเล็กทรอนิกส์อื่น ๆ
                ผู้ใช้บริการมีหน้าที่ตรวจสอบความถูกต้องของจํานวนเงิน
                และช่องทางการชําระเงินก่อนยืนยันทุกครั้ง
              </p>
              <br />
              <p style={termContentStyle}>
                Timelab Photobooth
                สงวนสิทธิ์ในการปรับเปลี่ยนอัตราค่าบริการได้ตามความเหมาะสม
                โดยจะแจ้งให้ผู้ใช้บริการทราบล่วงหน้าผ่านช่องทางที่กําหนด
                หากผู้ใช้บริการไม่สามารถชําระค่าบริการได้
                หรือพบความผิดปกติในการชําระเงิน Timelab Photobooth
                มีสิทธิ์ระงับหรือยกเลิกการให้บริการทั้งหมดหรือบางส่วนได้ทันที
                Timelab Photobooth
                สงวนสิทธิ์ในการเรียกร้องค่าเสียหายตามกฎหมายจากผู้ใช้บริการ
                หากพบว่ามีการชําระเงินโดยทุจริต
              </p>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h2 style={termTitleStyle}>12. ข้อกําหนดเบ็ดเตล็ด</h2>
              <p style={termContentStyle}>
                <strong>ความเป็นอิสระของข้อกําหนด</strong>
                <br />
                หากข้อใดข้อหนึ่งในข้อกําหนดและเงื่อนไขนี้
                ถูกตัดสินว่าขัดต่อกฎหมายหรือเป็นโมฆะ ข้ออื่น ๆ
                ยังคงมีผลบังคับใช้ตามปกติ
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>การละเว้นสิทธิ์</strong>
                <br />
                การที่ผู้ให้บริการละเว้นการบังคับใช้สิทธิ์ใด ๆ ในกรณีใดกรณีหนึ่ง
                ไม่ถือเป็นการสละสิทธิ์ในการบังคับใช้สิทธิ์นั้นในอนาคต
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>กฎหมายที่ใช้บังคับ</strong>
                <br />
                ข้อกําหนดและเงื่อนไขนี้อยู่ภายใต้และตีความตามกฎหมายของราชอาณาจักรไทย
                โดยผู้ใช้บริการตกลงให้ศาลไทยมีเขตอํานาจในการพิจารณาข้อพิพาทใด ๆ
                ที่เกิดขึ้นจากการใช้บริการ
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>การแจ้งประกาศ</strong>
                <br />
                Timelab Photobooth
                อาจประกาศข้อมูลหรือเปลี่ยนแปลงข้อกําหนดและเงื่อนไขผ่านทางช่องทางสื่อสารของ
                Timelab Photobooth
                การใช้บริการอย่างต่อเนื่องหลังจากการประกาศถือเป็นการยอมรับข้อกําหนดและเงื่อนไขใหม่โดยอัตโนมัติ
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>ความสัมพันธ์ระหว่างคู่สัญญา</strong>
                <br />
                ข้อกําหนดและเงื่อนไขนี้ไม่ได้สร้างความสัมพันธ์แบบหุ้นส่วน ตัวแทน
                หรือความร่วมทุนใด ๆ ระหว่างผู้ให้บริการกับผู้ใช้บริการ
              </p>
              <br />
              <p style={termContentStyle}>
                <strong>ความครบถ้วนของข้อตกลง</strong>
                <br />
                ข้อกําหนดและเงื่อนไขนี้ รวมกับนโยบายความเป็นส่วนตัวและประกาศอื่น
                ๆ ที่ Timelab Photobooth จัดทํา
                ถือเป็นข้อตกลงทั้งหมดระหว่างผู้ใช้บริการและ Timelab Photobooth
                เกี่ยวกับการใช้บริการตู้ถ่ายรูปนี้
              </p>
            </div>
          </div>

          <div
            style={{
              marginTop: "2rem",
              textAlign: "center",
              marginBottom: "1rem",
            }}
          >
            <p style={{ color: theme?.fontColor || "#e5e7eb", opacity: 0.9 }}>
              หากท่านมีข้อสงสัยเกี่ยวกับข้อกําหนดและเงื่อนไขนี้
              หรือต้องการใช้สิทธิตาม PDPA โปรดติดต่อ Timelab Photobooth
              ได้โดยตรง
            </p>
          </div>

          <div
            style={{
              textAlign: "center",
              borderTop: "1px solid rgba(255,255,255,0.1)",
              paddingTop: "1rem",
            }}
          >
            <p
              style={{
                color: theme?.fontColor || "#9ca3af",
                fontSize: "0.9rem",
                marginBottom: "0.5rem",
              }}
            >
              ข้อกําหนดและเงื่อนไขการใช้บริการฉบับนี้มีผลบังคับใช้ตั้งแต่วันที่
              15 พฤศจิกายน 2568
            </p>
            <p
              style={{
                color: theme?.fontColor || "#9ca3af",
                fontSize: "0.9rem",
              }}
            >
              © 2025 Timelab Photobooth. All Rights Reserved.
            </p>
          </div>
        </div>
      </div>
      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      <ContextMenu
        open={showContextMenu}
        onClose={() => setShowContextMenu(false)}
        onFormatReset={onFormatReset}
        onBeforeClose={onBeforeClose}
      />
    </div>
  );
}
