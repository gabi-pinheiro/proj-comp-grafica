// Biblioteca compartilhada: mesmas convenções da engine do professor —
// Surface com material, operações CSG, transformações e primitivas SDF.
// Acrescentamos apenas o campo emissivo e os utilitários da nossa cena.

uniform float uTime;        // tempo do artefato (velocidade controlada pela narrativa)
uniform vec3 uLightDir;     // direção que aponta PARA a estrela principal
uniform vec3 uCamPos;       // posição da câmera no mundo
uniform float uCoreGlow;    // intensidade do núcleo (controlada pela narrativa)
uniform float uParticles;   // quantidade de partículas orbitais (0 a 1)

#define PI 3.14159265359

struct Surface {
    float d;
    vec3 color;
    float Ka;
    float Kd;
    float Ks;
    vec3 em;   // emissivo (núcleo, gemas, aros do túnel)
};

Surface surf(float d, vec3 color, float ka, float kd, float ks)
{
    Surface s;
    s.d = d; s.color = color; s.Ka = ka; s.Kd = kd; s.Ks = ks; s.em = vec3(0.0);
    return s;
}

////////////////////
// TRANSFORMAÇÕES //
////////////////////

mat4 trans(vec3 t)
{
    return mat4(vec4(1., 0., 0., 0.),
                vec4(0., 1., 0., 0.),
                vec4(0., 0., 1., 0.),
                vec4(t.x, t.y, t.z, 1.));
}

mat4 rotX(in float angle)
{
    float rad = radians(angle);
    float c = cos(rad), s = sin(rad);
    return mat4(vec4(1.0, 0.0, 0.0, 0.0),
                vec4(0.0,   c,   s, 0.0),
                vec4(0.0,  -s,   c, 0.0),
                vec4(0.0, 0.0, 0.0, 1.0));
}

mat4 rotY(in float angle)
{
    float rad = radians(angle);
    float c = cos(rad), s = sin(rad);
    return mat4(vec4(  c, 0.0,  -s, 0.0),
                vec4(0.0, 1.0, 0.0, 0.0),
                vec4(  s, 0.0,   c, 0.0),
                vec4(0.0, 0.0, 0.0, 1.0));
}

mat4 rotZ(in float angle)
{
    float rad = radians(angle);
    float c = cos(rad), s = sin(rad);
    return mat4(vec4(  c,   s, 0.0, 0.0),
                vec4( -s,   c, 0.0, 0.0),
                vec4(0.0, 0.0, 1.0, 0.0),
                vec4(0.0, 0.0, 0.0, 1.0));
}

vec3 opTransf(vec3 p, mat4 m)
{
    return vec4(m * vec4(p, 1.)).xyz;
}

