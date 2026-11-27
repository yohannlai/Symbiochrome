// 3. PARTIE 1 : GÉNÉRATION DU MONDE — FRACTALES (fBm) & WAVE FUNCTION COLLAPSE
// ============================================================================
// Contrainte d'adjacence du WFC (Modèle tuilé à 6 biomes : 0..5) :
// Un biome de niveau N ne peut toucher que N-1, N ou N+1.
// Chaque règle est encodée en masque binaire 6 bits (ex: biome 0 -> 0b000011 = {0, 1}).
var NEIGHBOR_RULES = [0, 1, 2, 3, 4, 5].map(a =>
    [a - 1, a, a + 1]
        .filter(b => b >= 0 && b < 6)
        .reduce((mask, b) => mask | (1 << b), 0)
);

/**
 * Calcule l'union des voisins autorisés pour l'ensemble des biomes encore
 * possibles dans une cellule (représentés par son masque binaire).
 */
function getUnionMask(mask) {
    let union = 0;
    for (let b = 0; b < 6; b++) {
        if ((mask >> b) & 1) union |= NEIGHBOR_RULES[b];
    }
    return union;
}

// Données générées pour le monde (exportables en JSON et lues par la Partie 2)
var wfcLevels = new Uint8Array(WFC_WIDTH * WFC_HEIGHT);
var mapHeight = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
var mapMoisture = new Float32Array(GRID_WIDTH * GRID_HEIGHT);

/**
 * Solveur WAVE FUNCTION COLLAPSE (Observer -> Effondrer -> Propager).
 * Utilise la carte fractale (targetMap) comme poids probabilistes afin que
 * les 5 curseurs fractals pilotent la géographie tout en garantissant des
 * transitions de biomes strictement cohérentes.
 */
function runWaveFunctionCollapse(targetMap) {
    const N = WFC_WIDTH * WFC_HEIGHT;
    const sigma = 0.48 + PARAMS.rough * 1.1; // Souplesse par rapport à la cible fractale

    // Jusqu'à 30 tentatives en cas de contradiction (restart propre)
    for (let attempt = 0; attempt < 30; attempt++) {
        const r = createRNG(PARAMS.seed * 131 + attempt);
        // 1. SUPERPOSITION : toutes les cellules démarrent avec les 6 biomes possibles (0b111111 = 63)
        const gridMask = new Uint8Array(N).fill(63);
        let valid = true;

        while (valid) {
            // 2. OBSERVATION : trouver la cellule non résolue de plus basse entropie
            let bestIdx = -1;
            let minEntropy = 999;

            for (let i = 0; i < N; i++) {
                let count = 0;
                for (let b = 0; b < 6; b++) count += (gridMask[i] >> b) & 1;
                if (count > 1) {
                    // Entropie + petit bruit pour départager les égalités sans biais directionnel
                    const ent = count + r() * 0.45;
                    if (ent < minEntropy) {
                        minEntropy = ent;
                        bestIdx = i;
                    }
                }
            }

            // Toutes les cellules sont effondrées sur 1 seul biome -> succès !
            if (bestIdx < 0) {
                const solved = new Uint8Array(N);
                for (let i = 0; i < N; i++) solved[i] = 31 - Math.clz32(gridMask[i]);
                return solved;
            }

            // 3. COLLAPSE : choix pondéré par la proximité avec l'altitude fractale cible
            const weights = new Float32Array(6);
            let totalW = 0;
            for (let b = 0; b < 6; b++) {
                if ((gridMask[bestIdx] >> b) & 1) {
                    const diff = b - targetMap[bestIdx];
                    const w = Math.exp(-(diff * diff) / (2 * sigma * sigma));
                    weights[b] = w;
                    totalW += w;
                }
            }

            let pick = r() * totalW;
            let chosen = 0;
            while (chosen < 5 && (pick -= weights[chosen]) > 0) chosen++;
            gridMask[bestIdx] = 1 << chosen;

            // 4. PROPAGATION : réaction en chaîne sur les 4 voisins (pile explicite)
            const stack = [bestIdx];
            while (stack.length && valid) {
                const i = stack.pop();
                const x = i % WFC_WIDTH;
                const y = (i / WFC_WIDTH) | 0;
                const allowedForNeighbors = getUnionMask(gridMask[i]);

                const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
                for (let d = 0; d < 4; d++) {
                    const nx = x + dirs[d][0];
                    const ny = y + dirs[d][1];
                    if (nx < 0 || ny < 0 || nx >= WFC_WIDTH || ny >= WFC_HEIGHT) continue;

                    const j = ny * WFC_WIDTH + nx;
                    const nextMask = gridMask[j] & allowedForNeighbors;
                    if (nextMask === 0) {
                        valid = false; // Contradiction -> on relance une tentative
                        break;
                    }
                    if (nextMask !== gridMask[j]) {
                        gridMask[j] = nextMask;
                        stack.push(j); // Propager uniquement si le domaine a changé
                    }
                }
            }
        }
    }

    // Repli sécurisé si les 30 tentatives échouent
    const fallback = new Uint8Array(N);
    for (let i = 0; i < N; i++) fallback[i] = clamp(Math.round(targetMap[i]), 0, 5);
    return fallback;
}

/**
 * Retourne l'identifiant du biome WFC (0..5) correspondant à une cellule (gx, gy)
 * de la grille de simulation 160x100.
 */
