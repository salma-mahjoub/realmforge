// Pass this function to playwright-cli run-code with the collision lab open.
async (page) => {
    const consoleErrors = [], pageErrors = [];
    const onConsole = message => {if (message.type() === 'error') consoleErrors.push(message.text());};
    const onPageError = error => pageErrors.push(error.message);
    page.on('console', onConsole); page.on('pageerror', onPageError);
    await page.reload();
    await page.waitForFunction(() => !!window.seesawLab);
    const summaries = [];
    for (const scenario of ['rest', 'left', 'right', 'fall']) {
        const summary = await page.evaluate(scenario => {
            window.seesawLab.reset(scenario);
            window.seesawLab.advance(360);
            return window.seesawLab.advance(120);
        }, scenario);
        if (summary.footContacts !== 120 || summary.verticalRange >= 0.5 || summary.horizontalRange >= 0.5 || summary.maxPenetration >= 0.64 || summary.maxHingeError >= 0.001) throw new Error(`Unstable ${scenario}: ${JSON.stringify(summary)}`);
        if (summary.last.deck.thickness !== 28.8 || !summary.last.parentBoundsContainMain) throw new Error(`Invalid collision deck in ${scenario}`);
        await page.screenshot({path: `game-core/docs/evidence/seesaw-${scenario}.png`, fullPage: true});
        const jump = await page.evaluate(() => window.seesawLab.advance(1, {left: false, right: false, up: false, down: false, run: false, jump: true}));
        if (jump.last.player.vy >= 0) throw new Error(`Rider could not jump on ${scenario}`);
        summaries.push({scenario, ...summary, jumpVelocityFixed: jump.last.player.vy});
    }
    // Diagnostic only: report the existing adapter's growth bounds without pretending
    // this element-only change repairs broadphase geometry outside its ownership.
    const growthDiagnostic = await page.evaluate(() => {
        window.seesawLab.reset('right');
        window.seesawLab.setForm('big');
        window.seesawLab.advance(360);
        return window.seesawLab.metrics();
    });
    await page.screenshot({path: 'game-core/docs/evidence/seesaw-growth-diagnostic.png', fullPage: true});
    await page.evaluate(() => {window.seesawLab.reset('rest'); window.seesawLab.advance(120);});
    const isolatedGrowthBounds = await page.evaluate(() => window.seesawLab.isolatedGrowthBounds());
    page.off('console', onConsole); page.off('pageerror', onPageError);
    if (consoleErrors.length || pageErrors.length) throw new Error(JSON.stringify({consoleErrors, pageErrors}));
    return {browser: await page.context().browser().version(), summaries, growthDiagnostic, isolatedGrowthBounds, consoleErrors, pageErrors};
}
