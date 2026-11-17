#version 330 core
// Passe final: estica a cena renderizada em resolução menor para a janela.
in vec2 vUV;
out vec4 C;
uniform sampler2D uCena;

void main()
{
    C = texture(uCena, vUV);
}
