// WebGL2 着色器：顶点位移与法线全部在 GPU 计算，打磨时只更新高度纹理
import type { LightPreset, RenderMode } from '../sim/types.ts'

export const MAX_LAYERS = 12

const COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler2D;

uniform int u_mode;       // 0 polar 1 rect
uniform float u_radius;
uniform float u_width;
uniform float u_depth;
uniform float u_vertScale;
uniform sampler2D u_bodyHeight;
uniform sampler2D u_ground;
uniform sampler2D u_surface;
uniform sampler2DArray u_layerTex;
uniform sampler2D u_remaining;
uniform int u_layerCount;
uniform int u_renderMode; // 0 craft 1 layer 2 grind 3 heat
uniform int u_polished;
uniform int u_light;      // 0 studio 1 warm 2 daylight
uniform vec3 u_layerColors[${MAX_LAYERS}];
uniform vec3 u_cameraPos;
uniform float u_thinWarn;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
out vec4 outColor;

vec3 heatColor(float t) {
  // 蓝(安全) -> 黄 -> 红(危险)
  vec3 blue = vec3(0.16, 0.38, 0.82);
  vec3 yellow = vec3(0.92, 0.78, 0.25);
  vec3 red = vec3(0.78, 0.18, 0.14);
  return t < 0.5
    ? mix(blue, yellow, t * 2.0)
    : mix(yellow, red, (t - 0.5) * 2.0);
}

float texelSize() {
  return 1.0 / float(textureSize(u_surface, 0).x);
}

vec3 layerAt(vec2 uv) {
  float ground = texture(u_ground, uv).r;
  float depth = ground;
  vec3 result = vec3(0.35);
  bool resolved = false;
  for (int i = ${MAX_LAYERS - 1}; i >= 0; i--) {
    if (i >= u_layerCount) continue;
    float t = texture(u_layerTex, vec3(uv, float(i))).r;
    if (depth < t - 0.00001) {
      result = u_layerColors[i];
      resolved = true;
      break;
    }
    depth -= t;
  }
  if (!resolved) result = vec3(0.45, 0.32, 0.24); // 磨穿：胎体色
  return result;
}

bool isBreached(vec2 uv) {
  float ground = texture(u_ground, uv).r;
  float depth = ground;
  for (int i = ${MAX_LAYERS - 1}; i >= 0; i--) {
    if (i >= u_layerCount) continue;
    float t = texture(u_layerTex, vec3(uv, float(i))).r;
    if (depth < t - 0.00001) return false;
    depth -= t;
  }
  return true;
}

vec3 lighting(vec3 base, vec3 n, vec3 viewDir, float specPower) {
  vec3 keyDir;
  vec3 keyColor;
  float ambient;
  if (u_light == 1) {
    keyDir = normalize(vec3(-0.4, 0.55, 0.75));
    keyColor = vec3(1.0, 0.86, 0.66);
    ambient = 0.42;
  } else if (u_light == 2) {
    keyDir = normalize(vec3(0.35, 0.8, 0.5));
    keyColor = vec3(0.92, 0.96, 1.0);
    ambient = 0.52;
  } else {
    keyDir = normalize(vec3(-0.3, 0.7, 0.6));
    keyColor = vec3(1.0, 0.98, 0.95);
    ambient = 0.38;
  }
  vec3 fillDir = normalize(vec3(0.7, 0.35, -0.5));
  float diff = max(dot(n, keyDir), 0.0);
  float fill = max(dot(n, fillDir), 0.0) * 0.22;
  vec3 halfDir = normalize(keyDir + viewDir);
  float spec = pow(max(dot(n, halfDir), 0.0), specPower);
  float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0) * 0.18;
  return base * (ambient + diff * 0.72 + fill)
    + keyColor * spec * (u_polished == 1 ? 1.0 : 0.35)
    + base * fresnel;
}

