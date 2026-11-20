// 5. MOTEUR DE RENDU WEBGL — SHADER RISOGRAPHIE (BLUE NOISE + 4 ENCRES)
// ============================================================================
var glCanvas = document.getElementById('gl-canvas');
var gl = glCanvas.getContext('webgl');

// Canevas 2D hors-écran qui rassemble les couches dynamiques (flore) avant envoi au GPU
var dynCanvas = document.createElement('canvas');
dynCanvas.width = GRID_WIDTH * SCALE;
dynCanvas.height = GRID_HEIGHT * SCALE;
var dynCtx = dynCanvas.getContext('2d');

// Canevas 2D hors-écran dédié au dessin des L-Systems
var lsysCanvas = document.createElement('canvas');
lsysCanvas.width = GRID_WIDTH * SCALE;
lsysCanvas.height = GRID_HEIGHT * SCALE;
var lsysCtx = lsysCanvas.getContext('2d');

/**
 * Fragment Shader GLSL :
 *  - Lit la texture du terrain fractal (uTexFractal) et trace les courbes de niveau.
 *  - Lit la texture des couches dynamiques (uTexDyn : R = automates, G = L-Systems).
 *  - Applique le tramage stochastique Blue Noise (uTexBlueNoise) et le grain du papier (uTexPaper).
 *  - Simule le défaut de calage entre tambours (uMisreg) et la surimpression soustractive (Multiply).
 */
var fragmentShaderSource = `
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

var program = gl.createProgram();
gl.attachShader(program, compileShader(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'));
gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource));
gl.linkProgram(program);
gl.useProgram(program);

// Quad plein écran sur lequel le Fragment Shader s'exécute pour chaque pixel
var quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
var locP = gl.getAttribLocation(program, 'p');
gl.enableVertexAttribArray(locP);
gl.vertexAttribPointer(locP, 2, gl.FLOAT, false, 0, 0);

var textures = [0, 1, 2, 3].map(() => gl.createTexture());
var getU = name => gl.getUniformLocation(program, name);
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
