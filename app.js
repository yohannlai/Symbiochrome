/**
 * ============================================================================
 * SYMBIOCHROME — PROJET GAIA (Jalon Intermédiaire 1)
 * ============================================================================
 * Architecture logicielle : JavaScript natif (Vanilla JS) + WebGL (GLSL)
 *
 * Ce jalon met en place les 3 premières briques algorithmiques du sujet :
 *   1. TERRAIN FRACTAL (fBm) : génération procédurale d'une carte d'altitude
 *      et d'une carte d'humidité reproductibles via une graine (seed).
 *   2. AUTOMATES CELLULAIRES :
 *      - Un automate discret (variante du Jeu de la Vie de Conway) modulé par
 *        l'humidité locale.
 *      - Un automate continu (Lenia) à noyau gaussien lisse.
 *   3. L-SYSTEMS PARAMÉTRIQUES : 3 espèces végétales (Rosace, Astre, Corolle)
 *      qui croissent selon l'humidité et essaiment des cellules d'automate.
 *   4. RENDU RISOGRAPHIE WEBGL : surimpression soustractive (Multiply) de 4
 *      encres Pantone tramées par du Blue Noise sur papier coton.
 *
 * Note : Le Wave Function Collapse (WFC) et la faune évolutive (Boids/GA)
 *        seront branchés sur ces grilles de données dans le jalon suivant.
 * ============================================================================
 */

// ============================================================================
// 1. CONSTANTES DE SIMULATION & PARAMÈTRES UTILISATEUR
// ============================================================================
const GRID_WIDTH = 160;   // Résolution horizontale de la grille de simulation
const GRID_HEIGHT = 100;  // Résolution verticale de la grille de simulation
const SCALE = 8;          // Facteur d'échelle vers le canevas (160*8 = 1280px, 100*8 = 800px)

// Dictionnaire centralisé des paramètres modifiables via les curseurs du HUD
const PARAMS = {
    // --- Brique 1 : Terrain fractal (fBm) ---
    seed: 17,     // Graine aléatoire pour rendre la génération 100% reproductible
    scale: 2.2,   // Fréquence spatiale (zoom dans le bruit fractal)
    rough: 0.45,  // Rugosité / persistance des octaves fractales (relief escarpé vs doux)
    hum: 0.65,    // Biais global d'humidité (influencera la survie de la flore)
    alt: 0.50,    // Décalage global d'altitude (niveau de la mer)

    // --- Brique 2 & 3 : Flore (L-Systems + Automates cellulaires) ---
    ang: 28,      // Angle de branchement (en degrés) des tortues L-Systems
    grow: 0.65,   // Vitesse de croissance de l'âge des L-Systems
    bth: 3,       // Règle de naissance de l'automate discret (nombre de voisins requis)
    smin: 2,      // Règle de survie minimale de l'automate discret
    mu: 0.21,     // Centre de la fonction de croissance gaussienne de Lenia (μ)

    // --- Presse Risographie (Rendu WebGL) ---
    grain: 0.90,  // Intensité du tramage stochastique Blue Noise
    misreg: 1.1   // Défaut de calage mécanique (décalage en pixels entre les tambours)
};

const rnd = Math.random;
const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

// ============================================================================
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

// ============================================================================
// 3. BRIQUE 1 : GÉNÉRATION DU TERRAIN FRACTAL (ALTITUDE & HUMIDITÉ)
// ============================================================================
// Tableaux typés 1D (plus rapides et compacts en mémoire qu'un tableau 2D JS)
let mapHeight = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
let mapMoisture = new Float32Array(GRID_WIDTH * GRID_HEIGHT);

/**
 * Détermine si une cellule (index i) est habitable par la végétation.
 * Dans ce jalon 1, la zone fertile est définie par des seuils d'altitude
 * fractale : entre 32 % (au-dessus des bassins) et 78 % (sous les crêtes).
 */
function isHabitable(idx) {
    const h = mapHeight[idx];
    return h >= 0.32 && h <= 0.78;
}

/**
 * Calcule les cartes d'altitude et d'humidité sur toute la grille 160x100,
 * puis les envoie au GPU sous forme de texture RGBA (canal R = alt, G = hum).
 */
