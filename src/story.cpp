#include "story.h"

#include <cmath>

// Progresso de 0 a 1 dentro do intervalo [start, end], com easing (smoothstep):
// começa e termina devagar, o que deixa os movimentos suaves
static float stageProgress(float t, float start, float end)
{
    float x = glm::clamp((t - start) / (end - start), 0.0f, 1.0f);
    return x * x * (3.0f - 2.0f * x);
}

StoryFrame evaluateStory(float t)
{
    float approach = stageProgress(t, 0.0f, STORY_APPROACH_END);
    float encounter = stageProgress(t, STORY_APPROACH_END, STORY_ENCOUNTER_END);
    float awakening = stageProgress(t, STORY_ENCOUNTER_END, STORY_AWAKENING_END);
    float fracture = stageProgress(t, STORY_AWAKENING_END, STORY_FRACTURE_END);

    StoryFrame frame;

    // Câmera: começa longe e alta e desce até o artefato. A aproximação usa um único
    // intervalo das etapas 1 a 3, para o movimento não parar na troca de etapa.
    // Na fratura ela avança para dentro do artefato.
    float dolly = stageProgress(t, 0.0f, STORY_AWAKENING_END);
    // Na fratura a câmera é "puxada aos solavancos" e engolida pelo artefato
    // (distância chega a ~0.4, dentro da casca) antes de virar o túnel
    frame.distance = glm::mix(22.0f, 5.5f, dolly) - 5.1f * fracture - 0.4f * fracture * pow(abs(std::sin(t * 2.3f)), 4.0f);
    frame.pitch = glm::mix(0.35f, 0.03f, dolly);
    frame.yaw = 0.7f * (1.0f - approach) + 0.3f * encounter + 1.4f * awakening + 0.6f * fracture;

    // Tremor controlado da câmera no despertar, que some no fim da fratura
    float shake = (0.05f * awakening + 0.15f * fracture) * (1.0f - stageProgress(t, STORY_FRACTURE_END - 2.0f, STORY_FRACTURE_END));
    frame.cameraShake = shake * glm::vec3(std::sin(t * 21.0f), std::sin(t * 27.0f + 1.3f), std::sin(t * 17.0f + 2.1f));

    // O artefato quase parado no início, depois desperta e acelera
    frame.animationSpeed = 0.08f + 0.92f * encounter + 3.0f * awakening;
    frame.coreGlow = 0.5f + 1.0f * encounter + 2.5f * awakening + 2.0f * fracture;
    frame.bloomBoost = 1.0f + 1.5f * awakening;
    frame.particles = t >= STORY_ENCOUNTER_END + 2.0f;

    // Sem easing aqui: o shader já suaviza cada fragmento, e assim a ruptura usa os 12 s
    frame.fracture = glm::clamp((t - STORY_AWAKENING_END) / (STORY_FRACTURE_END - STORY_AWAKENING_END), 0.0f, 1.0f);
    frame.classroomTime = t >= STORY_FRACTURE_END ? t - STORY_FRACTURE_END : -1.0f;
    frame.black = t >= STORY_CUT_TO_BLACK ? 1.0f : 0.0f;
    return frame;
}
