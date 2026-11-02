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

    // Versão simplificada (protótipo): esfera fosca + argola inclinada,
    // para validar ray marching, iluminação e cena antes da escultura final.
    float core = sdSphere(p, 0.55);

    vec3 a = p;
    a.xy *= rotate2D(0.7);
    float ringA = sdTorus(a, vec2(1.0, 0.08));

    vec2 result = vec2(core, MAT_SHELL);
    result = closest(result, vec2(ringA, MAT_METAL));
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
