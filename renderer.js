// 5. MOTEUR DE RENDU WEBGL — SHADER RISOGRAPHIE (ORGANIQUE + APERÇU GRILLE WFC)
// ============================================================================
var glCanvas = document.getElementById('gl-canvas');
var gl = glCanvas.getContext('webgl');

// Canevas 2D hors-écran dédié uniquement aux L-Systems (encre Medium Blue)
var lsysCanvas = document.createElement('canvas');
lsysCanvas.width = GRID_WIDTH * SCALE;
lsysCanvas.height = GRID_HEIGHT * SCALE;
var lsysCtx = lsysCanvas.getContext('2d');

// Buffer léger 160x100 (64 Ko) pour envoyer directement Life & Lenia au GPU
var automataTexData = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 4);

/**
 * Fragment Shader GLSL :
 *  - uTexFractal  (unité 0) : Altitude organique (WFC lissé + fBm) & Humidité
 *  - uTexAutomata (unité 1) : Life (R) & Lenia (G) filtrés en bilinéaire GPU
 *  - uTexBlueNoise(unité 2) : Texture Blue Noise 128x128 sans couture
 *  - uTexPaper    (unité 3) : Texture Papier Coton 512x512
 *  - uTexLsys     (unité 4) : Couche vectorielle des L-Systems (G)
 *  - uTexWFC      (unité 5) : Grille brute des 6 biomes WFC (20x12) pour le mode aperçu
 */
var fragmentShaderSource = `
precision highp float;

uniform sampler2D uTexFractal, uTexAutomata, uTexBlueNoise, uTexPaper, uTexLsys, uTexWFC;
uniform vec2 uRes, uCamPos;
uniform float uZoom, uGrain, uMisreg, uInk, uShowWfc;

// Convertit une densité d'encre [0..1] en tramage stochastique net (points de pigment pur)
float risoBlueNoiseMask(vec2 fragCoord, float density, vec2 bnOffset) {
    if (density <= 0.02) return 0.0;
    float bn = texture2D(uTexBlueNoise, fract(fragCoord / 128.0 + bnOffset)).r;
    float tooth = texture2D(uTexPaper, fract(fragCoord / 512.0 + bnOffset * 0.25)).r;

    float boosted = clamp(pow(density, 0.80) * uInk, 0.0, 1.0);
    float d = clamp(boosted + (tooth - 0.93) * 0.55 * uGrain, 0.0, 1.0);

    float threshold = mix(0.5, bn, uGrain);
    float ink = smoothstep(threshold - 0.055, threshold + 0.055, d);
    float pores = 1.0 - (0.06 * uGrain * smoothstep(0.88, 0.99, bn));
    return clamp(ink * pores, 0.0, 1.0);
}

// Rendu organique en courbes de niveau basé sur le relief WFC lissé + fBm :
// vec4(FluoPink, MediumBlue, SunflowerYellow, Aqua)
vec4 getTerrainInks(vec2 uv) {
    vec4 fm = texture2D(uTexFractal, uv);
    float h = fm.r;
    float hum = fm.g;
    vec4 ink = vec4(0.0);

    // Isolignes topographiques nettes
    float iso = smoothstep(0.11, 0.02, abs(fract(h * 7.0) - 0.5));

    if (h < 0.34) {
        // Biomes 0 & 1 (Abysses / Eaux côtières) : aplat Aqua franc + isolignes Medium Blue
        ink.w = mix(0.68, 0.96, 1.0 - h / 0.34);
        ink.y = iso * 0.65;
    } else if (h < 0.78) {
        // Biomes 2, 3 & 4 (Plaine / Collines / Montagne) : papier vierge dans les creux secs,
        // aplats Sunflower Yellow + Aqua en zone humide (= surimpression Vert Riso)
        float landStep = smoothstep(0.42, 0.52, h);
        ink.z = landStep * mix(0.55, 0.88, (h - 0.34) / 0.44);
        ink.w = smoothstep(0.58, 0.72, hum) * 0.62;
        ink.z = max(ink.z, iso * 0.55);
    } else {
        // Biome 5 (Sommet) : surimpression Sunflower Yellow + Fluo Pink (= Orange fluo vif)
        ink.z = 0.94;
        ink.x = mix(0.55, 0.85, (h - 0.78) / 0.22);
        ink.x = max(ink.x, iso * 0.88);
    }
    return ink;
}

float sampleAutomata(vec2 uv) {
    vec4 a = texture2D(uTexAutomata, clamp(uv, 0.0, 1.0));
    return clamp(a.r * 0.92 + a.g * 0.88, 0.0, 1.0);
}

void main() {
    vec2 frag = gl_FragCoord.xy;
    vec2 screenUV = frag / uRes;
    screenUV.y = 1.0 - screenUV.y;
    vec2 w = (screenUV - 0.5) / uZoom + uCamPos;

    vec3 col = texture2D(uTexPaper, fract(frag / 512.0)).rgb;

    if (w.x >= 0.0 && w.x <= 1.0 && w.y >= 0.0 && w.y <= 1.0) {
        vec2 px = (1.0 / uRes) / uZoom;
        vec2 offPink   = vec2( 2.4, -1.6) * px * uMisreg;
        vec2 offBlue   = vec2(-2.0,  1.8) * px * uMisreg;
        vec2 offYellow = vec2(-1.4, -2.0) * px * uMisreg;
        vec2 offAqua   = vec2( 1.8,  2.0) * px * uMisreg;

        float autoPink = sampleAutomata(w + offPink);
        float lsysBlue = texture2D(uTexLsys, clamp(w + offBlue, 0.0, 1.0)).g;

        float pinkAmt   = clamp(getTerrainInks(w + offPink).x   + autoPink, 0.0, 1.0);
        float blueAmt   = clamp(getTerrainInks(w + offBlue).y   + lsysBlue, 0.0, 1.0);
        float yellowAmt = clamp(getTerrainInks(w + offYellow).z, 0.0, 1.0);
        float aquaAmt   = clamp(getTerrainInks(w + offAqua).w,   0.0, 1.0);

        float mYellow = risoBlueNoiseMask(frag, yellowAmt, vec2(0.00, 0.00));
        float mAqua   = risoBlueNoiseMask(frag, aquaAmt,   vec2(0.37, 0.19));
        float mPink   = risoBlueNoiseMask(frag, pinkAmt,   vec2(0.71, 0.53));
        float mBlue   = risoBlueNoiseMask(frag, blueAmt,   vec2(0.23, 0.83));

        // 4 Encres Risographie haute saturation
        vec3 inkYellow = vec3(1.00, 0.91, 0.00);
        vec3 inkAqua   = vec3(0.00, 0.78, 0.83);
        vec3 inkPink   = vec3(1.00, 0.14, 0.58);
        vec3 inkBlue   = vec3(0.11, 0.28, 0.78);

        col *= mix(vec3(1.0), inkYellow, mYellow * 0.98);
        col *= mix(vec3(1.0), inkAqua,   mAqua   * 0.96);
        col *= mix(vec3(1.0), inkPink,   mPink   * 0.98);
        col *= mix(vec3(1.0), inkBlue,   mBlue   * 0.98);

        // Mode soutenance : superposition légère de la grille WFC 20x12 (tuiles & niveaux)
        if (uShowWfc > 0.5) {
            vec2 g = fract(w * vec2(20.0, 12.0));
            float border = step(g.x, 0.035) + step(g.y, 0.035);
            float biomeId = floor(texture2D(uTexWFC, w).r * 255.0 + 0.5);
            // Teinte discrète par niveau WFC + quadrillage Medium Blue
            vec3 tint = mix(vec3(0.0, 0.65, 0.85), vec3(1.0, 0.20, 0.55), biomeId / 5.0);
            col = mix(col, tint, 0.16);
            col = mix(col, inkBlue, clamp(border, 0.0, 1.0) * 0.65);
        }
    } else {
        col *= 0.95;
    }

    gl_FragColor = vec4(col, 1.0);
}
`;

