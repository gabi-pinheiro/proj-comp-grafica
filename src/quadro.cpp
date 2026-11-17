#include "quadro.h"

#include <cmath>

// Progresso de 0 a 1 dentro do intervalo [inicio, fim], com easing (smoothstep):
// começa e termina devagar, o que deixa os movimentos suaves
static float progressoEtapa(float t, float inicio, float fim)
{
    float x = glm::clamp((t - inicio) / (fim - inicio), 0.0f, 1.0f);
    return x * x * (3.0f - 2.0f * x);
}

QuadroHistoria avaliarHistoria(float t)
{
    float aproximacao = progressoEtapa(t, 0.0f, FIM_APROXIMACAO);
    float encontro = progressoEtapa(t, FIM_APROXIMACAO, FIM_ENCONTRO);
    float despertar = progressoEtapa(t, FIM_ENCONTRO, FIM_DESPERTAR);
    float fratura = progressoEtapa(t, FIM_DESPERTAR, FIM_FRATURA);

    QuadroHistoria quadro;

    // Câmera: começa longe e alta e desce até o artefato. A aproximação usa um único
    // intervalo das etapas 1 a 3, para o movimento não parar na troca de etapa.
    // Na fratura ela avança para dentro do artefato.
    float avanco = progressoEtapa(t, 0.0f, FIM_DESPERTAR);
    // Na fratura a câmera é "puxada aos solavancos" e engolida pelo artefato:
    // a distância chega a ~0.1, bem dentro do núcleo (raio ~0.4), antes do túnel
    quadro.distancia = glm::mix(22.0f, 5.5f, avanco) - 5.45f * fratura - 0.2f * fratura * pow(abs(std::sin(t * 2.3f)), 4.0f);
    quadro.elevacao = glm::mix(0.35f, 0.03f, avanco);
    quadro.angulo = 0.7f * (1.0f - aproximacao) + 0.3f * encontro + 1.4f * despertar + 0.6f * fratura;

    // Tremor controlado da câmera no despertar, que some no fim da fratura
    float tremor = (0.05f * despertar + 0.15f * fratura) * (1.0f - progressoEtapa(t, FIM_FRATURA - 2.0f, FIM_FRATURA));
    quadro.tremorCamera = tremor * glm::vec3(std::sin(t * 21.0f), std::sin(t * 27.0f + 1.3f), std::sin(t * 17.0f + 2.1f));

    // O artefato quase parado no início, depois desperta e acelera
    quadro.velAnimacao = 0.08f + 0.92f * encontro + 3.0f * despertar;
    // O núcleo brilha forte no fim da fratura, engolindo a tela quando a câmera entra nele
    quadro.brilhoNucleo = 0.5f + 1.0f * encontro + 2.5f * despertar + 3.0f * fratura;
    quadro.impulsoBloom = 1.0f + 1.5f * despertar;
    quadro.particulas = t >= FIM_ENCONTRO + 2.0f;

    // Sem easing aqui: o shader já suaviza cada fragmento, e assim a ruptura usa os 12 s
    quadro.fratura = glm::clamp((t - FIM_DESPERTAR) / (FIM_FRATURA - FIM_DESPERTAR), 0.0f, 1.0f);
    quadro.tempoSala = t >= FIM_FRATURA ? t - FIM_FRATURA : -1.0f;
    quadro.preto = t >= CORTE_PARA_PRETO ? 1.0f : 0.0f;
    return quadro;
}
