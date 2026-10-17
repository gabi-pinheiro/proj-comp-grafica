#version 330 core

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uBright;
uniform vec2 uCoreScreen;   // posição do núcleo na tela (0 a 1)
uniform float uCoreRays;
uniform vec2 uSunScreen;    // posição da estrela principal na tela
uniform float uSunRays;

const int SAMPLES = 40;

// "God rays" em espaço de tela: soma as partes brilhantes ao longo da linha entre o
// pixel e a fonte de luz. O que estiver na frente da luz (casca, anéis, rochas) é
// escuro na imagem de brilho e por isso interrompe os raios.
vec3 radialBlur(vec2 uv, vec2 lightPos)
{
    vec2 step = (lightPos - uv) / float(SAMPLES);
    vec3 sum = vec3(0.0);
    float weight = 1.0;
    for (int i = 0; i < SAMPLES; i++) {
        uv += step;
        sum += texture(uBright, uv).rgb * weight;
        weight *= 0.95;
    }
    return sum / float(SAMPLES);
}

void main()
{
    vec3 rays = vec3(0.0);
    if (uCoreRays > 0.0)
        rays += radialBlur(vUV, uCoreScreen) * uCoreRays;
    if (uSunRays > 0.0)
        rays += radialBlur(vUV, uSunScreen) * uSunRays;
    fragColor = vec4(rays, 1.0);
}
