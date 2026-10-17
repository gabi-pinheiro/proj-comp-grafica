#version 330 core

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uRays;
uniform float uBloomStrength;
uniform float uRaysStrength;

#include "common.glsl"

// Junta a cena HDR com o bloom e os god rays e só então converte para a tela
void main()
{
    vec3 color = texture(uScene, vUV).rgb;
    color += texture(uBloom, vUV).rgb * uBloomStrength;
    color += texture(uRays, vUV).rgb * uRaysStrength;
    fragColor = vec4(toneMap(color), 1.0);
}
