#pragma once

#include <glad/glad.h>

// Framebuffer com uma textura (cor HDR ou profundidade) que pode ser lida depois por outro passe
struct RenderTarget {
    GLuint fbo = 0;
    GLuint texture = 0;
    GLuint depthBuffer = 0;
    int width = 0;
    int height = 0;
};

// Cor em ponto flutuante (RGBA16F), para guardar valores acima de 1 antes do tone mapping
RenderTarget createColorTarget(int width, int height, bool withDepth);

// Apenas profundidade, usada no shadow mapping
RenderTarget createShadowTarget(int size);

void deleteRenderTarget(RenderTarget& target);
