#version 330 core

// Image.frag — a cena inteira por ray marching, no estilo da engine do professor:
// getDist() devolve uma Surface (distância + material) e um único passo de
// fragment shader resolve geometria, luz, partículas, transição e a foto.

uniform sampler2D iChannel0;   // foto da sala de aula
uniform float iTime;           // tempo real (túnel, estrelas)
uniform vec4 iMouse;
uniform vec2 iResolution;
uniform vec3 uCamTarget;
uniform float uFracture;       // 0..1: progresso da fratura/transição
uniform float uRoomT;          // segundos desde que a sala apareceu (-1 = ainda não)
uniform float uBlack;          // 1 = tela preta (fim)
uniform float uRoomAspect;     // largura/altura da foto

out vec4 C;

#include "common.glsl"
#include "sculpture.glsl"

#define MAX_STEPS 220
#define MAX_DIST 160.
#define SURF_DIST 0.008
#define EPSILON 0.002
#define TUNNEL_MAX_STEPS 140
#define TUNNEL_MAX_DIST 30.

const float TUNNEL_R = 1.0;
const float RING_SPACING = 2.4;
const float RING_SIZE = 0.07;
const float RING_SPEED = 2.2;
// O túnel toma conta da câmera no fim da fratura
const float TUNNEL_START = 0.90;

////////////////////
//     TERRENO    //
////////////////////

// Relevo do terreno: duas oitavas de ruído, suave o suficiente para marchar
float terrainHeight(vec2 xz)
{
    float h = valueNoise(xz * 0.045) * 3.2
            + valueNoise(xz * 0.16) * 0.7
            + valueNoise(xz * 0.5) * 0.15;
    float d = length(xz);
    // Achata a região ao redor do artefato e levanta ao longe
    h *= smoothstep(2.0, 14.0, d) * 0.8 + 0.35 * smoothstep(0.0, 4.0, d);
    return h;
}

// Distância conservadora para o campo de altura (SDF "seguro" para marcha)
float terrainDist(vec3 p)
{
    return (p.y - terrainHeight(p.xz)) * 0.55;
}

////////////////////
//     ROCHAS     //
////////////////////

// Poucas rochas espalhadas por hash, unidas à SDF da cena
Surface rocksSurface(vec3 p)
{
    Surface r;
    r.d = MAX_DIST;
    for (int i = 0; i < 7; i++) {
        float fi = float(i);
        float ang = hash11(fi * 7.31) * 6.2831;
        float rad = 4.5 + hash11(fi * 3.17) * 9.0;
        vec3 center = vec3(cos(ang) * rad, 0.0, sin(ang) * rad);
        center.y = terrainHeight(center.xz) + 0.05;
        vec3 rp = p - center;
        rp.xz *= rotate2D(hash11(fi * 5.7) * 3.0);
        float size = 0.25 + hash11(fi * 9.3) * 0.45;
        float d = ellipsoidDist(rp, vec3(size, size * (0.55 + 0.5 * hash11(fi)), size));
        if (d < r.d) {
            r.d = d;
            r = surf(d, vec3(0.11, 0.07, 0.14), 0.2, 0.6, 0.05);
        }
    }
    return r;
}

////////////////////
//   CENA (getDist) //
////////////////////

Surface getDist(vec3 p)
{
    // Terreno
    Surface g = surf(terrainDist(p), vec3(0.16, 0.09, 0.20), 0.25, 0.8, 0.05);
    float detail = 0.6 * valueNoise(p.xz * 0.7) + 0.4 * valueNoise(p.xz * 3.1);
    g.color *= 0.7 + 0.6 * detail;

    Surface d = g;
    d = unionS(d, rocksSurface(p));

    // A escultura só é avaliada perto do artefato (bounding sphere grossa)
    float bound = length(p - artifactCenter());
    if (bound < 3.5) {
        d = unionS(d, sculptureSurface(p));
    } else {
        d = unionS(d, surf(bound - 3.0, vec3(0.0), 0.0, 0.0, 0.0));
    }
    return d;
}

////////////////////
//      TÚNEL     //
////////////////////

