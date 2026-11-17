// Headless test harness: loads the game in Chromium with a software WebGPU adapter and saves screenshots.
//   node tools/shot.js --out a.jpg[,b.jpg] [--html fable/index.html] [--query "scene=car&cap=1&res=960x540"]
//                      [--js "code for shot 1@@code for shot 2"] [--size 960x540] [--timeout 600]
// Each --js snippet is evaluated in the page before the matching screenshot (use window.__cap.* hooks);
// its return value is printed as RET <json>. A headless software GPU cannot present a WebGPU canvas, so the
// harness swaps the canvas texture for an offscreen one and reads it back.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
(async () => {
  const html = path.resolve(arg('html', path.join(__dirname, '..', 'fable', 'index.html')));
  const query = arg('query', 'scene=car&cap=1&res=960x540');
  const [w, h] = arg('size', '960x540').split('x').map(Number);
  const outs = arg('out', 'shot.jpg').split(','), jss = (arg('js', '') || '').split('@@');
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-gpu-watchdog'] });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('console', m => { const t = m.text(); if (!/^\[object/.test(t)) console.log('LOG', t.slice(0, 800)); });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.addInitScript(() => {
    let dev = null, fmt = 'rgba8unorm', tex = null;
    GPUCanvasContext.prototype.configure = function (c) { dev = c.device; fmt = c.format; };
    GPUCanvasContext.prototype.getCurrentTexture = function () {
      const cv = this.canvas;
      if (!tex || tex.width !== cv.width || tex.height !== cv.height) tex = dev.createTexture({ size: [cv.width, cv.height], format: fmt, usage: 0x10 | 0x01 | 0x04 });
      return tex;
    };
    window.__grab = async () => {
      const W = tex.width, H = tex.height, bpr = (W * 4 + 255) & ~255;
      const buf = dev.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const e = dev.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [W, H]); dev.queue.submit([e.finish()]);
      await buf.mapAsync(GPUMapMode.READ); const src = new Uint8Array(buf.getMappedRange());
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), im = g.createImageData(W, H), bgra = fmt.startsWith('bgra');
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = y * bpr + x * 4, d = (y * W + x) * 4; im.data[d] = src[s + (bgra ? 2 : 0)]; im.data[d + 1] = src[s + 1]; im.data[d + 2] = src[s + (bgra ? 0 : 2)]; im.data[d + 3] = 255; }
      g.putImageData(im, 0, 0); buf.unmap(); buf.destroy(); return c.toDataURL('image/jpeg', 0.92);
    };
  });
  const t0 = Date.now();
  await p.goto('file://' + html + '?' + query);
  let s; const tmo = +arg('timeout', 900);
  for (let i = 0; i < tmo * 2; i++) { s = await p.evaluate(() => window.__cap && (window.__cap.ready() ? 'ready' : window.__cap.error())); if (s) break; await p.waitForTimeout(500); }
  console.log('STATE', s, ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  if (s === 'ready') {
    for (let k = 0; k < outs.length; k++) {
      const r = await p.evaluate(async j => {
        const r = j ? await eval(j) : null;
        if (!window.__noFrames) { try { window.__cap.frames(3); } catch (e) { if (!/drawImage|2d|canvas/i.test(e.message)) throw e; } }
        return r === undefined ? null : JSON.stringify(r);
      }, jss[k] || '');
      if (r && r !== 'null') console.log('RET', r.slice(0, 4000));
      if (outs[k] !== 'none') { const d = await p.evaluate(() => window.__grab()); fs.writeFileSync(outs[k], Buffer.from(d.split(',')[1], 'base64')); }
    }
    await p.waitForTimeout(300);
    const e = await p.evaluate(() => window.__cap.error()); if (e) console.log('GPUERR', String(e).slice(0, 2000));
  }
  await b.close();
})();
