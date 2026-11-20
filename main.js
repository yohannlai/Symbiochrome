function mainLoop() {
    frame++;
    if (!isPaused) {
        if (frame % 15 === 0) updateAutomatonLife();  // Pas discret toutes les 15 frames
        if (frame % 4 === 0) updateAutomatonLenia(); // Pas continu toutes les 4 frames
        if (frame % 120 === 0) updateLSystems();     // Croissance lente des L-Systems
    }

    camera.x = clamp(camera.x, 0.5 / camera.z, 1 - 0.5 / camera.z);
    camera.y = clamp(camera.y, 0.5 / camera.z, 1 - 0.5 / camera.z);

    renderDynamicElements();
    gl.uniform2f(getU('uCamPos'), camera.x, camera.y);
    gl.uniform1f(getU('uZoom'), camera.z);
    gl.uniform1f(getU('uGrain'), PARAMS.grain);
    gl.uniform1f(getU('uMisreg'), PARAMS.misreg);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(mainLoop);
}

// Lancement initial au chargement de la page
generateFractalTerrain();
requestAnimationFrame(mainLoop);