function generateFractalTerrain() {
    const noiseAlt = createNoise(PARAMS.seed);
    const noiseHum = createNoise(PARAMS.seed + 99); // Décalage de seed pour décorréler l'humidité
    const texData = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 4);

    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            const idx = y * GRID_WIDTH + x;
            const nx = (x / GRID_WIDTH) * PARAMS.scale * 1.6;
            const ny = (y / GRID_HEIGHT) * PARAMS.scale;

            // Calcul fractal de l'altitude et de l'humidité
            const h = clamp(fbm(noiseAlt, nx, ny, PARAMS.rough) + (PARAMS.alt - 0.5) * 0.7, 0, 1);
            const m = clamp(fbm(noiseHum, nx * 1.3 + 5, ny * 1.3 + 5, 0.4) + (PARAMS.hum - 0.5) * 0.85, 0, 1);

            mapHeight[idx] = h;
            mapMoisture[idx] = m;

            // Encodage dans les octets de la texture WebGL (0..255)
            texData[idx * 4]     = h * 255; // Canal Rouge  = Altitude
            texData[idx * 4 + 1] = m * 255; // Canal Vert   = Humidité
            texData[idx * 4 + 2] = 0;
            texData[idx * 4 + 3] = 255;
        }
    }

    uploadTexture(0, GRID_WIDTH, GRID_HEIGHT, texData, gl.LINEAR, gl.CLAMP_TO_EDGE);
    initFlora(); // Réinitialise la flore pour l'adapter au nouveau terrain
}

// ============================================================================
// 4. BRIQUE 2 & 3 : AUTOMATES CELLULAIRES (LIFE & LENIA) + L-SYSTEMS
// ============================================================================
let gridLife;    // État binaire (0 ou 1) de l'automate discret (Mosaïque rose)
let gridAge;     // Âge de chaque cellule vivante (pour varier le rendu)
let gridLenia;   // État continu [0.0 .. 1.0] de l'automate Lenia (Brume rose)
let plants;      // Liste des individus L-Systems implantés sur la carte

// --- Précalcul du noyau de convolution en anneau pour Lenia ---
// Lenia regarde le voisinage dans un rayon R=5 avec une pondération gaussienne
// centrée à mi-rayon (r = 0.5), ce qui produit des motifs organiques fluides.
const kernel = [];
for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
        const r = Math.hypot(dx, dy) / 5;
        if (r > 0 && r <= 1) {
            const weight = Math.exp(-(((r - 0.5) / 0.15) ** 2) / 2);
            kernel.push([dx, dy, weight]);
        }
    }
}
const kernelSum = kernel.reduce((sum, item) => sum + item[2], 0);

// --- Grammaires formelles des 3 espèces de L-Systems ---
// F = avancer en traçant un pétale | + / - = tourner | [ / ] = empiler/dépiler l'état
const L_RULES = [
    { F: 'F[+F]F[-F]F' },            // Espèce 0 : Rosace ramifiée (symétrie d'ordre 6)
    { F: 'FF[+F][-F][++F][--F]' },   // Espèce 1 : Astre étoilé dense (symétrie d'ordre 8)
    { F: 'F[+F]F[-F+F]' }            // Espèce 2 : Corolle asymétrique (symétrie d'ordre 5)
];
const L_SYMMETRY = [6, 8, 5];
const lsysCache = {}; // Mémoïsation des chaînes réécrites pour éviter de recalculer à chaque frame

/**
 * Réécrit récursivement l'axiome 'F' selon la règle de l'espèce et la profondeur.
 */
function generateLSystemString(type, depth) {
    const key = type + '_' + depth;
    if (lsysCache[key]) return lsysCache[key];
    let str = 'F';
    for (let i = 0; i < depth; i++) {
        str = str.replace(/F/g, L_RULES[type].F);
    }
    return (lsysCache[key] = str);
}

/**
 * Initialise les automates et plante les 24 L-Systems initiaux
 * uniquement sur les zones fertiles et suffisamment humides du terrain fractal.
 */
function initFlora() {
    gridLife = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);
    gridAge = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);
    gridLenia = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
    plants = [];

    // Ensemencement initial des deux automates cellulaires
    for (let i = 0; i < GRID_WIDTH * GRID_HEIGHT; i++) {
        if (isHabitable(i)) {
            if (rnd() < 0.09) gridLife[i] = 1;
            if (rnd() < 0.055) gridLenia[i] = rnd();
        }
    }

    // Implantation des 3 espèces de L-Systems sur les sols humides (humidité > 25 %)
    for (let k = 0; k < 24; k++) {
        const i = (rnd() * GRID_WIDTH * GRID_HEIGHT) | 0;
        if (isHabitable(i) && mapMoisture[i] > 0.25) {
            plants.push({
                x: (i % GRID_WIDTH) * SCALE,
                y: ((i / GRID_WIDTH) | 0) * SCALE,
                type: k % 3,
                age: 2 + rnd() * 4
            });
        }
    }
    renderLSystems();
}

