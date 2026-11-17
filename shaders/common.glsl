// Biblioteca compartilhada: mesmas convenções da engine do professor -
// Superficie com material, operações CSG, transformações e primitivas SDF.
// Acrescentamos apenas o campo emissivo e os utilitários da nossa cena.

uniform float uTime;        // tempo do artefato (velocidade controlada pela narrativa)
uniform vec3 uDirLuz;     // direção que aponta PARA a estrela principal
uniform vec3 uPosCam;       // posição da câmera no mundo
uniform float uBrilhoNucleo;    // intensidade do núcleo (controlada pela narrativa)
uniform float uParticulas;   // quantidade de partículas orbitais (0 a 1)

#define PI 3.14159265359

struct Superficie {
    float d;
    vec3 cor;
    float Ka;
    float Kd;
    float Ks;
    vec3 em;   // emissivo (núcleo, gemas, aros do túnel)
    float mat; // material: 0 = genérico, 1 = chão (cor final resolvida na luz)
};

Superficie sup(float d, vec3 cor, float ka, float kd, float ks)
{
    Superficie s;
    s.d = d; s.cor = cor; s.Ka = ka; s.Kd = kd; s.Ks = ks; s.em = vec3(0.0);
    s.mat = 0.0;
    return s;
}

////////////////////
// TRANSFORMAÇÕES //
////////////////////

mat4 matTransl(vec3 t)
{
    return mat4(vec4(1., 0., 0., 0.),
                vec4(0., 1., 0., 0.),
                vec4(0., 0., 1., 0.),
                vec4(t.x, t.y, t.z, 1.));
}

mat4 rotX(in float angulo)
{
    float rad = radians(angulo);
    float c = cos(rad), s = sin(rad);
    return mat4(vec4(1.0, 0.0, 0.0, 0.0),
                vec4(0.0,   c,   s, 0.0),
                vec4(0.0,  -s,   c, 0.0),
                vec4(0.0, 0.0, 0.0, 1.0));
}

mat4 rotY(in float angulo)
{
    float rad = radians(angulo);
    float c = cos(rad), s = sin(rad);
    return mat4(vec4(  c, 0.0,  -s, 0.0),
                vec4(0.0, 1.0, 0.0, 0.0),
                vec4(  s, 0.0,   c, 0.0),
                vec4(0.0, 0.0, 0.0, 1.0));
}

mat4 rotZ(in float angulo)
{
    float rad = radians(angulo);
    float c = cos(rad), s = sin(rad);
    return mat4(vec4(  c,   s, 0.0, 0.0),
                vec4( -s,   c, 0.0, 0.0),
                vec4(0.0, 0.0, 1.0, 0.0),
                vec4(0.0, 0.0, 0.0, 1.0));
}

vec3 aplicarMatriz(vec3 p, mat4 m)
{
    return vec4(m * vec4(p, 1.)).xyz;
}

// Rotação 2D rápida (ângulo em radianos, sem mat4)
mat2 rot2D(float a)
{
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

////////////////////
// PRIMITIVAS SDF //
////////////////////

float distEsfera(vec3 p, vec3 ce, float r)
{
    return length(p - ce) - r;
}

float distToro(vec3 p, vec2 t)
{
    return length(vec2(length(p.xz) - t.x, p.y)) - t.y;
}

float distPlano(vec3 p, vec3 normal, float D)
{
    return dot(p, normal) - D;
}

float distCaixa(vec3 p, vec3 b)
{
    vec3 d = abs(p) - b;
    return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
}

float distCaixaArred(vec3 p, vec3 s, float r)
{
    vec3 d = abs(p) - (s - r);
    return length(max(d, 0.0)) - r + min(max(d.x, max(d.y, d.z)), 0.0);
}

float distElipsoide(in vec3 p, in vec3 r) // aproximada
{
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
}

///////////
//  CSG  //
///////////

Superficie uniao(Superficie s1, Superficie s2)
{
    return (s1.d <= s2.d) ? s1 : s2;
}

Superficie intersecao(Superficie s1, Superficie s2)
{
    return (s1.d <= s2.d) ? s2 : s1;
}

Superficie subtracao(Superficie s1, Superficie s2)
{
    Superficie R;
    if (s1.d <= -s2.d) {
        R = s2;
        R.d = -s2.d;
        return R;
    }
    return s1;
}

// Versões escalares: úteis dentro de uma peça que depois recebe um material só
float subtrair(float a, float b) { return max(a, -b); }

// União suave: emenda orgânica entre duas formas
float uniaoSuave(float a, float b, float k)
{
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

////////////////////
//  HASH / RUÍDO  //
////////////////////

float hash11(float n) { return fract(sin(n) * 43758.5453123); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash31(vec3 p)
{
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float ruido(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Versão 3D do ruído de valor (usada para deformar as rochas)
float ruido3(vec3 p)
{
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), u.x),
                   mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
               mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), u.x),
                   mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), u.x), u.y), u.z);
}

////////////////////
//  PALETA / LUZ  //
////////////////////

const vec3 ARTIFACT_CENTER = vec3(0.0, 2.6, 0.0);
const vec3 COR_SOL = vec3(1.0, 0.68, 0.60);
const vec3 CYAN = vec3(0.15, 0.95, 1.0);
const vec3 MAGENTA = vec3(1.0, 0.22, 0.70);

// O artefato flutua lentamente para cima e para baixo
vec3 centroArtefato()
{
    return ARTIFACT_CENTER + vec3(0.0, 0.12 * sin(uTime * 0.6), 0.0);
}

