// Definição da escultura por funções de distância assinada (SDFs).
// sculptureMap(p) retorna (distância até a superfície, id do material).

#define MAT_METAL 1.0
#define MAT_CORE  2.0
#define MAT_SHELL 3.0
#define MAT_GEM   4.0

const float BOUND_RADIUS = 2.05;

mat2 rotate2D(float angle)
{
    float c = cos(angle), s = sin(angle);
    return mat2(c, -s, s, c);
}

float sdSphere(vec3 p, float radius)
{
    return length(p) - radius;
}

// Toro no plano XZ: t.x = raio maior, t.y = raio do tubo
float sdTorus(vec3 p, vec2 t)
{
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

// Anel achatado (seção retangular) no plano XZ
float sdFlatRing(vec3 p, float radius, vec2 halfSize)
{
    vec2 q = abs(vec2(length(p.xz) - radius, p.y)) - halfSize;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float sdBox(vec3 p, vec3 halfSize)
{
    vec3 q = abs(p) - halfSize;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float opSubtract(float a, float b)
{
    return max(a, -b);
}

float opSmoothUnion(float a, float b, float k)
{
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

vec2 closest(vec2 a, vec2 b)
{
    return (a.x < b.x) ? a : b;
}

vec2 sculptureMap(vec3 p)
{
    p -= artifactCenter();
    p.xz *= rotate2D(uTime * 0.08);

    // Núcleo orgânico: esfera levemente deslocada e deformada por senos que "respiram"
    vec3 c = p - vec3(0.06, 0.02, -0.04);
    float wobble = sin(4.0 * c.x + uTime * 1.3) * sin(4.0 * c.y + uTime * 0.9) * sin(4.0 * c.z - uTime * 1.1);
    float core = sdSphere(c, 0.40 + 0.03 * corePulse()) + 0.05 * wobble;

    // Espinho cristalino torcido e inclinado atravessando o núcleo
    vec3 s = p;
    s.xy *= rotate2D(0.18);
    s.y -= 0.15;
    s.xz *= rotate2D(s.y * 1.6 + uTime * 0.2);
    float taper = 1.0 - clamp(abs(s.y) / 1.75, 0.0, 1.0);
    float spikeWidth = 0.13 * taper + 0.004;
    float spike = sdBox(s, vec3(spikeWidth, 1.75, spikeWidth));

    float body = opSmoothUnion(core, spike, 0.22);

    // Casca esférica cortada por uma faixa e por furos, formando duas calotas irregulares
    vec3 h = p;
    h.yz *= rotate2D(0.5);
    h.xy *= rotate2D(-0.3);
    float shell = abs(sdSphere(h, 0.82)) - 0.035;
    shell = opSubtract(shell, abs(h.y) - 0.30);
    shell = opSubtract(shell, sdSphere(h - vec3(0.55, 0.55, 0.20), 0.28));
    shell = opSubtract(shell, sdSphere(h - vec3(-0.30, -0.60, 0.50), 0.22));
    shell = opSubtract(shell, sdSphere(h - vec3(-0.20, 0.70, -0.50), 0.18));
    shell = opSubtract(shell, sdSphere(h - vec3(0.40, -0.50, -0.55), 0.25));

    // Dois anéis que se cruzam; cada um oscila em um eixo diferente
    vec3 a = p;
    a.xz *= rotate2D(uTime * 0.25);
    a.xy *= rotate2D(1.15);
    float ringA = sdTorus(a, vec2(1.2, 0.045));

    vec3 b = p;
    b.yz *= rotate2D(0.6 - uTime * 0.4);
    float ringB = sdTorus(b, vec2(1.1, 0.035));

    // Esferas brilhantes parcialmente incrustadas no anel A
    float gems = min(sdSphere(a - vec3(1.2, 0.0, 0.0), 0.11),
                     sdSphere(a - vec3(-0.85, 0.0, 0.85), 0.08));

    // Anel externo achatado com cortes regulares (repetição polar)
    vec3 r = p;
    r.xy *= rotate2D(0.22);
    r.xz *= rotate2D(-uTime * 0.15);
    float ringC = sdFlatRing(r, 1.55, vec2(0.09, 0.012));
    float sector = 6.2831853 / 9.0;
    float angle = mod(atan(r.z, r.x) + 0.5 * sector, sector) - 0.5 * sector;
    vec3 rp = vec3(length(r.xz) * cos(angle), r.y, length(r.xz) * sin(angle));
    ringC = opSubtract(ringC, sdBox(rp - vec3(1.55, 0.0, 0.0), vec3(0.12, 0.05, 0.07)));

    vec2 result = vec2(body, core < spike ? MAT_CORE : MAT_METAL);
    result = closest(result, vec2(shell, MAT_SHELL));
    result = closest(result, vec2(min(ringA, ringB), MAT_METAL));
    result = closest(result, vec2(ringC, MAT_SHELL));
    result = closest(result, vec2(gems, MAT_GEM));
    return result;
}

// Sombra suave: marcha em direção à luz e guarda o quão perto o raio passou da escultura
float sculptureShadow(vec3 ro, vec3 rd)
{
    vec2 bound = intersectSphere(ro - artifactCenter(), rd, BOUND_RADIUS);
    if (bound.y < 0.0)
        return 1.0;

    float shadow = 1.0;
    float t = max(bound.x, 0.02);
    for (int i = 0; i < 48 && t < bound.y; i++) {
        float d = sculptureMap(ro + rd * t).x;
        shadow = min(shadow, 8.0 * d / t);
        if (shadow < 0.002)
            return 0.0;
        t += clamp(d, 0.02, 0.25);
    }
    return clamp(shadow, 0.0, 1.0);
}
