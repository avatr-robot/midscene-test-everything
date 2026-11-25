import { Spin, Switch } from 'antd';
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { depthPointCloudFrame } from '../depth-api';
import { useLanguage } from '../i18n';
import {
  type ColorPixels,
  type DepthPointCloud,
  buildDepthPointCloud,
} from '../utils/depth-point-cloud';

const POINT_CLOUD_REFRESH_MS = 33;
const POINT_CLOUD_RETRY_MS = 1_000;

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aColor;
uniform float uYaw;
uniform float uPitch;
uniform float uZoom;
uniform float uRadius;
uniform float uFocal;
uniform float uPointSize;
uniform vec2 uViewport;
uniform vec2 uPan;
varying vec3 vColor;

void main() {
  vec3 p = aPosition;
  float cy = cos(uYaw);
  float sy = sin(uYaw);
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  float cp = cos(uPitch);
  float sp = sin(uPitch);
  p = vec3(p.x, cp * p.y - sp * p.z, sp * p.y + cp * p.z);

  float cameraDistance = uRadius * 2.8 / uZoom;
  float viewDepth = max(cameraDistance - p.z, 0.001);
  vec2 screen = p.xy * uFocal / viewDepth + uPan;
  vec2 ndc = screen / (uViewport * 0.5);
  float zNear = max(0.01, cameraDistance - uRadius * 1.35);
  float zFar = cameraDistance + uRadius * 1.35;
  float clipZ =
    (zFar + zNear) / (zFar - zNear) -
    (2.0 * zFar * zNear) / ((zFar - zNear) * viewDepth);

  gl_Position = vec4(ndc, clipZ, 1.0);
  gl_PointSize = uPointSize;
  vColor = aColor;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vColor;

void main() {
  gl_FragColor = vec4(vColor, 1.0);
}
`;

interface WebGlState {
  colorBuffer: WebGLBuffer;
  gl: WebGLRenderingContext;
  pointCount: number;
  positionBuffer: WebGLBuffer;
  positionLocation: number;
  colorLocation: number;
  program: WebGLProgram;
  uniforms: Record<
    | 'uYaw'
    | 'uPitch'
    | 'uZoom'
    | 'uRadius'
    | 'uFocal'
    | 'uPointSize'
    | 'uViewport'
    | 'uPan',
    WebGLUniformLocation
  >;
}

interface InteractionState {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
}

interface DragState {
  pointerId: number;
  x: number;
  y: number;
  pan: boolean;
}

function shader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const result = gl.createShader(type);
  if (!result) throw new Error('Unable to create WebGL shader');
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(result) || 'Unknown shader error';
    gl.deleteShader(result);
    throw new Error(message);
  }
  return result;
}

function createWebGlState(canvas: HTMLCanvasElement): WebGlState {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('WebGL is unavailable');
  const program = gl.createProgram();
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!program) throw new Error('Unable to create WebGL program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unknown program error';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  const positionBuffer = gl.createBuffer();
  const colorBuffer = gl.createBuffer();
  if (!positionBuffer || !colorBuffer)
    throw new Error('Unable to create WebGL buffers');
  const uniforms = Object.fromEntries(
    [
      'uYaw',
      'uPitch',
      'uZoom',
      'uRadius',
      'uFocal',
      'uPointSize',
      'uViewport',
      'uPan',
    ].map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as WebGlState['uniforms'];
  if (Object.values(uniforms).some((uniform) => uniform === null))
    throw new Error('Unable to locate WebGL uniforms');
  return {
    colorBuffer,
    gl,
    pointCount: 0,
    positionBuffer,
    positionLocation: gl.getAttribLocation(program, 'aPosition'),
    colorLocation: gl.getAttribLocation(program, 'aColor'),
    program,
    uniforms,
  };
}

async function decodeColorPixels(blob: Blob): Promise<ColorPixels> {
  const canvas = document.createElement('canvas');
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to decode the RGB image');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return {
      data: pixels.data,
      width: pixels.width,
      height: pixels.height,
    };
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Unable to decode RGB image'));
      element.src = url;
    });
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to decode the RGB image');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return {
      data: pixels.data,
      width: pixels.width,
      height: pixels.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function DepthPointCloudView({ cameraId }: { cameraId: string }) {
  const zh = useLanguage() === 'zh';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<WebGlState>();
  const cloudRef = useRef<DepthPointCloud>();
  const anchorRef = useRef<{
    center: DepthPointCloud['center'];
    radius: number;
  }>();
  const drawRef = useRef<() => void>(() => undefined);
  const interactionRef = useRef<InteractionState>({
    yaw: 0,
    pitch: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  const dragRef = useRef<DragState>();
  const lastFrameIdRef = useRef<number>();
  const [fillDepthHoles, setFillDepthHoles] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pointCount, setPointCount] = useState(0);
  const [error, setError] = useState<string>();

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      stateRef.current = createWebGlState(canvas);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    const draw = () => {
      const state = stateRef.current;
      const cloud = cloudRef.current;
      if (!state) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const { gl } = state;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0.035, 0.05, 0.09, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!cloud?.pointCount) return;
      const interaction = interactionRef.current;
      gl.useProgram(state.program);
      gl.enable(gl.DEPTH_TEST);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.positionBuffer);
      gl.enableVertexAttribArray(state.positionLocation);
      gl.vertexAttribPointer(state.positionLocation, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.colorBuffer);
      gl.enableVertexAttribArray(state.colorLocation);
      gl.vertexAttribPointer(state.colorLocation, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(state.uniforms.uYaw, interaction.yaw);
      gl.uniform1f(state.uniforms.uPitch, interaction.pitch);
      gl.uniform1f(state.uniforms.uZoom, interaction.zoom);
      gl.uniform1f(state.uniforms.uRadius, cloud.radius);
      gl.uniform1f(
        state.uniforms.uFocal,
        Math.min(rect.width, rect.height) * 1.25,
      );
      gl.uniform1f(
        state.uniforms.uPointSize,
        dpr * (Math.min(rect.width, rect.height) < 520 ? 2.4 : 2.75),
      );
      gl.uniform2f(state.uniforms.uViewport, rect.width, rect.height);
      gl.uniform2f(state.uniforms.uPan, interaction.panX, interaction.panY);
      gl.drawArrays(gl.POINTS, 0, cloud.pointCount);
    };
    drawRef.current = draw;
    draw();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(draw);
    observer?.observe(canvas);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const interaction = interactionRef.current;
      interaction.zoom = Math.min(
        6,
        Math.max(0.35, interaction.zoom * Math.exp(-event.deltaY * 0.001)),
      );
      draw();
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', wheel);
      observer?.disconnect();
      drawRef.current = () => undefined;
      const state = stateRef.current;
      stateRef.current = undefined;
      if (state) {
        state.gl.deleteBuffer(state.colorBuffer);
        state.gl.deleteBuffer(state.positionBuffer);
        state.gl.deleteProgram(state.program);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = (delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, delay);
    };
    const refresh = async () => {
      try {
        const frame = await depthPointCloudFrame(cameraId);
        if (cancelled) return;
        if (frame.frameId === lastFrameIdRef.current) return;
        lastFrameIdRef.current = frame.frameId;
        const color = await decodeColorPixels(frame.colorJpeg);
        if (cancelled) return;
        const cloud = buildDepthPointCloud({
          color,
          depth: frame.depth,
          depthWidth: frame.width,
          depthHeight: frame.height,
          fillDepthHoles,
          scaleMeters: frame.scaleMeters,
          intrinsics: frame.intrinsics,
          origin: anchorRef.current?.center,
          radius: anchorRef.current?.radius,
        });
        if (cancelled) return;
        const state = stateRef.current;
        if (!state) throw new Error('WebGL renderer is unavailable');
        if (cloud.pointCount > 0)
          anchorRef.current ??= {
            center: cloud.center,
            radius: cloud.radius,
          };
        cloudRef.current = cloud;
        state.pointCount = cloud.pointCount;
        state.gl.bindBuffer(state.gl.ARRAY_BUFFER, state.positionBuffer);
        state.gl.bufferData(
          state.gl.ARRAY_BUFFER,
          cloud.positions,
          state.gl.STATIC_DRAW,
        );
        state.gl.bindBuffer(state.gl.ARRAY_BUFFER, state.colorBuffer);
        state.gl.bufferData(
          state.gl.ARRAY_BUFFER,
          cloud.colors,
          state.gl.STATIC_DRAW,
        );
        setLoading(false);
        setPointCount(cloud.pointCount);
        setError(undefined);
        drawRef.current();
      } catch (cause) {
        if (!cancelled) {
          setLoading(false);
          setError(cause instanceof Error ? cause.message : String(cause));
          scheduleRefresh(POINT_CLOUD_RETRY_MS);
        }
      } finally {
        if (!cancelled && !timer) scheduleRefresh(POINT_CLOUD_REFRESH_MS);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [cameraId, fillDepthHoles]);

  useEffect(() => {
    anchorRef.current = undefined;
    cloudRef.current = undefined;
    lastFrameIdRef.current = undefined;
    if (stateRef.current) stateRef.current.pointCount = 0;
    setLoading(true);
    drawRef.current();
  }, [cameraId, fillDepthHoles]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => ({
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    pan: event.button === 2 || event.shiftKey,
  });
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = point(event);
    event.currentTarget.style.cursor = 'grabbing';
  };
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const interaction = interactionRef.current;
    if (drag.pan) {
      interaction.panX += dx;
      interaction.panY += dy;
    } else {
      interaction.yaw += dx * 0.007;
      interaction.pitch -= dy * 0.007;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    drawRef.current();
  };
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    event.currentTarget.style.cursor = 'grab';
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="depth-point-cloud-view">
      <div className="depth-point-cloud-toolbar">
        <span className="depth-point-cloud-filter">
          <Switch
            aria-label={zh ? '填补深度空洞' : 'Fill depth gaps'}
            checked={fillDepthHoles}
            onChange={setFillDepthHoles}
            size="small"
          />
          <span>{zh ? '填补深度空洞' : 'Fill depth gaps'}</span>
        </span>
      </div>
      <canvas
        aria-label={zh ? '三维深度点云' : '3D depth point cloud'}
        className="depth-point-cloud-canvas"
        onContextMenu={(event) => event.preventDefault()}
        onDoubleClick={() => {
          interactionRef.current = {
            yaw: 0,
            pitch: 0,
            zoom: 1,
            panX: 0,
            panY: 0,
          };
          drawRef.current();
        }}
        onLostPointerCapture={() => {
          dragRef.current = undefined;
          if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
        }}
        onPointerCancel={pointerUp}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        ref={canvasRef}
      />
      {loading ? (
        <span className="depth-point-cloud-status">
          <Spin size="small" />
          {zh ? '正在加载三维视图' : 'Loading 3D view'}
        </span>
      ) : error ? (
        <span className="depth-point-cloud-status" role="alert">
          {zh ? '三维预览不可用' : '3D preview unavailable'}
        </span>
      ) : (
        <span className="depth-point-cloud-hint">
          {zh
            ? '拖动旋转，滚轮缩放，Shift 拖动平移'
            : 'Drag to rotate, scroll to zoom, shift-drag to pan'}
          <span>{`${pointCount.toLocaleString()} points`}</span>
        </span>
      )}
    </div>
  );
}
