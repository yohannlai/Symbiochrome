// 6. INTERFACE UTILISATEUR (HUD), NAVIGATION CAMÉRA & BOUCLE PRINCIPALE
// ============================================================================
var camera = { x: 0.5, y: 0.5, z: 1.15 };
var frame = 0;
var dragStart = null;
var isPaused = false;

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
var SLIDERS_DEF = [
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
var regenTimer;
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
var PRESETS = {
    Archipel: { seed: 17, scale: 2.2, rough: 0.45, hum: 0.72, alt: 0.44 },
    Steppes:  { seed: 42, scale: 1.4, rough: 0.25, hum: 0.35, alt: 0.56 },
    Crêtes:   { seed: 73, scale: 3.0, rough: 0.80, hum: 0.50, alt: 0.65 }
};
var presetsContainer = document.getElementById('presets-container');
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
var LEGEND_ITEMS = [
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
var tooltipText = document.getElementById('tooltip-text');
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
