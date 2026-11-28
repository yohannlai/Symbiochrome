// 6. INTERFACE UTILISATEUR (HUD), NAVIGATION CAMÉRA, EXPORT JSON & INSPECTION
// ============================================================================
var camera = { x: 0.5, y: 0.5, z: 1.15 };
var cameraTarget = null; // Cible optionnelle pour les transitions douces du Mode Présentation
var frame = 0;
var dragStart = null;
var isPaused = false;

/**
 * Définit une cible de caméra animée en douceur (utilisé par tour.js).
 */
function setCameraTarget(x, y, z) {
    cameraTarget = {
        x: clamp(x, 0, 1),
        y: clamp(y, 0, 1),
        z: clamp(z, 1.0, 5.0)
    };
}

// Navigation libre à la souris (annule automatiquement toute transition de caméra en cours)
glCanvas.onpointerdown = e => {
    cameraTarget = null;
    dragStart = [e.clientX, e.clientY];
};
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
    cameraTarget = null;
    camera.z = clamp(camera.z * (e.deltaY < 0 ? 1.1 : 0.9), 1.0, 5.0);
};

// Définition des curseurs du panneau de contrôle (avec clé de section pour le Mode Présentation)
var SLIDERS_DEF = [
    ['01. Monde (Fractales fBm + WFC)', 'world'],
    ['seed', 'Seed', 1, 999, 1, true],
    ['scale', 'Échelle', 0.8, 5, 0.1, true],
    ['rough', 'Rugosité', 0, 1, 0.01, true],
    ['hum', 'Humidité', 0, 1, 0.01, true],
    ['alt', 'Altitude', 0, 1, 0.01, true],
    ['02. Flore (Automates & L-Systems)', 'flora'],
    ['ang', 'Angle branchement', 10, 60, 1, false],
    ['grow', 'Croissance L-System', 0.1, 1.5, 0.05, false],
    ['bth', 'Automate : naissance', 2, 4, 1, false],
    ['smin', 'Automate : survie min', 1, 3, 1, false],
    ['mu', 'Lenia μ (seuil)', 0.1, 0.3, 0.005, false],
    ['03. Presse Risographie', 'riso'],
    ['ink', 'Intensité encrage', 0.6, 1.8, 0.05, false],
    ['grain', 'Grain Blue Noise', 0.1, 1.0, 0.05, false],
    ['misreg', 'Décalage encres', 0.0, 2.5, 0.1, false]
];

