#pragma once

#include <glad/glad.h>
#include <glm/glm.hpp>

// Malha simples: triângulos não indexados com posição e normal intercaladas
struct Mesh {
    GLuint vao = 0;
    GLuint vbo = 0;
    int vertexCount = 0;
};

float terrainHeight(float x, float z);

Mesh createTerrainMesh(float size, int resolution);
Mesh createRockMesh(int seed);
void drawMesh(const Mesh& mesh);
void deleteMesh(Mesh& mesh);
