// The Anomaly - versão completa sobre a engine de ray marching do professor.
//
// A estrutura segue a engine (Math3.cpp): um único quad em tela cheia e um
// fragment shader (Shaders/Image.frag) que calcula a cena inteira por ray
// marching - nenhuma geometria é rasterizada.

#include <glad/glad.h>
#include <GLFW/glfw3.h>
#include <glm/glm.hpp>

#include <algorithm>
#include <cstdio>
#include <iostream>
#include <string>

#include "shader.h"
#include "quadro.h"
#include "texture.h"

void callbackRedimensionar(GLFWwindow* janela, int width, int height);

const unsigned int LARGURA_JANELA = 1280;
const unsigned int ALTURA_JANELA = 720;

// Quad em tela cheia: os 2 triângulos só servem para disparar o fragment shader
float vertices[] = {
    1.0f,  1.0f, 0.0f,   1.0f, 1.0f, // top right
    1.0f, -1.0f, 0.0f,   1.0f, 0.0f, // bottom right
   -1.0f, -1.0f, 0.0f,   0.0f, 0.0f, // bottom left
   -1.0f,  1.0f, 0.0f,   0.0f, 1.0f  // top left
};

unsigned int indices[] = { 0, 1, 3, 1, 2, 3 };

// Câmera de órbita do modo livre (a narrativa controla a câmera sozinha)
struct CameraOrbita {
    glm::vec3 alvo = glm::vec3(0.0f, 2.4f, 0.0f);
    float angulo = 0.0f;
    float elevacao = 0.06f;
    float distancia = 7.5f;

    glm::vec3 posicao() const
    {
        return alvo + distancia * glm::vec3(std::sin(angulo) * std::cos(elevacao),
                                              std::sin(elevacao),
                                              std::cos(angulo) * std::cos(elevacao));
    }
};

// Foto revelada no fim da narrativa (pasta assets/ do projeto)
const char* IMAGEM_SALA = "sala-each.jpg";

static CameraOrbita cam;
static bool arrastando = false;
static bool primeiroArrasto = true;
static double mouseAntX = 0.0, mouseAntY = 0.0;
static bool pausada = false;
static bool orbitaAuto = false;
static bool recarregaPendente = false;
static bool particulasAtivas = true;
// A narrativa começa sozinha; durante ela a câmera é controlada pela linha do tempo
static bool historiaTocando = true;
static bool reiniciarHistoria = false;

static void callbackTeclas(GLFWwindow* janela, int tecla, int, int acao, int)
{
    if (acao != GLFW_PRESS)
        return;
    switch (tecla) {
    case GLFW_KEY_ESCAPE: glfwSetWindowShouldClose(janela, true); break;
    case GLFW_KEY_SPACE:  pausada = !pausada; break;
    case GLFW_KEY_N:      reiniciarHistoria = true; break;
    // M sai da narrativa para o modo livre; A e P só fazem sentido lá
    case GLFW_KEY_M:      if (historiaTocando) { historiaTocando = false; cam.distancia = 10.0f; } break;
    case GLFW_KEY_A:      if (!historiaTocando) orbitaAuto = !orbitaAuto; break;
    case GLFW_KEY_P:      if (!historiaTocando) particulasAtivas = !particulasAtivas; break;
    case GLFW_KEY_R:      if (!historiaTocando) cam = CameraOrbita(); break;
    case GLFW_KEY_F5:     recarregaPendente = true; break;
    }
}

static void callbackBotaoMouse(GLFWwindow*, int botao, int acao, int)
{
    if (historiaTocando)
        return;
    if (botao == GLFW_MOUSE_BUTTON_LEFT) {
        arrastando = (acao == GLFW_PRESS);
        primeiroArrasto = true;
    }
}

static void callbackCursor(GLFWwindow*, double x, double y)
{
    if (!arrastando || historiaTocando) {
        mouseAntX = x;
        mouseAntY = y;
        return;
    }
    if (primeiroArrasto) {
        primeiroArrasto = false;
        mouseAntX = x;
        mouseAntY = y;
        return;
    }
    cam.angulo -= float(x - mouseAntX) * 0.005f;
    cam.elevacao = glm::clamp(cam.elevacao + float(y - mouseAntY) * 0.005f, -1.2f, 1.2f);
    mouseAntX = x;
    mouseAntY = y;
}

static void callbackScroll(GLFWwindow*, double, double deslY)
{
    if (historiaTocando)
        return;
    cam.distancia = glm::clamp(cam.distancia - float(deslY) * 0.7f, 2.0f, 30.0f);
}

