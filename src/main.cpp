#include <glad/glad.h>
#include <GLFW/glfw3.h>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <random>
#include <vector>

#include "geometry.h"
#include "shader.h"

struct OrbitCamera {
    glm::vec3 target = glm::vec3(0.0f, 2.4f, 0.0f);
    float yaw = 0.0f;
    float pitch = 0.06f;
    float distance = 7.5f;

    glm::vec3 position() const
    {
        return target + distance * glm::vec3(std::sin(yaw) * std::cos(pitch),
                                              std::sin(pitch),
                                              std::cos(yaw) * std::cos(pitch));
    }
};

struct SceneObject {
    const Mesh* mesh;
    glm::mat4 model;
    glm::vec3 color;
};

struct Programs {
    GLuint sky = 0;
    GLuint scene = 0;
    GLuint sculpture = 0;
};

static OrbitCamera camera;
static bool isDragging = false;
static double lastMouseX = 0.0, lastMouseY = 0.0;
static bool animationPaused = false;
static bool autoOrbit = false;
static bool reloadRequested = false;

static void keyCallback(GLFWwindow* window, int key, int, int action, int)
{
    if (action != GLFW_PRESS)
        return;

    switch (key) {
    case GLFW_KEY_ESCAPE: glfwSetWindowShouldClose(window, true); break;
    case GLFW_KEY_SPACE: animationPaused = !animationPaused; break;
    case GLFW_KEY_A: autoOrbit = !autoOrbit; break;
    case GLFW_KEY_R: camera = OrbitCamera(); break;
    case GLFW_KEY_F5: reloadRequested = true; break;
    }
}

static void mouseButtonCallback(GLFWwindow* window, int button, int action, int)
{
    if (button == GLFW_MOUSE_BUTTON_LEFT) {
        isDragging = (action == GLFW_PRESS);
        glfwGetCursorPos(window, &lastMouseX, &lastMouseY);
    }
}

static void cursorPosCallback(GLFWwindow*, double x, double y)
{
    if (!isDragging)
        return;

    camera.yaw -= (float)(x - lastMouseX) * 0.005f;
    camera.pitch += (float)(y - lastMouseY) * 0.005f;
    camera.pitch = glm::clamp(camera.pitch, -0.08f, 1.2f);
    lastMouseX = x;
    lastMouseY = y;
}

static void scrollCallback(GLFWwindow*, double, double offsetY)
{
    camera.distance = glm::clamp(camera.distance - (float)offsetY * 0.5f, 4.0f, 25.0f);
}

static bool loadPrograms(Programs& programs)
{
    Programs loaded;
    loaded.sky = createShaderProgram("fullscreen.vert", "sky.frag");
    loaded.scene = createShaderProgram("scene.vert", "scene.frag");
    loaded.sculpture = createShaderProgram("fullscreen.vert", "sculpture.frag");

    if (!loaded.sky || !loaded.scene || !loaded.sculpture) {
        glDeleteProgram(loaded.sky);
        glDeleteProgram(loaded.scene);
        glDeleteProgram(loaded.sculpture);
        return false;
    }

    glDeleteProgram(programs.sky);
    glDeleteProgram(programs.scene);
    glDeleteProgram(programs.sculpture);
    programs = loaded;
    return true;
}

