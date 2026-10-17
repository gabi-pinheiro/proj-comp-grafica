#version 330 core

in vec3 vWorldPos;
in vec3 vNormal;

out vec4 fragColor;

uniform vec3 uBaseColor;
uniform int uIsGround;
uniform mat4 uLightViewProj;
uniform sampler2DShadow uShadowMap;

#include "common.glsl"
#include "sculpture_sdf.glsl"

float hash2(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Shadow mapping: compara a profundidade do ponto vista pela luz com a guardada no mapa.
// 9 amostras vizinhas (PCF) deixam a borda da sombra suave.
float terrainShadow(vec3 worldPos, vec3 n)
{
    vec4 lightClip = uLightViewProj * vec4(worldPos + n * 0.05, 1.0);
    vec3 coord = lightClip.xyz / lightClip.w * 0.5 + 0.5;
    float texel = 1.0 / float(textureSize(uShadowMap, 0).x);

    float sum = 0.0;
    for (int x = -1; x <= 1; x++)
        for (int y = -1; y <= 1; y++)
            sum += texture(uShadowMap, vec3(coord.xy + vec2(x, y) * texel, coord.z - 0.0005));
    return sum / 9.0;
}

void main()
{
    vec3 n = normalize(vNormal);
    vec3 toPoint = vWorldPos - uCameraPos;
    float dist = length(toPoint);
    vec3 rd = toPoint / dist;

    vec3 albedo = uBaseColor;
    if (uIsGround == 1) {
        float detail = 0.6 * valueNoise(vWorldPos.xz * 0.7) + 0.4 * valueNoise(vWorldPos.xz * 3.1);
        albedo *= 0.7 + 0.6 * detail;
    }

    float diffuse = max(dot(n, uLightDir), 0.0);
    float shadow = 0.0;
    if (diffuse > 0.0)
        shadow = min(terrainShadow(vWorldPos, n), sculptureShadow(vWorldPos + n * 0.02, uLightDir));

    // Luz do núcleo bloqueada pela escultura (só calculada perto do artefato, onde ela é forte)
    float coreVisible = length(vWorldPos - artifactCenter()) < 10.0 ? coreVisibility(vWorldPos + n * 0.02) : 1.0;
    vec3 ambient = mix(vec3(0.03, 0.015, 0.04), vec3(0.08, 0.05, 0.13), 0.5 + 0.5 * n.y);

    vec3 color = albedo * (SUN_COLOR * diffuse * shadow * 1.6 + ambient + 3.0 * coreLight(vWorldPos, n) * coreVisible);

    // Ondas de energia que saem do artefato pelo chão
    if (uIsGround == 1) {
        float r = length(vWorldPos.xz - artifactCenter().xz);
        float wave = smoothstep(0.97, 1.0, sin(r * 2.2 - uTime * 1.2)) * exp(-r * 0.3);
        color += coreColor() * wave * (0.08 + 0.08 * corePulse());
    }

    color = applyFog(color, dist, rd);
    fragColor = vec4(color, 1.0);
}
