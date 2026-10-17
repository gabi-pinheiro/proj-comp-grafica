#version 330 core

out vec4 fragColor;

uniform mat4 uViewProj;
uniform mat4 uInvViewProj;
uniform vec2 uResolution;

#include "common.glsl"
#include "sculpture_sdf.glsl"

const int MAX_STEPS = 160;

// Normal pelo gradiente da SDF (diferenças centrais)
vec3 calcNormal(vec3 p)
{
    const vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        sculptureMap(p + e.xyy).x - sculptureMap(p - e.xyy).x,
        sculptureMap(p + e.yxy).x - sculptureMap(p - e.yxy).x,
        sculptureMap(p + e.yyx).x - sculptureMap(p - e.yyx).x));
}

// Oclusão ambiente: compara a distância esperada com a da SDF ao longo da normal
float calcAO(vec3 p, vec3 n)
{
    float occlusion = 0.0;
    float weight = 1.0;
    for (int i = 1; i <= 5; i++) {
        float h = 0.02 + 0.08 * float(i);
        occlusion += (h - sculptureMap(p + n * h).x) * weight;
        weight *= 0.7;
    }
    return clamp(1.0 - 2.0 * occlusion, 0.0, 1.0);
}

float depthFromPoint(vec3 p)
{
    vec4 clip = uViewProj * vec4(p, 1.0);
    return 0.5 * (clip.z / clip.w) + 0.5;
}

vec3 shade(vec3 p, vec3 rd, float material)
{
    vec3 n = calcNormal(p);
    vec3 v = -rd;
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 4.0);

    if (material == MAT_CORE) {
        vec3 c = p - artifactCenter();
        float veins = 0.5 + 0.5 * sin(12.0 * c.x + 9.0 * c.y - 7.0 * c.z + uTime * 2.0);
        return mix(CYAN, MAGENTA, 0.6 * veins + 0.4 * fresnel) * (0.7 + 0.9 * corePulse());
    }
    if (material == MAT_GEM)
        return MAGENTA * (2.0 + corePulse()) + vec3(fresnel);

    float diffuse = max(dot(n, uLightDir), 0.0);
    float shadow = diffuse > 0.0 ? sculptureShadow(p + n * 0.01, uLightDir) : 0.0;
    float specular = pow(max(dot(n, normalize(uLightDir + v)), 0.0), 48.0);
    float ao = calcAO(p, n);
    vec3 ambient = mix(vec3(0.04, 0.02, 0.05), vec3(0.12, 0.07, 0.18), 0.5 + 0.5 * n.y);

    vec3 albedo = (material == MAT_METAL) ? vec3(0.04, 0.04, 0.07) : vec3(0.55, 0.50, 0.62);
    float specularStrength = (material == MAT_METAL) ? 1.2 : 0.25;

    vec3 color = albedo * (SUN_COLOR * diffuse * shadow * 2.0 + ambient * ao);
    color += (albedo + 0.1) * coreLight(p, n);
    color += SUN_COLOR * specular * shadow * specularStrength;

    if (material == MAT_METAL) {
        // Reflexo do céu e borda iridescente que muda de cor com o ângulo
        color += skyColor(reflect(rd, n)) * (0.15 + 0.85 * fresnel) * 0.6 * ao;
        vec3 iridescence = mix(CYAN, MAGENTA, 0.5 + 0.5 * sin(6.0 * dot(n, vec3(0.3, 0.8, 0.5)) + uTime));
        color += iridescence * fresnel * 0.6;
    }
    return color;
}

void main()
{
    vec2 ndc = gl_FragCoord.xy / uResolution * 2.0 - 1.0;
    vec4 farPoint = uInvViewProj * vec4(ndc, 1.0, 1.0);
    vec3 ro = uCameraPos;
    vec3 rd = normalize(farPoint.xyz / farPoint.w - ro);
    vec3 center = artifactCenter();

    // Só faz a marcha nos pixels cujo raio passa pela esfera que envolve a escultura
    vec2 bound = intersectSphere(ro - center, rd, BOUND_RADIUS);
    if (bound.y < 0.0)
        discard;

    float t = max(bound.x, 0.0);
    vec2 hit = vec2(0.0);
    bool found = false;
    for (int i = 0; i < MAX_STEPS; i++) {
        hit = sculptureMap(ro + rd * t);
        if (hit.x < 0.0005 * t) {
            found = true;
            break;
        }
        // Passo reduzido porque as deformações tornam a SDF apenas aproximada
        t += hit.x * 0.7;
        if (t > bound.y)
            break;
    }

    // Halo luminoso ao redor do núcleo, calculado pela menor distância entre o raio e o centro
    float tClosest = max(dot(center - ro, rd), 0.0);
    float distToCore = length(ro + rd * tClosest - center);
    float glow = exp(-4.0 * max(distToCore - 0.35, 0.0)) * (0.2 + 0.15 * corePulse());
    glow *= 1.0 - smoothstep(0.3 * BOUND_RADIUS, 0.9 * BOUND_RADIUS, distToCore);
    vec3 glowColor = coreColor() * glow;

    if (found) {
        vec3 p = ro + rd * t;
        vec3 color = shade(p, rd, hit.y);
        if (t > tClosest)
            color += glowColor * 0.6;
        color = applyFog(color, t, rd);
        fragColor = vec4(color, 1.0);
        gl_FragDepth = depthFromPoint(p);
    } else {
        if (glow < 0.003)
            discard;
        // Alfa zero com blending pré-multiplicado: o halo é somado ao que já está na tela
        fragColor = vec4(glowColor, 0.0);
        gl_FragDepth = depthFromPoint(ro + rd * tClosest);
    }
}
