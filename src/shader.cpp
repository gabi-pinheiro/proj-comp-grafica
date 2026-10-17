#include "shader.h"

#include <fstream>
#include <iostream>
#include <sstream>
#include <glm/gtc/type_ptr.hpp>

// GLSL não tem #include, então os arquivos incluídos são colados no lugar da diretiva.
// Isso permite compartilhar a SDF da escultura entre vários shaders.
static std::string readShaderFile(const std::string& path)
{
    std::ifstream file(path);
    if (!file) {
        std::cerr << "Nao foi possivel abrir o shader: " << path << "\n";
        return "";
    }

    std::string folder = path.substr(0, path.find_last_of("/\\") + 1);
    std::stringstream result;
    std::string line;
    while (std::getline(file, line)) {
        if (line.rfind("#include", 0) == 0) {
            size_t first = line.find('"');
            size_t last = line.find_last_of('"');
            result << readShaderFile(folder + line.substr(first + 1, last - first - 1)) << "\n";
        } else {
            result << line << "\n";
        }
    }
    return result.str();
}

static GLuint compileShader(GLenum type, const std::string& path)
{
    std::string source = readShaderFile(path);
    const char* sourcePtr = source.c_str();

    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &sourcePtr, nullptr);
    glCompileShader(shader);

    GLint success;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &success);
    if (!success) {
        char log[2048];
        glGetShaderInfoLog(shader, sizeof(log), nullptr, log);
        std::cerr << "Erro ao compilar " << path << ":\n" << log << "\n";
        glDeleteShader(shader);
        return 0;
    }
    return shader;
}

GLuint createShaderProgram(const std::string& vertexFile, const std::string& fragmentFile)
{
    GLuint vertexShader = compileShader(GL_VERTEX_SHADER, SHADER_DIR + vertexFile);
    GLuint fragmentShader = compileShader(GL_FRAGMENT_SHADER, SHADER_DIR + fragmentFile);
    if (!vertexShader || !fragmentShader) {
        glDeleteShader(vertexShader);
        glDeleteShader(fragmentShader);
        return 0;
    }

    GLuint program = glCreateProgram();
    glAttachShader(program, vertexShader);
    glAttachShader(program, fragmentShader);
    glLinkProgram(program);
    glDeleteShader(vertexShader);
    glDeleteShader(fragmentShader);

    GLint success;
    glGetProgramiv(program, GL_LINK_STATUS, &success);
    if (!success) {
        char log[2048];
        glGetProgramInfoLog(program, sizeof(log), nullptr, log);
        std::cerr << "Erro ao ligar " << vertexFile << " + " << fragmentFile << ":\n" << log << "\n";
        glDeleteProgram(program);
        return 0;
    }
    return program;
}

void setUniform(GLuint program, const char* name, int value)
{
    glUniform1i(glGetUniformLocation(program, name), value);
}

void setUniform(GLuint program, const char* name, float value)
{
    glUniform1f(glGetUniformLocation(program, name), value);
}

void setUniform(GLuint program, const char* name, const glm::vec2& value)
{
    glUniform2fv(glGetUniformLocation(program, name), 1, glm::value_ptr(value));
}

void setUniform(GLuint program, const char* name, const glm::vec3& value)
{
    glUniform3fv(glGetUniformLocation(program, name), 1, glm::value_ptr(value));
}

void setUniform(GLuint program, const char* name, const glm::mat3& value)
{
    glUniformMatrix3fv(glGetUniformLocation(program, name), 1, GL_FALSE, glm::value_ptr(value));
}

void setUniform(GLuint program, const char* name, const glm::mat4& value)
{
    glUniformMatrix4fv(glGetUniformLocation(program, name), 1, GL_FALSE, glm::value_ptr(value));
}
