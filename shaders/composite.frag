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

// ================= Túnel 3D (ray marching, a mesma técnica da escultura) =================

const float TUNNEL_R = 1.0;       // raio do corredor
const float RING_SPACING = 3.2;   // distância entre os anéis
const float RING_SIZE = 0.07;     // espessura do torus de cada anel
const float RING_SPEED = 0.7;     // velocidade com que os anéis vêm na direção da câmera

// SDF do túnel: parede interna do cilindro (parada, serve de referência de fundo)
// + aros torus flutuando no meio do corredor, vindo na direção da câmera.
// Retorna (distância, material: 0 = parede, 1 = anel).
vec2 tunnelMap(vec3 p)
{
    // Estamos dentro do cilindro: a distância até a parede é R - len(p.xy)
    float wall = TUNNEL_R - length(p.xy);

    // Os aros se movem em -z: cada um nasce longe, cresce até engolir a tela e
    // passa pela câmera. O espaçamento varia um pouco por aro (hash), para o
    // padrão não parecer periódico/parado.
    float pz = p.z + uTime * RING_SPEED;
    float idx = floor(pz / RING_SPACING);
    float center = (idx + 0.5) * RING_SPACING + (hash11(idx * 0.61) - 0.5) * 0.8;
    float local = pz - center;
    // Aro no meio do corredor (não colado na parede), com raio variando por aro
    float ringRadius = 0.55 + 0.20 * hash11(idx * 0.83);
    float ring = length(vec2(length(p.xy) - ringRadius, local)) - RING_SIZE;
    return ring < wall ? vec2(ring, 1.0) : vec2(wall, 0.0);
}

// Normal pelo gradiente da SDF (diferenças finitas centrais)
vec3 tunnelNormal(vec3 p)
{
    vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(
        tunnelMap(p + e.xyy).x - tunnelMap(p - e.xyy).x,
        tunnelMap(p + e.yxy).x - tunnelMap(p - e.yxy).x,
        tunnelMap(p + e.yyx).x - tunnelMap(p - e.yyx).x));
}

// Sphere tracing dentro do túnel: a câmera avança em z com o tempo, atravessando
// um anel atrás do outro — é o movimento de câmera que dá a sensação de viagem.
vec3 tunnelColor(vec2 p, float f)
{
    // A câmera balança devagar; quem se move são os aros, vindo na direção dela
    vec3 ro = vec3(0.06 * sin(uTime * 0.7), 0.06 * sin(uTime * 0.9 + 1.0), 0.0);
    // Direção do raio por pixel: perspectiva real, com uma leve guinada da câmera
    vec3 rd = normalize(vec3(p, 1.6));
    rd.xy = rotate(rd.xy, 0.03 * sin(uTime * 0.5));

    float t = 0.0;
    float mat = -1.0;
    for (int i = 0; i < 40; i++) {
        vec2 h = tunnelMap(ro + rd * t);
        if (h.x < 0.003) { mat = h.y; break; }
        t += h.x * 0.9;
        if (t > 16.0) break;
    }
    if (mat < 0.0)
        return vec3(1.0);   // o ponto de fuga: não bateu em nada

    vec3 hit = ro + rd * t;
    vec3 n = tunnelNormal(hit);

    // Luz pontual à frente, no ponto de fuga (a "saída" do túnel)
    vec3 toLight = vec3(0.0, 0.0, ro.z + 12.0) - hit;
    float lightDist = length(toLight);
    float diffuse = max(dot(n, toLight / lightDist), 0.0) / (1.0 + 0.15 * lightDist);

    vec3 col;
    if (mat > 0.5) {
        // Aro emissivo: cada um com uma cor própria, suavizada (sem neon)
        float idx = floor((hit.z + uTime * RING_SPEED) / RING_SPACING);
        vec3 tint = mix(vec3(0.7), saturated(hash11(idx * 0.37 + 0.5)), 0.55);
        col = tint * (0.55 + diffuse);
    } else {
        // Parede escura com faixas longitudinais e luz difusa do ponto de fuga
        // Parede clara com faixas longitudinais finas: continua o clarão do
        // núcleo, e a névoa já converge para branco no ponto de fuga
        float stripes = 0.5 + 0.5 * sin(atan(hit.y, hit.x) * 18.0);
        col = vec3(0.85, 0.87, 0.92) * (0.55 + stripes * 0.2)
            + vec3(0.20, 0.25, 0.35) * diffuse;
    }

    // Névoa: quanto mais longe, mais o pixel converge para o branco do ponto de fuga
    return mix(col, vec3(1.0), 1.0 - exp(-t * 0.10));
}

// ==================================================================================

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

    // Transição, inspirada no "star gate" de 2001:
    //   a cena torce e é sugada -> a câmera viaja por um túnel 3D de anéis de luz
    //   -> clarão -> preto -> as pálpebras abrem na sala de aula.

    // 1) A cena torce e é puxada para o centro, como se a câmera mergulhasse na
    //    abertura do túnel (o núcleo do artefato vira o ponto de fuga)
    float twist = 4.0 * f * f * exp(-1.8 * r);
    vec2 warped = rotate(p, twist) * (1.0 - 0.6 * f * exp(-1.2 * r));
    vec3 alien = alienScene(warped / vec2(aspect, 1.0) + 0.5);

    // 2) Viagem pelo túnel 3D: crossfade da cena para o ray marching
    float gate = smoothstep(0.20, 0.55, f);
    vec3 tunnel = tunnelColor(p, f);
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
