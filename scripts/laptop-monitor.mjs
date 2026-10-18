import http from 'node:http';

const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Encore laptop monitor</title>
<style>body{margin:0;padding:32px;background:#131714;color:#eee;font:16px system-ui}h1{font-size:26px;font-weight:500}p{color:#aab8ad}main{display:grid;grid-template-columns:minmax(300px,620px) minmax(240px,360px);gap:32px}img{display:block;max-width:100%;background:#000;border:1px solid #374339;border-radius:12px}#glasses{width:576px;image-rendering:auto}#phone{max-height:65vh}button,a{color:#d4f1ce}button{background:#26352a;border:1px solid #536859;border-radius:8px;padding:12px;margin:12px 8px 0 0;cursor:pointer}a{margin-right:20px}small{display:block;color:#aab8ad;margin-top:15px}@media(max-width:850px){main{grid-template-columns:1fr}}</style>
<h1>Encore · laptop monitor</h1><p>Official Even simulator · no physical glasses connection</p><main><section><h2>Glasses display</h2><img id="glasses" alt="Live simulated glasses framebuffer" src="/glasses.png"><small>576 × 288 pixels. The black background preserves the framebuffer transparency.</small><div><button data-action="up">Swipe up</button><button data-action="down">Swipe down</button><button data-action="click">Tap</button><button data-action="double_click">Double tap</button></div><p id="status" role="status">Connecting…</p><a href="http://localhost:5173" target="_blank">Open app</a><a href="http://localhost:5173/health" target="_blank">Backend health</a></section><section><h2>Simulator phone view</h2><img id="phone" alt="Live phone view from the same simulator session" src="/phone.png"><small>The simulator window provides direct phone interaction.</small></section></main>
<script>function refresh(id,delay){const img=document.getElementById(id);const again=()=>setTimeout(()=>{img.src='/'+(id==='glasses'?'glasses':'phone')+'.png?t='+Date.now()},delay);img.onload=again;img.onerror=again}refresh('glasses',700);refresh('phone',1800);async function status(){try{const r=await fetch('/health');const h=await r.json();document.getElementById('status').textContent=h.ok?'Backend ready · Basic Pitch connected · '+(h.modelConfigured?'Gemini configured':'fallback coaching (Gemini disabled)'):'Backend unavailable'}catch{document.getElementById('status').textContent='Backend unavailable'}setTimeout(status,5000)}status();document.querySelectorAll('button').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await fetch('/input',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:b.dataset.action})});if(!r.ok)throw Error();}catch{document.getElementById('status').textContent='Simulator unavailable'}finally{b.disabled=false}})</script></html>`;
const images = { '/glasses.png': 'glasses', '/phone.png': 'webview' };
const actions = new Set(['up', 'down', 'click', 'double_click']);
const server = http.createServer(async (request, response) => {
  response.setHeader('cache-control', 'no-store');
  const path = new URL(request.url ?? '/', 'http://localhost:5260').pathname;
  try {
    if (request.method === 'GET' && path === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(page); return;
    }
    let target;
    let init = { signal: AbortSignal.timeout(5000) };
    if (request.method === 'GET' && Object.hasOwn(images, path)) target = 'http://127.0.0.1:9898/api/screenshot/' + images[path];
    else if (request.method === 'GET' && path === '/health') {
      const analysis = await fetch('http://127.0.0.1:8002/health', init);
      if (!analysis.ok || !(await analysis.json()).modelLoaded) throw Error('analysis unavailable');
      target = 'http://127.0.0.1:8788/health';
    } else if (request.method === 'POST' && path === '/input') {
      if (request.headers.origin !== 'http://localhost:5260') { response.writeHead(403); response.end(); return; }
      let body = '';
      for await (const chunk of request) { body += chunk; if (body.length > 128) { response.writeHead(413); response.end(); return; } }
      const { action } = JSON.parse(body);
      if (!actions.has(action)) { response.writeHead(400); response.end(); return; }
      target = 'http://127.0.0.1:9898/api/input';
      init = { ...init, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) };
    } else { response.writeHead(404); response.end(); return; }
    const upstream = await fetch(target, init);
    response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch { response.writeHead(503, { 'content-type': 'application/json' }); response.end('{"error":"local_service_unavailable"}'); }
});
server.listen(5260, '127.0.0.1', () => console.log('Encore simulator monitor: http://localhost:5260'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