// Espalha rochas e estruturas ao redor da cratera de forma determinística (semente fixa)
static std::vector<SceneObject> createRocks(const std::vector<Mesh>& rockMeshes)
{
    std::vector<SceneObject> rocks;
    std::mt19937 rng(42);
    std::uniform_real_distribution<float> random01(0.0f, 1.0f);
    const float twoPi = 6.2831853f;

    auto place = [&](float radius, float angle, glm::vec3 size, float tilt, glm::vec3 color) {
        float x = radius * std::cos(angle);
        float z = radius * std::sin(angle);
        glm::mat4 model = glm::translate(glm::mat4(1.0f), glm::vec3(x, terrainHeight(x, z) - 0.15f * size.y, z));
        model = glm::rotate(model, random01(rng) * twoPi, glm::vec3(0.0f, 1.0f, 0.0f));
        model = glm::rotate(model, tilt, glm::vec3(1.0f, 0.0f, 0.0f));
        model = glm::scale(model, size);
        rocks.push_back({ &rockMeshes[rng() % rockMeshes.size()], model, color });
    };

    // Evita colocar rochas próximas entre a câmera inicial e o artefato
    auto blocksInitialView = [&](float radius, float angle) {
        float cameraAngle = twoPi * 0.25f;
        return radius < 13.0f && std::abs(angle - cameraAngle) < 0.6f;
    };

    glm::vec3 rockColor(0.15f, 0.12f, 0.21f);
    glm::vec3 shardColor(0.11f, 0.09f, 0.19f);

    for (int i = 0; i < 40; i++) {
        float radius = (i < 10) ? 7.5f + random01(rng) * 3.5f : 13.0f + random01(rng) * 27.0f;
        float angle = random01(rng) * twoPi;
        if (blocksInitialView(radius, angle))
            continue;
        float s = (i < 10) ? 0.4f + random01(rng) * 0.7f : 0.6f + random01(rng) * 1.4f;
        glm::vec3 size(s * (0.8f + random01(rng) * 0.5f), s * (0.6f + random01(rng) * 0.5f), s);
        place(radius, angle, size, random01(rng) * 0.3f, rockColor * (0.8f + random01(rng) * 0.4f));
    }

    // Estruturas altas e inclinadas ao longe, como fragmentos de algo maior
    for (int i = 0; i < 8; i++) {
        float radius = 18.0f + random01(rng) * 27.0f;
        float angle = random01(rng) * twoPi;
        float width = 1.0f + random01(rng) * 0.6f;
        glm::vec3 size(width, 4.0f + random01(rng) * 5.0f, width);
        place(radius, angle, size, random01(rng) * 0.35f, shardColor);
    }
    return rocks;
}

