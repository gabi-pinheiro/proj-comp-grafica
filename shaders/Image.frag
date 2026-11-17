#version 330 core

// Image.frag - a cena inteira por ray marching, no estilo da engine do professor:
// getDist() devolve uma Surface (distância + material) e um único passo de
// fragment shader resolve geometria, luz, partículas, transição e a foto.

uniform sampler2D iChannel0;   // foto da sala de aula
uniform float iTime;           // tempo real (túnel, estrelas)
uniform vec4 iMouse;
uniform vec2 iResolution;
uniform vec3 uAlvoCam;
uniform float uFratura;       // 0..1: progresso da fratura/transição
uniform float uTempoSala;          // segundos desde que a sala apareceu (-1 = ainda não)
uniform float uPreto;          // 1 = tela preta (fim)
uniform float uAspectoSala;     // largura/altura da foto

out vec4 C;

#include "common.glsl"
#include "sculpture.glsl"

#define MAX_STEPS 100
#define MAX_DIST 90.
#define SURF_DIST 0.008
#define EPSILON 0.002
#define TUNNEL_MAX_STEPS 140
#define TUNNEL_MAX_DIST 30.

const float RAIO_TUNEL = 1.0;
const float ESPACO_AROS = 2.4;
const float TAM_AROS = 0.07;
const float VEL_AROS = 2.2;
// O túnel toma conta da câmera na segunda metade da fratura (~10 s reais)
const float INICIO_TUNEL = 0.55;

////////////////////
//     TERRENO    //
////////////////////

// FBM de 4 oitavas - mesma família de relevo da malha da versão anterior
float fbmTerreno(vec2 p)
{
    float soma = 0.0, ampl = 0.5, freq = 1.0;
    for (int i = 0; i < 4; i++) {
        soma += ampl * ruido(p * freq);
        ampl *= 0.5;
        freq *= 2.0;
    }
    return soma;
}

// Relevo do terreno: dunas suaves, cratera sob o artefato e montanhas ao longe
float alturaTerreno(vec2 xz)
{
    float r = length(xz);

    float dunas = (fbmTerreno(xz * 0.05) - 0.45) * 3.0
                + 0.4 * sin(xz.x * 0.21 + xz.y * 0.13);
    float centroPlano = smoothstep(9.0, 24.0, r);

    // Pequena cratera embaixo do artefato, como se ele tivesse marcado o solo
    float cratera = -0.35 * (1.0 - smoothstep(0.0, 6.5, r))
                 + 0.3 * exp(-(r - 7.0) * (r - 7.0) / 1.5);

    // As montanhas só existem longe: o FBM dela nem é avaliado perto do centro
    float montanhas = r > 33.0 ? smoothstep(35.0, 70.0, r)
                      * fbmTerreno(xz * 0.03 + vec2(7.0, 0.0)) * 16.0 : 0.0;

    return dunas * centroPlano + cratera + montanhas;
}

// Distância amortecida para o campo de altura (a encosta trai a SDF exata;
// o fator mantém os passos conservadores nas montanhas íngremes)
float distTerreno(vec3 p)
{
    return (p.y - alturaTerreno(p.xz)) * 0.45;
}

////////////////////
//     ROCHAS     //
////////////////////