/**
 * Mise à jour de l'AUTOMATE CELLULAIRE DISCRET (variante du Jeu de la Vie).
 * Couplage au terrain :
 *  - Les cellules meurent hors de la zone habitable fractale.
 *  - Une forte humidité (> 78 %) facilite la naissance spontanée.
 *  - Un sol trop sec (< 18 %) provoque une mortalité aléatoire.
 */
function updateAutomatonLife() {
    const next = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);

    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            const i = y * GRID_WIDTH + x;

            // Comptage des 8 voisins (voisinage de Moore)
            let neighbors = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if ((dx || dy) && x + dx >= 0 && y + dy >= 0 && x + dx < GRID_WIDTH && y + dy < GRID_HEIGHT) {
                        neighbors += gridLife[i + dy * GRID_WIDTH + dx];
                    }
                }
            }

            const alive = gridLife[i];
            let nextState = 0;

            if (!isHabitable(i)) {
                nextState = 0; // Survie impossible dans l'eau profonde ou sur les crêtes
            } else if (alive) {
                nextState = (neighbors >= PARAMS.smin && neighbors <= 3) ? 1 : 0; // Survie
            } else {
                // Naissance selon le seuil B (PARAMS.bth) ou favorisée par l'humidité
                const humidBoost = (neighbors === 2 && mapMoisture[i] > 0.78 && rnd() < 0.25);
                const spontaneous = rnd() < 0.0005 * mapMoisture[i];
                nextState = (neighbors === PARAMS.bth || humidBoost || spontaneous) ? 1 : 0;
            }

            // Stress hydrique sur sol sec
            if (nextState && mapMoisture[i] < 0.18 && rnd() < 0.1) nextState = 0;

            next[i] = nextState;
            gridAge[i] = (nextState && alive) ? Math.min(250, gridAge[i] + 1) : 0;
        }
    }
    gridLife = next;
}

/**
 * Mise à jour de l'AUTOMATE CELLULAIRE CONTINU (Lenia).
 * Chaque cellule calcule la somme pondérée de son voisinage (u), puis applique
 * une fonction de croissance gaussienne centrée sur mu (décalé par l'humidité).
 */
function updateAutomatonLenia() {
    const next = new Float32Array(GRID_WIDTH * GRID_HEIGHT);

    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            const i = y * GRID_WIDTH + x;
            if (!isHabitable(i)) continue;

            // Convolution discrète avec le noyau en anneau
            let u = 0;
            for (const [dx, dy, w] of kernel) {
                const X = x + dx, Y = y + dy;
                if (X >= 0 && Y >= 0 && X < GRID_WIDTH && Y < GRID_HEIGHT) {
                    u += w * gridLenia[Y * GRID_WIDTH + X];
                }
            }
            u /= kernelSum;

            // Couplage environnemental : l'humidité décale légèrement le pic de croissance μ
            const muLocal = PARAMS.mu + (mapMoisture[i] - 0.5) * 0.05;
            const growth = 2 * Math.exp(-((u - muLocal) ** 2) / (2 * 0.04 * 0.04)) - 1;
            next[i] = clamp(gridLenia[i] + 0.12 * growth, 0, 1);
        }
    }
    gridLenia = next;
}

/**
 * Fait grandir les L-Systems et crée une interaction entre les deux modèles
 * végétaux : les L-Systems essaiment des graines dans l'automate cellulaire.
 */
function updateLSystems() {
    for (const p of plants) {
        p.age += PARAMS.grow;
        const depth = Math.min(2, Math.floor(p.age / 3.5));
        const radius = (depth + 1) * 1.6;

        // Essaimage local autour de la plante
        if (rnd() < 0.45) {
            const gx = ((p.x / SCALE) + (rnd() * 2 - 1) * radius) | 0;
            const gy = ((p.y / SCALE) + (rnd() * 2 - 1) * radius) | 0;
            if (gx >= 0 && gy >= 0 && gx < GRID_WIDTH && gy < GRID_HEIGHT && isHabitable(gy * GRID_WIDTH + gx)) {
                gridLife[gy * GRID_WIDTH + gx] = 1;
            }
        }
    }
    renderLSystems();
}

