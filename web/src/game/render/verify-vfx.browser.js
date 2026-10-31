/**
 * Real Chromium presentation checks. Run from the repository root against an open /play/1:
 * playwright-cli --session realmforge-vfx run-code --filename web/src/game/render/verify-vfx.browser.js
 *
 * Screenshots use a separate collision fixture. The harness repositions the controller to isolate
 * interactions; these are presentation checks, never submitted/claimed as validated player runs.
 * Includes actual keyboard skid/jumps, collision-based collection/brick/spring/goal/death,
 * a real frame sequence, fixed-step pause assertions, bounded particle stress and a Kenney switch.
 * No art is generated, recoloured, upscaled or interpolated by this harness.
 */
async (page) => {
    const check = async (page) => {
    await page.setViewportSize({width:1440,height:1000});
    await page.reload();
    await page.waitForFunction(()=>window.__play?.sequence===null);

    await page.evaluate(async () => {
        const {EventBus} = await import('/src/game/EventBus.ts');
        const {createEmptyLevel,encodeLevel} = await import('/src/game/level/serialize.ts');
        const doc = createEmptyLevel(60,16,'grass');
        doc.meta.name = 'VFX verification course';
        doc.entities = [
            {id:1,type:'coin',x:4,y:13}, {id:2,type:'question_block',x:7,y:10},
            {id:3,type:'brick',x:10,y:10}, {id:4,type:'spring',x:16,y:13},
            {id:5,type:'falling_block',x:20,y:12}, {id:6,type:'checkpoint',x:24,y:13,props:{height:2}},
            {id:7,type:'walker',x:29,y:13}, {id:8,type:'shell',x:33,y:13},
            {id:9,type:'goal',x:42,y:13}, {id:10,type:'cannon',x:51,y:13,props:{direction:-1,timer:120}}
        ];
        window.__vfxFixture = encodeLevel(doc);
        window.__vfxEvents = [];
        EventBus.on('play:state', state => window.__vfxEvents.push({state:state.state,frame:window.__play.frame}));
        EventBus.on('play:finished', result => window.__vfxFinished = result);
        window.__play.scene.restart({level:window.__vfxFixture,levelId:null,from:'play',creator:'Browser verification fixture'});
    });
    await page.waitForTimeout(700);
    await page.screenshot({path:'docs/screenshots/vfx/intro-card.png'});
    await page.waitForFunction(()=>window.__play.sequence === null);
    const start = await page.evaluate(()=>({frame:window.__play.frame,views:window.__play.effects.views.filter(v=>v.sprite).map(v=>v.el.def.type)}));
    await page.evaluate(async()=>{const {EventBus}=await import('/src/game/EventBus.ts');EventBus.emit('play:pause');window.__pauseFrame=window.__play.frame;});
    await page.waitForTimeout(250);
    const paused = await page.evaluate(()=>window.__play.paused && window.__pauseFrame===window.__play.frame);
    if (!paused) throw new Error('pause without payload failed');
    await page.evaluate(async()=>{const {EventBus}=await import('/src/game/EventBus.ts');EventBus.emit('play:resume');});
    await page.keyboard.down('Shift'); await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(700);
    await page.keyboard.up('ArrowRight'); await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(70);
    const skid = await page.evaluate(()=>({mode:window.__play.player.state.mode,particles:window.__play.effects.activeParticles,vx:window.__play.player.state.vx}));
    if(skid.mode!=='skid' || skid.particles===0) throw new Error('Reversal did not produce skid dust');
    await page.evaluate(async()=>{const {EventBus}=await import('/src/game/EventBus.ts');EventBus.emit('play:pause');});
    await page.screenshot({path:'docs/screenshots/vfx/skid-dust.png'});
    await page.keyboard.up('ArrowLeft'); await page.keyboard.up('Shift');
    return {start,paused,skid,events:await page.evaluate(()=>window.__vfxEvents)};

    };
    const objects = async (page) => {
    const resume = () => page.evaluate(async()=>{const {EventBus}=await import('/src/game/EventBus.ts');EventBus.emit('play:resume');});
    const pause = () => page.evaluate(async()=>{const {EventBus}=await import('/src/game/EventBus.ts');EventBus.emit('play:pause');});
    const place = (x,y,big=false) => page.evaluate(({x,y,big})=>{
        const p=window.__play.player;
        p.setForm(big?'big':'small');
        p.setState({...p.state,x:Math.round(x*4096),y:Math.round(y*4096),vx:0,vy:0,mode:'idle',previousInput:0,jumpBuffer:0,coyote:0});
    },{x,y,big});
    await place(10.5,13.05,true); await resume();
    await page.waitForTimeout(350);
    await page.keyboard.down('Space');
    await page.waitForFunction(()=>!window.__play.runtime.elements.get(3).enabled,{},{timeout:3000,polling:'raf'});
    await page.waitForTimeout(320); await pause(); await page.keyboard.up('Space');
    const brick=await page.evaluate(()=>({enabled:window.__play.runtime.elements.get(3).enabled,particles:window.__play.effects.activeParticles,form:window.__play.player.form}));
    await page.screenshot({path:'docs/screenshots/vfx/brick-break.png'});
    await place(7.5,13.45,false); await resume(); await page.waitForTimeout(400);
    const coinsBefore=await page.evaluate(()=>window.__play.coins);
    await page.keyboard.down('Space');
    await page.waitForFunction(()=>window.__play.runtime.elements.get(2).phase==='used',{},{timeout:3000,polling:'raf'});
    await page.waitForTimeout(20); await pause(); await page.keyboard.up('Space');
    const coin=await page.evaluate(()=>({phase:window.__play.runtime.elements.get(2).phase,coins:window.__play.coins,particles:window.__play.effects.activeParticles}));
    if(coin.coins!==coinsBefore+1) throw new Error('Question-block reward changed');
    await page.screenshot({path:'docs/screenshots/vfx/coin-pop.png'});
    await place(16.5,10.5,false); await resume(); await page.waitForTimeout(180);
    await page.waitForFunction(()=>window.__play.player.state.vy< -1000,{},{timeout:3000,polling:'raf'});
    await page.waitForTimeout(45); await pause();
    const spring=await page.evaluate(()=>({mode:window.__play.player.state.mode,vy:window.__play.player.state.vy,particles:window.__play.effects.activeParticles,scaleY:window.__play.effects.views.find(v=>v.el.def.id===4).sprite.scaleY}));
    await page.screenshot({path:'docs/screenshots/vfx/spring.png'});
    await place(24.5,13.45,false); await resume();
    await page.waitForFunction(()=>window.__play.runtime.elements.get(6).phase==='active',{},{timeout:3000,polling:'raf'});
    await pause(); await page.screenshot({path:'docs/screenshots/vfx/checkpoint.png'});
    if(brick.enabled || brick.particles===0 || spring.vy>=0)throw new Error('Object collision presentation failed');
    return {brick,coin,spring,checkpoint:await page.evaluate(()=>window.__play.checkpointName)};

    };
    const sequences = async (page) => {
    await page.evaluate(async()=>{
        const s=window.__play,p=s.player;
        p.setForm('small');p.setState({...p.state,x:41*4096,y:Math.round(13.45*4096),vx:0,vy:0,mode:'idle',previousInput:0});
        const {EventBus}=await import('/src/game/EventBus.ts');EventBus.emit('play:resume');
        window.__vfxFinished=undefined;window.__vfxFinishCount=0;
        EventBus.on('play:finished',()=>window.__vfxFinishCount++);
    });
    await page.waitForTimeout(500);await page.keyboard.down('ArrowRight');
    await page.waitForFunction(()=>window.__play.finished,{},{timeout:3000,polling:'raf'});
    await page.keyboard.up('ArrowRight');
    const goalFrame=await page.evaluate(()=>window.__play.frame);
    await page.waitForTimeout(100);
    await page.screenshot({path:'docs/screenshots/vfx/goal-sequence.png'});
    await page.screenshot({path:'docs/screenshots/vfx/goal-00.png'});
    await page.waitForTimeout(600);
    await page.screenshot({path:'docs/screenshots/vfx/goal-01.png'});
    await page.waitForFunction(()=>window.__play.tweens.getTweens().some(t=>t.targets.some(v=>typeof v.radius==='number' && v.radius>450 && v.radius<750)),{},{timeout:3000,polling:'raf'});
    await page.evaluate(()=>{window.__play.tweens.pauseAll();window.__play.time.paused=true;});
    await page.screenshot({path:'docs/screenshots/vfx/goal-02-iris.png'});
    await page.evaluate(()=>{window.__play.time.paused=false;window.__play.tweens.resumeAll();});
    await page.waitForFunction(()=>!!window.__vfxFinished,{},{timeout:3000});
    const goal=await page.evaluate(()=>({frame:window.__play.frame,finishCount:window.__vfxFinishCount,state:window.__vfxEvents.at(-1).state,timeMs:window.__vfxFinished.timeMs,cleared:window.__vfxFinished.cleared}));
    if(goal.frame!==goalFrame || goal.finishCount!==1 || goal.state!=='cleared') throw new Error('Goal lifecycle/payload is inconsistent');
    // Use the UI action to clear its completed-run overlay as well as restarting Phaser.
    await page.getByRole('button',{name:'Play again',exact:true}).click();
    await page.waitForFunction(()=>window.__play.sequence===null);
    await page.evaluate(()=>{
        const s=window.__play,p=s.player;
        p.setState({...p.state,x:36.5*4096,y:Math.round(13.45*4096),vx:0,vy:0,mode:'idle'});
    });
    await page.waitForTimeout(500);
    await page.evaluate(()=>window.__play.runtime.add({id:'verification-spike',type:'spikes',x:36.5,y:13.5}));
    await page.waitForFunction(()=>window.__play.sequence==='death',{},{timeout:3000,polling:'raf'});
    const deathFrame=await page.evaluate(()=>window.__play.frame);
    await page.screenshot({path:'docs/screenshots/vfx/death-00-freeze.png'});
    await page.waitForTimeout(250);
    await page.screenshot({path:'docs/screenshots/vfx/death.png'});
    await page.screenshot({path:'docs/screenshots/vfx/death-01-hop.png'});
    await page.waitForTimeout(300);
    await page.screenshot({path:'docs/screenshots/vfx/death-02-fall.png'});
    await page.waitForFunction(()=>window.__play.sequence==='dead',{},{timeout:3000});
    const death=await page.evaluate(()=>({frame:window.__play.frame,state:window.__vfxEvents.at(-1).state,world:window.__play.matter.world.enabled}));
    if(death.frame!==deathFrame || death.state!=='dead' || death.world)throw new Error('Death lifecycle did not freeze simulation');
    return {goal,death};

    };
    const performance = async (page) => {
    await page.reload();
    await page.waitForFunction(()=>window.__play?.sequence===null && window.__play.frame>60);
    const performance=await page.evaluate(async()=>{
        const s=window.__play;
        const fps=[],deltas=[];let previous=performance.now();
        await new Promise(resolve=>{
            const tick=(now)=>{deltas.push(now-previous);previous=now;fps.push(s.game.loop.actualFps);if(fps.length<300)requestAnimationFrame(tick);else resolve();};
            requestAnimationFrame(tick);
        });
        const sorted=deltas.slice().sort((a,b)=>a-b);
        return {url:location.pathname,pack:s.registry.get('assetPack'),renderer:s.game.renderer.type,samples:fps.length,meanFps:Number((fps.reduce((a,b)=>a+b,0)/fps.length).toFixed(2)),minFps:Number(Math.min(...fps).toFixed(2)),p95FrameMs:Number(sorted[Math.floor(sorted.length*.95)].toFixed(2)),frame:s.frame};
    });
    const pool=await page.evaluate(()=>{
        const s=window.__play,before=s.children.length;
        for(let i=0;i<1000;i++)s.effects.burst('dust',s.playerSprite.x,s.playerSprite.y);
        return {before,after:s.children.length,particles:s.effects.activeParticles,capacity:s.effects.particles.length,labels:s.effects.labels.length};
    });
    if(pool.before!==pool.after || pool.capacity!==128 || pool.particles>128)throw new Error('Particle pool allocated during burst');
    await page.waitForTimeout(800);
    const empty=await page.evaluate(()=>window.__play.effects.activeParticles);
    if(empty!==0)throw new Error('Particles did not retire');
    await page.screenshot({path:'docs/screenshots/vfx/play-1-performance.png'});
    await page.evaluate(()=>localStorage.setItem('realmforge:asset-pack','kenney'));
    await page.reload();
    await page.waitForFunction(()=>window.__play?.registry.get('assetPack')==='kenney' && window.__play.sequence===null);
    const kenney=await page.evaluate(async()=>{
        const {EventBus}=await import('/src/game/EventBus.ts');EventBus.emit('play:pause');
        const s=window.__play;s.effects.burst('land_puff',s.playerSprite.x,s.playerSprite.y);s.effects.score(s.playerSprite.x,s.playerSprite.y-64,'+1');
        return {pack:s.registry.get('assetPack'),particles:s.effects.activeParticles,paused:s.paused};
    });
    await page.screenshot({path:'docs/screenshots/vfx/kenney-fallback.png'});
    await page.evaluate(()=>localStorage.setItem('realmforge:asset-pack','mario'));
    await page.reload();
    return {performance,pool,retired:empty,kenney};

    };
    const controls = await check(page);
    const objectResults = await objects(page);
    const sequenceResults = await sequences(page);
    const metrics = await performance(page);
    return { controls, objects: objectResults, sequences: sequenceResults, ...metrics };
}
