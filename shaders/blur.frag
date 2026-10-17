#version 330 core

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uImage;
uniform vec2 uDirection;   // (1, 0) para horizontal, (0, 1) para vertical

// Pesos de uma gaussiana de 9 amostras. O desfoque é separável: um passe horizontal
// seguido de um vertical custa muito menos que um filtro 2D completo.
const float WEIGHTS[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

void main()
{
    vec2 offset = uDirection / vec2(textureSize(uImage, 0));
    vec3 sum = texture(uImage, vUV).rgb * WEIGHTS[0];
    for (int i = 1; i < 5; i++) {
        sum += texture(uImage, vUV + offset * float(i)).rgb * WEIGHTS[i];
        sum += texture(uImage, vUV - offset * float(i)).rgb * WEIGHTS[i];
    }
    fragColor = vec4(sum, 1.0);
}