// Mesma distribuição da versão em malha: um anel perto do artefato,
// rochas espalhadas até ~40 u e 8 cacos altos no horizonte. Hash decide tudo.
Surface supRochas(vec3 p)
{
    Surface melhor;
    melhor.d = MAX_DIST;
    // Nenhuma rocha existe acima de ~14 u, abaixo do solo ou além de r=52:
    // raios para o céu ou muito longe pulam o laço inteiro
    if (p.y > 14.0 || p.y < -2.0 || dot(p.xz, p.xz) > 52.0 * 52.0)
        return melhor;
    // 18 rochas (8 perto + 6 espalhadas + 4 cacos): a distribuição é a da
    // versão em malha reduzida - cada iteração custa um hash + teste por
    // passo de marcha, então menos rochas = FPS direto
    for (int i = 0; i < 18; i++) {
        float fi = float(i);
        bool caco = (i >= 14);
        float ang = hash11(fi * 5.31) * 6.2831;
        float rad = caco ? 18.0 + hash11(fi * 3.17) * 27.0
                : (i < 10 ? 7.5 + hash11(fi * 1.77) * 3.5
                          : 13.0 + hash11(fi * 1.93) * 27.0);
        // Deixa livre o setor entre a câmera inicial e o artefato
        if (!caco && rad < 13.0 && abs(ang - 1.5708) < 0.6)
            continue;

        float tamanho = caco ? 1.0 + hash11(fi * 7.71) * 0.6
                 : (i < 10 ? 0.4 + hash11(fi * 9.13) * 0.7
                           : 0.6 + hash11(fi * 9.13) * 1.4);
        vec3 raios = caco ? vec3(tamanho, 4.0 + hash11(fi * 4.33) * 5.0, tamanho)
                           : vec3(tamanho * (0.8 + 0.5 * hash11(fi * 2.31)),
                                  tamanho * (0.6 + 0.5 * hash11(fi * 3.97)), tamanho);

        // Teste barato em XZ: pula a rocha se o raio passa longe dela
        float limite = max(raios.x, max(raios.y, raios.z)) + 4.0;
        vec2 dxz = p.xz - vec2(cos(ang), sin(ang)) * rad;
        if (dot(dxz, dxz) > limite * limite)
            continue;

        vec3 centro = vec3(cos(ang) * rad, 0.0, sin(ang) * rad);
        centro.y = alturaTerreno(centro.xz) - 0.15 * raios.y;
        vec3 rp = p - centro;

        // Elipsoide achatada no solo: forma rochosa sem ruído por passo
        float d = max(ellipsoidDist(rp, raios), (centro.y - 0.45 * raios.y) - p.y);
        if (d < melhor.d) {
            vec3 base = caco ? vec3(0.11, 0.09, 0.19)
                              : vec3(0.15, 0.12, 0.21) * (0.8 + 0.4 * hash11(fi * 11.3));
            melhor = surf(d, base, 0.2, 0.6, 0.05);
        }
    }
    return melhor;
}

////////////////////
//   CENA (getDist) //
////////////////////

Surface getDist(vec3 p, bool comRochas)
{
    // Terreno (a color detalhada só é calculada na luz, não a cada passo)
    Surface g = surf(distTerreno(p), vec3(0.13, 0.09, 0.17), 0.25, 0.8, 0.05);
    g.mat = 1.0;

    Surface d = g;
    if (comRochas)
        d = unionS(d, supRochas(p));

    // A escultura só é avaliada perto do artefato (bounding sphere grossa)
    float limite = length(p - centroArtefato());
    if (limite < 3.5) {
        d = unionS(d, supEscultura(p));
    } else {
        d = unionS(d, surf(limite - 3.0, vec3(0.0), 0.0, 0.0, 0.0));
    }
    return d;
}

////////////////////
//      TÚNEL     //
////////////////////

// O túnel da transição: cilindro claro com aros emissivos que vêm na direção
// da câmera - geometria movendo, não a câmera, com a parede parada de referência
Surface distTunel(vec3 p)
{
    Surface parede = surf(RAIO_TUNEL - length(p.xy), vec3(0.85, 0.87, 0.92), 0.5, 0.8, 0.0);

    float pz = p.z + iTime * VEL_AROS;
    float ind = floor(pz / ESPACO_AROS);
    float centro = (ind + 0.5) * ESPACO_AROS + (hash11(ind * 0.61) - 0.5) * 0.8;
    float local = pz - centro;
    float raioAnel = 0.55 + 0.20 * hash11(ind * 0.83);
    float anel = length(vec2(length(p.xy) - raioAnel, local)) - TAM_AROS;

    vec3 matiz = mix(CYAN, MAGENTA, hash11(ind * 0.47));
    matiz = mix(matiz, vec3(1.0, 0.75, 0.3), hash11(ind * 0.23) * 0.4);
    matiz = mix(matiz, vec3(0.55), 0.35);
    Surface ringS = surf(anel, vec3(0.0), 0.0, 0.0, 0.0);
    ringS.em = matiz * 1.6;

    return unionS(parede, ringS);
}

////////////////////
//  RAY MARCHING  //
////////////////////

// Quando a fratura termina, a cena inteira vira o túnel (mesmo uniform que
// escolhe o ramo em main(), então marcha e normal são sempre consistentes)
Surface distGeral(vec3 p)
{
    return uFratura >= INICIO_TUNEL ? distTunel(p) : getDist(p, true);
}

// O raio até o núcleo ignora as rochas (o vazamento de luz entre elas é
// imperceptível e isso poupa metade do custo da sombra do núcleo)
Surface distGeralSemRochas(vec3 p)
{
    return uFratura >= INICIO_TUNEL ? distTunel(p) : getDist(p, false);
}