function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Erreur de compilation du shader GLSL :', gl.getShaderInfoLog(s));
    }
    return s;
}

var program = gl.createProgram();
gl.attachShader(program, compileShader(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'));
gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource));
gl.linkProgram(program);
gl.useProgram(program);

var quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
var locP = gl.getAttribLocation(program, 'p');
gl.enableVertexAttribArray(locP);
gl.vertexAttribPointer(locP, 2, gl.FLOAT, false, 0, 0);

var textures = [0, 1, 2, 3, 4, 5].map(() => gl.createTexture());
var getU = name => gl.getUniformLocation(program, name);
['uTexFractal', 'uTexAutomata', 'uTexBlueNoise', 'uTexPaper', 'uTexLsys', 'uTexWFC'].forEach((n, i) => gl.uniform1i(getU(n), i));
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

// Initialisation par défaut puis chargement des textures Blue Noise et Papier
uploadTexture(2, 1, 1, new Uint8Array([128, 128, 128, 255]), gl.NEAREST, gl.REPEAT);
uploadTexture(3, 1, 1, new Uint8Array([245, 240, 227, 255]), gl.LINEAR, gl.REPEAT);
uploadTexture(4, 1, 1, new Uint8Array([0, 0, 0, 255]), gl.LINEAR, gl.CLAMP_TO_EDGE);
uploadTexture(5, 1, 1, new Uint8Array([0, 0, 0, 255]), gl.NEAREST, gl.CLAMP_TO_EDGE);

if (window.RISO_TEXTURES) {
    const imgBN = new Image();
    imgBN.onload = () => uploadTexture(2, 0, 0, imgBN, gl.NEAREST, gl.REPEAT);
    imgBN.src = window.RISO_TEXTURES.blueNoise;

    const imgPaper = new Image();
    imgPaper.onload = () => uploadTexture(3, 0, 0, imgPaper, gl.LINEAR, gl.REPEAT);
    imgPaper.src = window.RISO_TEXTURES.paper;
}

/**
 * Envoie les grilles d'automates (Life dans R, Lenia dans G) directement au GPU
 * dans une texture légère 160x100 (64 Ko) avec filtrage bilinéaire matériel.
 */
function uploadAutomataTexture() {
    const W = GRID_WIDTH, H = GRID_HEIGHT;
    for (let y = 0; y < H; y++) {
        const row = y * W;
        for (let x = 0; x < W; x++) {
            const i = row + x;
            const o = i * 4;
            const lifeOn = gridLife[i] && (((x + y) & 1) || gridAge[i] < 4);
            automataTexData[o]     = lifeOn ? 235 : 0;
            automataTexData[o + 1] = gridLenia[i] > 0.08 ? Math.min(255, (gridLenia[i] * 255) | 0) : 0;
            automataTexData[o + 2] = 0;
            automataTexData[o + 3] = 255;
        }
    }
    uploadTexture(1, W, H, automataTexData, gl.LINEAR, gl.CLAMP_TO_EDGE);
    needsAutomataUpload = false;
}

/**
 * Envoie le canevas des L-Systems au GPU (appelé uniquement quand les plantes poussent
 * ou quand l'angle de branchement est modifié).
 */
function uploadLSystemsTexture() {
    uploadTexture(4, 0, 0, lsysCanvas, gl.LINEAR, gl.CLAMP_TO_EDGE);
    needsLsysUpload = false;
}
