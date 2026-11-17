// A escultura central como uma única Surface CSG: núcleo + espinho, casca com
// furos, três anéis e gemas - tudo por fórmulas de distância.
// Depende de common.glsl (Surface, primitivas, rotações).

float distAnel(vec3 p, float raio, vec2 meioTamanho)
{
    vec2 d = vec2(length(p.xz) - raio, abs(p.y)) - meioTamanho;
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

Surface supEscultura(vec3 p)
{
    p -= centroArtefato();
    p.xz *= rotate2D(uTime * 0.08);

    // Núcleo orgânico: esfera deformada por senos que "respiram" + espinho torcido
    vec3 c = p - vec3(0.06, 0.02, -0.04);
    float ondulacao = sin(4.0 * c.x + uTime * 1.3) * sin(4.0 * c.y + uTime * 0.9) * sin(4.0 * c.z - uTime * 1.1);
    float nucleo = sphereDist(c, vec3(0.0), 0.40 + 0.03 * pulsoNucleo()) + 0.05 * ondulacao;

    vec3 s = p;
    s.xy *= rotate2D(0.18);
    s.y -= 0.15;
    s.xz *= rotate2D(s.y * 1.6 + uTime * 0.2);
    float afinamento = 1.0 - clamp(abs(s.y) / 1.75, 0.0, 1.0);
    float espinho = boxDist(s, vec3(0.13 * afinamento + 0.004, 1.75, 0.13 * afinamento + 0.004));

    float corpo = opSmoothUnion(nucleo, espinho, 0.22);
    Surface bodyS = surf(corpo, vec3(0.0), 0.15, 0.3, 0.9);
    // Núcleo e espinho são emissivos: veias ciano/magenta pulsando
    bodyS.em = (nucleo < espinho)
        ? mix(CYAN, MAGENTA, 0.6 * (0.5 + 0.5 * sin(12.0 * c.x + 9.0 * c.y - 7.0 * c.z + uTime * 2.0)))
          * (0.5 + 0.7 * pulsoNucleo()) * uBrilhoNucleo
        : corNucleo() * 0.35;

    // Casca esférica cortada por uma faixa e por furos (subtração CSG)
    vec3 h = p;
    h.yz *= rotate2D(0.5);
    h.xy *= rotate2D(-0.3);
    float casca = abs(sphereDist(h, vec3(0.0), 0.82)) - 0.035;
    casca = opSub(casca, abs(h.y) - 0.30);
    casca = opSub(casca, sphereDist(h, vec3( 0.55,  0.55,  0.20), 0.28));
    casca = opSub(casca, sphereDist(h, vec3(-0.30, -0.60,  0.50), 0.22));
    casca = opSub(casca, sphereDist(h, vec3(-0.20,  0.70, -0.50), 0.18));
    casca = opSub(casca, sphereDist(h, vec3( 0.40, -0.50, -0.55), 0.25));
    Surface shellS = surf(casca, vec3(0.16, 0.10, 0.24), 0.25, 0.7, 0.8);

    // Dois anéis que se cruzam, oscilando em eixos diferentes
    vec3 a = p;
    a.xz *= rotate2D(uTime * 0.25);
    a.xy *= rotate2D(1.15);
    float ringA = torusDist(a, vec2(1.2, 0.045));

    vec3 b = p;
    b.yz *= rotate2D(0.6 - uTime * 0.4);
    float ringB = torusDist(b, vec2(1.1, 0.035));
    Surface aneisS = surf(min(ringA, ringB), vec3(0.35, 0.28, 0.45), 0.15, 0.5, 1.0);

    // Gemas incrustadas no anel A (emissivas)
    float gemas = min(sphereDist(a, vec3( 1.2,  0.0,  0.0 ), 0.11),
                     sphereDist(a, vec3(-0.85, 0.0,  0.85), 0.08));
    Surface gemsS = surf(gemas, vec3(0.0), 0.0, 0.0, 0.0);
    gemsS.em = MAGENTA * (1.5 + pulsoNucleo()) * uBrilhoNucleo;

    // Anel externo achatado com 9 cortes regulares (repetição polar)
    vec3 r = p;
    r.xy *= rotate2D(0.22);
    r.xz *= rotate2D(-uTime * 0.15);
    float ringC = distAnel(r, 1.55, vec2(0.09, 0.012));
    float setor = 6.2831853 / 9.0;
    float angulo = mod(atan(r.z, r.x) + 0.5 * setor, setor) - 0.5 * setor;
    vec3 rp = vec3(length(r.xz) * cos(angulo), r.y, length(r.xz) * sin(angulo));
    ringC = opSub(ringC, boxDist(rp - vec3(1.55, 0.0, 0.0), vec3(0.12, 0.05, 0.07)));
    Surface ringCS = surf(ringC, vec3(0.20, 0.14, 0.30), 0.25, 0.7, 0.8);

    Surface resultado = bodyS;
    resultado = unionS(resultado, shellS);
    resultado = unionS(resultado, aneisS);
    resultado = unionS(resultado, ringCS);
    resultado = unionS(resultado, gemsS);
    return resultado;
}
