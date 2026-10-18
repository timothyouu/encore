/** Canvas raster and geometry acceptance; no hardware or backend calls. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo=resolve(import.meta.dirname,'..');
const out=join(repo,'.run/note-markers');
await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(process.env.ENCORE_PLAYWRIGHT ?? '/home/tim/Relay/node_modules/playwright/index.mjs').href);
const {createServer}=await import(pathToFileURL(join(repo,'mobile/node_modules/vite/dist/node/index.js')).href);
await writeFile(join(out,'index.html'),`<!doctype html><html><meta charset="utf-8"><style>body{background:#191919;color:white;font:16px sans-serif}img{width:576px;height:288px;image-rendering:pixelated;border:1px solid #888}section{display:inline-block;margin:12px}h2{font-size:16px}</style><h1>Glasses note markers · local fixture</h1><main></main><script type="module">
import examples from '/shared/visual-examples.json';
import {fixtureAnalysis} from '/mobile/src/session.ts';
import {PASSAGES} from '/shared/passages.ts';
import {reviewData} from '/g2/src/feedback.ts';
import {renderBarArt,renderCardArt,renderReplayFrame,replaySteps} from '/g2/src/review/art.ts';
const paths=new WeakMap();let ellipses=[],crosses=[];
const proto=CanvasRenderingContext2D.prototype;
for(const name of ['beginPath','moveTo','lineTo','ellipse']){const original=proto[name];proto[name]=function(...args){
 if(name==='beginPath')paths.set(this,[]);
 else if(name==='ellipse')ellipses.push({x:args[0],y:args[1]});
 else (paths.get(this)??[]).push([name,...args]);
 return original.apply(this,args);
}}
const stroke=proto.stroke;proto.stroke=function(...args){const path=paths.get(this)??[];
 if(this.strokeStyle==='#ffffff'&&this.lineWidth===2.5&&path.length===4&&path[0][0]==='moveTo'&&path[2][0]==='moveTo')
  crosses.push({x:(path[0][1]+path[1][1])/2,y:(path[0][2]+path[1][2])/2});
 return stroke.apply(this,args);
};
window.results=[];
try{
for(const octave of [0,2]){
 const record={attemptId:'marker-'+octave,passageId:'P01',passageVersion:'1',captureSource:'test'};
 record.analysis=fixtureAnalysis(record,'mistakes','2');
 const played=record.analysis.detectedNotes.find(n=>n.id==='detected-3');
 played.onsetSec+=.25;played.midiPitch+=12*octave;
 const view=reviewData(record,PASSAGES[0]).views.find(v=>v.card?.kind==='wrong_note');
 const card=view.card;
 for(const phase of ['review','played','guide']){
  ellipses=[];crosses=[];
  const png=phase==='played'?await renderReplayFrame(card,replaySteps(card,false,true)[0]):await renderBarArt(card,phase==='guide');
  const image=document.createElement('img');image.src=URL.createObjectURL(new Blob([png],{type:'image/png'}));
  const section=document.createElement('section');section.innerHTML='<h2>'+phase+' · heard pitch offset '+octave+' octaves</h2>';section.append(image);document.querySelector('main').append(section);
  window.results.push({phase,octave,ellipses:[...ellipses],crosses:[...crosses],expected:{x:153,y:92.75}});
 }
}
// Extreme microphone pitches and jitter must not create context Xs/ledgers.
window.extraResults=[];
for(const kind of ['extra_note','missing_note'])for(const pitch of [21,108]){
 const card=structuredClone(examples.examples.find(e=>e.name===kind+'-'+(kind==='extra_note'?'extra':'missing')).plan.cards[0]);
 const focal=kind==='extra_note'?'d4.5':null;
 card.evidence={...card.evidence,source:'analysis',referenceNoteIds:focal?[]:['r5'],detectedNoteIds:focal?[focal]:[]};
 if(focal)card.detected.notes.find(n=>n.id===focal).midiPitch=pitch;
 // Add an unrelated extreme transcription; it is context, never a marker.
 card.detected.notes.push({id:'context-noise',midiPitch:pitch,onsetBeat:4.25,durationBeats:.1});
 for(const layer of ['played','both','written']){
  ellipses=[];crosses=[];
  const png=await renderReplayFrame(card,{art:'staff',layer,hold:'end'});
  const image=document.createElement('img');image.src=URL.createObjectURL(new Blob([png],{type:'image/png'}));
  const section=document.createElement('section');section.innerHTML='<h2>'+kind+' · '+layer+' · detected '+pitch+'</h2>';section.append(image);document.querySelector('main').append(section);
  const rasterHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',png))).map(n=>n.toString(16).padStart(2,'0')).join('');
  window.extraResults.push({kind,layer,pitch,rasterHash,ellipses:[...ellipses],crosses:[...crosses]});
 }
}
window.galleryFrames=0;
for(const example of examples.examples)for(const card of example.plan.cards){
 const staticPng=await renderCardArt(card);if(staticPng.length<100)throw Error('empty static art');window.galleryFrames++;
 for(const step of replaySteps(card)){const png=await renderReplayFrame(card,step);if(png.length<100)throw Error('empty replay art');window.galleryFrames++;}
}
window.done=true;
}catch(error){window.failure=String(error);window.done=true;}
</script></html>`);
const server=await createServer({configFile:false,root:repo,envDir:false,cacheDir:join(out,'vite-cache'),server:{host:'127.0.0.1',port:0}});
let browser;
try{
 await server.listen();const address=server.httpServer.address();
 browser=await chromium.launch({executablePath:process.env.ENCORE_CHROME ?? '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1240,height:1160}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+address.port+'/.run/note-markers/index.html');
 await page.waitForFunction(()=>window.done);
 assert.equal(await page.evaluate(()=>window.failure),undefined);
 const results=await page.evaluate(()=>window.results);
 assert.equal(results.length,6);
 for(const row of results){
  assert.equal(row.ellipses.length,4,'full authored bar stays visible in '+row.phase);
  assert.ok(row.ellipses.some(n=>n.x===row.expected.x&&n.y===row.expected.y),'reference note rendered');
  assert.deepEqual(row.crosses,row.phase==='guide'?[]:[row.expected], 'X stays on the reference note despite changed played pitch/time');
 }
 const extraResults=await page.evaluate(()=>window.extraResults);
 assert.equal(extraResults.length,12);
 for(const row of extraResults){
  assert.equal(row.ellipses.length,row.kind==='extra_note'?2:3,'written score remains visible');
  const expectedCount=row.kind==='extra_note'&&row.layer!=='written'?1:0;
  assert.equal(row.crosses.length,expectedCount,'only extra event has an X; missing/context notes do not');
  for(const marker of row.crosses)assert.equal(marker.y,26,'extra event uses lane, never ledger pitch');
 }
 const low=extraResults.filter(row=>row.pitch===21);
 const high=extraResults.filter(row=>row.pitch===108);
 assert.deepEqual(low.map(row=>({crosses:row.crosses,notes:row.ellipses,rasterHash:row.rasterHash})),high.map(row=>({crosses:row.crosses,notes:row.ellipses,rasterHash:row.rasterHash})),'extreme detected pitches cannot alter score or markers');
 assert.ok(await page.evaluate(()=>window.galleryFrames)>50);
 assert.deepEqual(errors,[]);
 await page.screenshot({path:join(out,'glasses-note-markers.png'),fullPage:true});
 await writeFile(join(out,'evidence.json'),JSON.stringify({status:'passed',input:'canvas fixture, not hardware',results,extraResults,errors},null,2));
 console.log(JSON.stringify({status:'passed',frames:6+extraResults.length,wholeBarVisible:true,referenceMarkersAligned:true,guideRemovesMarks:true,galleryFrames:await page.evaluate(()=>window.galleryFrames),errors}));
}finally{await browser?.close();await server.close();}