// O túnel da transição: cilindro claro com aros emissivos que vêm na direção
// da câmera — geometria movendo, não a câmera, com a parede parada de referência
Surface tunnelDist(vec3 p)
{
    Surface wall = surf(TUNNEL_R - length(p.xy), vec3(0.85, 0.87, 0.92), 0.5, 0.8, 0.0);

    float pz = p.z + iTime * RING_SPEED;
    float idx = floor(pz / RING_SPACING);
    float center = (idx + 0.5) * RING_SPACING + (hash11(idx * 0.61) - 0.5) * 0.8;
    float local = pz - center;
    float ringRadius = 0.55 + 0.20 * hash11(idx * 0.83);
    float ring = length(vec2(length(p.xy) - ringRadius, local)) - RING_SIZE;

    vec3 hue = mix(CYAN, MAGENTA, hash11(idx * 0.47));
    hue = mix(hue, vec3(1.0, 0.75, 0.3), hash11(idx * 0.23) * 0.4);
    hue = mix(hue, vec3(0.55), 0.35);
    Surface ringS = surf(ring, vec3(0.0), 0.0, 0.0, 0.0);
    ringS.em = hue * 1.6;

    return unionS(wall, ringS);
}

////////////////////
//  RAY MARCHING  //
////////////////////

// Quando a fratura termina, a cena inteira vira o túnel (mesmo uniform que
// escolhe o ramo em main(), então marcha e normal são sempre consistentes)
Surface mapDist(vec3 p)
{
    return uFracture >= TUNNEL_START ? tunnelDist(p) : getDist(p);
}

Surface rayMarching(vec3 Cam, vec3 rd)
{
    float d0 = 0.0;
    float maxD = uFracture >= TUNNEL_START ? TUNNEL_MAX_DIST : MAX_DIST;
    int maxSteps = uFracture >= TUNNEL_START ? TUNNEL_MAX_STEPS : MAX_STEPS;
    vec3 pi = Cam + d0 * rd;
    Surface s = mapDist(pi);
    int i = 0;
    while (i < maxSteps && s.d > SURF_DIST && d0 < maxD) {
        d0 += s.d;
        pi = Cam + d0 * rd;
        s = mapDist(pi);
        i++;
    }
    if (i == maxSteps)
        d0 = maxD + 1.0;
    s.d = d0;   // s.d passa a ser a distância percorrida (como na engine)
    return s;
}

vec3 estimateNormal(vec3 p)
{
    float sd = mapDist(p).d;
    float dx = mapDist(vec3(p.x + EPSILON, p.y, p.z)).d - sd;
    float dy = mapDist(vec3(p.x, p.y + EPSILON, p.z)).d - sd;
    float dz = mapDist(vec3(p.x, p.y, p.z + EPSILON)).d - sd;
    return normalize(vec3(dx, dy, dz));
}

////////////////////
//     SOMBRA     //
////////////////////

// Sombra suave ray-marcada: um segundo march em direção à luz guarda o quanto
// o raio "raspou" em geometria (penumbra) — substitui o shadow map rasterizado
float softShadow(vec3 ro, vec3 rd, float maxT)
{
    float res = 1.0;
    float t = 0.04;
    for (int i = 0; i < 48; i++) {
        float h = mapDist(ro + rd * t).d;
        res = min(res, 10.0 * h / t);
        t += clamp(h, 0.02, 0.6);
        if (res < 0.005 || t > maxT)
            break;
    }
    return clamp(res, 0.0, 1.0);
}

// A luz do núcleo só chega onde a casca não bloqueia (mesmo truque da sombra)
float coreVisibility(vec3 p)
{
    vec3 core = artifactCenter();
    vec3 dir = core - p;
    float dist = length(dir);
    return softShadow(p, dir / dist, dist - 0.05);
}

////////////////////
//      LUZ       //
////////////////////

vec3 getLight(vec3 p, vec3 CamPos, Surface s, vec3 rd)
{
    vec3 n = estimateNormal(p);

    vec3 ambient = mix(vec3(0.03, 0.015, 0.04), vec3(0.08, 0.05, 0.13), 0.5 + 0.5 * n.y);
    vec3 v = -rd;
    vec3 col = s.color * s.Ka * ambient * 12.0;

    // Sol direcional (Blinn-Phong) com sombra suave marchada
    float diffuse = max(dot(n, uLightDir), 0.0);
    if (diffuse > 0.0) {
        float shadow = softShadow(p + n * 0.02, uLightDir, 40.0);
        vec3 hv = normalize(uLightDir + v);
        float spec = pow(max(dot(n, hv), 0.0), 48.0);
        col += SUN_COLOR * shadow * (s.color * s.Kd * diffuse * 1.6 + s.Ks * spec * 0.6);
    }

    // Luz do núcleo, bloqueada pela casca
    float coreVis = length(p - artifactCenter()) < 10.0 ? coreVisibility(p + n * 0.02) : 1.0;
    col += s.color * coreLight(p, n) * 3.0 * coreVis;

    // Emissivo (núcleo, gemas, aros do túnel)
    col += s.em;

    // Ondas de energia que saem do artefato pelo chão
    if (uFracture < TUNNEL_START && p.y < terrainHeight(p.xz) + 0.06) {
        float r = length(p.xz - artifactCenter().xz);
        float wave = smoothstep(0.97, 1.0, sin(r * 2.2 - iTime * 1.2)) * exp(-r * 0.3);
        col += coreColor() * wave * (0.08 + 0.08 * corePulse());
    }
    return col;
}

