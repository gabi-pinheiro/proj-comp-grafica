// The Anomaly — versão completa sobre a engine de ray marching do professor.
//
// A estrutura segue a engine (Math3.cpp): um único quad em tela cheia e um
// fragment shader (Shaders/Image.frag) que calcula a cena inteira por ray
// marching — nenhuma geometria é rasterizada.

#include <glad/glad.h>
#include <GLFW/glfw3.h>
#include <glm/glm.hpp>

#include <algorithm>
#include <cstdio>
#include <iostream>
#include <string>

#include "shader.h"
#include "story.h"
#include "texture.h"

void framebuffer_size_callback(GLFWwindow* window, int width, int height);

const unsigned int SCR_WIDTH = 1280;
const unsigned int SCR_HEIGHT = 720;

// Quad em tela cheia: os 2 triângulos só servem para disparar o fragment shader
float vertices[] = {
    1.0f,  1.0f, 0.0f,   1.0f, 1.0f, // top right
    1.0f, -1.0f, 0.0f,   1.0f, 0.0f, // bottom right
   -1.0f, -1.0f, 0.0f,   0.0f, 0.0f, // bottom left
   -1.0f,  1.0f, 0.0f,   0.0f, 1.0f  // top left
};

unsigned int indices[] = { 0, 1, 3, 1, 2, 3 };

// Câmera de órbita do modo livre (a narrativa controla a câmera sozinha)
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

// Foto revelada no fim da narrativa (pasta assets/ do projeto)
const char* CLASSROOM_IMAGE = "sala-each.jpg";

static OrbitCamera camera;
static bool isDragging = false;
static bool firstDrag = true;
static double lastMouseX = 0.0, lastMouseY = 0.0;
static bool animationPaused = false;
static bool autoOrbit = false;
static bool reloadRequested = false;
static bool particlesEnabled = true;
// A narrativa começa sozinha; durante ela a câmera é controlada pela linha do tempo
static bool storyPlaying = true;
static bool storyRestartRequested = false;

static void keyCallback(GLFWwindow* window, int key, int, int action, int)
{
    if (action != GLFW_PRESS)
        return;
    switch (key) {
    case GLFW_KEY_ESCAPE: glfwSetWindowShouldClose(window, true); break;
    case GLFW_KEY_SPACE:  animationPaused = !animationPaused; break;
    case GLFW_KEY_N:      storyRestartRequested = true; break;
    // M sai da narrativa para o modo livre; A e P só fazem sentido lá
    case GLFW_KEY_M:      if (storyPlaying) { storyPlaying = false; camera.distance = 10.0f; } break;
    case GLFW_KEY_A:      if (!storyPlaying) autoOrbit = !autoOrbit; break;
    case GLFW_KEY_P:      if (!storyPlaying) particlesEnabled = !particlesEnabled; break;
    case GLFW_KEY_R:      if (!storyPlaying) camera = OrbitCamera(); break;
    case GLFW_KEY_F5:     reloadRequested = true; break;
    }
}

static void mouseButtonCallback(GLFWwindow*, int button, int action, int)
{
    if (storyPlaying)
        return;
    if (button == GLFW_MOUSE_BUTTON_LEFT) {
        isDragging = (action == GLFW_PRESS);
        firstDrag = true;
    }
}

static void cursorPosCallback(GLFWwindow*, double x, double y)
{
    if (!isDragging || storyPlaying) {
        lastMouseX = x;
        lastMouseY = y;
        return;
    }
    if (firstDrag) {
        firstDrag = false;
        lastMouseX = x;
        lastMouseY = y;
        return;
    }
    camera.yaw -= float(x - lastMouseX) * 0.005f;
    camera.pitch = glm::clamp(camera.pitch + float(y - lastMouseY) * 0.005f, -1.2f, 1.2f);
    lastMouseX = x;
    lastMouseY = y;
}