/**
 * Dessine un pétale elliptique plein entre deux positions de la tortue L-System
 * (donne un aspect tampon imprimé Riso beaucoup plus riche qu'un simple trait).
 */
function drawFilledPetal(ctx, x1, y1, x2, y2, width) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    ctx.save();
    ctx.translate((x1 + x2) * 0.5, (y1 + y2) * 0.5);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.ellipse(0, 0, len * 0.58, width, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/**
 * Interprète la chaîne L-System via une tortue géométrique symétrique
 * et dessine le résultat dans le canal Vert (qui deviendra l'encre Medium Blue).
 */
function renderLSystems() {
    lsysCtx.clearRect(0, 0, GRID_WIDTH * SCALE, GRID_HEIGHT * SCALE);

    for (const p of plants) {
        const depth = Math.min(2, Math.floor(p.age / 3.5));
        const cmds = generateLSystemString(p.type, depth);
        const len = 28 / Math.pow(1.65, depth);
        const angle = (PARAMS.ang * Math.PI / 180) * (1 + p.type * 0.2);

        // Cœur circulaire central de la plante
        lsysCtx.fillStyle = 'rgba(0, 235, 0, 0.92)';
        lsysCtx.beginPath();
        lsysCtx.arc(p.x, p.y, 7 + depth * 2.2, 0, Math.PI * 2);
        lsysCtx.fill();

        // Répétition radiale selon la symétrie propre à chaque espèce (6, 8 ou 5)
        for (let a = 0; a < L_SYMMETRY[p.type]; a++) {
            let x = p.x, y = p.y;
            let heading = a * (Math.PI * 2) / L_SYMMETRY[p.type];
            const stack = [];
            let stepIdx = 0;

            for (const c of cmds) {
                if (c === 'F') {
                    const nx = x + Math.cos(heading) * len;
                    const ny = y + Math.sin(heading) * len;
                    const petalW = Math.max(3.2, (7.5 - depth * 1.6) * (1.0 - stepIdx * 0.04));
                    lsysCtx.fillStyle = p.type === 1 ? 'rgba(0, 225, 0, 0.82)' : 'rgba(0, 250, 0, 0.88)';
                    drawFilledPetal(lsysCtx, x, y, nx, ny, petalW);
                    x = nx; y = ny;
                    stepIdx++;
                } else if (c === '+') {
                    heading += angle;
                } else if (c === '-') {
                    heading -= angle;
                } else if (c === '[') {
                    stack.push([x, y, heading, stepIdx]); // Sauvegarde de l'état de la tortue
                } else if (c === ']') {
                    [x, y, heading, stepIdx] = stack.pop(); // Restauration de l'état
                }
            }
        }
    }
}

// ============================================================================
// 5. MOTEUR DE RENDU WEBGL — SHADER RISOGRAPHIE (BLUE NOISE + 4 ENCRES)
// ============================================================================
const glCanvas = document.getElementById('gl-canvas');
const gl = glCanvas.getContext('webgl');

// Canevas 2D hors-écran qui rassemble les couches dynamiques (flore) avant envoi au GPU
const dynCanvas = document.createElement('canvas');
dynCanvas.width = GRID_WIDTH * SCALE;
dynCanvas.height = GRID_HEIGHT * SCALE;
const dynCtx = dynCanvas.getContext('2d');

// Canevas 2D hors-écran dédié au dessin des L-Systems
const lsysCanvas = document.createElement('canvas');
lsysCanvas.width = GRID_WIDTH * SCALE;
lsysCanvas.height = GRID_HEIGHT * SCALE;
const lsysCtx = lsysCanvas.getContext('2d');

/**
 * Fragment Shader GLSL :
 *  - Lit la texture du terrain fractal (uTexFractal) et trace les courbes de niveau.
 *  - Lit la texture des couches dynamiques (uTexDyn : R = automates, G = L-Systems).
 *  - Applique le tramage stochastique Blue Noise (uTexBlueNoise) et le grain du papier (uTexPaper).
 *  - Simule le défaut de calage entre tambours (uMisreg) et la surimpression soustractive (Multiply).
 */
const fragmentShaderSource = `
precision highp float;

uniform sampler2D uTexFractal, uTexDyn, uTexBlueNoise, uTexPaper;
uniform vec2 uRes, uCamPos;
uniform float uZoom, uGrain, uMisreg;

// Convertit une densité continue d'encre [0..1] en masque de points stochastiques Blue Noise
float risoBlueNoiseMask(vec2 fragCoord, float density, vec2 bnOffset) {
    if (density <= 0.015) return 0.0;
    float bn = texture2D(uTexBlueNoise, fract(fragCoord / 128.0 + bnOffset)).r;
    float tooth = texture2D(uTexPaper, fract(fragCoord / 512.0 + bnOffset * 0.25)).r;
    float d = clamp(density + (tooth - 0.92) * 0.65 * uGrain, 0.0, 1.0);
    float threshold = mix(0.5, bn, uGrain);
    float ink = smoothstep(threshold - 0.14, threshold + 0.14, d);
    float pores = 1.0 - (0.09 * uGrain * smoothstep(0.84, 0.98, bn));
    return clamp(ink * pores, 0.0, 1.0);
}

// Traduit l'altitude fractale et l'humidité en 4 densités d'encres Pantone :
// vec4(FluoPink, MediumBlue, SunflowerYellow, Aqua)
vec4 getFractalInks(vec2 uv) {
    vec4 fm = texture2D(uTexFractal, uv);
    float h = fm.r;
    float hum = fm.g;
    vec4 ink = vec4(0.0);

    // Courbes de niveau topographiques calculées sur l'altitude fractale
    float iso = smoothstep(0.10, 0.0, abs(fract(h * 7.0) - 0.5));

    if (h < 0.32) {
        // Bassins fractals : encre Aqua + lignes de niveau Medium Blue
        ink.w = mix(0.28, 0.72, 1.0 - h / 0.32);
        ink.y = iso * 0.35;
    } else if (h < 0.78) {
        // Terres fertiles : papier vierge dominant + lavis léger Jaune/Aqua selon l'humidité
        ink.z = smoothstep(0.35, 0.75, h) * 0.35;
        ink.w = smoothstep(0.55, 0.95, hum) * 0.28;
        ink.z += iso * 0.25;
    } else {
        // Crêtes fractales : aplat Sunflower Yellow + contours Fluo Pink
        ink.z = 0.65;
        ink.x = iso * 0.55;
    }
    return ink;
}

void main() {
    vec2 frag = gl_FragCoord.xy;
    vec2 screenUV = frag / uRes;
    screenUV.y = 1.0 - screenUV.y;
    vec2 w = (screenUV - 0.5) / uZoom + uCamPos;

    // Couleur de base : texture du papier coton non couché
    vec3 col = texture2D(uTexPaper, fract(frag / 512.0)).rgb;

    if (w.x >= 0.0 && w.x <= 1.0 && w.y >= 0.0 && w.y <= 1.0) {
        // Simulation du léger décalage mécanique (misregistration) entre les 4 tambours
        vec2 px = (1.0 / uRes) / uZoom;
        vec2 offPink   = vec2( 2.4, -1.6) * px * uMisreg;
        vec2 offBlue   = vec2(-2.0,  1.8) * px * uMisreg;
        vec2 offYellow = vec2(-1.4, -2.0) * px * uMisreg;
        vec2 offAqua   = vec2( 1.8,  2.0) * px * uMisreg;

        // Fusion des couches du terrain fractal et des couches dynamiques (flore)
        float pinkAmt   = clamp(getFractalInks(w + offPink).x   + texture2D(uTexDyn, clamp(w + offPink, 0.0, 1.0)).r * 0.92, 0.0, 1.0);
        float blueAmt   = clamp(getFractalInks(w + offBlue).y   + texture2D(uTexDyn, clamp(w + offBlue, 0.0, 1.0)).g * 1.00, 0.0, 1.0);
        float yellowAmt = clamp(getFractalInks(w + offYellow).z, 0.0, 1.0);
        float aquaAmt   = clamp(getFractalInks(w + offAqua).w,   0.0, 1.0);

        // Tramage stochastique Blue Noise décalé par tambour
        float mYellow = risoBlueNoiseMask(frag, yellowAmt, vec2(0.00, 0.00));
        float mAqua   = risoBlueNoiseMask(frag, aquaAmt,   vec2(0.37, 0.19));
        float mPink   = risoBlueNoiseMask(frag, pinkAmt,   vec2(0.71, 0.53));
        float mBlue   = risoBlueNoiseMask(frag, blueAmt,   vec2(0.23, 0.83));

        // Surimpression soustractive (Multiply) des 4 encres Pantone Riso
        col *= mix(vec3(1.0), vec3(1.00, 0.89, 0.08), mYellow * 0.95); // Sunflower Yellow
        col *= mix(vec3(1.0), vec3(0.14, 0.76, 0.79), mAqua   * 0.92); // Riso Aqua
        col *= mix(vec3(1.0), vec3(1.00, 0.28, 0.62), mPink   * 0.94); // Fluo Pink
        col *= mix(vec3(1.0), vec3(0.18, 0.32, 0.66), mBlue   * 0.95); // Medium Blue
    } else {
        col *= 0.95; // Marge légèrement grisée hors de la zone imprimée
    }

    gl_FragColor = vec4(col, 1.0);
}
`;

// Compilation et édition des liens du programme WebGL
function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Erreur de compilation du shader GLSL :', gl.getShaderInfoLog(s));
    }
    return s;
}

