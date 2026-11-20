// 2. OUTILS MATHÉMATIQUES : GÉNÉRATEUR ALÉATOIRE (PRNG) & BRUIT FRACTAL (fBm)
// ============================================================================

/**
 * Générateur pseudo-aléatoire déterministe (algorithme Mulberry32).
 * Permet d'obtenir exactement la même carte à partir d'un même numéro de seed.
 */
function createRNG(seed) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Bruit de valeur 2D (Value Noise) avec interpolation cubique Hermite (smoothstep).
 * Génère une grille de valeurs aléatoires lissées continûment dans l'espace.
 */
function createNoise(seed) {
    const r = createRNG(seed);
    const p = new Float32Array(65536);
    for (let i = 0; i < p.length; i++) p[i] = r();

    // Lecture torique dans la table de permutation 256x256
    const valAt = (x, y) => p[((y & 255) << 8) | (x & 255)];

    return (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        const fx = x - xi, fy = y - yi;
        // Courbe en S (3t² - 2t³) pour éviter les artefacts anguleux aux bords de cellules
        const u = fx * fx * (3 - 2 * fx);
        const w = fy * fy * (3 - 2 * fy);
        return (valAt(xi, yi) * (1 - u) + valAt(xi + 1, yi) * u) * (1 - w) +
               (valAt(xi, yi + 1) * (1 - u) + valAt(xi + 1, yi + 1) * u) * w;
    };
}

/**
 * Mouvement Brownien Fractionnaire (fBm — Fractional Brownian Motion).
 * Additionne 5 octaves de bruit en doublant la fréquence et en réduisant
 * l'amplitude à chaque étape (contrôlée par le paramètre 'roughness').
 */
function fbm(noiseFunc, x, y, roughness) {
    let amplitude = 1.0;
    let frequency = 1.0;
    let sum = 0.0;
    let norm = 0.0;

    for (let octave = 0; octave < 5; octave++) {
        sum += amplitude * noiseFunc(x * frequency, y * frequency);
        norm += amplitude;
        amplitude *= 0.30 + roughness * 0.45; // Persistance contrôlée par la rugosité
        frequency *= 2.0;                     // Lacunarité standard = 2
    }
    return sum / norm; // Normalisation dans l'intervalle [0, 1]
}

