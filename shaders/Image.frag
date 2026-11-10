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

#define MAX_STEPS 120
#define MAX_DIST 90.
#define SURF_DIST 0.008
#define EPSILON 0.002
#define TUNNEL_MAX_STEPS 140
#define TUNNEL_MAX_DIST 30.

const float TUNNEL_R = 1.0;
const float RING_SPACING = 2.4;
const float RING_SIZE = 0.07;
const float RING_SPEED = 2.2;
// O túnel toma conta da câmera na segunda metade da fratura (~10 s reais)
const float TUNNEL_START = 0.55;

////////////////////
//     TERRENO    //
////////////////////

// FBM de 4 oitavas — mesma família de relevo da malha da versão anterior
float terrainFbm(vec2 p)
{
    float sum = 0.0, amp = 0.5, freq = 1.0;
    for (int i = 0; i < 4; i++) {
        sum += amp * valueNoise(p * freq);
        amp *= 0.5;
        freq *= 2.0;
    }
    return sum;
}

// Relevo do terreno: dunas suaves, cratera sob o artefato e montanhas ao longe
float terrainHeight(vec2 xz)
{
    float r = length(xz);

    float dunes = (terrainFbm(xz * 0.05) - 0.45) * 3.0
                + 0.4 * sin(xz.x * 0.21 + xz.y * 0.13);
    float flatCenter = smoothstep(9.0, 24.0, r);

    // Pequena cratera embaixo do artefato, como se ele tivesse marcado o solo
    float crater = -0.35 * (1.0 - smoothstep(0.0, 6.5, r))
                 + 0.3 * exp(-(r - 7.0) * (r - 7.0) / 1.5);

    // As montanhas só existem longe: o FBM dela nem é avaliado perto do centro
    float mountains = r > 33.0 ? smoothstep(35.0, 70.0, r)
                      * terrainFbm(xz * 0.03 + vec2(7.0, 0.0)) * 16.0 : 0.0;

    return dunes * flatCenter + crater + mountains;
}

// Distância amortecida para o campo de altura (a encosta trai a SDF exata;
// o fator mantém os passos conservadores nas montanhas íngremes)
float terrainDist(vec3 p)
{
    return (p.y - terrainHeight(p.xz)) * 0.45;
}

////////////////////
//     ROCHAS     //
////////////////////

// Mesma distribuição da versão em malha: um anel perto do artefato,
// rochas espalhadas até ~40 u e 8 cacos altos no horizonte. Hash decide tudo.
Surface rocksSurface(vec3 p)
{
    Surface best;
    best.d = MAX_DIST;
    // Nenhuma rocha existe acima de ~14 u, abaixo do solo ou além de r=52:
    // raios para o céu ou muito longe pulam o laço inteiro
    if (p.y > 14.0 || p.y < -2.0 || dot(p.xz, p.xz) > 52.0 * 52.0)
        return best;
    for (int i = 0; i < 48; i++) {
        float fi = float(i);
        bool shard = (i >= 40);
        float ang = hash11(fi * 5.31) * 6.2831;
        float rad = shard ? 18.0 + hash11(fi * 3.17) * 27.0
                : (i < 10 ? 7.5 + hash11(fi * 1.77) * 3.5
                          : 13.0 + hash11(fi * 1.93) * 27.0);
        // Deixa livre o setor entre a câmera inicial e o artefato
        if (!shard && rad < 13.0 && abs(ang - 1.5708) < 0.6)
            continue;

        float size = shard ? 1.0 + hash11(fi * 7.71) * 0.6
                 : (i < 10 ? 0.4 + hash11(fi * 9.13) * 0.7
                           : 0.6 + hash11(fi * 9.13) * 1.4);
        vec3 radii = shard ? vec3(size, 4.0 + hash11(fi * 4.33) * 5.0, size)
                           : vec3(size * (0.8 + 0.5 * hash11(fi * 2.31)),
                                  size * (0.6 + 0.5 * hash11(fi * 3.97)), size);

        // Teste barato em XZ: pula a rocha se o raio passa longe dela
        float bound = max(radii.x, max(radii.y, radii.z)) + 4.0;
        vec2 dxz = p.xz - vec2(cos(ang), sin(ang)) * rad;
        if (dot(dxz, dxz) > bound * bound)
            continue;

        vec3 center = vec3(cos(ang) * rad, 0.0, sin(ang) * rad);
        center.y = terrainHeight(center.xz) - 0.15 * radii.y;
        vec3 rp = p - center;
        rp.xz *= rotate2D(hash11(fi * 6.17) * 6.2831);

        // Elipsoide deformada por ruído e com a base achatada no solo
        float d = ellipsoidDist(rp, radii)
                - 0.20 * size * valueNoise3(rp * 1.8 / size + vec3(fi * 13.7));
        d = max(d, (center.y - 0.45 * radii.y) - p.y);
        if (d < best.d) {
            vec3 base = shard ? vec3(0.11, 0.09, 0.19)
                              : vec3(0.15, 0.12, 0.21) * (0.8 + 0.4 * hash11(fi * 11.3));
            best = surf(d, base, 0.2, 0.6, 0.05);
        }
    }
    return best;
}

