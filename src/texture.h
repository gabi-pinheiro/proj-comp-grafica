#pragma once

#include <glad/glad.h>
#include <string>

// Carrega uma imagem (JPG, PNG, ...) como textura com mipmaps.
// aspect recebe largura / altura da imagem. Se o arquivo não existir,
// devolve uma textura cinza e avisa no terminal.
GLuint loadTexture(const std::string& path, float& aspect);