const program = gl.createProgram();
gl.attachShader(program, compileShader(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'));
gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource));
gl.linkProgram(program);
gl.useProgram(program);

// Quad plein écran sur lequel le Fragment Shader s'exécute pour chaque pixel
const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const locP = gl.getAttribLocation(program, 'p');
gl.enableVertexAttribArray(locP);
gl.vertexAttribPointer(locP, 2, gl.FLOAT, false, 0, 0);

const textures = [0, 1, 2, 3].map(() => gl.createTexture());
const getU = name => gl.getUniformLocation(program, name);
['uTexFractal', 'uTexDyn', 'uTexBlueNoise', 'uTexPaper'].forEach((n, i) => gl.uniform1i(getU(n), i));
gl.uniform2f(getU('uRes'), glCanvas.width, glCanvas.height);

function uploadTexture(unit, w, h, data, filter, wrap) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (data instanceof Uint8Array) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
}

// Chargement des textures Blue Noise et Papier Coton depuis textures.js
uploadTexture(2, 1, 1, new Uint8Array([128, 128, 128, 255]), gl.NEAREST, gl.REPEAT);
uploadTexture(3, 1, 1, new Uint8Array([245, 240, 227, 255]), gl.LINEAR, gl.REPEAT);
if (window.RISO_TEXTURES) {
    const imgBN = new Image();
    imgBN.onload = () => uploadTexture(2, 0, 0, imgBN, gl.NEAREST, gl.REPEAT);
    imgBN.src = window.RISO_TEXTURES.blueNoise;

    const imgPaper = new Image();
    imgPaper.onload = () => uploadTexture(3, 0, 0, imgPaper, gl.LINEAR, gl.REPEAT);
    imgPaper.src = window.RISO_TEXTURES.paper;
}

