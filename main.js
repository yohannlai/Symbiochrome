// 8. BOUCLE PRINCIPALE D'ANIMATION (60 FPS)
// ============================================================================
function mainLoop() {
    frame++;
    if (!isPaused) {
        if (frame % 10 === 0) updateAutomatonLife();  // Pas discret toutes les 10 frames
        if (frame % 3 === 0) updateAutomatonLenia();  // Pas continu toutes les 3 frames
        if (frame % 60 === 0) updateLSystems();       // Croissance fluide des L-Systems
    }

    // Transition douce de la caméra lorsqu'une étape du Mode Présentation la pilote
    if (cameraTarget) {
        camera.x += (cameraTarget.x - camera.x) * 0.08;
        camera.y += (cameraTarget.y - camera.y) * 0.08;
        camera.z += (cameraTarget.z - camera.z) * 0.08;
        if (Math.hypot(cameraTarget.x - camera.x, cameraTarget.y - camera.y) < 0.002 &&
            Math.abs(cameraTarget.z - camera.z) < 0.01) {
            camera.x = cameraTarget.x;
            camera.y = cameraTarget.y;
            camera.z = cameraTarget.z;
            cameraTarget = null;
        }
    }

    camera.x = clamp(camera.x, 0.5 / camera.z, 1 - 0.5 / camera.z);
    camera.y = clamp(camera.y, 0.5 / camera.z, 1 - 0.5 / camera.z);

    if (needsAutomataUpload) uploadAutomataTexture();
    if (needsLsysUpload) uploadLSystemsTexture();

    gl.uniform2f(getU('uCamPos'), camera.x, camera.y);
    gl.uniform1f(getU('uZoom'), camera.z);
    gl.uniform1f(getU('uInk'), PARAMS.ink);
    gl.uniform1f(getU('uGrain'), PARAMS.grain);
    gl.uniform1f(getU('uMisreg'), PARAMS.misreg);
    gl.uniform1f(getU('uShowWfc'), showWfcGrid ? 1.0 : 0.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Mise à jour du calque 2D (chiffres 0..5 sur chaque case WFC si la grille est affichée)
    drawWfcOverlay();

    requestAnimationFrame(mainLoop);
}

// Lancement initial : génération du monde (Fractales + WFC) puis boucle d'animation
generateWorld();
requestAnimationFrame(mainLoop);