////////////////////
//   PARTÍCULAS   //
////////////////////

// Sem instancing: cada partícula é um ponto em órbita; o brilho é acumulado
// quando o raio da câmera passa perto dele (glow ao longo do raio)
vec3 particleGlow(vec3 ro, vec3 rd, float maxT)
{
    if (uParticles <= 0.001)
        return vec3(0.0);
    vec3 center = artifactCenter();
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 32; i++) {
        float fi = float(i);
        float ring = mod(fi, 4.0);
        float radius = 1.4 + ring * 0.45 + hash11(fi * 1.7) * 0.15;
        float speed = (0.5 + 0.4 * ring) * (0.6 + 0.4 * hash11(fi * 3.3));
        float phase = hash11(fi * 11.1) * 6.2831;
        float a = uTime * speed + phase;
        float tilt = ring * 0.5 - 0.7;
        vec3 pos = center + vec3(cos(a) * radius, sin(a * 0.7 + fi) * 0.35 + tilt * 0.2, sin(a) * radius);
        float t = dot(pos - ro, rd);
        if (t > 0.3 && t < maxT) {
            vec3 q = ro + t * rd;
            float d = length(q - pos);
            acc += mix(CYAN, MAGENTA, hash11(fi * 0.9)) * exp(-d * d * 60.0) * 0.45;
        }
    }
    return acc * uParticles;
}

// Halo em volta do núcleo: brilho quando o raio passa perto do artefato
vec3 coreHalo(vec3 ro, vec3 rd, float maxT)
{
    vec3 center = artifactCenter();
    float t = dot(center - ro, rd);
    if (t < 0.0 || t > maxT + 4.0)
        return vec3(0.0);
    float d = length(ro + t * rd - center);
    return coreColor() * exp(-d * d * 1.1) * (0.25 + 0.2 * corePulse()) * uCoreGlow;
}

////////////////////
//     CÂMERA     //
////////////////////

mat3 SetCamera(vec3 Look_at, vec3 CamPos)
{
    vec3 cd = normalize(Look_at - CamPos);
    vec3 cv = cross(vec3(0.0, 1.0, 0.0), cd);
    vec3 cu = cross(cd, cv);
    return mat3(cv, cu, cd);
}

////////////////////
//  SALA DE AULA  //
////////////////////

// A foto preenche a tela sem deformar (cover), emerge do branco, pisca e olha
// para os lados com um pan simples de "cabeça"
vec3 classroomColor(vec2 uv01, float t)
{
    // Pan: a "cabeça" olha para a esquerda, depois para a direita e volta
    float look = sin(clamp((t - 3.0) / 5.0, 0.0, 1.0) * 3.14159 * 2.0) * 0.14;
    float zoom = 1.12;

    vec2 uv = uv01 - 0.5;
    uv *= zoom;
    uv.x += look;
    // Cover: corta o eixo que sobra conforme o aspect da foto vs. da tela
    float screenAspect = iResolution.x / iResolution.y;
    if (screenAspect > uRoomAspect)
        uv.y *= uRoomAspect / screenAspect;
    else
        uv.x *= screenAspect / uRoomAspect;
    uv += 0.5;

    vec3 room = texture(iChannel0, uv).rgb;
    // Desfoque simples no começo: 4 amostras vizinhas somadas quando t é pequeno
    float blurAmt = 1.0 - smoothstep(0.2, 1.4, t);
    if (blurAmt > 0.01) {
        vec2 px = vec2(0.006 * blurAmt);
        room = (room + texture(iChannel0, uv + px).rgb + texture(iChannel0, uv - px).rgb
              + texture(iChannel0, uv + vec2(px.x, -px.y)).rgb + texture(iChannel0, uv - vec2(px.x, -px.y)).rgb) / 5.0;
    }
    // A sala emerge do branco
    room = mix(vec3(1.0), room, smoothstep(0.0, 1.2, t));

    // Uma piscada: as pálpebras fecham e reabrem rápido uma vez
    vec2 p = uv01 * 2.0 - 1.0;
    float blink = smoothstep(1.7, 1.9, t) * (1.0 - smoothstep(2.1, 2.8, t));
    float lidEdge = (1.0 - clamp(blink, 0.0, 1.0)) * 0.75;
    room *= 1.0 - smoothstep(lidEdge - 0.03, lidEdge, abs(p.y) + 0.2 * p.x * p.x);
    return room;
}

