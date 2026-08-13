/**
 * รัน LUT (.cube) บนภาพสดด้วย WebGL2
 *
 * หน้าถ่ายรูปของตู้ที่ล็อกฟิลเตอร์ไว้ต้องโชว์ "ฟิลเตอร์ตัวจริง" ไม่ใช่ CSS ประมาณเอา
 * ยิง `apply_lut_filter` ทีละเฟรมไม่ทัน (เฟรมละหลายร้อย ms) จึงโหลดตาราง LUT ไปเป็น
 * 3D texture แล้วให้ GPU sample เอง — คณิตศาสตร์ตรงกับฝั่ง Rust ทุกขั้น:
 *
 *   1. trilinear interpolation บนกริด LUT  (Lut3D::apply)
 *   2. shadow fix ดึงสีในเงาออก luma < 0.28 ด้วยเส้นโค้ง quadratic (apply_lut_filter)
 *
 * ภาพสดที่เห็นจึงเป็นสีเดียวกับรูปที่ถ่ายออกมา
 */

const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  // ภาพจาก <video>/<img> มีแกน Y กลับด้านกับ clip space
  v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;
uniform sampler3D u_lut;
uniform float u_lutSize;

/** เทียบเท่า Lut3D::apply ฝั่ง Rust — hardware trilinear ให้ผลเดียวกัน
    ถ้า map ค่าสีไปตรงกลาง texel */
vec3 applyLut(vec3 c) {
  vec3 cc = clamp(c, 0.0, 1.0);
  vec3 coord = (cc * (u_lutSize - 1.0) + 0.5) / u_lutSize;
  return texture(u_lut, coord).rgb;
}

/** เทียบเท่าท่อน "แก้ปัญหาเงาเขียว" ใน apply_lut_filter */
vec3 shadowFix(vec3 c) {
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  const float threshold = 0.28;
  if (luma < threshold) {
    float t = luma / threshold;
    float curve = t * t;
    return vec3(luma) + (c - vec3(luma)) * curve;
  }
  return c;
}

void main() {
  vec3 src = texture(u_src, v_uv).rgb;
  fragColor = vec4(clamp(shadowFix(applyLut(src)), 0.0, 1.0), 1.0);
}`;

export type LutFrameSource = HTMLVideoElement | HTMLImageElement;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

export class LutPreviewRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private srcTexture: WebGLTexture;
  private lutTexture: WebGLTexture;
  private lutSizeLoc: WebGLUniformLocation | null;
  private disposed = false;

  private constructor(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    srcTexture: WebGLTexture,
    lutTexture: WebGLTexture,
  ) {
    this.gl = gl;
    this.program = program;
    this.srcTexture = srcTexture;
    this.lutTexture = lutTexture;
    this.lutSizeLoc = gl.getUniformLocation(program, "u_lutSize");
  }

  /**
   * @param lutSize ขนาดกริด (เช่น 33)
   * @param lutBytes ข้อมูล RGB8 ขนาด lutSize^3 * 3 จาก `load_lut_texture`
   * @returns null ถ้าเครื่องไม่รองรับ WebGL2 (ให้ผู้เรียก fallback ไปโชว์ภาพดิบ)
   */
  static create(
    canvas: HTMLCanvasElement,
    lutSize: number,
    lutBytes: Uint8Array,
  ): LutPreviewRenderer | null {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return null;

    const expected = lutSize * lutSize * lutSize * 3;
    if (lutBytes.length < expected) {
      throw new Error(`LUT data too small: ${lutBytes.length} < ${expected}`);
    }

    const program = gl.createProgram();
    if (!program) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link failed: ${log}`);
    }

    // สามเหลี่ยมคลุมจอ ไม่ต้องมี index buffer
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const posLoc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const srcTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const lutTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lutTexture);
    // แถวละ size*3 ไบต์ ไม่หาร 4 ลงตัว ต้องบอก GL ว่าไม่ต้อง align
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGB8,
      lutSize,
      lutSize,
      lutSize,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      lutBytes.subarray(0, expected),
    );
    // LINEAR = ได้ trilinear ฟรีจาก GPU (ตรงกับ Rust)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "u_src"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "u_lut"), 1);

    const renderer = new LutPreviewRenderer(gl, program, srcTexture, lutTexture);
    renderer.gl.uniform1f(renderer.lutSizeLoc, lutSize);
    return renderer;
  }

  /** วาดหนึ่งเฟรมจาก <video>/<img> ลง canvas — เรียกใน requestAnimationFrame */
  render(source: LutFrameSource, width: number, height: number): void {
    if (this.disposed || width <= 0 || height <= 0) return;
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    gl.deleteTexture(this.srcTexture);
    gl.deleteTexture(this.lutTexture);
    gl.deleteProgram(this.program);
  }
}

/** แปลง base64 จาก `load_lut_texture` เป็นไบต์ */
export function decodeLutBase64(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
