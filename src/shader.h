#pragma once

#include <glad/glad.h>
#include <glm/glm.hpp>
#include <string>

// Retorna 0 se houver erro de compilação ou de ligação (o erro é impresso no terminal)
GLuint createShaderProgram(const std::string& vertexFile, const std::string& fragmentFile);

void setUniform(GLuint program, const char* name, int value);
void setUniform(GLuint program, const char* name, float value);
void setUniform(GLuint program, const char* name, const glm::vec2& value);
void setUniform(GLuint program, const char* name, const glm::vec3& value);
void setUniform(GLuint program, const char* name, const glm::mat3& value);
void setUniform(GLuint program, const char* name, const glm::mat4& value);