Surface rayMarching(vec3 cam, vec3 rd)
{
    float d0 = 0.0;
    float maxD = uFratura >= INICIO_TUNEL ? TUNNEL_MAX_DIST : MAX_DIST;
    int passosMax = uFratura >= INICIO_TUNEL ? TUNNEL_MAX_STEPS : MAX_STEPS;
    vec3 pi = cam + d0 * rd;
    Surface s = distGeral(pi);
    int i = 0;
    while (i < passosMax && s.d > SURF_DIST && d0 < maxD) {
        d0 += s.d;
        pi = cam + d0 * rd;
        s = distGeral(pi);
        i++;
    }
    if (i == passosMax)
        d0 = maxD + 1.0;
    s.d = d0;   // s.d passa a ser a distância percorrida (como na engine)
    return s;
}

vec3 estimateNormal(vec3 p)
{
    float sd = distGeral(p).d;
    float dx = distGeral(vec3(p.x + EPSILON, p.y, p.z)).d - sd;
    float dy = distGeral(vec3(p.x, p.y + EPSILON, p.z)).d - sd;
    float dz = distGeral(vec3(p.x, p.y, p.z + EPSILON)).d - sd;
    return normalize(vec3(dx, dy, dz));
}

////////////////////
//     SOMBRA     //
////////////////////

// Sombra suave ray-marcada: um segundo march em direção à luz guarda o quanto
// o raio "raspou" em geometria (penumbra) - substitui o sombra map rasterizado
float sombraSuave(vec3 ro, vec3 rd, float tMax, bool comRochas)
{
    float res = 1.0;
    float t = 0.04;
    for (int i = 0; i < 16; i++) {
        float h = comRochas ? distGeral(ro + rd * t).d : distGeralSemRochas(ro + rd * t).d;
        res = min(res, 10.0 * h / t);
        t += clamp(h, 0.04, 0.8);
        if (res < 0.005 || t > tMax)
            break;
    }
    return clamp(res, 0.0, 1.0);
}

// A luz do núcleo só chega onde a casca não bloqueia (mesmo truque da sombra)
float visibilidadeNucleo(vec3 p)
{
    vec3 nucleo = centroArtefato();
    vec3 direcao = nucleo - p;
    float dist = length(direcao);
    // Para antes da superfície do núcleo (~0,45 do centro): se o raio entra
    // no emissor, ele conta como oclusor e a luz nunca chega a lugar nenhum
    return sombraSuave(p, direcao / dist, dist - 0.55, false);
}

////////////////////
//      LUZ       //
////////////////////

vec3 getLight(vec3 p, vec3 posCam, Surface s, vec3 rd)
{
    vec3 n = estimateNormal(p);

    // Detalhe de color do chão: calculado uma vez, no ponto atingido
    if (s.mat == 1.0) {
        float detalhe = 0.6 * ruido(p.xz * 0.7) + 0.4 * ruido(p.xz * 3.1);
        s.color *= 0.7 + 0.6 * detalhe;
    }

    vec3 ambiente = mix(vec3(0.03, 0.015, 0.04), vec3(0.08, 0.05, 0.13), 0.5 + 0.5 * n.y);
    vec3 v = -rd;
    vec3 color = s.color * s.Ka * ambiente * 12.0;

    // Sol direcional (Blinn-Phong) com sombra suave marchada
    float difusa = max(dot(n, uDirLuz), 0.0);
    if (difusa > 0.0) {
        float sombra = sombraSuave(p + n * 0.02, uDirLuz, 30.0, true);
        vec3 hv = normalize(uDirLuz + v);
        float espec = pow(max(dot(n, hv), 0.0), 48.0);
        color += COR_SOL * sombra * (s.color * s.Kd * difusa * 1.6 + s.Ks * espec * 0.6);
    }

    // Luz do núcleo, bloqueada pela casca
    float visNucleo = length(p - centroArtefato()) < 10.0 ? visibilidadeNucleo(p + n * 0.02) : 1.0;
    color += s.color * luzNucleo(p, n) * 3.0 * visNucleo;

    // Emissivo (núcleo, gemas, aros do túnel)
    color += s.em;

    // Ondas de energia que saem do artefato pelo chão
    if (uFratura < INICIO_TUNEL && p.y < 4.0 && p.y < alturaTerreno(p.xz) + 0.06) {
        float r = length(p.xz - centroArtefato().xz);
        float onda = smoothstep(0.97, 1.0, sin(r * 2.2 - iTime * 1.2)) * exp(-r * 0.3);
        color += corNucleo() * onda * (0.08 + 0.08 * pulsoNucleo());
    }
    return color;
}

////////////////////
//   PARTÍCULAS   //
////////////////////