////////////////////
//      MAIN      //
////////////////////

void main()
{
    vec2 uv01 = gl_FragCoord.xy / iResolution.xy;
    vec2 p = (gl_FragCoord.xy - 0.5 * iResolution) / iResolution.y;
    float f = uFracture;

    vec3 col;

    if (uRoomT >= 0.0) {
        // Sala de aula (textura em iChannel0)
        col = classroomColor(uv01, uRoomT);
        col = mix(col, vec3(0.0), uBlack);
        C = vec4(col, 1.0);
        return;
    }

    if (f >= TUNNEL_START) {
        // ===================== TÚNEL =====================
        vec3 ro = vec3(0.0, 0.0, 0.0);
        vec3 rd = normalize(vec3(p, 1.0));
        // leve oscilação da "mão segurando a câmera"
        rd.xy = rotate2D(0.06 * sin(iTime * 0.8)) * rd.xy;

        Surface s = rayMarching(ro, rd);
        vec3 tcol;
        if (s.d < TUNNEL_MAX_DIST) {
            vec3 po = ro + s.d * rd;
            vec3 n = estimateNormal(po);
            // luz à frente do túnel
            vec3 lpos = vec3(0.0, 0.0, po.z + 6.0);
            vec3 l = normalize(lpos - po);
            float dif = max(dot(n, l), 0.0);
            float stripes = 0.5 + 0.5 * sin(atan(po.y, po.x) * 18.0);
            tcol = s.color * (s.Ka + s.Kd * dif) + vec3(0.10, 0.12, 0.18) * stripes * dif + s.em;
            // névoa converge para o branco do ponto de fuga
            tcol = mix(tcol, vec3(1.0), smoothstep(6.0, 24.0, s.d));
        } else {
            tcol = vec3(1.0);
        }
        // Clarão final: o ponto de fuga engole a tela
        float whiteout = smoothstep(0.985, 0.998, f);
        float rr = length(p);
        tcol += vec3(1.0) * exp(-rr * 3.0) * 2.5 * smoothstep(0.96, 0.99, f);
        tcol = mix(tcol, vec3(1.0), whiteout);
        col = tcol;
    } else {
        // ===================== CENA =====================
        // A imagem se torce conforme a fratura avança (a câmera mergulha no núcleo)
        float twist = f * 1.6 * smoothstep(1.4, 0.0, length(p));
        p = rotate2D(-twist) * p;
        p *= 1.0 - 0.25 * f;

        vec3 rd = normalize(vec3(p, 1.2));
        vec3 Cam = uCamPos;
        mat3 Mc = SetCamera(uCamTarget, Cam);
        rd = Mc * rd;

        Surface s = rayMarching(Cam, rd);
        float maxD = s.d;
        if (s.d < MAX_DIST) {
            vec3 po = Cam + s.d * rd;
            col = getLight(po, Cam, s, rd);
            col = applyFog(col, s.d, rd);
        } else {
            col = renderSky(rd);
        }

        // Brilhos acumulados ao longo do raio (partículas + halo do núcleo)
        col += particleGlow(Cam, rd, maxD);
        col += coreHalo(Cam, rd, maxD);

        // No fim da fratura a tela é engolida pelo brilho do núcleo
        col += vec3(1.0) * exp(-length(p) * 3.0) * 4.0 * smoothstep(0.78, 0.9, f);
        col = mix(col, vec3(1.0), smoothstep(0.86, 0.9, f));
    }

    col = toneMap(col * (1.0 - uBlack));
    C = vec4(col, 1.0);
}