void main() {
  vec3 n = normalize(v_normal);
  vec3 viewDir = normalize(u_cameraPos - v_worldPos);
  // 极域极点附近：uv 角度无意义，统一钳到固定角度，消除放射接缝
  vec2 sampleUv = v_uv;
  if (u_mode == 0 && v_uv.x < texelSize() * 2.0) {
    sampleUv = vec2(max(v_uv.x, texelSize() * 0.5), 0.0);
  }

  if (u_renderMode == 1) {
    // 层显：纯平涂色块，便于看每层覆盖范围
    outColor = vec4(layerAt(sampleUv), 1.0);
    return;
  }

  if (u_renderMode == 3) {
    // 热力：剩余漆厚，磨穿格直接标红
    if (isBreached(sampleUv)) {
      outColor = vec4(vec3(0.82, 0.1, 0.08), 1.0);
    } else {
      float remain = texture(u_remaining, sampleUv).r;
      float t = 1.0 - clamp(remain / max(u_thinWarn * 3.0, 0.001), 0.0, 1.0);
      outColor = vec4(heatColor(t), 1.0);
    }
    return;
  }

  vec3 base = layerAt(sampleUv);
  if (isBreached(sampleUv)) {
    // 磨穿标红警示
    base = mix(base, vec3(0.85, 0.12, 0.1), 0.72);
  }

  if (u_renderMode == 2) {
    // 打磨态：哑光磨砂质感
    vec3 color = lighting(base, n, viewDir, 10.0);
    outColor = vec4(color, 1.0);
    return;
  }

  // 工艺态 / 推光：漆面高光 + 深层透色
  float specPower = u_polished == 1 ? 96.0 : 40.0;
  vec3 deep = layerAt(clamp(sampleUv, vec2(0.001), vec2(0.999)));
  vec3 mixedBase = mix(base, deep, u_polished == 1 ? 0.18 : 0.08);
  vec3 color = lighting(mixedBase, n, viewDir, specPower);
  outColor = vec4(color, 1.0);
}
`

export const VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 a_uv;
in vec3 a_skirtPos;   // 侧壁/底盖世界坐标，工作面为 (0,0,0)
uniform int u_skirt;  // 0 工作面 1 侧壁底盖
uniform int u_mode;
uniform float u_radius;
uniform float u_width;
uniform float u_depth;
uniform float u_wall;
uniform float u_vertScale;
uniform sampler2D u_bodyHeight;
uniform sampler2D u_ground;
uniform sampler2D u_surface;

uniform mat4 u_viewProj;
out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;

float hAt(vec2 uv) {
  float body = texture(u_bodyHeight, uv).r;
  float surface = texture(u_surface, uv).r;
  float ground = texture(u_ground, uv).r;
  return body + (surface - body) - ground;
}

void main() {
  v_uv = a_uv;
  vec2 texel = 1.0 / vec2(textureSize(u_surface, 0));
  // 极域极点：统一从角度 0 采样，保证 r=0 整行高度一致，消除放射竖线
  vec2 hUv = a_uv;
  if (u_mode == 0 && a_uv.x < texel.x * 1.5) {
    hUv = vec2(texel.x * 0.5, 0.0);
  }
  float h = hAt(hUv);
  float hx1 = hAt(clamp(a_uv + vec2(texel.x, 0.0), texel, 1.0 - texel));
  float hx0 = hAt(clamp(a_uv - vec2(texel.x, 0.0), texel, 1.0 - texel));
  float hy1 = hAt(clamp(a_uv + vec2(0.0, texel.y), texel, 1.0 - texel));
  float hy0 = hAt(clamp(a_uv - vec2(0.0, texel.y), texel, 1.0 - texel));

  vec2 planar;
  vec2 dx;
  vec2 dy;
  if (u_mode == 0) {
    // 极点行给最小正半径，避免 r=0 退化三角形产生黑色竖边
    float r = max(a_uv.x * u_radius, u_radius * texel.x * 0.25);
    float theta = a_uv.y * 6.2831853;
    planar = vec2(r * cos(theta), r * sin(theta));
    float dr = u_radius * texel.x;
    dx = vec2(dr, 0.0);
    dy = vec2(0.0, max(r, dr * 0.5) * 6.2831853 * texel.y);
  } else {
    planar = vec2((a_uv.x - 0.5) * u_width, (a_uv.y - 0.5) * u_depth);
    dx = vec2(u_width * texel.x, 0.0);
    dy = vec2(0.0, u_depth * texel.y);
  }

  // 极点附近角度切线退化，直接用竖直法线避免尖刺
  vec3 normal;
  if (u_mode == 0 && a_uv.x < texel.x * 1.5) {
    normal = vec3(0.0, 1.0, 0.0);
  } else {
    vec3 px = vec3(dx.x, (hx1 - hx0) * 0.5, dx.y);
    vec3 py = vec3(dy.x, (hy1 - hy0) * 0.5, dy.y);
    normal = normalize(cross(py, px));
  }

  vec3 pos;
  if (u_skirt == 1) {
    // 侧壁/底盖：直接使用 CPU 给定的世界坐标
    pos = a_skirtPos;
    if (length(a_skirtPos.xz) < 0.001) {
      // 底盖中心
      normal = vec3(0.0, -1.0, 0.0);
    } else {
      float radialLen = length(a_skirtPos.xz);
      vec3 radial = normalize(vec3(a_skirtPos.x / radialLen, 0.0, a_skirtPos.z / radialLen));
      // 底盖环顶点 y 与中心相同，用屏幕外轮廓无法区分，统一给径向+向下混合
      normal = normalize(radial + vec3(0.0, -0.15, 0.0));
    }
  } else {
    // 工作面
    pos = vec3(planar.x, h * u_vertScale, planar.y);
  }

  v_worldPos = pos;
  v_normal = normal;
  gl_Position = u_viewProj * vec4(pos, 1.0);
}
`

export const FRAGMENT_SHADER = COMMON

export function lightLabel(light: LightPreset): string {
  const map: Record<LightPreset, string> = {
    studio: '摄影棚光',
    warm: '暖光展柜',
    daylight: '窗边日光'
  }
  return map[light]
}

export function modeLabel(mode: RenderMode): string {
  const map: Record<RenderMode, string> = {
    craft: '工艺质感',
    layer: '层显纹色',
    grind: '打磨哑光',
    heat: '剩漆热力'
  }
  return map[mode]
}
