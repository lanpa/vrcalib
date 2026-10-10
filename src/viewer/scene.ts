// WebGL2 renderer: a 10 m grid box seen from its centre, rendered per eye
// into an offscreen texture, then barrel-distorted onto the screen.
// Draws on demand (profile change, resize), not every frame: the view is
// fixed, since head tracking isn't needed for calibration.

import type { DeviceParams } from '../profile/codec';
import { barrelUniforms, frustum, leftEyeFov, type Screen } from './cardboardView';
import { BARREL_FRAGMENT, BARREL_VERTEX, SCENE_FRAGMENT, SCENE_VERTEX } from './shader';

const NEAR = 0.1;
const FAR = 100;
const BOX_HALF = 5;

// Face tints from wwgc 3d_app.js, in THREE.BoxGeometry order: +x, −x, +y, −y, +z, −z.
const FACE_COLORS = [0xa020a0, 0x20a020, 0x50a0f0, 0x404040, 0xa0a0a0, 0xa0a020];

/** Two triangles per face; normals point inward, since we look from inside. */
function boxGeometry(): Float32Array {
  const out: number[] = [];
  const faces: [axis: number, sign: number][] = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  faces.forEach(([axis, sign], i) => {
    const c = FACE_COLORS[i]!;
    const rgb = [(c >> 16) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255];
    const normal = [0, 0, 0];
    normal[axis] = -sign;
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const corner = (a: number, b: number) => {
      const p = [0, 0, 0];
      p[axis] = sign * BOX_HALF;
      p[u] = a * BOX_HALF;
      p[v] = b * BOX_HALF;
      out.push(...p, ...normal, ...rgb);
    };
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]] as const) corner(a, b);
  });
  return new Float32Array(out);
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    gl.attachShader(program, s);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error');
  return program;
}

function translateX(x: number): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]);
}

export class StereoRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly sceneProgram: WebGLProgram;
  private readonly barrelProgram: WebGLProgram;
  private readonly sceneVao: WebGLVertexArrayObject;
  private readonly barrelVao: WebGLVertexArrayObject;
  private readonly vertexCount: number;
  private readonly fbo: WebGLFramebuffer;
  private readonly colorTex: WebGLTexture;
  private readonly depth: WebGLRenderbuffer;
  private fboSize = [0, 0];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;

    this.sceneProgram = compile(gl, SCENE_VERTEX, SCENE_FRAGMENT);
    this.barrelProgram = compile(gl, BARREL_VERTEX, BARREL_FRAGMENT);

    const box = boxGeometry();
    this.vertexCount = box.length / 9;
    this.sceneVao = gl.createVertexArray();
    gl.bindVertexArray(this.sceneVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, box, gl.STATIC_DRAW);
    for (const [name, offset] of [['aPosition', 0], ['aNormal', 3], ['aColor', 6]] as const) {
      const loc = gl.getAttribLocation(this.sceneProgram, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 36, offset * 4);
    }

    this.barrelVao = gl.createVertexArray();
    gl.bindVertexArray(this.barrelVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    // One triangle covering the screen.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.barrelProgram, 'aPosition');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.fbo = gl.createFramebuffer();
    this.colorTex = gl.createTexture();
    this.depth = gl.createRenderbuffer();
  }

  private ensureFbo(w: number, h: number): void {
    if (this.fboSize[0] === w && this.fboSize[1] === h) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fboSize = [w, h];
  }

  render(screen: Screen, device: DeviceParams, showCenter: boolean): void {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const half = Math.floor(w / 2);
    this.ensureFbo(w, h);

    // Pass 1: each eye into its half of the texture, cameras ±IPD/2 apart.
    const fov = leftEyeFov(screen, device);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.sceneProgram);
    gl.bindVertexArray(this.sceneVao);
    const uProjection = gl.getUniformLocation(this.sceneProgram, 'uProjection');
    const uView = gl.getUniformLocation(this.sceneProgram, 'uView');
    const ipd = device.interLensDistance;
    for (const [eye, x0, eyeX] of [['left', 0, -ipd / 2], ['right', half, ipd / 2]] as const) {
      gl.viewport(x0, 0, half, h);
      gl.uniformMatrix4fv(uProjection, false, frustum(fov, NEAR, FAR, eye));
      gl.uniformMatrix4fv(uView, false, translateX(-eyeX));
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    }

    // Pass 2: barrel distortion to the screen.
    const u = barrelUniforms(screen, device, NEAR, FAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.barrelProgram);
    gl.bindVertexArray(this.barrelVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    const p = this.barrelProgram;
    gl.uniform1i(gl.getUniformLocation(p, 'tDiffuse'), 0);
    gl.uniform2f(gl.getUniformLocation(p, 'distortion'), ...u.distortion);
    gl.uniform4f(gl.getUniformLocation(p, 'projectionLeft'), ...u.projectionLeft);
    gl.uniform4f(gl.getUniformLocation(p, 'unprojectionLeft'), ...u.unprojectionLeft);
    // Red outside the eye images: shows FOV / geometry mismatch.
    gl.uniform4f(gl.getUniformLocation(p, 'backgroundColor'), 1, 0, 0, 1);
    gl.uniform4f(gl.getUniformLocation(p, 'dividerColor'), 0.5, 0.5, 0.5, 1);
    gl.uniform1i(gl.getUniformLocation(p, 'showCenter'), showCenter ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** RGBA at (x, y) from the bottom-left. Only valid in the same task as render(). */
  readPixel(x: number, y: number): number[] {
    const out = new Uint8Array(4);
    this.gl.readPixels(x, y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, out);
    return [...out];
  }
}
