/**
 * ============================================================================
 * SYMBIOCHROME — PROJET GAIA IMAC 2027
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
 *        seront branchés sur ces grilles de données lors d'une prochaine étape.
 * ============================================================================
 */

// ============================================================================
// 1. CONSTANTES DE SIMULATION & PARAMÈTRES UTILISATEUR
// ============================================================================
var GRID_WIDTH = 160;   // Résolution horizontale de la grille de simulation
var GRID_HEIGHT = 100;  // Résolution verticale de la grille de simulation
var SCALE = 8;          // Facteur d'échelle vers le canevas (160*8 = 1280px, 100*8 = 800px)

// Dictionnaire centralisé des paramètres modifiables via les curseurs du HUD
var PARAMS = {
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

var rnd = Math.random;
var clamp = (val, min, max) => Math.max(min, Math.min(max, val));

