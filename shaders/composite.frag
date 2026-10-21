#version 330 core

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uRays;
uniform float uBloomStrength;
uniform float uRaysStrength;

// Narrativa: transição "The Fracture" e foto da sala de aula
uniform sampler2D uClassroom;
uniform float uClassroomAspect;   // largura / altura da foto
uniform float uFracture;          // 0 = cena alienígena intacta, 1 = só a sala
uniform float uClassroomTime;     // segundos desde que a sala apareceu (-1 = ainda não)
uniform float uBlack;             // 1 = corte para preto

#include "common.glsl"

const float PI = 3.14159265;
const float SECTORS = 9.0;        // mesmo número de cortes do anel externo da escultura
const float RING_WIDTH = 0.18;
const int TENTACLES = 6;

float hash21(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 rotate(vec2 p, float a)
{
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Paleta arco-íris forte, na pegada psicodélica do túnel de "2001"
vec3 rainbow(float h)
{
    return 0.5 + 0.5 * cos(2.0 * PI * (h + vec3(0.0, 0.33, 0.67)));
}

// Cena HDR + bloom + god rays, convertida para a tela
vec3 alienScene(vec2 uv)
{
    vec3 color = texture(uScene, uv).rgb;
    color += texture(uBloom, uv).rgb * uBloomStrength;
    color += texture(uRays, uv).rgb * uRaysStrength;
    return toneMap(color);
}

// Foto da sala preenchendo a tela sem deformar ("cover"): o que sobra é cortado.
// O desfoque usa os mipmaps da textura.
vec3 classroom(vec2 uv, float aspect, float blur)
{
    vec2 scale = vec2(1.0);
    if (aspect > uClassroomAspect)
        scale.y = uClassroomAspect / aspect;
    else
        scale.x = aspect / uClassroomAspect;
    return textureLod(uClassroom, (uv - 0.5) * scale + 0.5, blur).rgb;
}

// Tentáculos do artefato: braços sinuosos que nascem nas bordas da tela e se
// esticam em direção ao centro, puxando a câmera. rgb = brilho da borda, a = corpo
vec4 tendrils(float r, float angle, float f)
{
    float body = 0.0;
    vec3 rim = vec3(0.0);
    for (int i = 0; i < TENTACLES; i++) {
        float fi = float(i);
        float h = hash21(vec2(fi, 3.7));

        // Cada tentáculo entra num momento diferente; a ponta avança da borda ao centro
        float grow = smoothstep(0.12 + 0.35 * h, 0.55 + 0.3 * h, f);
        if (grow <= 0.0)
            continue;
        float tip = mix(2.5, 0.04, grow);
        if (r < tip)
            continue;

        // A linha do tentáculo ondula com o raio e o tempo, como um braço vivo
        float base = fi / float(TENTACLES) * 2.0 * PI + h * 0.9;
        float wave = 0.30 * sin(r * 4.0 - uTime * 2.5 + h * 6.28)
                   + 0.12 * sin(r * 9.0 + uTime * 1.6 + h * 4.0);
        float arc = abs(mod(angle - base - wave + PI, 2.0 * PI) - PI) * r;

        // Grosso na base, afinando até a ponta; a espessura pulsa
        float w = (0.05 + 0.09 * smoothstep(tip, tip + 0.6, r))
                * (0.75 + 0.25 * sin(uTime * 2.0 + h * 5.0));
        float inBody = smoothstep(w, w * 0.35, arc) * smoothstep(tip - 0.02, tip + 0.08, r);
        float inRim = smoothstep(w * 1.8, w, arc) - inBody;
        body = max(body, inBody);
        rim += rainbow(fi / float(TENTACLES) + uTime * 0.05) * max(inRim, 0.0);
    }
    return vec4(rim, body);
}

void main()
{
    if (uFracture <= 0.0) {
        fragColor = vec4(alienScene(vUV), 1.0);
        return;
    }

    vec2 size = vec2(textureSize(uScene, 0));
    float aspect = size.x / size.y;
    float f = uFracture;

    // Coordenadas centradas com a proporção corrigida, para os padrões não esticarem
    vec2 p = (vUV - 0.5) * vec2(aspect, 1.0);
    float r = length(p);
    float angle = atan(p.y, p.x) + PI;   // 0 a 2*PI, para os setores terem o mesmo tamanho

    // 1) Tentáculos: calculados primeiro porque eles "agarra" a imagem e a puxam
    vec4 tent = tendrils(r, angle, f);
    float tentFade = smoothstep(0.15, 0.45, f) * (1.0 - smoothstep(0.82, 0.97, f));

    // 2) Fragmentos: setores polares (como os cortes do anel da escultura) divididos
    //    em anéis concêntricos, deslocados por setor. Cada fragmento tem um hash fixo,
    //    então o padrão é estável e não pisca.
    float sectorSize = 2.0 * PI / SECTORS;
    float sector = floor(angle / sectorSize);
    float ringCoord = r / RING_WIDTH + hash21(vec2(sector, 7.0));
    float ring = floor(ringCoord);
    float h = hash21(vec2(sector, ring));

    // Os fragmentos se rompem na segunda metade da transição: primeiro a imagem se
    // distorce e o túnel aparece, depois ela se quebra de vez. Todos os limiares
    // ficam abaixo de 1, então a cena alienígena some por completo.
    float threshold = 0.45 + 0.35 * clamp(ring * RING_WIDTH, 0.0, 1.0) + 0.15 * h;
    float loosen = smoothstep(threshold - 0.4, threshold, f);
    float reveal = smoothstep(threshold, threshold + 0.05, f);

    // 3) Distorção radial: torção e puxão para o centro; os tentáculos "chupam" a imagem
    float twist = 3.5 * f * f * exp(-1.8 * r);
    vec2 warped = rotate(p, twist) * (1.0 - 0.55 * f * exp(-1.2 * r));
    float sectorAngle = (sector + 0.5) * sectorSize;
    warped += vec2(cos(sectorAngle), sin(sectorAngle)) * 0.08 * loosen * (0.5 + h);
    warped *= 1.0 - 0.07 * tent.a * tentFade;   // o tentáculo puxa a imagem para dentro

    vec3 alien = alienScene(warped / vec2(aspect, 1.0) + 0.5);

    // 4) Túnel psicodélico ("além do infinito"): em coordenada logarítmica, as faixas
    //    correm para o centro sem fim, como uma viagem em direção ao ponto de fuga.
    //    Raios em espiral + anéis correndo + núcleo branco pulsante.
    float gate = smoothstep(0.10, 0.40, f) * (1.0 - smoothstep(0.80, 0.98, f));
    float logr = log(max(r, 0.03));
    float rays = pow(0.5 + 0.5 * sin(angle * 12.0 + logr * 9.0 - uTime * 3.0), 5.0);
    float bands = fract(logr * 4.0 - uTime * 2.0);
    float rings = smoothstep(0.80, 1.0, bands);
    float hue = fract(logr * 0.4 + angle / (2.0 * PI) * 3.0 - uTime * 0.12 + rays * 0.4);
    vec3 cosmic = rainbow(hue) * (rays * 1.6 + rings * 0.7);
    cosmic += vec3(1.0) * exp(-r * 7.0) * (1.5 + 1.5 * sin(uTime * 3.0));  // ponto de fuga

    // No começo o túnel só "contamina" a cena com franjas de cor; depois domina a tela
    alien += rainbow(hue) * rays * smoothstep(0.05, 0.3, f) * 0.9 * (1.0 - gate);
    alien += vec3(0.5, 0.8, 1.0) * 0.4 * f * f * loosen;
    vec3 sceneColor = alien + cosmic * gate;

    // 5) Rachaduras brilhantes nas bordas dos fragmentos, antes de cada um se romper
    float edgeSector = (0.5 - abs(fract(angle / sectorSize) - 0.5)) * sectorSize * r;
    float edgeRing = (0.5 - abs(fract(ringCoord) - 0.5)) * RING_WIDTH;
    float crack = 1.0 - smoothstep(0.0, 0.006, min(edgeSector, edgeRing));
    crack *= smoothstep(threshold - 0.4, threshold - 0.1, f) * (1.0 - reveal);
    sceneColor += mix(CYAN, MAGENTA, h) * 1.5 * crack;

    // 6) A sala de aula aparece por trás dos fragmentos que se romperam.
    //    "Acordando": a foto começa desfocada, entra em foco, há uma piscada e
    //    uma pequena aproximação com um leve balanço da cabeça.
    float t = max(uClassroomTime, 0.0);
    float blur = 4.0 * (1.0 - smoothstep(0.0, 2.5, t));
    float zoom = 1.0 - 0.06 * smoothstep(0.0, 7.0, t);
    vec2 sway = vec2(0.012 * sin(t * 0.8), 0.008 * sin(t * 1.3)) * (1.0 - smoothstep(2.0, 6.0, t));
    vec3 room = classroom((vUV - 0.5) * zoom + 0.5 + sway, aspect, blur);

    // Pálpebras: borda curva que fecha e abre rapidamente em t = 1,3 s
    float closed = 1.0 - smoothstep(0.0, 0.25, abs(t - 1.3));
    float lidEdge = (1.0 - closed) * 0.75;
    room *= 1.0 - smoothstep(lidEdge - 0.03, lidEdge, abs(p.y) + 0.2 * p.x * p.x);

    vec3 color = mix(sceneColor, room, reveal);

    // 7) Tentáculos por cima de tudo, soltando a imagem no fim da transição
    color = mix(color, vec3(0.03, 0.01, 0.07), tent.a * 0.9 * tentFade);
    color += tent.rgb * 0.8 * tentFade;

    color *= 1.0 - uBlack;
    fragColor = vec4(color, 1.0);
}