// Sem instancing: cada partícula é um ponto em órbita; o brilho é acumulado
// quando o raio da câmera passa perto dele (glow ao longo do raio)
vec3 brilhoParticulas(vec3 ro, vec3 rd, float tMax)
{
    if (uParticulas <= 0.001)
        return vec3(0.0);
    vec3 centro = centroArtefato();
    // Se o raio nunca chega perto do artefato, nenhum glow vale a pena calcular
    float tc = dot(centro - ro, rd);
    if (tc < -3.0 || length(ro + tc * rd - centro) > 6.0)
        return vec3(0.0);
    vec3 acum = vec3(0.0);
    for (int i = 0; i < 32; i++) {
        float fi = float(i);
        float anel = mod(fi, 4.0);
        float raio = 1.4 + anel * 0.45 + hash11(fi * 1.7) * 0.15;
        float veloc = (0.5 + 0.4 * anel) * (0.6 + 0.4 * hash11(fi * 3.3));
        float fase = hash11(fi * 11.1) * 6.2831;
        float a = uTime * veloc + fase;
        float inclin = anel * 0.5 - 0.7;
        vec3 posicao = centro + vec3(cos(a) * raio, sin(a * 0.7 + fi) * 0.35 + inclin * 0.2, sin(a) * raio);
        float t = dot(posicao - ro, rd);
        if (t > 0.3 && t < tMax) {
            vec3 q = ro + t * rd;
            float d = length(q - posicao);
            acum += mix(CYAN, MAGENTA, hash11(fi * 0.9)) * exp(-d * d * 60.0) * 0.45;
        }
    }
    return acum * uParticulas;
}

// Halo em volta do núcleo: brilho quando o raio passa perto do artefato
vec3 haloNucleo(vec3 ro, vec3 rd, float tMax)
{
    vec3 centro = centroArtefato();
    float t = dot(centro - ro, rd);
    if (t < 0.0 || t > tMax + 4.0)
        return vec3(0.0);
    float d = length(ro + t * rd - centro);
    return corNucleo() * exp(-d * d * 1.1) * (0.25 + 0.2 * pulsoNucleo()) * uBrilhoNucleo;
}

////////////////////
//     CÂMERA     //
////////////////////

mat3 SetCamera(vec3 Look_at, vec3 posCam)
{
    vec3 cd = normalize(Look_at - posCam);
    // sem normalize, o raio sai sem comprimento 1 quando a câmera inclina
    vec3 cv = normalize(cross(vec3(0.0, 1.0, 0.0), cd));
    vec3 cu = cross(cd, cv);
    return mat3(cv, cu, cd);
}

////////////////////
//  SALA DE AULA  //
////////////////////

// A foto preenche a tela sem deformar (cover), emerge do branco, pisca e olha
// para os lados com um pan simples de "cabeça"
vec3 corSala(vec2 uv01, float t)
{
    // Pan: a "cabeça" olha para a esquerda, depois para a direita e volta
    float olhar = sin(clamp((t - 3.0) / 5.0, 0.0, 1.0) * 3.14159 * 2.0) * 0.14;
    float zoom = 1.12;

    vec2 uv = uv01 - 0.5;
    uv *= zoom;
    uv.x += olhar;
    // Cover: corta o eixo que sobra conforme o aspect da foto vs. da tela
    float screenAspect = iResolution.x / iResolution.y;
    if (screenAspect > uAspectoSala)
        uv.y *= uAspectoSala / screenAspect;
    else
        uv.x *= screenAspect / uAspectoSala;
    uv += 0.5;

    vec3 sala = texture(iChannel0, uv).rgb;
    // Desfoque simples no começo: 4 amostras vizinhas somadas quando t é pequeno
    float qtdDesfoque = 1.0 - smoothstep(0.2, 1.4, t);
    if (qtdDesfoque > 0.01) {
        vec2 px = vec2(0.006 * qtdDesfoque);
        sala = (sala + texture(iChannel0, uv + px).rgb + texture(iChannel0, uv - px).rgb
              + texture(iChannel0, uv + vec2(px.x, -px.y)).rgb + texture(iChannel0, uv - vec2(px.x, -px.y)).rgb) / 5.0;
    }
    // Depois do branco do túnel: ~1 s de preto e então a sala "acorda",
    // emergindo do escuro; a piscada logo abaixo faz o papel de abrir os olhos
    if (t < 1.0)
        sala = vec3(0.0);
    else
        sala = mix(vec3(0.0), sala, smoothstep(1.0, 1.9, t));

    // Uma piscada: as pálpebras fecham e reabrem rápido uma vez
    vec2 p = uv01 * 2.0 - 1.0;
    float piscada = smoothstep(1.7, 1.9, t) * (1.0 - smoothstep(2.1, 2.8, t));
    float bordaPalpebra = (1.0 - clamp(piscada, 0.0, 1.0)) * 0.75;
    sala *= 1.0 - smoothstep(bordaPalpebra - 0.03, bordaPalpebra, abs(p.y) + 0.2 * p.x * p.x);
    return sala;
}