int main()
{
    if (!glfwInit()) {
        std::cerr << "Falha ao inicializar o GLFW\n";
        return 1;
    }
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
    glfwWindowHint(GLFW_SAMPLES, 4);

    GLFWwindow* window = glfwCreateWindow(1280, 720, "The Anomaly", nullptr, nullptr);
    if (!window) {
        std::cerr << "Falha ao criar a janela (OpenGL 3.3 e necessario)\n";
        glfwTerminate();
        return 1;
    }
    glfwMakeContextCurrent(window);
    glfwSwapInterval(1);
    glfwSetKeyCallback(window, keyCallback);
    glfwSetMouseButtonCallback(window, mouseButtonCallback);
    glfwSetCursorPosCallback(window, cursorPosCallback);
    glfwSetScrollCallback(window, scrollCallback);

    if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress)) {
        std::cerr << "Falha ao carregar as funcoes do OpenGL\n";
        return 1;
    }
    std::cout << "OpenGL " << glGetString(GL_VERSION) << " | " << glGetString(GL_RENDERER) << "\n";

    Programs programs;
    if (!loadPrograms(programs))
        return 1;

    Mesh terrain = createTerrainMesh(200.0f, 220);
    std::vector<Mesh> rockMeshes = { createRockMesh(1), createRockMesh(2), createRockMesh(3) };
    std::vector<SceneObject> rocks = createRocks(rockMeshes);

    // VAO vazio para os passes de tela cheia (os vértices são gerados no shader)
    GLuint fullscreenVao;
    glGenVertexArrays(1, &fullscreenVao);

    const glm::vec3 lightDir = glm::normalize(glm::vec3(-0.84f, 0.26f, -0.48f));
    const glm::vec3 terrainColor(0.13f, 0.09f, 0.17f);

    float animationTime = 0.0f;
    double lastFrameTime = glfwGetTime();
    double fpsTimer = lastFrameTime;
    int frameCount = 0;

    while (!glfwWindowShouldClose(window)) {
        double now = glfwGetTime();
        float deltaTime = (float)(now - lastFrameTime);
        lastFrameTime = now;

        if (!animationPaused)
            animationTime += deltaTime;
        if (autoOrbit)
            camera.yaw += deltaTime * 0.08f;

        if (reloadRequested) {
            reloadRequested = false;
            std::cout << (loadPrograms(programs) ? "Shaders recarregados\n" : "Mantendo os shaders anteriores\n");
        }

        int width, height;
        glfwGetFramebufferSize(window, &width, &height);
        if (width == 0 || height == 0) {
            // Janela minimizada: espera um evento em vez de repetir o laço sem parar
            glfwWaitEvents();
            continue;
        }
        glViewport(0, 0, width, height);

        glm::vec3 cameraPos = camera.position();
        // Mantém a câmera acima do terreno quando ela está baixa e afastada
        cameraPos.y = std::max(cameraPos.y, terrainHeight(cameraPos.x, cameraPos.z) + 0.5f);
        glm::mat4 view = glm::lookAt(cameraPos, camera.target, glm::vec3(0.0f, 1.0f, 0.0f));
        glm::mat4 projection = glm::perspective(glm::radians(50.0f), (float)width / height, 0.1f, 300.0f);
        glm::mat4 viewProj = projection * view;
        glm::mat4 invViewProj = glm::inverse(viewProj);
        glm::vec2 resolution((float)width, (float)height);

        auto setCommonUniforms = [&](GLuint program) {
            glUseProgram(program);
            setUniform(program, "uTime", animationTime);
            setUniform(program, "uLightDir", lightDir);
            setUniform(program, "uCameraPos", cameraPos);
            setUniform(program, "uViewProj", viewProj);
            setUniform(program, "uInvViewProj", invViewProj);
            setUniform(program, "uResolution", resolution);
        };

        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

        // 1) Céu: triângulo de tela cheia, sem depth
        glDisable(GL_DEPTH_TEST);
        glDepthMask(GL_FALSE);
        setCommonUniforms(programs.sky);
        glBindVertexArray(fullscreenVao);
        glDrawArrays(GL_TRIANGLES, 0, 3);

        // 2) Terreno e rochas: geometria convencional
        glEnable(GL_DEPTH_TEST);
        glDepthMask(GL_TRUE);
        setCommonUniforms(programs.scene);

        setUniform(programs.scene, "uModel", glm::mat4(1.0f));
        setUniform(programs.scene, "uNormalMatrix", glm::mat3(1.0f));
        setUniform(programs.scene, "uBaseColor", terrainColor);
        setUniform(programs.scene, "uIsGround", 1);
        drawMesh(terrain);

        setUniform(programs.scene, "uIsGround", 0);
        for (const SceneObject& rock : rocks) {
            setUniform(programs.scene, "uModel", rock.model);
            setUniform(programs.scene, "uNormalMatrix", glm::mat3(glm::transpose(glm::inverse(rock.model))));
            setUniform(programs.scene, "uBaseColor", rock.color);
            drawMesh(*rock.mesh);
        }

        // 3) Escultura por ray marching. O shader escreve gl_FragDepth para se
        //    misturar corretamente com o terreno e as rochas.
        glEnable(GL_BLEND);
        glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
        setCommonUniforms(programs.sculpture);
        glBindVertexArray(fullscreenVao);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        glDisable(GL_BLEND);

        glfwSwapBuffers(window);
        glfwPollEvents();

        frameCount++;
        if (now - fpsTimer >= 0.5) {
            char title[64];
            std::snprintf(title, sizeof(title), "The Anomaly | %.1f FPS", frameCount / (now - fpsTimer));
            glfwSetWindowTitle(window, title);
            frameCount = 0;
            fpsTimer = now;
        }
    }

    deleteMesh(terrain);
    for (Mesh& mesh : rockMeshes)
        deleteMesh(mesh);
    glDeleteVertexArrays(1, &fullscreenVao);
    glDeleteProgram(programs.sky);
    glDeleteProgram(programs.scene);
    glDeleteProgram(programs.sculpture);
    glfwTerminate();
    return 0;
}
