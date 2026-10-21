#pragma once

#include <glm/glm.hpp>

// Linha do tempo da narrativa, em segundos. Basta mudar estes valores para
// ajustar a duração de cada etapa.
const float STORY_APPROACH_END = 12.0f;    // 1) a aproximação
const float STORY_ENCOUNTER_END = 24.0f;   // 2) o encontro
const float STORY_AWAKENING_END = 38.0f;   // 3) o despertar
const float STORY_FRACTURE_END = 50.0f;    // 4) a fratura (transição para a sala)
const float STORY_CUT_TO_BLACK = 58.0f;    // 5) a sala de aula, até o corte para preto
const float STORY_END = 60.0f;

// Multiplica a velocidade da narrativa inteira (2.0 = duas vezes mais rápida)
const float STORY_SPEED = 1.0f;

// Estado da cena em um instante da narrativa. Os valores padrão são os do modo livre.
struct StoryFrame {
    float yaw = 0.0f;
    float pitch = 0.0f;
    float distance = 0.0f;
    glm::vec3 cameraShake = glm::vec3(0.0f);
    float animationSpeed = 1.0f;   // velocidade das animações do artefato
    float coreGlow = 1.0f;         // intensidade da luz do núcleo
    float bloomBoost = 1.0f;       // multiplica o bloom e os god rays
    bool particles = true;
    float fracture = 0.0f;         // progresso da transição (0 a 1)
    float classroomTime = -1.0f;   // segundos desde que a sala apareceu (-1 = ainda não)
    float black = 0.0f;            // 1 = tela preta
};

StoryFrame evaluateStory(float t);