////////////////////
//   CENA (getDist) //
////////////////////

Surface getDist(vec3 p, bool withRocks)
{
    // Terreno (a cor detalhada só é calculada na luz, não a cada passo)
    Surface g = surf(terrainDist(p), vec3(0.13, 0.09, 0.17), 0.25, 0.8, 0.05);
    g.mat = 1.0;

    Surface d = g;
    if (withRocks)
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
    return uFracture >= TUNNEL_START ? tunnelDist(p) : getDist(p, true);
}

// O raio até o núcleo ignora as rochas (o vazamento de luz entre elas é
// imperceptível e isso poupa metade do custo da sombra do núcleo)
Surface mapDistNoRocks(vec3 p)
{
    return uFracture >= TUNNEL_START ? tunnelDist(p) : getDist(p, false);
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
float softShadow(vec3 ro, vec3 rd, float maxT, bool withRocks)
{
    float res = 1.0;
    float t = 0.04;
    for (int i = 0; i < 32; i++) {
        float h = withRocks ? mapDist(ro + rd * t).d : mapDistNoRocks(ro + rd * t).d;
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
    return softShadow(p, dir / dist, dist - 0.05, false);
}

////////////////////
//      LUZ       //
////////////////////

vec3 getLight(vec3 p, vec3 CamPos, Surface s, vec3 rd)
{
    vec3 n = estimateNormal(p);

    // Detalhe de cor do chão: calculado uma vez, no ponto atingido
    if (s.mat == 1.0) {
        float detail = 0.6 * valueNoise(p.xz * 0.7) + 0.4 * valueNoise(p.xz * 3.1);
        s.color *= 0.7 + 0.6 * detail;
    }

    vec3 ambient = mix(vec3(0.03, 0.015, 0.04), vec3(0.08, 0.05, 0.13), 0.5 + 0.5 * n.y);
    vec3 v = -rd;
    vec3 col = s.color * s.Ka * ambient * 12.0;

    // Sol direcional (Blinn-Phong) com sombra suave marchada
    float diffuse = max(dot(n, uLightDir), 0.0);
    if (diffuse > 0.0) {
        float shadow = softShadow(p + n * 0.02, uLightDir, 40.0, true);
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
    if (uFracture < TUNNEL_START && p.y < 4.0 && p.y < terrainHeight(p.xz) + 0.06) {
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
    // Se o raio nunca chega perto do artefato, nenhum glow vale a pena calcular
    float tc = dot(center - ro, rd);
    if (tc < -3.0 || length(ro + tc * rd - center) > 6.0)
        return vec3(0.0);
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
        col += vec3(1.0) * exp(-length(p) * 3.0) * 4.0 * smoothstep(TUNNEL_START - 0.14, TUNNEL_START, f);
        col = mix(col, vec3(1.0), smoothstep(TUNNEL_START - 0.06, TUNNEL_START, f));
    }

    col = toneMap(col * (1.0 - uBlack));
    C = vec4(col, 1.0);
}