/**
 * Rassemble les couches dynamiques (L-Systems + Automates cellulaires)
 * sur un canevas 2D, puis l'envoie au GPU dans l'unité de texture 1.
 */
function renderDynamicElements() {
    dynCtx.globalCompositeOperation = 'source-over';
    dynCtx.fillStyle = '#000000';
    dynCtx.fillRect(0, 0, GRID_WIDTH * SCALE, GRID_HEIGHT * SCALE);

    // Addition additive des canaux RVB (R = encre Fluo Pink, G = encre Medium Blue)
    dynCtx.globalCompositeOperation = 'lighter';

    // 1. Copie des L-Systems (dessinés dans le canal Vert)
    dynCtx.drawImage(lsysCanvas, 0, 0);

    // 2. Dessin des automates cellulaires (canal Rouge) avec un léger flou
    // pour obtenir des nuages d'encre organiques après tramage Blue Noise
    dynCtx.save();
    dynCtx.filter = 'blur(2.5px)';
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            const i = y * GRID_WIDTH + x;
            const px = x * SCALE + SCALE * 0.5;
            const py = y * SCALE + SCALE * 0.5;

            // Automate discret (Jeu de la Vie) : motif en damier ou jeunes cellules
            if (gridLife[i] && (((x + y) & 1) || gridAge[i] < 4)) {
                dynCtx.fillStyle = 'rgba(255, 0, 0, 0.72)';
                dynCtx.beginPath();
                dynCtx.arc(px, py, SCALE * 0.65, 0, Math.PI * 2);
                dynCtx.fill();
            }

            // Automate continu (Lenia) : densité proportionnelle à l'état [0..1]
            if (gridLenia[i] > 0.1) {
                const alpha = clamp(gridLenia[i] * 0.68, 0.05, 0.68);
                dynCtx.fillStyle = `rgba(255, 0, 0, ${alpha.toFixed(2)})`;
                dynCtx.beginPath();
                dynCtx.arc(px, py, SCALE * 1.1, 0, Math.PI * 2);
                dynCtx.fill();
            }
        }
    }
    dynCtx.restore();

    uploadTexture(1, 0, 0, dynCanvas, gl.LINEAR, gl.CLAMP_TO_EDGE);
}

