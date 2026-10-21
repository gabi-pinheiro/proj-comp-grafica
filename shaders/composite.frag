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

float hash11(float p)
{
    return fract(sin(p * 127.1) * 43758.5453);
}

vec2 rotate(vec2 p, float a)
{
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Cor saturada, como os campos de cor do corredor de luz de "2001"
vec3 saturated(float h)
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

void main()
{
    if (uFracture <= 0.0) {
        fragColor = vec4(alienScene(vUV), 1.0);
        return;
    }

    vec2 size = vec2(textureSize(uScene, 0));
    float aspect = size.x / size.y;
    float f = uFracture;

    // Coordenadas centradas com a proporção corrigida
    vec2 p = (vUV - 0.5) * vec2(aspect, 1.0);
    float r = length(p);
    float angle = atan(p.y, p.x) + PI;   // 0 a 2*PI

    // Transição simples e legível, inspirada no "star gate" de 2001:
    //   a cena torce e é sugada -> um corredor de anéis de luz vem na direção da
    //   câmera -> clarão -> preto -> as pálpebras abrem na sala de aula.

    // 1) A cena torce e é puxada para o centro, como se a câmera entrasse no túnel
    float twist = 4.0 * f * f * exp(-1.8 * r);
    vec2 warped = rotate(p, twist) * (1.0 - 0.6 * f * exp(-1.2 * r));
    vec3 alien = alienScene(warped / vec2(aspect, 1.0) + 0.5);

    // 2) O corredor de luz: em coordenada logarítmica, os anéis nascem pequenos no
    //    ponto de fuga e expandem para fora — é isso que dá a sensação de viajar
    //    para dentro do túnel, porque eles passam "por cima" da câmera.
    float gate = smoothstep(0.20, 0.55, f);
    float logr = log(max(r, 0.04));

    // Anéis: cada um nasce no centro e corre para a borda, ganhando velocidade.
    // Cada anel tem uma cor saturada própria (uma cor por vez, bem legível).
    float lane = logr * 3.0 - uTime * 2.2;
    float ringIndex = floor(lane);
    float d = abs(fract(lane) - 0.5);
    float ring = 1.0 - smoothstep(0.0, 0.12, d);
    vec3 ringColor = saturated(hash11(ringIndex * 0.37 + 0.5));

    // Raios radiais finos e quase fixos, como as linhas do corredor
    float rays = pow(0.5 + 0.5 * sin(angle * 18.0 + uTime * 0.4), 20.0);

    // O túnel é escuro: anéis + raios sobre fundo quase preto, com o núcleo branco
    vec3 tunnel = ringColor * ring * 1.4 + vec3(0.7, 0.85, 1.0) * rays * 0.5;
    tunnel += vec3(1.0) * exp(-r * 6.0) * (1.0 + 0.8 * sin(uTime * 3.0));  // ponto de fuga
    tunnel += ringColor * 0.06;   // leve véu de cor para não ficar preto puro

    // A cena escurece enquanto o túnel toma conta — sem fragmentos, só um crossfade
    vec3 color = mix(alien * (1.0 - 0.7 * gate), tunnel, gate);

    // 3) Clarão e corte para preto: o ponto de fuga engole a tela e tudo apaga
    float blackout = smoothstep(0.82, 0.97, f);
    color += vec3(1.0) * exp(-r * 3.5) * 3.0 * smoothstep(0.75, 0.90, f) * (1.0 - blackout);
    color *= 1.0 - blackout;

    // 4) Acordar na sala de aula: as pálpebras abrem devagar sobre a foto (que já
    //    começa preta atrás delas), a imagem entra em foco e a "cabeça" olha para
    //    os lados — para a esquerda, para a direita, e volta ao centro.
    if (uClassroomTime >= 0.0) {
        float t = uClassroomTime;
        float blur = 4.0 * (1.0 - smoothstep(0.5, 3.5, t));

        // Olhar para os lados: a foto tem margem lateral sobrando (zoom > 1),
        // então dá para virar a "cabeça" sem mostrar a borda da imagem
        float leftLook = smoothstep(2.5, 4.5, t) * (1.0 - smoothstep(5.0, 6.5, t));
        float rightLook = smoothstep(6.5, 8.5, t) * (1.0 - smoothstep(9.5, 11.0, t));
        float pan = 0.04 * (rightLook - leftLook);
        float zoom = 1.10 - 0.02 * smoothstep(0.0, 6.0, t);
        vec3 room = classroom((vUV - 0.5) * zoom + 0.5 + vec2(pan, 0.0), aspect, blur);

        // Pálpebras: começam fechadas (tela preta) e abrem devagar, com um tremer
        float open = smoothstep(0.8, 3.5, t);
        open += 0.15 * sin(t * 9.0) * smoothstep(0.8, 1.2, t) * (1.0 - smoothstep(1.5, 3.0, t));
        float lidEdge = clamp(open, 0.0, 1.0) * 0.75;
        room *= 1.0 - smoothstep(lidEdge - 0.03, lidEdge, abs(p.y) + 0.2 * p.x * p.x);

        color = mix(color, room, smoothstep(0.97, 1.0, f));
    }

    color *= 1.0 - uBlack;
    fragColor = vec4(color, 1.0);
}
