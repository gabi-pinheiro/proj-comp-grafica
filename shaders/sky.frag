#version 330 core

out vec4 fragColor;

uniform mat4 uInvViewProj;
uniform vec2 uResolution;

#include "common.glsl"

const vec3 PLANET_DIR = normalize(vec3(0.41, 0.24, -0.88));
const vec3 RING_NORMAL = normalize(vec3(0.25, 1.0, 0.35));

float hash(vec3 p)
{
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

vec3 stars(vec3 dir)
{
    vec3 grid = dir * 300.0;
    vec3 cell = floor(grid);
    float h = hash(cell);
    if (h < 0.993)
        return vec3(0.0);

    float dist = length(grid - cell - 0.5);
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + h * 400.0);
    float brightness = (1.0 - smoothstep(0.0, 0.5, dist)) * (h - 0.993) / 0.007;
    return vec3(0.85, 0.85, 1.0) * brightness * twinkle * 2.0 * smoothstep(0.0, 0.2, dir.y);
}

void main()
{
    vec2 ndc = gl_FragCoord.xy / uResolution * 2.0 - 1.0;
    vec4 farPoint = uInvViewProj * vec4(ndc, 1.0, 1.0);
    vec3 rd = normalize(farPoint.xyz / farPoint.w - uCameraPos);

    vec3 color = skyColor(rd);

    // Disco da estrela principal
    float sunAmount = dot(rd, uLightDir);
    color += SUN_COLOR * (smoothstep(0.9990, 0.9995, sunAmount) * 4.0 + pow(max(sunAmount, 0.0), 400.0) * 1.5);

    // Planeta gigante com anéis, tratado como uma esfera muito distante
    vec3 planetCenter = PLANET_DIR * 100.0;
    float planetRadius = 9.0;
    vec2 planetHit = intersectSphere(-planetCenter, rd, planetRadius);

    if (planetHit.x > 0.0) {
        vec3 n = normalize(rd * planetHit.x - planetCenter);
        float light = max(dot(n, uLightDir), 0.0);
        float latitude = dot(n, RING_NORMAL);
        float bands = sin(latitude * 18.0 + 2.0 * sin(latitude * 5.0));
        vec3 surface = mix(vec3(0.30, 0.15, 0.42), vec3(0.70, 0.38, 0.55), 0.5 + 0.5 * bands);
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        color = surface * (light * 0.8 + 0.015) + vec3(0.6, 0.3, 0.8) * rim * (0.15 + light);
    } else {
        color += stars(rd);
    }

    float ringT = dot(planetCenter, RING_NORMAL) / dot(rd, RING_NORMAL);
    if (ringT > 0.0 && (planetHit.x < 0.0 || ringT < planetHit.x)) {
        float ringDist = length(rd * ringT - planetCenter) / planetRadius;
        if (ringDist > 1.35 && ringDist < 2.3) {
            float stripes = 0.6 + 0.4 * sin(ringDist * 14.0);
            float fade = smoothstep(1.35, 1.5, ringDist) * (1.0 - smoothstep(2.1, 2.3, ringDist));
            color = mix(color, vec3(0.60, 0.45, 0.62) * 0.4, 0.6 * stripes * fade);
        }
    }

    fragColor = vec4(toneMap(color), 1.0);
}
