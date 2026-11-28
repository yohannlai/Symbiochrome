// 7. MODE PRÉSENTATION / VISITE GUIDÉE INTERACTIVE (THÉORIE + CODE INTERNE)
// ============================================================================
/**
 * Ce module pilote une visite guidée en 7 étapes pensée à la fois :
 *  - comme outil pédagogique (pour comprendre chaque brique algorithmique),
 *  - comme support de soutenance live (caméra guidée, activation automatique
 *    de la grille WFC, zoom sur les L-Systems, surbrillance du HUD).
 */
var TOUR_STEPS = [
    {
        title: "Symbiochrome & l'Hypothèse Gaïa",
        section: null,
        theory:
            "Inspiré par <b>James Lovelock</b> (hypothèse Gaïa) et <b>Lynn Margulis</b> (symbiogenèse), " +
            "Symbiochrome traduit la coopération biologique par la <b>risographie</b> : chaque système " +
            "algorithmique est imprimé sur une couche d'encre pure (Aqua, Jaune, Rose fluo, Bleu) qui se " +
            "mélange par surimpression soustractive.",
        code:
            "Architecture 100% <b>Vanilla JS + WebGL natif</b> découpée en modules clairs : " +
            "<code>config.js</code> (paramètres), <code>math.js</code> (bruit fractal), " +
            "<code>terrain.js</code> (WFC), <code>simulation.js</code> (flore), " +
            "<code>renderer.js</code> (shader GLSL) et <code>hud.js</code> (contrôles).",
        onEnter: () => {
            setWfcGridVisible(false);
            setCameraTarget(0.5, 0.5, 1.15);
        }
    },
    {
        title: "Partie 1A — Terrain Fractal (fBm)",
        section: "world",
        theory:
            "Le relief et l'humidité sont générés par un <b>Mouvement Brownien Fractionnaire (fBm)</b> : " +
            "on additionne 5 octaves de bruit lissé en doublant la fréquence à chaque étape. " +
            "Une même graine (<b>Seed</b>) reproduit toujours exactement le même monde.",
        code:
            "Dans <code>math.js</code> : <code>createRNG()</code> (Mulberry32 déterministe) alimente " +
            "<code>createNoise()</code> (interpolation cubique) puis <code>fbm()</code>. " +
            "Les 5 curseurs du HUD (<i>Seed, Échelle, Rugosité, Humidité, Altitude</i>) recalculent " +
            "la carte via <code>generateWorld()</code> dans <code>terrain.js</code>.",
        onEnter: () => {
            setWfcGridVisible(false);
            setCameraTarget(0.5, 0.5, 1.35);
        }
    },
    {
        title: "Partie 1B — Wave Function Collapse (WFC)",
        section: "world",
        theory:
            "Le WFC résout une grille <b>20×12</b> de <b>6 biomes</b> (<b>0</b> Abysses → <b>5</b> Sommet) " +
            "avec une règle stricte de voisinage : deux cases adjacentes ont au plus <b>±1 niveau d'écart</b>. " +
            "Impossible de coller un sommet directement aux abysses ! Les courbes organiques traversent " +
            "les cases car la grille est ensuite lissée pour éviter un effet carrelage.",
        code:
            "Dans <code>terrain.js</code> : <code>runWaveFunctionCollapse()</code> initialise chaque case " +
            "en superposition (masque 6 bits <code>63</code>), choisit la case d'<b>entropie minimale</b>, " +
            "l'effondre selon les poids fractals puis propage <code>NEIGHBOR_RULES</code> via une pile. " +
            "La grille est lissée bilinéairement puis envoyée au GPU (<code>uTexWFC</code> + calque 2D).",
        onEnter: () => {
            setWfcGridVisible(true);
            setCameraTarget(0.5, 0.5, 1.45);
        }
    },
    {
        title: "Partie 2A — Automates Cellulaires (Life & Lenia)",
        section: "flora",
        theory:
            "La biomasse rose fluo combine deux automates couplés au terrain : un <b>Jeu de la Vie discret</b> " +
            "(mosaïque cellulaire) et un automate continu <b>Lenia</b> (brume organique fluide). " +
            "Ils ne survivent que sur les biomes terrestres du WFC (<b>2, 3 et 4</b>) et réagissent en direct à l'humidité.",
        code:
            "Dans <code>simulation.js</code> : <code>isHabitable()</code> filtre selon <code>getBiomeAtGrid()</code>. " +
            "<code>updateAutomatonLife()</code> compte les 8 voisins (Moore) et applique le stress hydrique. " +
            "<code>updateAutomatonLenia()</code> effectue une convolution par noyau gaussien en anneau " +
            "(<code>kernelDx/Dy/W</code>) dont le pic <code>μ</code> est décalé par <code>mapMoisture</code>.",
        onEnter: () => {
            setWfcGridVisible(false);
            // Zoom sur une zone fertile (biome 2..4)
            let tx = 0.5, ty = 0.5;
            for (let i = 0; i < GRID_WIDTH * GRID_HEIGHT; i++) {
                if (isHabitable(i) && (gridLife[i] || gridLenia[i] > 0.3)) {
                    tx = (i % GRID_WIDTH) / GRID_WIDTH;
                    ty = ((i / GRID_WIDTH) | 0) / GRID_HEIGHT;
                    break;
                }
            }
            setCameraTarget(tx, ty, 2.2);
        }
    },
    {
        title: "Partie 2B — L-Systems (3 espèces végétales)",
        section: "flora",
        theory:
            "Trois espèces végétales en <b>Medium Blue</b> (<i>Rosace, Astre, Corolle</i>) poussent sur les sols " +
            "humides à partir de grammaires formelles récursives. En grandissant, elles <b>essaiment</b> des " +
            "graines actives dans l'automate cellulaire autour de leurs racines.",
        code:
            "Dans <code>simulation.js</code> : <code>L_RULES</code> définit les 3 règles de réécriture " +
            "(ex. <code>F → F[+F]F[-F]F</code>) mémoïsées par <code>generateLSystemString()</code>. " +
            "<code>renderLSystems()</code> interprète la chaîne avec une pile de tortue et dessine des " +
            "pétales pleins (<code>drawFilledPetal</code>) envoyés au GPU via <code>uTexLsys</code>.",
        onEnter: () => {
            setWfcGridVisible(false);
            if (plants && plants.length > 0) {
                const p = plants[0];
                setCameraTarget(p.x / (GRID_WIDTH * SCALE), p.y / (GRID_HEIGHT * SCALE), 2.8);
            } else {
                setCameraTarget(0.5, 0.5, 2.2);
            }
        }
    },
    {
        title: "Rendu GPU — Presse Risographie WebGL",
        section: "riso",
        theory:
            "Pourquoi du <b>WebGL en 2D</b> ? Calculer le grain d'encre, les fibres du papier et la fusion " +
            "soustractive sur 1 million de pixels 60 fois par seconde saturerait le CPU. Le GPU traite tous " +
            "les pixels en parallèle et reproduit fidèlement le décalage mécanique entre tambours (<i>misregistration</i>).",
        code:
            "Dans <code>renderer.js</code> : le <b>Fragment Shader GLSL</b> échantillonne les 4 couches " +
            "(terrain, automates <code>uTexAutomata</code>, plantes <code>uTexLsys</code>) avec un décalage " +
            "par tambour, applique le tramage stochastique <code>risoBlueNoiseMask()</code> (texture Blue Noise " +
            "128×128 + papier coton 512×512) puis multiplie les 4 encres Pantone.",
        onEnter: () => {
            setWfcGridVisible(false);
            setCameraTarget(0.5, 0.5, 1.8);
        }
    },
    {
        title: "Interopérabilité, Export & Suite (Partie 3)",
        section: "controls",
        theory:
            "Ce jalon valide intégralement les <b>Parties 1 et 2</b> du cahier des charges (5 paramètres, " +
            "3 presets, WFC contraint, export de données, 3 espèces L-Systems + Life/Lenia couplés au sol). " +
            "Prochaine étape : la <b>Partie 3</b> ajoutera les essaims (Boids), leur Perceptron et l'Algorithme Génétique.",
        code:
            "Dans <code>hud.js</code> : le bouton <b>Export JSON</b> sérialise <code>wfcBiomes</code>, " +
            "<code>heightMap</code> et <code>moistureMap</code>. Les données de biomasse déjà calculées " +
            "dans <code>simulation.js</code> serviront directement de capteurs de nourriture aux futurs Boids " +
            "pollinisateurs. (Raccourcis visite : <code>←</code> / <code>→</code> / <code>Échap</code>.)",
        onEnter: () => {
            setWfcGridVisible(false);
            setCameraTarget(0.5, 0.5, 1.15);
        }
    }
];

