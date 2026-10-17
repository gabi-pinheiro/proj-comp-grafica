// Uniforms, paleta e funções compartilhadas por todos os shaders da cena

uniform float uTime;
uniform vec3 uLightDir;   // direção que aponta PARA a estrela principal
uniform vec3 uCameraPos;

const vec3 ARTIFACT_CENTER = vec3(0.0, 2.6, 0.0);
const vec3 SUN_COLOR = vec3(1.0, 0.68, 0.60);
const vec3 CYAN = vec3(0.15, 0.95, 1.0);
const vec3 MAGENTA = vec3(1.0, 0.22, 0.70);

// O artefato flutua lentamente para cima e para baixo
vec3 artifactCenter()
{
    return ARTIFACT_CENTER + vec3(0.0, 0.12 * sin(uTime * 0.6), 0.0);
}

float corePulse()
{
    return 0.5 + 0.5 * sin(uTime * 1.8);
}

vec3 coreColor()
{
    return mix(CYAN, MAGENTA, 0.15 + 0.15 * sin(uTime * 0.4));
}

// Luz pontual emitida pelo núcleo do artefato
vec3 coreLight(vec3 p, vec3 n)
{
    vec3 toCore = artifactCenter() - p;
    float dist = length(toCore);
    float diffuse = max(dot(n, toCore / dist), 0.0);
    return coreColor() * diffuse * (1.0 + 1.5 * corePulse()) / (1.0 + 0.6 * dist * dist);
}

vec3 skyColor(vec3 dir)
{
    vec3 zenith = vec3(0.004, 0.004, 0.018);
    vec3 horizon = vec3(0.13, 0.045, 0.17);
    vec3 color = mix(horizon, zenith, pow(clamp(dir.y, 0.0, 1.0), 0.45));

    float sunAmount = max(dot(dir, uLightDir), 0.0);
    color += vec3(0.45, 0.13, 0.16) * pow(sunAmount, 8.0) * 0.6;
    return color;
}

vec3 applyFog(vec3 color, float dist, vec3 rayDir)
{
    float fog = 1.0 - exp(-pow(dist * 0.022, 2.0));
    return mix(color, skyColor(rayDir), fog);
}

// Tone mapping ACES (aproximação de Narkowicz) seguido de correção gama
vec3 toneMap(vec3 c)
{
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}

// Retorna (tPerto, tLonge) da interseção raio-esfera, ou (-1, -1) se não houver
vec2 intersectSphere(vec3 ro, vec3 rd, float radius)
{
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float h = b * b - c;
    if (h < 0.0)
        return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
}
