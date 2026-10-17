#include "geometry.h"

#include <cmath>
#include <vector>
#include <glm/gtc/constants.hpp>

static float hash3(int x, int y, int z)
{
    unsigned int h = (unsigned int)x * 374761393u + (unsigned int)y * 668265263u + (unsigned int)z * 2246822519u;
    h = (h ^ (h >> 13)) * 1274126177u;
    h = h ^ (h >> 16);
    return (h & 0xFFFFFF) / float(0xFFFFFF);
}

// Value noise 3D: interpola valores aleatórios definidos nos vértices de uma grade
static float valueNoise(const glm::vec3& p)
{
    glm::vec3 cell = glm::floor(p);
    glm::vec3 f = p - cell;
    glm::vec3 u = f * f * (3.0f - 2.0f * f);
    int x = (int)cell.x, y = (int)cell.y, z = (int)cell.z;

    float bottom = glm::mix(glm::mix(hash3(x, y, z), hash3(x + 1, y, z), u.x),
                            glm::mix(hash3(x, y + 1, z), hash3(x + 1, y + 1, z), u.x), u.y);
    float top = glm::mix(glm::mix(hash3(x, y, z + 1), hash3(x + 1, y, z + 1), u.x),
                         glm::mix(hash3(x, y + 1, z + 1), hash3(x + 1, y + 1, z + 1), u.x), u.y);
    return glm::mix(bottom, top, u.z);
}

static float fbm(float x, float z)
{
    float sum = 0.0f, amplitude = 0.5f, frequency = 1.0f;
    for (int i = 0; i < 4; i++) {
        sum += amplitude * valueNoise(glm::vec3(x * frequency, 0.0f, z * frequency));
        amplitude *= 0.5f;
        frequency *= 2.0f;
    }
    return sum;
}

float terrainHeight(float x, float z)
{
    float r = std::sqrt(x * x + z * z);

    float dunes = (fbm(x * 0.05f, z * 0.05f) - 0.45f) * 3.0f + 0.4f * std::sin(x * 0.21f + z * 0.13f);
    float flatCenter = glm::smoothstep(9.0f, 24.0f, r);

    // Pequena cratera embaixo do artefato, como se ele tivesse marcado o solo
    float crater = -0.35f * (1.0f - glm::smoothstep(0.0f, 6.5f, r))
                 + 0.3f * std::exp(-(r - 7.0f) * (r - 7.0f) / 1.5f);

    float mountains = glm::smoothstep(35.0f, 70.0f, r) * fbm(x * 0.03f + 7.0f, z * 0.03f) * 16.0f;

    return dunes * flatCenter + crater + mountains;
}

static void addVertex(std::vector<float>& data, const glm::vec3& p, const glm::vec3& n)
{
    data.insert(data.end(), { p.x, p.y, p.z, n.x, n.y, n.z });
}

static Mesh uploadMesh(const std::vector<float>& data)
{
    Mesh mesh;
    mesh.vertexCount = (int)(data.size() / 6);

    glGenVertexArrays(1, &mesh.vao);
    glGenBuffers(1, &mesh.vbo);
    glBindVertexArray(mesh.vao);
    glBindBuffer(GL_ARRAY_BUFFER, mesh.vbo);
    glBufferData(GL_ARRAY_BUFFER, data.size() * sizeof(float), data.data(), GL_STATIC_DRAW);

    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 6 * sizeof(float), (void*)0);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 6 * sizeof(float), (void*)(3 * sizeof(float)));
    glEnableVertexAttribArray(1);

    glBindVertexArray(0);
    return mesh;
}

Mesh createTerrainMesh(float size, int resolution)
{
    int n = resolution + 1;
    float step = size / resolution;
    float half = size * 0.5f;

    std::vector<glm::vec3> positions(n * n);
    std::vector<glm::vec3> normals(n * n);
    for (int j = 0; j < n; j++) {
        for (int i = 0; i < n; i++) {
            float x = -half + i * step;
            float z = -half + j * step;
            positions[j * n + i] = glm::vec3(x, terrainHeight(x, z), z);
        }
    }

    // Normais por diferenças finitas da altura
    const float e = 0.1f;
    for (int k = 0; k < n * n; k++) {
        float x = positions[k].x, z = positions[k].z;
        float dx = terrainHeight(x - e, z) - terrainHeight(x + e, z);
        float dz = terrainHeight(x, z - e) - terrainHeight(x, z + e);
        normals[k] = glm::normalize(glm::vec3(dx, 2.0f * e, dz));
    }

    std::vector<float> data;
    data.reserve(resolution * resolution * 6 * 6);
    for (int j = 0; j < resolution; j++) {
        for (int i = 0; i < resolution; i++) {
            int a = j * n + i, b = a + 1, c = a + n, d = c + 1;
            addVertex(data, positions[a], normals[a]);
            addVertex(data, positions[c], normals[c]);
            addVertex(data, positions[d], normals[d]);
            addVertex(data, positions[a], normals[a]);
            addVertex(data, positions[d], normals[d]);
            addVertex(data, positions[b], normals[b]);
        }
    }
    return uploadMesh(data);
}

// Rocha low-poly: uma esfera de poucos segmentos deformada por ruído, com normais por face
Mesh createRockMesh(int seed)
{
    const int rings = 7;
    const int segments = 10;
    const float pi = glm::pi<float>();

    auto rockPoint = [&](int r, int s) {
        float theta = pi * r / rings;
        float phi = 2.0f * pi * s / segments;
        glm::vec3 dir(std::sin(theta) * std::cos(phi), std::cos(theta), std::sin(theta) * std::sin(phi));

        bool isPole = (r == 0 || r == rings);
        float bump = valueNoise(dir * 1.8f + glm::vec3(seed * 13.7f));
        float jitter = isPole ? 0.5f : hash3(r, s % segments, seed);
        glm::vec3 p = dir * (0.7f + 0.55f * bump + 0.15f * jitter);

        // Achata a base para a rocha "assentar" no chão
        if (p.y < -0.25f)
            p.y = -0.25f + (p.y + 0.25f) * 0.3f;
        return p;
    };

    std::vector<float> data;
    auto addTriangle = [&](const glm::vec3& a, const glm::vec3& b, const glm::vec3& c) {
        glm::vec3 normal = glm::cross(b - a, c - a);
        if (glm::length(normal) < 1e-6f)
            return;
        normal = glm::normalize(normal);
        if (glm::dot(normal, a + b + c) < 0.0f)
            normal = -normal;
        addVertex(data, a, normal);
        addVertex(data, b, normal);
        addVertex(data, c, normal);
    };

    for (int r = 0; r < rings; r++) {
        for (int s = 0; s < segments; s++) {
            glm::vec3 a = rockPoint(r, s);
            glm::vec3 b = rockPoint(r + 1, s);
            glm::vec3 c = rockPoint(r + 1, s + 1);
            glm::vec3 d = rockPoint(r, s + 1);
            addTriangle(a, b, c);
            addTriangle(a, c, d);
        }
    }
    return uploadMesh(data);
}

void drawMesh(const Mesh& mesh)
{
    glBindVertexArray(mesh.vao);
    glDrawArrays(GL_TRIANGLES, 0, mesh.vertexCount);
}

void deleteMesh(Mesh& mesh)
{
    glDeleteBuffers(1, &mesh.vbo);
    glDeleteVertexArrays(1, &mesh.vao);
    mesh = Mesh();
}
