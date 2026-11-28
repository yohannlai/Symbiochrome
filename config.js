/**
 * ============================================================================
 * SYMBIOCHROME — PROJET GAIA IMAC 2027
 * ============================================================================
 * Architecture logicielle : JavaScript natif (Vanilla JS) + WebGL (GLSL)
 *
 * Modules actifs :
 *   1. MONDE (Fractales fBm + Wave Function Collapse) :
 *      - Le bruit fractal guide les probabilités d'une grille WFC à 6 biomes
 *        avec contraintes d'adjacence strictes (|biome A - biome B| <= 1).
 *      - Le rendu reste organique (courbes de niveau lissées), avec un mode
 *        d'aperçu de la grille WFC (chiffres 0..5) pour la soutenance.
 *   2. FLORE (Automates Cellulaires Life/Lenia + 3 espèces L-Systems) :
 *      - Contrainte par les biomes habitables du WFC et modulée par l'humidité.
 *   3. RENDU RISOGRAPHIE WEBGL :
 *      - 4 encres haute saturation, tramage Blue Noise, surimpression
 *        soustractive (Multiply) et défaut de calage entre tambours.
 *   4. MODE PRÉSENTATION (tour.js) :
 *      - Visite guidée interactive expliquant la théorie et le code interne.
 * ============================================================================
 */

// ============================================================================
// 1. CONSTANTES DE SIMULATION & PARAMÈTRES UTILISATEUR
// ============================================================================
var GRID_WIDTH = 160;   // Résolution horizontale de la grille de simulation
var GRID_HEIGHT = 100;  // Résolution verticale de la grille de simulation
var WFC_WIDTH = 20;     // Résolution horizontale de la grille Wave Function Collapse
var WFC_HEIGHT = 12;    // Résolution verticale de la grille Wave Function Collapse
var SCALE = 8;          // Facteur d'échelle vers le canevas (160*8 = 1280px, 100*8 = 800px)

// Noms complets et abrégés des 6 biomes résolus par le WFC (du niveau 0 au niveau 5)
var BIOME_NAMES = [
    '0 · Abysses',
    '1 · Eaux côtières',
    '2 · Plaine fertile',
    '3 · Collines humides',
    '4 · Plateau / Montagne',
    '5 · Sommet aride'
];
var BIOME_SHORT = ['Abysses', 'Eaux', 'Plaine', 'Collines', 'Montagne', 'Sommet'];

// Dictionnaire centralisé des paramètres modifiables via les curseurs du HUD
var PARAMS = {
    // --- Partie 1 : Monde (Fractales fBm + WFC) ---
    seed: 17,     // Graine aléatoire reproductible
    scale: 2.2,   // Fréquence spatiale du bruit fractal
    rough: 0.42,  // Rugosité fractale + tolérance de variation du WFC
    hum: 0.65,    // Biais global d'humidité (module la flore et les automates)
    alt: 0.48,    // Décalage global d'altitude (niveau de la mer)

    // --- Partie 2 : Flore (L-Systems + Automates cellulaires) ---
    ang: 28,      // Angle de branchement (en degrés) des L-Systems
    grow: 0.65,   // Vitesse de croissance des L-Systems
    bth: 3,       // Règle de naissance de l'automate discret (voisins requis)
    smin: 2,      // Règle de survie minimale de l'automate discret
    mu: 0.21,     // Centre de la fonction de croissance gaussienne de Lenia (μ)

    // --- Presse Risographie (Rendu WebGL) ---
    ink: 1.20,    // Richesse d'encrage sur le papier
    grain: 0.88,  // Intensité du tramage stochastique Blue Noise
    misreg: 1.2   // Défaut de calage mécanique entre tambours
};

// Drapeaux d'affichage et de synchronisation CPU -> GPU
var showWfcGrid = false;       // Affiche/masque la superposition de la grille WFC + chiffres 0..5
var needsAutomataUpload = true;
var needsLsysUpload = true;

var rnd = Math.random;
var clamp = (val, min, max) => Math.max(min, Math.min(max, val));