// Rotação 2D rápida (ângulo em radianos, sem mat4)
mat2 rotate2D(float a)
{
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

////////////////////
// PRIMITIVAS SDF //
////////////////////

float sphereDist(vec3 p, vec3 ce, float r)
{
    return length(p - ce) - r;
}

float torusDist(vec3 p, vec2 t)
{
    return length(vec2(length(p.xz) - t.x, p.y)) - t.y;
}

float planeDist(vec3 p, vec3 normal, float D)
{
    return dot(p, normal) - D;
}

float boxDist(vec3 p, vec3 b)
{
    vec3 d = abs(p) - b;
    return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
}

float boxRoundDist(vec3 p, vec3 s, float r)
{
    vec3 d = abs(p) - (s - r);
    return length(max(d, 0.0)) - r + min(max(d.x, max(d.y, d.z)), 0.0);
}

float ellipsoidDist(in vec3 p, in vec3 r) // aproximada
{
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
}

///////////
//  CSG  //
///////////

Surface unionS(Surface s1, Surface s2)
{
    return (s1.d <= s2.d) ? s1 : s2;
}

Surface intersectionS(Surface s1, Surface s2)
{
    return (s1.d <= s2.d) ? s2 : s1;
}

Surface subtractionS(Surface s1, Surface s2)
{
    Surface R;
    if (s1.d <= -s2.d) {
        R = s2;
        R.d = -s2.d;
        return R;
    }
    return s1;
}

// Versões escalares: úteis dentro de uma peça que depois recebe um material só
float opSub(float a, float b) { return max(a, -b); }

// União suave: emenda orgânica entre duas formas
float opSmoothUnion(float a, float b, float k)
{
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

////////////////////
//  HASH / RUÍDO  //
////////////////////

float hash11(float n) { return fract(sin(n) * 43758.5453123); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash31(vec3 p)
{
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float valueNoise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

////////////////////
//  PALETA / LUZ  //
////////////////////

const vec3 ARTIFACT_CENTER = vec3(0.0, 2.6, 0.0);
const vec3 SUN_COLOR = vec3(1.0, 0.68, 0.60);
const vec3 CYAN = vec3(0.15, 0.95, 1.0);
const vec3 MAGENTA = vec3(1.0, 0.22, 0.70);

// O artefato flutua lentamente para cima e para baixo
vec3 artifactCenter()
{
    return ARTIFACT_CENTER + vec3(0.0, 0.12 * sin(uTime * 0.6), 0.0);
}

float corePulse()
{
    return 0.5 + 0.5 * sin(uTime * 1.8);
}

vec3 coreColor()
{
    return mix(CYAN, MAGENTA, 0.15 + 0.15 * sin(uTime * 0.4)) * uCoreGlow;
}

// Luz pontual emitida pelo núcleo do artefato
vec3 coreLight(vec3 p, vec3 n)
{
    vec3 toCore = artifactCenter() - p;
    float dist = length(toCore);
    float diffuse = max(dot(n, toCore / dist), 0.0);
    return coreColor() * diffuse * (1.0 + 1.5 * corePulse()) / (1.0 + 0.6 * dist * dist);
}

///////////
//  CÉU  //
///////////

vec3 skyColor(vec3 dir)
{
    vec3 zenith = vec3(0.004, 0.004, 0.018);
    vec3 horizon = vec3(0.13, 0.045, 0.17);
    vec3 color = mix(horizon, zenith, pow(clamp(dir.y, 0.0, 1.0), 0.45));
    float sunAmount = max(dot(dir, uLightDir), 0.0);
    color += vec3(0.45, 0.13, 0.16) * pow(sunAmount, 8.0) * 0.6;
    return color;
}

// Estrelas por hash numa grade sobre a direção do raio
vec3 stars(vec3 dir)
{
    vec3 grid = dir * 300.0;
    vec3 cell = floor(grid);
    float h = hash31(cell);
    if (h < 0.993)
        return vec3(0.0);
    float dist = length(grid - cell - 0.5);
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + h * 400.0);
    float brightness = (1.0 - smoothstep(0.0, 0.5, dist)) * (h - 0.993) / 0.007;
    return vec3(0.85, 0.85, 1.0) * brightness * twinkle * 2.0 * smoothstep(0.0, 0.2, dir.y);
}

// Retorna (tPerto, tLonge) da interseção raio-esfera, ou (-1, -1) se não houver
vec2 intersectSphere(vec3 ro, vec3 rd, float radius)
{
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float h = b * b - c;
    if (h < 0.0)
        return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
}

const vec3 PLANET_DIR = vec3(0.4099795, 0.239988, -0.879956);   // normalize(vec3(0.41,0.24,-0.88))
const vec3 RING_NORMAL = vec3(0.22965761, 0.91863042, 0.32152065); // normalize(vec3(0.25,1.0,0.35))

// Céu completo: gradiente, estrela, planeta gigante com anéis e estrelas
vec3 renderSky(vec3 rd)
{
    vec3 color = skyColor(rd);

    // Disco da estrela principal
    float sunAmount = dot(rd, uLightDir);
    color += SUN_COLOR * (smoothstep(0.9990, 0.9995, sunAmount) * 4.0 + pow(max(sunAmount, 0.0), 400.0) * 1.5);

    // Planeta gigante tratado como esfera muito distante
    vec3 planetCenter = PLANET_DIR * 100.0;
    float planetRadius = 9.0;
    vec2 planetHit = intersectSphere(-planetCenter, rd, planetRadius);

    if (planetHit.x > 0.0) {
        vec3 n = normalize(rd * planetHit.x - planetCenter);
        float light = max(dot(n, uLightDir), 0.0);
        float latitude = dot(n, RING_NORMAL);
        float bands = sin(latitude * 18.0 + 2.0 * sin(latitude * 5.0));
        vec3 surface = mix(vec3(0.30, 0.15, 0.42), vec3(0.70, 0.38, 0.55), 0.5 + 0.5 * bands);
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        color = surface * (light * 0.8 + 0.015) + vec3(0.6, 0.3, 0.8) * rim * (0.15 + light);
    } else {
        color += stars(rd);
    }

    float ringT = dot(planetCenter, RING_NORMAL) / dot(rd, RING_NORMAL);
    if (ringT > 0.0 && (planetHit.x < 0.0 || ringT < planetHit.x)) {
        float ringDist = length(rd * ringT - planetCenter) / planetRadius;
        if (ringDist > 1.35 && ringDist < 2.3) {
            float stripes = 0.6 + 0.4 * sin(ringDist * 14.0);
            float fade = smoothstep(1.35, 1.5, ringDist) * (1.0 - smoothstep(2.1, 2.3, ringDist));
            color = mix(color, vec3(0.60, 0.45, 0.62) * 0.4, 0.6 * stripes * fade);
        }
    }
    return color;
}

//////////
//  FOG //
//////////

// Névoa exponencial quadrática, misturando na cor do céu na direção do raio
vec3 applyFog(vec3 color, float dist, vec3 rayDir)
{
    float fog = 1.0 - exp(-pow(dist * 0.022, 2.0));
    return mix(color, skyColor(rayDir), fog);
}

//////////////////
// TONE MAPPING //
//////////////////

// ACES aproximado (Narkowicz) + gama, aplicado no fim da composição
vec3 toneMap(vec3 c)
{
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}