// Impede a câmera de mergulhar no terreno no modo livre (guarda-chuva aproximado)
static void prenderCamNoChao()
{
    float y = cam.alvo.y + cam.distancia * sin(cam.elevacao);
    if (y < 0.8f)
        cam.elevacao = std::asin(glm::clamp((0.8f - cam.alvo.y) / cam.distancia, -1.0f, 1.0f));
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

    GLFWwindow* janela = glfwCreateWindow(LARGURA_JANELA, ALTURA_JANELA, "The Anomaly", NULL, NULL);
    if (janela == NULL) {
        std::cout << "Failed to create GLFW janela" << std::endl;
        glfwTerminate();
        return -1;
    }
    glfwMakeContextCurrent(janela);
    glfwSetFramebufferSizeCallback(janela, callbackRedimensionar);
    glfwSetKeyCallback(janela, callbackTeclas);
    glfwSetMouseButtonCallback(janela, callbackBotaoMouse);
    glfwSetCursorPosCallback(janela, callbackCursor);
    glfwSetScrollCallback(janela, callbackScroll);

    if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress)) {
        std::cout << "Failed to initialize GLAD" << std::endl;
        return -1;
    }

    // criarProgramaShader resolve os nomes dentro de SHADER_DIR (shaders/)
    GLuint progImagem = criarProgramaShader("fullscreen.vert", "Image.frag");
    if (!progImagem)
        return -1;
    // Passe de apresentação: só estica a imagem pronta para a janela inteira
    GLuint progBlit = criarProgramaShader("fullscreen.vert", "blit.frag");
    if (!progBlit)
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
    float aspectoSala = 1.0f;
    GLuint texSala = carregarTextura(std::string(ASSET_DIR) + IMAGEM_SALA, aspectoSala);

    // A cena é 100% ray marching: cada pixel custa uma marcha inteira. Em GPUs
    // fracas isso fica lento, então marchamos numa textura menor e só esticamos
    // a imagem na janela (o passe final é 2D, não rasterização da cena).
    const float ESCALA_INTERNA = 0.75f;
    GLuint fboCena = 0, texCena = 0;
    glGenFramebuffers(1, &fboCena);
    glGenTextures(1, &texCena);
    int largInterna = 0, altInterna = 0;

    glm::vec2 resolucao(LARGURA_JANELA, ALTURA_JANELA);
    glUseProgram(progImagem);
    uniforme(progImagem, "iChannel0", 1);
    uniforme(progImagem, "uAspectoSala", aspectoSala);
    uniforme(progImagem, "uDirLuz", glm::normalize(glm::vec3(0.55f, 0.42f, -0.72f)));

    glUseProgram(progBlit);
    uniforme(progBlit, "uCena", 0);

    glActiveTexture(GL_TEXTURE1);
    glBindTexture(GL_TEXTURE_2D, texSala);

    glDisable(GL_CULL_FACE);   // o quad em tela cheia é desenhado dos dois lados

    double timerFps = glfwGetTime();
    int quadrosFps = 0;
    double tempoAnterior = glfwGetTime();
    double tempoAnim = 0.0;   // tempo da animação (pausável)
    double tempoHistoria = 0.0;       // tempo de narrativa (escala VELOCIDADE_HISTORIA)

    ////////////////////
    //  RENDER LOOP   //
    ////////////////////
    while (!glfwWindowShouldClose(janela)) {
        double agora = glfwGetTime();
        double dt = agora - tempoAnterior;
        tempoAnterior = agora;
        // Um quadro muito lento (ex.: GPU fraca) não pode pular a narrativa:
        // limita o passo de tempo a 0,1 s - a animação "espera" em vez de saltar
        double passo = std::min(dt, 0.1);
        if (!pausada)
            tempoAnim += passo;

        int w, h;
        glfwGetFramebufferSize(janela, &w, &h);
        // Com a janela minimizada não há o que desenhar: espera o próximo quadro
        if (w == 0 || h == 0 || glfwGetWindowAttrib(janela, GLFW_ICONIFIED)) {
            glfwWaitEventsTimeout(0.1);
            continue;
        }

        if (recarregaPendente) {
            recarregaPendente = false;
            GLuint recarregado = criarProgramaShader("fullscreen.vert", "Image.frag");
            if (recarregado) {
                glDeleteProgram(progImagem);
                progImagem = recarregado;
                glUseProgram(progImagem);
                uniforme(progImagem, "iChannel0", 1);
                uniforme(progImagem, "uAspectoSala", aspectoSala);
                uniforme(progImagem, "uDirLuz", glm::normalize(glm::vec3(0.55f, 0.42f, -0.72f)));
                std::cout << "Shaders recarregados" << std::endl;
            } else {
                std::cout << "Falha ao recarregar shaders (mantendo os anteriores)" << std::endl;
            }
        }

        if (reiniciarHistoria) {
            reiniciarHistoria = false;
            tempoHistoria = 0.0;
            historiaTocando = true;
        }
        if (historiaTocando && !pausada)
            tempoHistoria += passo * VELOCIDADE_HISTORIA;

        // Uniforms da narrativa (valem defaults de modo livre quando a história acabou)
        QuadroHistoria quadro = avaliarHistoria(historiaTocando ? float(tempoHistoria) : 0.0f);
        glm::vec3 posCam, alvoCam;
        float angulo, elevacao, distancia;
        if (historiaTocando) {
            angulo = quadro.angulo; elevacao = quadro.elevacao; distancia = quadro.distancia;
            alvoCam = cam.alvo;
            posCam = alvoCam + distancia * glm::vec3(std::sin(angulo) * std::cos(elevacao),
                                                    std::sin(elevacao),
                                                    std::cos(angulo) * std::cos(elevacao));
            posCam += quadro.tremorCamera;
        } else {
            if (orbitaAuto && !pausada)
                cam.angulo += float(dt) * 0.25f;
            prenderCamNoChao();
            alvoCam = cam.alvo;
            posCam = cam.posicao();
            quadro.fratura = 0.0f;
            quadro.tempoSala = -1.0f;
            quadro.preto = 0.0f;
            quadro.brilhoNucleo = 1.0f;
            quadro.velAnimacao = 1.0f;
        }

        // Textura interna em resolução reduzida (recriada se a janela mudar)
        int largFb, altFb;
        glfwGetFramebufferSize(janela, &largFb, &altFb);
        int rw = std::max(1, int(largFb * ESCALA_INTERNA));
        int rh = std::max(1, int(altFb * ESCALA_INTERNA));
        if (rw != largInterna || rh != altInterna) {
            largInterna = rw;
            altInterna = rh;
            resolucao = glm::vec2(float(largInterna), float(altInterna));
            glBindTexture(GL_TEXTURE_2D, texCena);
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB, largInterna, altInterna, 0, GL_RGB, GL_UNSIGNED_BYTE, nullptr);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            glBindFramebuffer(GL_FRAMEBUFFER, fboCena);
            glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texCena, 0);
        }

        // Passo 1: marcha a cena inteira na textura menor
        glBindFramebuffer(GL_FRAMEBUFFER, fboCena);
        glViewport(0, 0, largInterna, altInterna);
        glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT);

        glUseProgram(progImagem);
        glBindVertexArray(VAO);
        glActiveTexture(GL_TEXTURE1);
        glBindTexture(GL_TEXTURE_2D, texSala);

        uniforme(progImagem, "iResolution", resolucao);
        uniforme(progImagem, "iTime", float(tempoAnim));
        uniforme(progImagem, "uTime", float(tempoAnim) * quadro.velAnimacao);
        uniforme(progImagem, "uPosCam", posCam);
        uniforme(progImagem, "uAlvoCam", alvoCam);
        uniforme(progImagem, "uBrilhoNucleo", quadro.brilhoNucleo);
        uniforme(progImagem, "uFratura", quadro.fratura);
        uniforme(progImagem, "uTempoSala", quadro.tempoSala);
        uniforme(progImagem, "uPreto", quadro.preto);
        uniforme(progImagem, "uParticulas", (historiaTocando ? quadro.particulas : particulasAtivas) ? 1.0f : 0.0f);

        glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_INT, 0);

        // Passo 2: estica a imagem para o tamanho real da janela
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        glViewport(0, 0, largFb, altFb);
        glUseProgram(progBlit);
        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, texCena);
        glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_INT, 0);

        // FPS no título da janela
        quadrosFps++;
        if (agora - timerFps > 0.5) {
            char titulo[64];
            std::snprintf(titulo, sizeof(titulo), "The Anomaly - %.0f FPS", quadrosFps / (agora - timerFps));
            glfwSetWindowTitle(janela, titulo);
            timerFps = agora;
            quadrosFps = 0;
        }

        glfwSwapBuffers(janela);
        glfwPollEvents();
    }

    glDeleteVertexArrays(1, &VAO);
    glDeleteBuffers(1, &VBO);
    glDeleteBuffers(1, &EBO);
    glDeleteTextures(1, &texSala);
    glfwTerminate();
    return 0;
}

void callbackRedimensionar(GLFWwindow*, int width, int height)
{
    glViewport(0, 0, width, height);
}
