#version 330 core

uniform mat4 uViewProj;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform int uParticleCount;

#include "common.glsl"

out vec2 vCorner;
out vec3 vColor;

const int RING_COUNT = 4;

float hash11(float n)
{
    return fract(sin(n * 91.345) * 47453.5453);
}

// Ruído 1D suave: interpola valores aleatórios definidos nos inteiros
float noise1(float x)
{
    float i = floor(x);
    float f = fract(x);
    return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

mat3 rotateX(float a)
{
    float c = cos(a), s = sin(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

mat3 rotateZ(float a)
{
    float c = cos(a), s = sin(a);
    return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
}

// Não há buffer de vértices: cada instância é uma partícula e a posição dela
// é calculada aqui a partir do índice (gl_InstanceID) e do tempo
void main()
{
    const vec2 corners[6] = vec2[](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0),
                                   vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));
    vCorner = corners[gl_VertexID];

    int ring = gl_InstanceID % RING_COUNT;
    int indexInRing = gl_InstanceID / RING_COUNT;
    int perRing = uParticleCount / RING_COUNT;
    float id = float(gl_InstanceID);
    float r = float(ring);

    float radius = 2.3 + 0.6 * r + 0.35 * (hash11(id) - 0.5);

    // Terceira lei de Kepler: órbitas maiores são mais lentas (velocidade ~ raio^-1,5)
    float speed = 0.5 * pow(2.3 / radius, 1.5);

    // Repetição polar: as partículas de um anel ficam em ângulos igualmente espaçados
    float angle = 6.2831853 * (float(indexInRing) + 0.4 * hash11(id + 3.1)) / float(perRing);
    angle += uTime * speed;

    // Ruído procedural desloca as partículas para dentro/fora e para cima/baixo
    float offsetRadius = 0.5 * (noise1(angle * 3.0 + r * 17.0 + uTime * 0.3) - 0.5);
    float offsetHeight = 0.3 * (noise1(angle * 5.0 + r * 31.0 - uTime * 0.2) - 0.5);
    vec3 local = vec3(cos(angle) * (radius + offsetRadius), offsetHeight, sin(angle) * (radius + offsetRadius));

    // Cada anel tem uma inclinação diferente
    local = rotateZ(0.35 * r - 0.5) * rotateX(0.3 * r - 0.2) * local;

    // Quadrado sempre virado para a câmera (billboard)
    float size = 0.02 + 0.035 * hash11(id + 7.7);
    vec3 worldPos = artifactCenter() + local + (uCameraRight * vCorner.x + uCameraUp * vCorner.y) * size;

    float twinkle = 0.6 + 0.4 * sin(uTime * 3.0 + id);
    vColor = mix(CYAN, MAGENTA, hash11(id + 1.3)) * (1.5 + 2.5 * hash11(id + 5.5)) * twinkle;

    gl_Position = uViewProj * vec4(worldPos, 1.0);
}