// ============================================================================
// 6. INTERFACE UTILISATEUR (HUD), NAVIGATION CAMÉRA & BOUCLE PRINCIPALE
// ============================================================================
const camera = { x: 0.5, y: 0.5, z: 1.15 };
let frame = 0;
let dragStart = null;
let isPaused = false;

// Navigation libre à la souris (glisser-déposer pour déplacer, molette pour zoomer)
glCanvas.onpointerdown = e => { dragStart = [e.clientX, e.clientY]; };
window.onpointerup = () => { dragStart = null; };
window.onpointermove = e => {
    if (!dragStart) return;
    const rect = glCanvas.getBoundingClientRect();
    camera.x = clamp(camera.x - (e.clientX - dragStart[0]) / rect.width / camera.z, 0, 1);
    camera.y = clamp(camera.y - (e.clientY - dragStart[1]) / rect.height / camera.z, 0, 1);
    dragStart = [e.clientX, e.clientY];
};
glCanvas.onwheel = e => {
    e.preventDefault();
    camera.z = clamp(camera.z * (e.deltaY < 0 ? 1.1 : 0.9), 1.0, 5.0);
};

// Définition des curseurs du panneau de contrôle
const SLIDERS_DEF = [
    ['01. Terrain Fractal (fBm)'],
    ['seed', 'Seed', 1, 999, 1, true],
    ['scale', 'Échelle', 0.8, 5, 0.1, true],
    ['rough', 'Rugosité', 0, 1, 0.01, true],
    ['hum', 'Humidité', 0, 1, 0.01, true],
    ['alt', 'Altitude', 0, 1, 0.01, true],
    ['02. Automates & L-Systems'],
    ['ang', 'Angle branchement', 10, 60, 1, false],
    ['grow', 'Croissance L-System', 0.1, 1.5, 0.05, false],
    ['bth', 'Automate : naissance', 2, 4, 1, false],
    ['smin', 'Automate : survie min', 1, 3, 1, false],
    ['mu', 'Lenia μ (seuil)', 0.1, 0.3, 0.005, false],
    ['03. Presse Risographie'],
    ['grain', 'Grain Blue Noise', 0.1, 1.0, 0.05, false],
    ['misreg', 'Décalage encres', 0.0, 2.5, 0.1, false]
];

