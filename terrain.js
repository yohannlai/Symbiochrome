// 3. BRIQUE 1 : GÉNÉRATION DU TERRAIN FRACTAL (ALTITUDE & HUMIDITÉ)
// ============================================================================
// Tableaux typés 1D (plus rapides et compacts en mémoire qu'un tableau 2D JS)
var mapHeight = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
var mapMoisture = new Float32Array(GRID_WIDTH * GRID_HEIGHT);

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
