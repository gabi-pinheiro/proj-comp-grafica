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

#include "framebuffer.h"
#include "geometry.h"
#include "shader.h"
#include "story.h"
#include "texture.h"

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
    GLuint particles = 0;
    GLuint shadow = 0;
    GLuint bright = 0;
    GLuint blur = 0;
    GLuint godRays = 0;
    GLuint composite = 0;
};

// Alvos do pós-processamento: a cena em HDR na resolução da janela e os demais em 1/4
struct PostTargets {
    RenderTarget scene;
    RenderTarget bright;
    RenderTarget blurA;
    RenderTarget blurB;
    RenderTarget rays;
};

const int SHADOW_MAP_SIZE = 2048;
const int PARTICLE_COUNT = 800;
const int BLUR_ITERATIONS = 3;

// Foto revelada no fim da narrativa (pasta assets/ do projeto)
const char* CLASSROOM_IMAGE = "sala-each.jpg";

static OrbitCamera camera;
static bool isDragging = false;
static double lastMouseX = 0.0, lastMouseY = 0.0;
static bool animationPaused = false;
static bool autoOrbit = false;
static bool reloadRequested = false;
static bool bloomEnabled = true;
static bool godRaysEnabled = true;
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
    case GLFW_KEY_SPACE: animationPaused = !animationPaused; break;
    case GLFW_KEY_A: autoOrbit = !autoOrbit; break;
    case GLFW_KEY_R: camera = OrbitCamera(); break;
    case GLFW_KEY_F5: reloadRequested = true; break;
    case GLFW_KEY_B: bloomEnabled = !bloomEnabled; break;
    case GLFW_KEY_G: godRaysEnabled = !godRaysEnabled; break;
    case GLFW_KEY_P: particlesEnabled = !particlesEnabled; break;
    case GLFW_KEY_N: storyRestartRequested = true; break;
    case GLFW_KEY_M:
        // Sai da narrativa e volta para a exploração livre
        storyPlaying = false;
        particlesEnabled = true;
        camera = OrbitCamera();
        break;
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
    if (!isDragging || storyPlaying)
        return;

    camera.yaw -= (float)(x - lastMouseX) * 0.005f;
    camera.pitch += (float)(y - lastMouseY) * 0.005f;
    camera.pitch = glm::clamp(camera.pitch, -0.08f, 1.2f);
    lastMouseX = x;
    lastMouseY = y;
}

static void scrollCallback(GLFWwindow*, double, double offsetY)
{
    if (storyPlaying)
        return;
    camera.distance = glm::clamp(camera.distance - (float)offsetY * 0.5f, 4.0f, 25.0f);
}

static void deletePrograms(Programs& programs)
{
    for (GLuint program : { programs.sky, programs.scene, programs.sculpture, programs.particles, programs.shadow,
                            programs.bright, programs.blur, programs.godRays, programs.composite })
        glDeleteProgram(program);
    programs = Programs();
}

static bool loadPrograms(Programs& programs)
{
    Programs loaded;
    loaded.sky = createShaderProgram("fullscreen.vert", "sky.frag");
    loaded.scene = createShaderProgram("scene.vert", "scene.frag");
    loaded.sculpture = createShaderProgram("fullscreen.vert", "sculpture.frag");
    loaded.particles = createShaderProgram("particles.vert", "particles.frag");
    loaded.shadow = createShaderProgram("shadow.vert", "shadow.frag");
    loaded.bright = createShaderProgram("fullscreen.vert", "bright.frag");
    loaded.blur = createShaderProgram("fullscreen.vert", "blur.frag");
    loaded.godRays = createShaderProgram("fullscreen.vert", "godrays.frag");
    loaded.composite = createShaderProgram("fullscreen.vert", "composite.frag");

    if (!loaded.sky || !loaded.scene || !loaded.sculpture || !loaded.particles || !loaded.shadow ||
        !loaded.bright || !loaded.blur || !loaded.godRays || !loaded.composite) {
        deletePrograms(loaded);
        return false;
    }

    deletePrograms(programs);
    programs = loaded;
    return true;
}

static PostTargets createPostTargets(int width, int height)
{
    int smallWidth = std::max(width / 4, 1);
    int smallHeight = std::max(height / 4, 1);

    PostTargets targets;
    targets.scene = createColorTarget(width, height, true);
    targets.bright = createColorTarget(smallWidth, smallHeight, false);
    targets.blurA = createColorTarget(smallWidth, smallHeight, false);
    targets.blurB = createColorTarget(smallWidth, smallHeight, false);
    targets.rays = createColorTarget(smallWidth, smallHeight, false);
    return targets;
}

