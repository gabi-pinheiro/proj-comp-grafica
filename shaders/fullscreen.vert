#version 330 core

out vec2 vUV;

// Um único triângulo que cobre a tela inteira, sem precisar de buffer de vértices
void main()
{
    vec2 positions[3] = vec2[](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    vUV = positions[gl_VertexID] * 0.5 + 0.5;
    gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
}