const slidersContainer = document.getElementById('sliders-container');
let regenTimer;
SLIDERS_DEF.forEach(def => {
    if (def.length === 1) {
        slidersContainer.insertAdjacentHTML('beforeend', `<h4>${def[0]}</h4>`);
        return;
    }
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label><span>${def[1]}</span><b id="v_${def[0]}">${PARAMS[def[0]]}</b></label><input type="range" min="${def[2]}" max="${def[3]}" step="${def[4]}" value="${PARAMS[def[0]]}" id="s_${def[0]}">`;
    slidersContainer.append(wrap);
    wrap.querySelector('input').oninput = e => {
        PARAMS[def[0]] = +e.target.value;
        document.getElementById('v_' + def[0]).textContent = e.target.value;
        // Si le paramètre modifie le relief (def[5] === true), on régénère le terrain avec un léger délai
        if (def[5]) {
            clearTimeout(regenTimer);
            regenTimer = setTimeout(generateFractalTerrain, 100);
        }
    };
});

// Trois configurations prédéfinies (Presets) pour démontrer la variété fractale
const PRESETS = {
    Archipel: { seed: 17, scale: 2.2, rough: 0.45, hum: 0.72, alt: 0.44 },
    Steppes:  { seed: 42, scale: 1.4, rough: 0.25, hum: 0.35, alt: 0.56 },
    Crêtes:   { seed: 73, scale: 3.0, rough: 0.80, hum: 0.50, alt: 0.65 }
};
const presetsContainer = document.getElementById('presets-container');
for (const key in PRESETS) {
    const btn = document.createElement('button');
    btn.textContent = key;
    btn.onclick = () => {
        Object.assign(PARAMS, PRESETS[key]);
        SLIDERS_DEF.forEach(s => {
            if (s.length > 1) {
                document.getElementById('s_' + s[0]).value = PARAMS[s[0]];
                document.getElementById('v_' + s[0]).textContent = PARAMS[s[0]];
            }
        });
        generateFractalTerrain();
    };
    presetsContainer.append(btn);
}

document.getElementById('btn-pause').onclick = e => {
    isPaused = !isPaused;
    e.target.textContent = isPaused ? 'Reprendre' : 'Pause';
    e.target.classList.toggle('active', isPaused);
};
document.getElementById('btn-reset-flora').onclick = initFlora;

// Légende visuelle des encres et systèmes
const LEGEND_ITEMS = [
    ['linear-gradient(135deg, #24c2c7, #2e52a8)', 'Bassins fractals (alt < 32%)'],
    ['linear-gradient(135deg, #f5f0e3, #ffe314)', 'Terres fertiles (courbes de niveau fBm)'],
    ['linear-gradient(135deg, #ffe314, #ff479e)', 'Crêtes fractales (alt > 78%)'],
    ['radial-gradient(#ff479e 35%, transparent 70%)', 'Automates : Life (mosaïque) & Lenia (brume)'],
    ['repeating-conic-gradient(#2e52a8 0 20deg, transparent 0 40deg)', 'L-Systems : 3 espèces (Rosace, Astre, Corolle)']
];
document.getElementById('legend-container').innerHTML = LEGEND_ITEMS.map(([bg, label]) =>
    `<div class="legend-item"><i class="swatch" style="background:${bg}"></i><span>${label}</span></div>`
).join('');

// Infobulle d'inspection au survol de la souris
const tooltipText = document.getElementById('tooltip-text');
glCanvas.addEventListener('pointermove', e => {
    const rect = glCanvas.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) / rect.width - 0.5) / camera.z + camera.x;
    const wy = ((e.clientY - rect.top) / rect.height - 0.5) / camera.z + camera.y;
    const gx = (wx * GRID_WIDTH) | 0, gy = (wy * GRID_HEIGHT) | 0;
    if (gx < 0 || gy < 0 || gx >= GRID_WIDTH || gy >= GRID_HEIGHT) return;

    const idx = gy * GRID_WIDTH + gx;
    const h = mapHeight[idx];
    const zone = h < 0.32 ? 'Bassin fractal' : h <= 0.78 ? 'Terre fertile' : 'Crête fractale';
    const pl = plants.find(p => Math.hypot(p.x / SCALE - gx, p.y / SCALE - gy) < 4);

    tooltipText.innerHTML =
        `<b>${zone}</b><br>` +
        `Alt ${(h * 100) | 0}% · Hum ${(mapMoisture[idx] * 100) | 0}%<br>` +
        `${gridLife[idx] ? 'Life · ' : ''}${gridLenia[idx] > 0.2 ? 'Lenia · ' : ''}` +
        `${pl ? ['Rosace', 'Astre', 'Corolle'][pl.type] + ' (âge ' + (pl.age | 0) + ')' : ''}`;
});

// Boucle principale d'animation (60 FPS)
function mainLoop() {
    frame++;
    if (!isPaused) {
        if (frame % 15 === 0) updateAutomatonLife();  // Pas discret toutes les 15 frames
        if (frame % 4 === 0) updateAutomatonLenia(); // Pas continu toutes les 4 frames
        if (frame % 120 === 0) updateLSystems();     // Croissance lente des L-Systems
    }

    camera.x = clamp(camera.x, 0.5 / camera.z, 1 - 0.5 / camera.z);
    camera.y = clamp(camera.y, 0.5 / camera.z, 1 - 0.5 / camera.z);

    renderDynamicElements();
    gl.uniform2f(getU('uCamPos'), camera.x, camera.y);
    gl.uniform1f(getU('uZoom'), camera.z);
    gl.uniform1f(getU('uGrain'), PARAMS.grain);
    gl.uniform1f(getU('uMisreg'), PARAMS.misreg);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(mainLoop);
}

// Lancement initial au chargement de la page
generateFractalTerrain();
requestAnimationFrame(mainLoop);
