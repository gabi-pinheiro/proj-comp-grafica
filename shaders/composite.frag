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
const int TENTACLES = 6;

float hash11(float p)
{
    return fract(sin(p * 127.1) * 43758.5453);
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

// Foto da sala preenchendo a tela sem deformar. "cover" corta o que sobra; usando
// um pouco mais de zoom (cover * ~1.1), sobra uma margem lateral para a câmera
// "olhar para os lados" (pan) sem mostrar a borda da imagem.
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
        float h = hash11(fi * 3.7);

        // Cada tentáculo entra num momento diferente; a ponta avança da borda ao centro
        float grow = smoothstep(0.10 + 0.30 * h, 0.50 + 0.25 * h, f);
        if (grow <= 0.0)
            continue;
        float tip = mix(2.5, 0.05, grow);
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
    float angle = atan(p.y, p.x) + PI;   // 0 a 2*PI

    // Progressão limpa, inspirada na "Jornada Além do Infinito" de 2001:
    //   distorção -> tentáculos puxando -> túnel de luz -> preto -> acordar na sala

    // 1) Tentáculos: calculados primeiro porque eles agarram a imagem e a puxam
    vec4 tent = tendrils(r, angle, f);
    float tentFade = smoothstep(0.15, 0.40, f) * (1.0 - smoothstep(0.70, 0.90, f));

    // 2) Distorção radial: torção e puxão para o centro; os tentáculos "chupam" a imagem
    float twist = 4.0 * f * f * exp(-1.8 * r);
    vec2 warped = rotate(p, twist) * (1.0 - 0.6 * f * exp(-1.2 * r));
    warped *= 1.0 - 0.07 * tent.a * tentFade;

    vec3 alien = alienScene(warped / vec2(aspect, 1.0) + 0.5);

    // 3) Túnel psicodélico: em coordenada logarítmica (log(r)), raios em espiral e
    //    anéis correm para o centro sem fim, com paleta arco-íris circulando e um
    //    núcleo branco pulsante no ponto de fuga.
    float gate = smoothstep(0.20, 0.50, f);
    float logr = log(max(r, 0.03));
    float rays = pow(0.5 + 0.5 * sin(angle * 12.0 + logr * 9.0 - uTime * 3.0), 5.0);
    float bands = fract(logr * 4.0 - uTime * 2.0);
    float rings = smoothstep(0.80, 1.0, bands);
    float hue = fract(logr * 0.4 + angle / (2.0 * PI) * 3.0 - uTime * 0.12 + rays * 0.4);
    vec3 cosmic = rainbow(hue) * (rays * 1.6 + rings * 0.7);
    cosmic += vec3(1.0) * exp(-r * 7.0) * (1.5 + 1.5 * sin(uTime * 3.0));  // ponto de fuga

    // No começo o túnel só "contamina" a cena com franjas de cor; depois domina a tela
    alien += rainbow(hue) * rays * smoothstep(0.05, 0.3, f) * 0.9 * (1.0 - gate);
    vec3 color = mix(alien, cosmic, gate);

    // 4) Tentáculos por cima de tudo, soltando a imagem antes do fim
    color = mix(color, vec3(0.03, 0.01, 0.07), tent.a * 0.9 * tentFade);
    color += tent.rgb * 0.8 * tentFade;

    // 5) Corte para preto: o túnel colapsa e a tela apaga antes de acordar na sala.
    //    Um último clarão do núcleo antecede o apagão.
    float blackout = smoothstep(0.82, 0.97, f);
    color += vec3(1.0) * exp(-r * 4.0) * 2.0 * smoothstep(0.78, 0.88, f) * (1.0 - blackout);
    color *= 1.0 - blackout;

    // 6) Acordar na sala de aula: as pálpebras abrem devagar sobre a foto (que já
    //    começa preta atrás delas), a imagem entra em foco e a "cabeça" olha para
    //    os lados — para a esquerda, para a direita, e volta ao centro.
    if (uClassroomTime >= 0.0) {
        float t = uClassroomTime;
        float blur = 4.0 * (1.0 - smoothstep(0.5, 3.5, t));

        // Olhar para os lados com parallax falso (a foto é plana, mas dois truques
        // dão sensação de profundidade):
        //  - keystone: ao virar a "cabeça", um lado da foto comprime e o outro
        //    estica, como se o plano da sala girasse em perspectiva;
        //  - a parte de baixo (carteiras, perto) se desloca mais que a de cima
        //    (parede e lousa, longe), como num parallax de verdade.
        //    O zoom fixo > 1 deixa uma margem lateral para o pan sem mostrar a borda.
        float leftLook = smoothstep(2.5, 4.5, t) * (1.0 - smoothstep(5.0, 6.5, t));
        float rightLook = smoothstep(6.5, 8.5, t) * (1.0 - smoothstep(9.5, 11.0, t));
        float pan = 0.04 * (rightLook - leftLook);
        float zoom = 1.12 - 0.02 * smoothstep(0.0, 6.0, t);
        vec2 cuv = vUV;
        cuv.x = 0.5 + (cuv.x - 0.5) / (1.0 - pan * 3.0);   // keystone
        cuv.x += pan * 0.5 * (1.0 - vUV.y);              // perto desloca mais
        vec3 room = classroom((cuv - 0.5) * zoom + 0.5 + vec2(pan, 0.0), aspect, blur);

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