////////////////////
//      MAIN      //
////////////////////

void main()
{
    vec2 uv01 = gl_FragCoord.xy / iResolution.xy;
    vec2 p = (gl_FragCoord.xy - 0.5 * iResolution) / iResolution.y;
    float f = uFratura;

    vec3 color;

    if (uTempoSala >= 0.0) {
        // Sala de aula (textura em iChannel0)
        color = corSala(uv01, uTempoSala);
        color = mix(color, vec3(0.0), uPreto);
        C = vec4(color, 1.0);
        return;
    }

    if (f >= INICIO_TUNEL) {
        // ===================== TÚNEL =====================
        vec3 ro = vec3(0.0, 0.0, 0.0);
        vec3 rd = normalize(vec3(p, 1.0));
        // leve oscilação da "mão segurando a câmera"
        rd.xy = rotate2D(0.06 * sin(iTime * 0.8)) * rd.xy;

        Surface s = rayMarching(ro, rd);
        vec3 colorT;
        if (s.d < TUNNEL_MAX_DIST) {
            vec3 po = ro + s.d * rd;
            vec3 n = estimateNormal(po);
            // luz à frente do túnel
            vec3 lpos = vec3(0.0, 0.0, po.z + 6.0);
            vec3 l = normalize(lpos - po);
            float dif = max(dot(n, l), 0.0);
            float listras = 0.5 + 0.5 * sin(atan(po.y, po.x) * 18.0);
            colorT = s.color * (s.Ka + s.Kd * dif) + vec3(0.10, 0.12, 0.18) * listras * dif + s.em;
            // névoa converge para o branco do ponto de fuga
            colorT = mix(colorT, vec3(1.0), smoothstep(6.0, 24.0, s.d));
        } else {
            colorT = vec3(1.0);
        }
        // Clarão final: o ponto de fuga engole a tela
        float clarao = smoothstep(0.985, 0.998, f);
        float rr = length(p);
        colorT += vec3(1.0) * exp(-rr * 3.0) * 2.5 * smoothstep(0.96, 0.99, f);
        colorT = mix(colorT, vec3(1.0), clarao);

        // Dissolve de entrada: o começo do túnel imita o último quadro da
        // cena (núcleo ciano ao centro, bordas violetas) - o corte some
        float dissolve = smoothstep(INICIO_TUNEL, INICIO_TUNEL + 0.08, f);
        vec3 quadroAnterior = mix(CYAN * 1.3 + vec3(0.5), vec3(0.16, 0.10, 0.24),
                             smoothstep(0.0, 0.45, rr));
        colorT = mix(quadroAnterior, colorT, dissolve);
        color = colorT;
    } else {
        // ===================== CENA =====================
        // A imagem se torce conforme a fratura avança (a câmera mergulha no núcleo)
        float torcao = f * 1.6 * smoothstep(1.4, 0.0, length(p));
        p = rotate2D(-torcao) * p;
        p *= 1.0 - 0.25 * f;

        vec3 rd = normalize(vec3(p, 1.2));
        vec3 cam = uPosCam;
        mat3 Mc = SetCamera(uAlvoCam, cam);
        rd = Mc * rd;

        Surface s = rayMarching(cam, rd);
        float maxD = s.d;
        if (s.d < MAX_DIST) {
            vec3 po = cam + s.d * rd;
            color = getLight(po, cam, s, rd);
            color = aplicarNevoa(color, s.d, rd);
        } else {
            color = renderizarCeu(rd);
        }

        // Brilhos acumulados ao longo do raio (partículas + halo do núcleo)
        color += brilhoParticulas(cam, rd, maxD);
        color += haloNucleo(cam, rd, maxD);

        // No fim da fratura a tela é engolida pelo brilho do núcleo
        color += vec3(1.0) * exp(-length(p) * 3.0) * 4.0 * smoothstep(INICIO_TUNEL - 0.14, INICIO_TUNEL, f);
        color = mix(color, vec3(1.0), smoothstep(INICIO_TUNEL - 0.06, INICIO_TUNEL, f));
    }

    color = mapearTom(color * (1.0 - uPreto));
    C = vec4(color, 1.0);
}