var tourActive = false;
var tourIndex = 0;

var tourCard = document.getElementById('tour-card');
var tourStepBadge = document.getElementById('tour-step-badge');
var tourTitle = document.getElementById('tour-title');
var tourTheory = document.getElementById('tour-theory');
var tourCode = document.getElementById('tour-code');
var tourDots = document.getElementById('tour-dots');
var tourPrevBtn = document.getElementById('tour-prev-btn');
var tourNextBtn = document.getElementById('tour-next-btn');
var tourBtn = document.getElementById('btn-tour');

// Création des points de navigation rapide
TOUR_STEPS.forEach((_, idx) => {
    const dot = document.createElement('button');
    dot.className = 'tour-dot';
    dot.title = `Étape ${idx + 1}`;
    dot.onclick = () => showTourStep(idx);
    tourDots.appendChild(dot);
});

function clearHudHighlights() {
    document.querySelectorAll('#hud-panel h4.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));
}

function showTourStep(idx) {
    tourIndex = clamp(idx, 0, TOUR_STEPS.length - 1);
    const step = TOUR_STEPS[tourIndex];

    tourStepBadge.textContent = `${tourIndex + 1} / ${TOUR_STEPS.length}`;
    tourTitle.textContent = step.title;
    tourTheory.innerHTML = step.theory;
    tourCode.innerHTML = step.code;

    tourPrevBtn.disabled = tourIndex === 0;
    tourPrevBtn.style.opacity = tourIndex === 0 ? '0.45' : '1';
    tourNextBtn.textContent = tourIndex === TOUR_STEPS.length - 1 ? 'Terminer ✓' : 'Suivant →';

    // Mise à jour des pastilles de progression
    Array.from(tourDots.children).forEach((d, i) => d.classList.toggle('active', i === tourIndex));

    // Surbrillance de la section correspondante dans le panneau de droite
    clearHudHighlights();
    if (step.section) {
        const header = document.querySelector(`#hud-panel h4[data-section="${step.section}"]`);
        if (header) {
            header.classList.add('tour-highlight');
            header.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    if (step.onEnter) step.onEnter();
}

function startTour() {
    tourActive = true;
    tourCard.classList.add('visible');
    tourBtn.classList.add('active');
    tourBtn.textContent = '■ Quitter la présentation';
    showTourStep(0);
}

function stopTour() {
    tourActive = false;
    tourCard.classList.remove('visible');
    tourBtn.classList.remove('active');
    tourBtn.textContent = '▶ Mode Présentation (Visite guidée)';
    clearHudHighlights();
    cameraTarget = null;
}

tourBtn.onclick = () => (tourActive ? stopTour() : startTour());
document.getElementById('tour-close-btn').onclick = stopTour;
tourPrevBtn.onclick = () => showTourStep(tourIndex - 1);
tourNextBtn.onclick = () => {
    if (tourIndex >= TOUR_STEPS.length - 1) stopTour();
    else showTourStep(tourIndex + 1);
};

// Raccourcis clavier pratiques pendant une soutenance (Flèches gauche/droite + Échap)
window.addEventListener('keydown', e => {
    if (!tourActive) return;
    if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (tourIndex < TOUR_STEPS.length - 1) showTourStep(tourIndex + 1);
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (tourIndex > 0) showTourStep(tourIndex - 1);
    } else if (e.key === 'Escape') {
        stopTour();
    }
});
