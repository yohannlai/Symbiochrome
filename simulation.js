// 4. BRIQUE 2 & 3 : AUTOMATES CELLULAIRES (LIFE & LENIA) + L-SYSTEMS
// ============================================================================
var gridLife;    // État binaire (0 ou 1) de l'automate discret (Mosaïque rose)
var gridAge;     // Âge de chaque cellule vivante (pour varier le rendu)
var gridLenia;   // État continu [0.0 .. 1.0] de l'automate Lenia (Brume rose)
var plants;      // Liste des individus L-Systems implantés sur la carte

// --- Précalcul du noyau de convolution en anneau pour Lenia ---
// Lenia regarde le voisinage dans un rayon R=5 avec une pondération gaussienne
// centrée à mi-rayon (r = 0.5), ce qui produit des motifs organiques fluides.
var kernel = [];
for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
        const r = Math.hypot(dx, dy) / 5;
        if (r > 0 && r <= 1) {
            const weight = Math.exp(-(((r - 0.5) / 0.15) ** 2) / 2);
            kernel.push([dx, dy, weight]);
        }
    }
}
var kernelSum = kernel.reduce((sum, item) => sum + item[2], 0);

// --- Grammaires formelles des 3 espèces de L-Systems ---
// F = avancer en traçant un pétale | + / - = tourner | [ / ] = empiler/dépiler l'état
var L_RULES = [
    { F: 'F[+F]F[-F]F' },            // Espèce 0 : Rosace ramifiée (symétrie d'ordre 6)
    { F: 'FF[+F][-F][++F][--F]' },   // Espèce 1 : Astre étoilé dense (symétrie d'ordre 8)
    { F: 'F[+F]F[-F+F]' }            // Espèce 2 : Corolle asymétrique (symétrie d'ordre 5)
];
var L_SYMMETRY = [6, 8, 5];
var lsysCache = {}; // Mémoïsation des chaînes réécrites pour éviter de recalculer à chaque frame

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
