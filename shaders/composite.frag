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

float hash21(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 rotate(vec2 p, float a)
{
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
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

    // 1) Fragmentos: setores polares (como os cortes do anel da escultura) divididos
    //    em anéis concêntricos. Os anéis são deslocados em cada setor para os
    //    fragmentos não ficarem alinhados. Tudo depende só da posição, então é estável.
    float sectorSize = 2.0 * PI / SECTORS;
    float sector = floor(angle / sectorSize);
    float ringCoord = r / RING_WIDTH + hash21(vec2(sector, 7.0));
    float ring = floor(ringCoord);
    float h = hash21(vec2(sector, ring));

    // Cada fragmento se rompe quando f passa do seu limiar: o centro primeiro e a
    // ruptura avança para fora. Todos os limiares ficam abaixo de 1, então a cena
    // alienígena desaparece por completo no fim.
    float threshold = 0.1 + 0.55 * clamp(ring * RING_WIDTH, 0.0, 1.0) + 0.25 * h;
    float loosen = smoothstep(threshold - 0.35, threshold, f);
    float reveal = smoothstep(threshold, threshold + 0.04, f);

    // 2) Distorção radial: o espaço é torcido e puxado para o centro, mais forte
    //    perto do centro, como se a câmera atravessasse uma ruptura
    float twist = 3.0 * f * f * exp(-2.0 * r);
    vec2 warped = rotate(p, twist) * (1.0 - 0.5 * f * exp(-1.5 * r));

    // Antes de sumir, cada fragmento se solta e se afasta do centro
    float sectorAngle = (sector + 0.5) * sectorSize;
    warped += vec2(cos(sectorAngle), sin(sectorAngle)) * 0.08 * loosen * (0.5 + h);

    vec3 alien = alienScene(warped / vec2(aspect, 1.0) + 0.5);
    alien += vec3(0.5, 0.8, 1.0) * 0.5 * f * f * loosen;   // a cena "estoura" em luz

    // 3) Rachaduras brilhantes nas bordas dos fragmentos, que aparecem antes da ruptura
    float edgeSector = (0.5 - abs(fract(angle / sectorSize) - 0.5)) * sectorSize * r;
    float edgeRing = (0.5 - abs(fract(ringCoord) - 0.5)) * RING_WIDTH;
    float crack = 1.0 - smoothstep(0.0, 0.006, min(edgeSector, edgeRing));
    crack *= smoothstep(threshold - 0.4, threshold - 0.1, f) * (1.0 - reveal);
    vec3 crackColor = mix(CYAN, MAGENTA, h) * 1.5 * crack;

    // 4) A sala de aula aparece por trás dos fragmentos que se romperam.
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

    vec3 color = mix(alien, room, reveal) + crackColor;
    color *= 1.0 - uBlack;
    fragColor = vec4(color, 1.0);
}