function getBiomeAtGrid(gx, gy) {
    const tx = clamp(Math.floor((gx / GRID_WIDTH) * WFC_WIDTH), 0, WFC_WIDTH - 1);
    const ty = clamp(Math.floor((gy / GRID_HEIGHT) * WFC_HEIGHT), 0, WFC_HEIGHT - 1);
    return wfcLevels[ty * WFC_WIDTH + tx];
}

/**
 * Couplage Partie 1 -> Partie 2 :
 * Seuls les biomes terrestres intermédiaires résolus par le WFC
 * (2: Plaine, 3: Collines, 4: Montagne) permettent la croissance de la flore.
 */
function isHabitable(idx) {
    const gx = idx % GRID_WIDTH;
    const gy = (idx / GRID_WIDTH) | 0;
    const biome = getBiomeAtGrid(gx, gy);
    return biome >= 2 && biome <= 4;
}

/**
 * Pipeline complet de génération du monde :
 *  1. Calcule une carte cible fractale (fBm) sur la grille WFC 20x12.
 *  2. Résout les biomes cohérents via Wave Function Collapse.
 *  3. Lisse bilinéairement les biomes WFC et y ajoute du détail fractal haute
 *     fréquence pour obtenir un relief organique en courbes de niveau.
 *  4. Envoie les textures au GPU (uTexFractal & uTexWFC) et réinitialise la flore.
 */
function generateWorld() {
    const noiseAlt = createNoise(PARAMS.seed);
    const noiseHum = createNoise(PARAMS.seed + 99);

    // 1. Carte cible fractale pour guider les poids du WFC
    const targetMap = new Float32Array(WFC_WIDTH * WFC_HEIGHT);
    for (let y = 0; y < WFC_HEIGHT; y++) {
        for (let x = 0; x < WFC_WIDTH; x++) {
            const nx = (x / WFC_WIDTH) * PARAMS.scale * 1.6;
            const ny = (y / WFC_HEIGHT) * PARAMS.scale;
            let val = (fbm(noiseAlt, nx, ny, PARAMS.rough) - 0.5) * 5.2 + 2.5;
            val += (PARAMS.alt - 0.5) * 3.8 - (PARAMS.hum - 0.5) * 1.2;
            targetMap[y * WFC_WIDTH + x] = clamp(val, 0, 5);
        }
    }

    // 2. Résolution WFC (6 biomes contraints)
    wfcLevels = runWaveFunctionCollapse(targetMap);

    // 3. Lissage organique du WFC + détail fractal pour la grille 160x100
    const getLvl = (tx, ty) => wfcLevels[clamp(ty, 0, WFC_HEIGHT - 1) * WFC_WIDTH + clamp(tx, 0, WFC_WIDTH - 1)];
    const texTerrain = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 4);

    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            const fx = (x / GRID_WIDTH) * WFC_WIDTH - 0.5;
            const fy = (y / GRID_HEIGHT) * WFC_HEIGHT - 0.5;
            const x0 = Math.floor(fx), y0 = Math.floor(fy);
            const u = fx - x0, v = fy - y0;
            const idx = y * GRID_WIDTH + x;

            // Interpolation bilinéaire des niveaux WFC (supprime l'aspect "carrelage")
            const smoothWfc =
                (getLvl(x0, y0) * (1 - u) + getLvl(x0 + 1, y0) * u) * (1 - v) +
                (getLvl(x0, y0 + 1) * (1 - u) + getLvl(x0 + 1, y0 + 1) * u) * v;

            // Ajout d'une perturbation fractale organique sur les côtes et les courbes de niveau
            const detail = (fbm(noiseHum, (x / GRID_WIDTH) * PARAMS.scale * 3.0, (y / GRID_HEIGHT) * PARAMS.scale * 3.0, PARAMS.rough) - 0.5) * (0.24 + 0.16 * PARAMS.rough);
            const h = clamp((smoothWfc / 5.0) * 0.86 + 0.07 + detail, 0, 1);
            const m = clamp(fbm(noiseHum, (x / GRID_WIDTH) * PARAMS.scale * 2.0 + 5, (y / GRID_HEIGHT) * PARAMS.scale * 2.0, 0.4) + (PARAMS.hum - 0.5) * 0.9, 0, 1);

            mapHeight[idx] = h;
            mapMoisture[idx] = m;

            texTerrain[idx * 4]     = h * 255; // R = Altitude organique (WFC lissé + fBm)
            texTerrain[idx * 4 + 1] = m * 255; // G = Humidité
            texTerrain[idx * 4 + 2] = 0;
            texTerrain[idx * 4 + 3] = 255;
        }
    }

    // Texture brute des biomes WFC (20x12) pour l'aperçu optionnel de la grille
    const texWfc = new Uint8Array(WFC_WIDTH * WFC_HEIGHT * 4);
    for (let i = 0; i < WFC_WIDTH * WFC_HEIGHT; i++) {
        texWfc[i * 4] = wfcLevels[i];
        texWfc[i * 4 + 3] = 255;
    }

    uploadTexture(0, GRID_WIDTH, GRID_HEIGHT, texTerrain, gl.LINEAR, gl.CLAMP_TO_EDGE);
    uploadTexture(5, WFC_WIDTH, WFC_HEIGHT, texWfc, gl.NEAREST, gl.CLAMP_TO_EDGE);

    initFlora();
}
