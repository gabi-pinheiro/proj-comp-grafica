#version 330 core

in vec2 vCorner;
in vec3 vColor;

out vec4 fragColor;

// Ponto luminoso com borda suave; a cor é somada à cena (blending aditivo)
void main()
{
    float intensity = exp(-4.0 * dot(vCorner, vCorner));
    if (intensity < 0.05)
        discard;
    fragColor = vec4(vColor * intensity, 1.0);
}
