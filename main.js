// 7. BOUCLE PRINCIPALE D'ANIMATION (60 FPS)
// ============================================================================
function mainLoop() {
    frame++;
    if (!isPaused) {
        if (frame % 10 === 0) updateAutomatonLife();  // Pas discret toutes les 10 frames
        if (frame % 3 === 0) updateAutomatonLenia();  // Pas continu toutes les 3 frames
        if (frame % 60 === 0) updateLSystems();       // Croissance fluide des L-Systems
    }

    camera.x = clamp(camera.x, 0.5 / camera.z, 1 - 0.5 / camera.z);
    camera.y = clamp(camera.y, 0.5 / camera.z, 1 - 0.5 / camera.z);

    // Envoi au GPU uniquement lorsque les données ont réellement changé
    if (needsAutomataUpload) uploadAutomataTexture();
    if (needsLsysUpload) uploadLSystemsTexture();

    gl.uniform2f(getU('uCamPos'), camera.x, camera.y);
    gl.uniform1f(getU('uZoom'), camera.z);
    gl.uniform1f(getU('uInk'), PARAMS.ink);
    gl.uniform1f(getU('uGrain'), PARAMS.grain);
    gl.uniform1f(getU('uMisreg'), PARAMS.misreg);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(mainLoop);
}

// Lancement initial au chargement de la page
generateFractalTerrain();
requestAnimationFrame(mainLoop);