float pulsoNucleo()
{
    return 0.5 + 0.5 * sin(uTime * 1.8);
}

vec3 corNucleo()
{
    return mix(CYAN, MAGENTA, 0.15 + 0.15 * sin(uTime * 0.4)) * uBrilhoNucleo;
}

// Luz pontual emitida pelo núcleo do artefato
vec3 luzNucleo(vec3 p, vec3 n)
{
    vec3 paraNucleo = centroArtefato() - p;
    float dist = length(paraNucleo);
    float difusa = max(dot(n, paraNucleo / dist), 0.0);
    return corNucleo() * difusa * (1.0 + 1.5 * pulsoNucleo()) / (1.0 + 0.6 * dist * dist);
}

///////////
//  CÉU  //
///////////

vec3 corCeu(vec3 direcao)
{
    vec3 zenite = vec3(0.004, 0.004, 0.018);
    vec3 horizonte = vec3(0.13, 0.045, 0.17);
    vec3 cor = mix(horizonte, zenite, pow(clamp(direcao.y, 0.0, 1.0), 0.45));
    float qtdSol = max(dot(direcao, uDirLuz), 0.0);
    cor += vec3(0.45, 0.13, 0.16) * pow(qtdSol, 8.0) * 0.6;
    return cor;
}

// Estrelas por hash numa grade sobre a direção do raio
vec3 estrelas(vec3 direcao)
{
    vec3 grade = direcao * 300.0;
    vec3 celula = floor(grade);
    float h = hash31(celula);
    if (h < 0.993)
        return vec3(0.0);
    float dist = length(grade - celula - 0.5);
    float cintilar = 0.6 + 0.4 * sin(uTime * 2.0 + h * 400.0);
    float brilho = (1.0 - smoothstep(0.0, 0.5, dist)) * (h - 0.993) / 0.007;
    return vec3(0.85, 0.85, 1.0) * brilho * cintilar * 2.0 * smoothstep(0.0, 0.2, direcao.y);
}

// Retorna (tPerto, tLonge) da interseção raio-esfera, ou (-1, -1) se não houver
vec2 intersectaEsfera(vec3 ro, vec3 rd, float raio)
{
    float b = dot(ro, rd);
    float c = dot(ro, ro) - raio * raio;
    float h = b * b - c;
    if (h < 0.0)
        return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
}

const vec3 DIR_PLANETA = vec3(0.4099795, 0.239988, -0.879956);   // normalize(vec3(0.41,0.24,-0.88))
const vec3 NORMAL_ANEL = vec3(0.22965761, 0.91863042, 0.32152065); // normalize(vec3(0.25,1.0,0.35))

// Céu completo: gradiente, estrela, planeta gigante com anéis e estrelas
vec3 renderizarCeu(vec3 rd)
{
    vec3 cor = corCeu(rd);

    // Disco da estrela principal
    float qtdSol = dot(rd, uDirLuz);
    cor += COR_SOL * (smoothstep(0.9990, 0.9995, qtdSol) * 4.0 + pow(max(qtdSol, 0.0), 400.0) * 1.5);

    // Planeta gigante tratado como esfera muito distante
    vec3 centroPlaneta = DIR_PLANETA * 100.0;
    float raioPlaneta = 9.0;
    vec2 acertoPlaneta = intersectaEsfera(-centroPlaneta, rd, raioPlaneta);

    if (acertoPlaneta.x > 0.0) {
        vec3 n = normalize(rd * acertoPlaneta.x - centroPlaneta);
        float luz = max(dot(n, uDirLuz), 0.0);
        float latitude = dot(n, NORMAL_ANEL);
        float faixas = sin(latitude * 18.0 + 2.0 * sin(latitude * 5.0));
        vec3 superficie = mix(vec3(0.30, 0.15, 0.42), vec3(0.70, 0.38, 0.55), 0.5 + 0.5 * faixas);
        float borda = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        cor = superficie * (luz * 0.8 + 0.015) + vec3(0.6, 0.3, 0.8) * borda * (0.15 + luz);
    } else {
        cor += estrelas(rd);
    }

    float tAnel = dot(centroPlaneta, NORMAL_ANEL) / dot(rd, NORMAL_ANEL);
    if (tAnel > 0.0 && (acertoPlaneta.x < 0.0 || tAnel < acertoPlaneta.x)) {
        float distAnel2 = length(rd * tAnel - centroPlaneta) / raioPlaneta;
        if (distAnel2 > 1.35 && distAnel2 < 2.3) {
            float listras = 0.6 + 0.4 * sin(distAnel2 * 14.0);
            float esmaecer = smoothstep(1.35, 1.5, distAnel2) * (1.0 - smoothstep(2.1, 2.3, distAnel2));
            cor = mix(cor, vec3(0.60, 0.45, 0.62) * 0.4, 0.6 * listras * esmaecer);
        }
    }
    return cor;
}

//////////
//  FOG //
//////////

// Névoa exponencial quadrática, misturando na cor do céu na direção do raio
vec3 aplicarNevoa(vec3 cor, float dist, vec3 rayDir)
{
    float fog = 1.0 - exp(-pow(dist * 0.022, 2.0));
    return mix(cor, corCeu(rayDir), fog);
}

//////////////////
// TONE MAPPING //
//////////////////

// ACES aproximado (Narkowicz) + gama, aplicado no fim da composição
vec3 mapearTom(vec3 c)
{
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}
