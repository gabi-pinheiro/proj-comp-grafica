#pragma once

#include <glm/glm.hpp>

// Linha do tempo da narrativa, em segundos. Basta mudar estes valores para
// ajustar a duração de cada etapa.
const float FIM_APROXIMACAO = 12.0f;    // 1) a aproximação
const float FIM_ENCONTRO = 24.0f;   // 2) o encontro
const float FIM_DESPERTAR = 38.0f;   // 3) o despertar
const float FIM_FRATURA = 86.0f;    // 4) a fratura; a segunda metade dela é o túnel (~10 s)
const float CORTE_PARA_PRETO = 94.0f;    // 5) a sala de aula, até o corte para preto
const float FIM_HISTORIA = 96.0f;

// Multiplica a velocidade da narrativa inteira (2.0 = duas vezes mais rápida).
// Os tempos acima são em "segundos de narrativa": com 2.15, a história inteira
// (96 s de narrativa) leva ~45 segundos reais, com ~10 s dentro do túnel.
const float VELOCIDADE_HISTORIA = 2.15f;

// Estado da cena em um instante da narrativa. Os valores padrão são os do modo livre.
struct QuadroHistoria {
    float angulo = 0.0f;
    float elevacao = 0.0f;
    float distancia = 0.0f;
    glm::vec3 tremorCamera = glm::vec3(0.0f);
    float velAnimacao = 1.0f;   // velocidade das animações do artefato
    float brilhoNucleo = 1.0f;         // intensidade da luz do núcleo
    float impulsoBloom = 1.0f;       // multiplica o bloom e os god rays
    bool particulas = true;
    float fratura = 0.0f;         // progresso da transição (0 a 1)
    float tempoSala = -1.0f;   // segundos desde que a sala apareceu (-1 = ainda não)
    float preto = 0.0f;            // 1 = tela preta
};

QuadroHistoria avaliarHistoria(float t);