static void deletePostTargets(PostTargets& targets)
{
    deleteRenderTarget(targets.scene);
    deleteRenderTarget(targets.bright);
    deleteRenderTarget(targets.blurA);
    deleteRenderTarget(targets.blurB);
    deleteRenderTarget(targets.rays);
}

static void bindTarget(const RenderTarget& target)
{
    glBindFramebuffer(GL_FRAMEBUFFER, target.fbo);
    glViewport(0, 0, target.width, target.height);
}

static void bindTexture(int unit, GLuint texture)
{
    glActiveTexture(GL_TEXTURE0 + unit);
    glBindTexture(GL_TEXTURE_2D, texture);
}

// Posição de um ponto na tela (0 a 1). visible fica 0 se o ponto estiver atrás da câmera.
static glm::vec2 toScreen(const glm::mat4& viewProj, const glm::vec3& point, float& visible)
{
    glm::vec4 clip = viewProj * glm::vec4(point, 1.0f);
    visible = clip.w > 0.0f ? 1.0f : 0.0f;
    if (clip.w <= 0.0f)
        return glm::vec2(0.5f);
    return glm::vec2(clip) / clip.w * 0.5f + 0.5f;
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

    float classroomAspect;
    GLuint classroomTexture = loadTexture(std::string(ASSET_DIR) + CLASSROOM_IMAGE, classroomAspect);
    std::cout << "Narrativa: N reinicia, M sai para o modo livre\n";

    Mesh terrain = createTerrainMesh(200.0f, 220);
    std::vector<Mesh> rockMeshes = { createRockMesh(1), createRockMesh(2), createRockMesh(3) };
    std::vector<SceneObject> rocks = createRocks(rockMeshes);

    // VAO vazio para os passes de tela cheia e para as partículas (os vértices são gerados no shader)
    GLuint emptyVao;
    glGenVertexArrays(1, &emptyVao);

    const glm::vec3 lightDir = glm::normalize(glm::vec3(-0.84f, 0.26f, -0.48f));
    const glm::vec3 terrainColor(0.13f, 0.09f, 0.17f);

    // Câmera ortográfica da luz principal, cobrindo a região em volta da cratera.
    // A luz, o terreno e as rochas não se movem, então o shadow map só precisa ser
    // gerado de novo quando os shaders são recarregados.
    const glm::mat4 lightView = glm::lookAt(lightDir * 120.0f, glm::vec3(0.0f), glm::vec3(0.0f, 1.0f, 0.0f));
    const glm::mat4 lightProjection = glm::ortho(-45.0f, 45.0f, -45.0f, 45.0f, 1.0f, 250.0f);
    const glm::mat4 lightViewProj = lightProjection * lightView;
    RenderTarget shadowMap = createShadowTarget(SHADOW_MAP_SIZE);
    bool shadowMapDirty = true;

    PostTargets post;
    float animationTime = 0.0f;
    float particleSpread = 0.0f;
    float storyTime = 0.0f;
    double lastFrameTime = glfwGetTime();
    double fpsTimer = lastFrameTime;
    int frameCount = 0;

    while (!glfwWindowShouldClose(window)) {
        double now = glfwGetTime();
        float deltaTime = (float)(now - lastFrameTime);
        lastFrameTime = now;

        if (storyRestartRequested) {
            storyRestartRequested = false;
            storyPlaying = true;
            storyTime = 0.0f;
            animationTime = 0.0f;
            particleSpread = 0.0f;
        }

        // Narrativa: a linha do tempo define a câmera, a velocidade das animações e os efeitos.
        // No fim ela fica parada no último estado (tela preta) até N ou M.
        StoryFrame story;
        if (storyPlaying) {
            if (!animationPaused)
                storyTime = std::min(storyTime + deltaTime * STORY_SPEED, STORY_END);
            story = evaluateStory(storyTime);
            camera.yaw = story.yaw;
            camera.pitch = story.pitch;
            camera.distance = story.distance;
            particlesEnabled = story.particles;
        }

        if (!animationPaused)
            animationTime += deltaTime * story.animationSpeed;

        // Transição das partículas (2 segundos) entre o núcleo (0) e as órbitas (1)
        float spreadSpeed = deltaTime / 2.0f;
        particleSpread += particlesEnabled ? spreadSpeed : -spreadSpeed;
        particleSpread = glm::clamp(particleSpread, 0.0f, 1.0f);
        if (autoOrbit && !storyPlaying)
            camera.yaw += deltaTime * 0.08f;

        if (reloadRequested) {
            reloadRequested = false;
            bool reloaded = loadPrograms(programs);
            shadowMapDirty = shadowMapDirty || reloaded;
            std::cout << (reloaded ? "Shaders recarregados\n" : "Mantendo os shaders anteriores\n");
        }

        int width, height;
        glfwGetFramebufferSize(window, &width, &height);
        if (width == 0 || height == 0 || glfwGetWindowAttrib(window, GLFW_ICONIFIED)) {
            // Janela minimizada: espera um evento em vez de repetir o laço sem parar
            glfwWaitEvents();
            continue;
        }
        if (width != post.scene.width || height != post.scene.height) {
            deletePostTargets(post);
            post = createPostTargets(width, height);
        }

        // 0) Shadow map: profundidade do terreno e das rochas vista pela luz
        if (shadowMapDirty) {
            shadowMapDirty = false;
            bindTarget(shadowMap);
            glClear(GL_DEPTH_BUFFER_BIT);
            glEnable(GL_DEPTH_TEST);
            glDepthMask(GL_TRUE);
            // Desloca a profundidade para evitar "acne" (sombra da superfície sobre ela mesma)
            glEnable(GL_POLYGON_OFFSET_FILL);
            glPolygonOffset(2.0f, 4.0f);
            glUseProgram(programs.shadow);
            setUniform(programs.shadow, "uLightViewProj", lightViewProj);
            setUniform(programs.shadow, "uModel", glm::mat4(1.0f));
            drawMesh(terrain);
            for (const SceneObject& rock : rocks) {
                setUniform(programs.shadow, "uModel", rock.model);
                drawMesh(*rock.mesh);
            }
            glDisable(GL_POLYGON_OFFSET_FILL);
        }

        glm::vec3 cameraPos = camera.position() + story.cameraShake;
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
            setUniform(program, "uCoreGlow", story.coreGlow);
        };

        // A cena é desenhada em uma textura HDR, que guarda brilhos acima de 1
        bindTarget(post.scene);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

        // 1) Céu: triângulo de tela cheia, sem depth
        glDisable(GL_DEPTH_TEST);
        glDepthMask(GL_FALSE);
        setCommonUniforms(programs.sky);
        glBindVertexArray(emptyVao);
        glDrawArrays(GL_TRIANGLES, 0, 3);

        // 2) Terreno e rochas: geometria convencional
        glEnable(GL_DEPTH_TEST);
        glDepthMask(GL_TRUE);
        setCommonUniforms(programs.scene);
        setUniform(programs.scene, "uLightViewProj", lightViewProj);
        setUniform(programs.scene, "uShadowMap", 0);
        bindTexture(0, shadowMap.texture);

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

        // 3) Partículas orbitais: uma instância por partícula, somadas à cena (blending aditivo).
        //    Elas escrevem profundidade para que a escultura, desenhada depois, as esconda corretamente.
        glEnable(GL_BLEND);
        glBlendFunc(GL_ONE, GL_ONE);
        if (particleSpread > 0.0f) {
            setCommonUniforms(programs.particles);
            setUniform(programs.particles, "uCameraRight", glm::vec3(view[0][0], view[1][0], view[2][0]));
            setUniform(programs.particles, "uCameraUp", glm::vec3(view[0][1], view[1][1], view[2][1]));
            setUniform(programs.particles, "uParticleCount", PARTICLE_COUNT);
            setUniform(programs.particles, "uSpread", particleSpread);
            glBindVertexArray(emptyVao);
            glDrawArraysInstanced(GL_TRIANGLES, 0, 6, PARTICLE_COUNT);
        }

        // 4) Escultura por ray marching. O shader escreve gl_FragDepth para se
        //    misturar corretamente com o terreno, as rochas e as partículas.
        glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
        setCommonUniforms(programs.sculpture);
        glBindVertexArray(emptyVao);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        glDisable(GL_BLEND);

        // Pós-processamento: todos os passes são triângulos de tela cheia, sem depth
        glDisable(GL_DEPTH_TEST);

        // 5) Partes brilhantes da cena, em 1/4 da resolução
        bindTarget(post.bright);
        glUseProgram(programs.bright);
        setUniform(programs.bright, "uScene", 0);
        bindTexture(0, post.scene.texture);
        glDrawArrays(GL_TRIANGLES, 0, 3);

        // 6) God rays a partir do núcleo e da estrela principal
        // Mesma fórmula de artifactCenter() em common.glsl
        glm::vec3 coreCenter(0.0f, 2.6f + 0.12f * std::sin(animationTime * 0.6f), 0.0f);
        float coreVisible, sunVisible;
        glm::vec2 coreScreen = toScreen(viewProj, coreCenter, coreVisible);
        glm::vec2 sunScreen = toScreen(viewProj, cameraPos + lightDir * 200.0f, sunVisible);

        bindTarget(post.rays);
        glUseProgram(programs.godRays);
        setUniform(programs.godRays, "uBright", 0);
        setUniform(programs.godRays, "uCoreScreen", coreScreen);
        setUniform(programs.godRays, "uCoreRays", coreVisible);
        setUniform(programs.godRays, "uSunScreen", sunScreen);
        setUniform(programs.godRays, "uSunRays", sunVisible);
        bindTexture(0, post.bright.texture);
        glDrawArrays(GL_TRIANGLES, 0, 3);

        // 7) Bloom: desfoque gaussiano separável, alternando entre dois framebuffers
        glUseProgram(programs.blur);
        setUniform(programs.blur, "uImage", 0);
        GLuint source = post.bright.texture;
        for (int i = 0; i < BLUR_ITERATIONS; i++) {
            bindTarget(post.blurA);
            setUniform(programs.blur, "uDirection", glm::vec2(1.0f, 0.0f));
            bindTexture(0, source);
            glDrawArrays(GL_TRIANGLES, 0, 3);

            bindTarget(post.blurB);
            setUniform(programs.blur, "uDirection", glm::vec2(0.0f, 1.0f));
            bindTexture(0, post.blurA.texture);
            glDrawArrays(GL_TRIANGLES, 0, 3);
            source = post.blurB.texture;
        }

        // 8) Composição final na tela: cena + bloom + god rays, com tone mapping,
        //    e a transição para a sala de aula no fim da narrativa
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        glViewport(0, 0, width, height);
        glUseProgram(programs.composite);
        setUniform(programs.composite, "uScene", 0);
        setUniform(programs.composite, "uBloom", 1);
        setUniform(programs.composite, "uRays", 2);
        setUniform(programs.composite, "uClassroom", 3);
        setUniform(programs.composite, "uBloomStrength", bloomEnabled ? 0.8f * story.bloomBoost : 0.0f);
        setUniform(programs.composite, "uRaysStrength", godRaysEnabled ? 0.6f * story.bloomBoost : 0.0f);
        setUniform(programs.composite, "uClassroomAspect", classroomAspect);
        setUniform(programs.composite, "uFracture", story.fracture);
        setUniform(programs.composite, "uClassroomTime", story.classroomTime);
        setUniform(programs.composite, "uBlack", story.black);
        bindTexture(0, post.scene.texture);
        bindTexture(1, post.blurB.texture);
        bindTexture(2, post.rays.texture);
        bindTexture(3, classroomTexture);
        glDrawArrays(GL_TRIANGLES, 0, 3);

        glfwSwapBuffers(window);
        glfwPollEvents();

        frameCount++;
        if (now - fpsTimer >= 0.5) {
            char title[96];
            if (storyPlaying)
                std::snprintf(title, sizeof(title), "The Anomaly | %.1f FPS | narrativa %.0f s", frameCount / (now - fpsTimer), storyTime);
            else
                std::snprintf(title, sizeof(title), "The Anomaly | %.1f FPS", frameCount / (now - fpsTimer));
            glfwSetWindowTitle(window, title);
            frameCount = 0;
            fpsTimer = now;
        }
    }

    deleteMesh(terrain);
    for (Mesh& mesh : rockMeshes)
        deleteMesh(mesh);
    glDeleteVertexArrays(1, &emptyVao);
    glDeleteTextures(1, &classroomTexture);
    deleteRenderTarget(shadowMap);
    deletePostTargets(post);
    deletePrograms(programs);
    glfwTerminate();
    return 0;
}