const slidersContainer = document.getElementById('sliders-container');
var regenTimer;
SLIDERS_DEF.forEach(def => {
    if (def.length === 2) {
        slidersContainer.insertAdjacentHTML('beforeend', `<h4 data-section="${def[1]}">${def[0]}</h4>`);
        return;
    }
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label><span>${def[1]}</span><b id="v_${def[0]}">${PARAMS[def[0]]}</b></label><input type="range" min="${def[2]}" max="${def[3]}" step="${def[4]}" value="${PARAMS[def[0]]}" id="s_${def[0]}">`;
    slidersContainer.append(wrap);
    wrap.querySelector('input').oninput = e => {
        PARAMS[def[0]] = +e.target.value;
        document.getElementById('v_' + def[0]).textContent = e.target.value;
        if (def[5]) {
            clearTimeout(regenTimer);
            regenTimer = setTimeout(generateWorld, 100);
        } else if (def[0] === 'ang') {
            renderLSystems();
        }
    };
});

// Trois configurations prédéfinies (Presets) exigées par le cahier des charges
var PRESETS = {
    Archipel: { seed: 17, scale: 2.2, rough: 0.42, hum: 0.72, alt: 0.42 },
    Steppes:  { seed: 42, scale: 1.4, rough: 0.25, hum: 0.35, alt: 0.56 },
    Crêtes:   { seed: 73, scale: 3.0, rough: 0.78, hum: 0.48, alt: 0.68 }
};
var presetsContainer = document.getElementById('presets-container');
for (const key in PRESETS) {
    const btn = document.createElement('button');
    btn.textContent = key;
    btn.onclick = () => {
        Object.assign(PARAMS, PRESETS[key]);
        SLIDERS_DEF.forEach(s => {
            if (s.length > 2) {
                document.getElementById('s_' + s[0]).value = PARAMS[s[0]];
                document.getElementById('v_' + s[0]).textContent = PARAMS[s[0]];
            }
        });
        generateWorld();
    };
    presetsContainer.append(btn);
}

/**
 * Synchronise l'état visuel de la grille WFC, du bouton et de son encadré explicatif.
 */
function setWfcGridVisible(visible) {
    showWfcGrid = visible;
    const btn = document.getElementById('btn-wfc-grid');
    const box = document.getElementById('wfc-explain-box');
    btn.classList.toggle('active', showWfcGrid);
    btn.textContent = showWfcGrid ? 'Masquer grille WFC' : 'Afficher grille WFC';
    box.classList.toggle('visible', showWfcGrid);
}

document.getElementById('btn-wfc-grid').onclick = () => setWfcGridVisible(!showWfcGrid);

// Export JSON des cartes de données (Heightmap, Humidité, Grille WFC) — Partie 1
document.getElementById('btn-export').onclick = () => {
    const exportData = {
        project: 'Symbiochrome — Projet GAIA',
        params: PARAMS,
        gridDimensions: [GRID_WIDTH, GRID_HEIGHT],
        wfcDimensions: [WFC_WIDTH, WFC_HEIGHT],
        wfcBiomes: Array.from(wfcLevels),
        heightMap: Array.from(mapHeight, v => +v.toFixed(3)),
        moistureMap: Array.from(mapMoisture, v => +v.toFixed(3))
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(exportData)], { type: 'application/json' }));
    a.download = 'symbiochrome_world_seed_' + PARAMS.seed + '.json';
    a.click();
};

document.getElementById('btn-pause').onclick = e => {
    isPaused = !isPaused;
    e.target.textContent = isPaused ? 'Reprendre' : 'Pause';
    e.target.classList.toggle('active', isPaused);
};
document.getElementById('btn-reset-flora').onclick = initFlora;

// Légende visuelle des biomes et couches d'encres
var LEGEND_ITEMS = [
    ['linear-gradient(135deg, #00c7d4, #1c47c7)', 'WFC 0-1 : Abysses & Eaux côtières'],
    ['linear-gradient(135deg, #ffe800, #00c7d4)', 'WFC 2-4 : Terres fertiles (Jaune + Aqua = Vert)'],
    ['linear-gradient(135deg, #ffe800, #ff2494)', 'WFC 5 : Sommets arides (Jaune + Pink = Orange)'],
    ['radial-gradient(#ff2494 40%, transparent 72%)', 'Automates : Life (mosaïque) & Lenia (brume)'],
    ['repeating-conic-gradient(#1c47c7 0 20deg, transparent 0 40deg)', 'L-Systems : 3 espèces (Rosace, Astre, Corolle)']
];
document.getElementById('legend-container').innerHTML = LEGEND_ITEMS.map(([bg, label]) =>
    `<div class="legend-item"><i class="swatch" style="background:${bg}"></i><span>${label}</span></div>`
).join('');

// Infobulle d'inspection au survol de la souris
var tooltipText = document.getElementById('tooltip-text');
glCanvas.addEventListener('pointermove', e => {
    const rect = glCanvas.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) / rect.width - 0.5) / camera.z + camera.x;
    const wy = ((e.clientY - rect.top) / rect.height - 0.5) / camera.z + camera.y;
    const gx = (wx * GRID_WIDTH) | 0, gy = (wy * GRID_HEIGHT) | 0;
    if (gx < 0 || gy < 0 || gx >= GRID_WIDTH || gy >= GRID_HEIGHT) return;

    const idx = gy * GRID_WIDTH + gx;
    const biome = getBiomeAtGrid(gx, gy);
    const pl = plants.find(p => Math.hypot(p.x / SCALE - gx, p.y / SCALE - gy) < 4);

    tooltipText.innerHTML =
        `<b>${BIOME_NAMES[biome]}</b><br>` +
        `Alt ${(mapHeight[idx] * 100) | 0}% · Hum ${(mapMoisture[idx] * 100) | 0}%<br>` +
        `${gridLife[idx] ? 'Life · ' : ''}${gridLenia[idx] > 0.2 ? 'Lenia · ' : ''}` +
        `${pl ? ['Rosace', 'Astre', 'Corolle'][pl.type] + ' (âge ' + (pl.age | 0) + ')' : ''}`;
});
