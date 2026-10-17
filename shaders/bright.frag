#version 330 core

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uScene;

const float THRESHOLD = 1.0;

// Separa as partes mais brilhantes da cena (núcleo, gemas, estrela, partículas)
void main()
{
    // Média de 4 amostras bilineares, para reduzir a resolução sem cintilação
    vec2 texel = 1.0 / vec2(textureSize(uScene, 0));
    vec3 color = 0.25 * (texture(uScene, vUV + texel * vec2(-1.0, -1.0)).rgb +
                         texture(uScene, vUV + texel * vec2( 1.0, -1.0)).rgb +
                         texture(uScene, vUV + texel * vec2(-1.0,  1.0)).rgb +
                         texture(uScene, vUV + texel * vec2( 1.0,  1.0)).rgb);

    float brightness = max(color.r, max(color.g, color.b));
    float factor = max(brightness - THRESHOLD, 0.0) / max(brightness, 0.0001);
    fragColor = vec4(color * factor, 1.0);
}