static void scrollCallback(GLFWwindow*, double, double yoff)
{
    if (storyPlaying)
        return;
    camera.distance = glm::clamp(camera.distance - float(yoff) * 0.7f, 2.0f, 30.0f);
}

// Impede a câmera de mergulhar no terreno no modo livre (guarda-chuva aproximado)
static void clampCameraAboveTerrain()
{
    float y = camera.target.y + camera.distance * sin(camera.pitch);
    if (y < 0.8f)
        camera.pitch = std::asin(glm::clamp((0.8f - camera.target.y) / camera.distance, -1.0f, 1.0f));
}

int main()
{
    glfwInit();
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
#ifdef __APPLE__
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
#endif

    GLFWwindow* window = glfwCreateWindow(SCR_WIDTH, SCR_HEIGHT, "The Anomaly", NULL, NULL);
    if (window == NULL) {
        std::cout << "Failed to create GLFW window" << std::endl;
        glfwTerminate();
        return -1;
    }
    glfwMakeContextCurrent(window);
    glfwSetFramebufferSizeCallback(window, framebuffer_size_callback);
    glfwSetKeyCallback(window, keyCallback);
    glfwSetMouseButtonCallback(window, mouseButtonCallback);
    glfwSetCursorPosCallback(window, cursorPosCallback);
    glfwSetScrollCallback(window, scrollCallback);

    if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress)) {
        std::cout << "Failed to initialize GLAD" << std::endl;
        return -1;
    }

    // createShaderProgram resolve os nomes dentro de SHADER_DIR (shaders/)
    GLuint imageProgram = createShaderProgram("fullscreen.vert", "Image.frag");
    if (!imageProgram)
        return -1;

    ////////////////////
    //  QUAD TELA CHEIA //
    ////////////////////
    unsigned int VBO, VAO, EBO;
    glGenVertexArrays(1, &VAO);
    glGenBuffers(1, &VBO);
    glGenBuffers(1, &EBO);
    glBindVertexArray(VAO);

    glBindBuffer(GL_ARRAY_BUFFER, VBO);
    glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STREAM_DRAW);

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, EBO);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(indices), indices, GL_STREAM_DRAW);

    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 5 * sizeof(float), (void*)0);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 5 * sizeof(float), (void*)(3 * sizeof(float)));
    glEnableVertexAttribArray(1);

    ////////////////////
    //    TEXTURAS     //
    ////////////////////
    // iChannel0 = foto da sala de aula (única imagem importada do projeto)
    float roomAspect = 1.0f;
    GLuint roomTexture = loadTexture(std::string(ASSET_DIR) + CLASSROOM_IMAGE, roomAspect);

    glm::vec2 resolution(SCR_WIDTH, SCR_HEIGHT);
    glUseProgram(imageProgram);
    setUniform(imageProgram, "iChannel0", 0);
    setUniform(imageProgram, "iResolution", resolution);
    setUniform(imageProgram, "uRoomAspect", roomAspect);
    setUniform(imageProgram, "uLightDir", glm::normalize(glm::vec3(0.55f, 0.42f, -0.72f)));

    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, roomTexture);

    glDisable(GL_CULL_FACE);   // o quad em tela cheia é desenhado dos dois lados

    double fpsTimer = glfwGetTime();
    int fpsFrames = 0;
    double lastTime = glfwGetTime();
    double animationTime = 0.0;   // tempo da animação (pausável)
    double storyTime = 0.0;       // tempo de narrativa (escala STORY_SPEED)

    ////////////////////
    //  RENDER LOOP   //
    ////////////////////
    while (!glfwWindowShouldClose(window)) {
        double now = glfwGetTime();
        double dt = now - lastTime;
        lastTime = now;
        // Um quadro muito lento (ex.: GPU fraca) não pode pular a narrativa:
        // limita o passo de tempo a 0,1 s — a animação "espera" em vez de saltar
        double step = std::min(dt, 0.1);
        if (!animationPaused)
            animationTime += step;

        int w, h;
        glfwGetFramebufferSize(window, &w, &h);
        // Com a janela minimizada não há o que desenhar: espera o próximo frame
        if (w == 0 || h == 0 || glfwGetWindowAttrib(window, GLFW_ICONIFIED)) {
            glfwWaitEventsTimeout(0.1);
            continue;
        }
        resolution = glm::vec2(float(w), float(h));

        if (reloadRequested) {
            reloadRequested = false;
            GLuint reloaded = createShaderProgram("fullscreen.vert", "Image.frag");
            if (reloaded) {
                glDeleteProgram(imageProgram);
                imageProgram = reloaded;
                glUseProgram(imageProgram);
                setUniform(imageProgram, "iChannel0", 0);
                setUniform(imageProgram, "uRoomAspect", roomAspect);
                setUniform(imageProgram, "uLightDir", glm::normalize(glm::vec3(0.55f, 0.42f, -0.72f)));
                std::cout << "Shaders recarregados" << std::endl;
            } else {
                std::cout << "Falha ao recarregar shaders (mantendo os anteriores)" << std::endl;
            }
        }

        if (storyRestartRequested) {
            storyRestartRequested = false;
            storyTime = 0.0;
            storyPlaying = true;
        }
        if (storyPlaying && !animationPaused)
            storyTime += step * STORY_SPEED;

        // Uniforms da narrativa (valem defaults de modo livre quando a história acabou)
        StoryFrame story = evaluateStory(storyPlaying ? float(storyTime) : 0.0f);
        glm::vec3 camPos, camTarget;
        float yaw, pitch, distance;
        if (storyPlaying) {
            yaw = story.yaw; pitch = story.pitch; distance = story.distance;
            camTarget = camera.target;
            camPos = camTarget + distance * glm::vec3(std::sin(yaw) * std::cos(pitch),
                                                    std::sin(pitch),
                                                    std::cos(yaw) * std::cos(pitch));
            camPos += story.cameraShake;
        } else {
            if (autoOrbit && !animationPaused)
                camera.yaw += float(dt) * 0.25f;
            clampCameraAboveTerrain();
            camTarget = camera.target;
            camPos = camera.position();
            story.fracture = 0.0f;
            story.classroomTime = -1.0f;
            story.black = 0.0f;
            story.coreGlow = 1.0f;
            story.animationSpeed = 1.0f;
        }

        glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT);

        glUseProgram(imageProgram);
        glBindVertexArray(VAO);
        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, roomTexture);

        setUniform(imageProgram, "iResolution", resolution);
        setUniform(imageProgram, "iTime", float(animationTime));
        setUniform(imageProgram, "uTime", float(animationTime) * story.animationSpeed);
        setUniform(imageProgram, "uCamPos", camPos);
        setUniform(imageProgram, "uCamTarget", camTarget);
        setUniform(imageProgram, "uCoreGlow", story.coreGlow);
        setUniform(imageProgram, "uFracture", story.fracture);
        setUniform(imageProgram, "uRoomT", story.classroomTime);
        setUniform(imageProgram, "uBlack", story.black);
        setUniform(imageProgram, "uParticles", (storyPlaying ? story.particles : particlesEnabled) ? 1.0f : 0.0f);

        glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_INT, 0);

        // FPS no título da janela
        fpsFrames++;
        if (now - fpsTimer > 0.5) {
            char title[64];
            std::snprintf(title, sizeof(title), "The Anomaly - %.0f FPS", fpsFrames / (now - fpsTimer));
            glfwSetWindowTitle(window, title);
            fpsTimer = now;
            fpsFrames = 0;
        }

        glfwSwapBuffers(window);
        glfwPollEvents();
    }

    glDeleteVertexArrays(1, &VAO);
    glDeleteBuffers(1, &VBO);
    glDeleteBuffers(1, &EBO);
    glDeleteTextures(1, &roomTexture);
    glfwTerminate();
    return 0;
}

void framebuffer_size_callback(GLFWwindow*, int width, int height)
{
    glViewport(0, 0, width, height);
}
