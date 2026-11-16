import * as THREE from 'three';
import QRCode from 'qrcode';
import { mulberry32, randomSeed, worldChecksum } from './world/rng.js';
import { clearSession, markSessionRejoin, readBootConfig, readSeedFromUrl, saveSession } from './net/session.js';
import { getIceServers, leaveRoom, rejoinRoom } from './net/signaling.js';
import { NetSession } from './net/webrtc.js';
import { CHANNEL, INPUT, MSG } from './net/protocol.js';

export function start(){
'use strict';
const $=id=>document.getElementById(id);
const boot = readBootConfig();
const worldSeed = (boot && boot.seed) || readSeedFromUrl() || randomSeed();
const rand = mulberry32(worldSeed);
const TAU=Math.PI*2, rnd=(a,b)=>a+rand()*(b-a), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angDiff=(a,b)=>{let d=(b-a)%TAU;if(d>Math.PI)d-=TAU;if(d<-Math.PI)d+=TAU;return d;};

/* ---------- renderer / scene ---------- */
let canvas=$('c');
function showWebglFailure(detail){
  const loading=$('loadingMenu');if(loading)loading.hidden=true;
  const menu=$('menu');if(menu)menu.hidden=true;
  const el=$('webglError');if(el)el.hidden=false;
  const msg=$('webglErrorMsg');
  if(msg&&detail)msg.textContent=detail;
  const retry=$('webglRetry');
  if(retry&&!retry.dataset.bound){
    retry.dataset.bound='1';
    retry.addEventListener('click',()=>window.location.reload());
  }
}
function makeRenderer(){
  const attempts=[
    {antialias:true,powerPreference:'high-performance'},
    {antialias:false,powerPreference:'low-power',failIfMajorPerformanceCaveat:false},
  ];
  let lastErr=null;
  for(let i=0;i<attempts.length;i++){
    try{
      return new THREE.WebGLRenderer({canvas,...attempts[i]});
    }catch(err){
      lastErr=err;
      console.warn('[webgl] context attempt '+(i+1)+' failed',err);
      if(i<attempts.length-1){
        /* A failed getContext can leave the canvas unusable; try a fresh one. */
        const fresh=canvas.cloneNode(false);
        canvas.replaceWith(fresh);
        canvas=fresh;
      }
    }
  }
  console.error('[webgl] could not create a rendering context',lastErr);
  return null;
}
const renderer=makeRenderer();
if(!renderer){
  showWebglFailure();
  return;
}
canvas.addEventListener('webglcontextlost',e=>{
  e.preventDefault();
  console.error('[webgl] context lost');
  showWebglFailure('The 3D graphics context was lost. Close other 3D tabs or games, then reload.');
},{passive:false});
canvas.addEventListener('webglcontextrestored',()=>{
  const el=$('webglError');if(el)el.hidden=true;
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFShadowMap; 
const SKY=0x9bd6f2;
const scene=new THREE.Scene();
scene.background=new THREE.Color(SKY);
/* a soft fog: you can only see a little way into the distance */
scene.fog=new THREE.Fog(SKY,60,380);
const camera=new THREE.PerspectiveCamera(70,1,0.1,2800);
camera.rotation.order='YXZ';
scene.add(camera);
function resize(){const w=window.innerWidth,h=window.innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
window.addEventListener('resize',resize);resize();

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.7);
scene.add(hemiLight);
const sun=new THREE.DirectionalLight(0xfff5d6, 1.2);
sun.castShadow=true;
sun.shadow.mapSize.set(1024,1024);
const sc=sun.shadow.camera;sc.left=-45;sc.right=45;sc.top=45;sc.bottom=-45;sc.near=1;sc.far=200;
sun.shadow.bias=-0.0004;
sun.shadow.radius = 3.5;
scene.add(sun);scene.add(sun.target);
const SUNDIR=new THREE.Vector3(32,52,22).normalize();

/* ---------- day / night cycle ---------- */
const DAY_LEN=300;
let dayT=.30;
let nightFlag=false;
const SKY_DAY=new THREE.Color(0x9bd6f2),SKY_NIGHT=new THREE.Color(0x0b1630),
      SKY_DAWN=new THREE.Color(0xffb46b),SKY_DUSK=new THREE.Color(0xff8a4c),
      HEMI_DAY=new THREE.Color(0xe2f4ff),MOON_HEMI=new THREE.Color(0x2e4066),tmpCol=new THREE.Color();
const sunVis=new THREE.Group();
(function(){
  const disc=new THREE.Mesh(new THREE.SphereGeometry(80,12,8),new THREE.MeshBasicMaterial({color:0xfff4b8,fog:false}));
  disc.renderOrder=2;sunVis.add(disc);
  const c=document.createElement('canvas');c.width=256;c.height=256;const g=c.getContext('2d');
  const gr=g.createRadialGradient(128,128,10,128,128,128);
  gr.addColorStop(0,'rgba(255,244,180,.85)');gr.addColorStop(.35,'rgba(255,230,150,.3)');gr.addColorStop(1,'rgba(255,230,150,0)');
  g.fillStyle=gr;g.fillRect(0,0,256,256);
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),fog:false,transparent:true,depthWrite:false}));
  glow.scale.set(700,700,1);glow.renderOrder=1;sunVis.add(glow);
  scene.add(sunVis);
})();
const moonVis=new THREE.Group();
(function(){
  const m=new THREE.Mesh(new THREE.SphereGeometry(55,12,8),new THREE.MeshBasicMaterial({color:0xe8eeff,fog:false}));
  m.renderOrder=2;moonVis.add(m);
  const c=document.createElement('canvas');c.width=256;c.height=256;const g=c.getContext('2d');
  const gr=g.createRadialGradient(128,128,10,128,128,128);
  gr.addColorStop(0,'rgba(214,226,255,.7)');gr.addColorStop(.35,'rgba(190,208,255,.22)');gr.addColorStop(1,'rgba(190,208,255,0)');
  g.fillStyle=gr;g.fillRect(0,0,256,256);
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),fog:false,transparent:true,depthWrite:false}));
  glow.scale.set(460,460,1);glow.renderOrder=1;moonVis.add(glow);
  scene.add(moonVis);
})();
const starVis=new THREE.Group();
(function(){
  const n=420,pos=new Float32Array(n*3);
  for(let i=0;i<n;i++){const u=rnd(0,1),v=rnd(0,1),th=u*TAU,ph=Math.acos(2*v-1),r=2500;
    pos[i*3]=r*Math.sin(ph)*Math.cos(th);pos[i*3+1]=Math.abs(r*Math.cos(ph))*.9+60;pos[i*3+2]=r*Math.sin(ph)*Math.sin(th);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  const mat=new THREE.PointsMaterial({color:0xffffff,size:7,sizeAttenuation:false,fog:false,transparent:true,opacity:0,depthWrite:false});
  starVis.add(new THREE.Points(geo,mat));
  starVis.userData.mat=mat;
  scene.add(starVis);
})();
function updateSky(dt){
  dayT=(dayT+dt/DAY_LEN)%1;
  const ang=dayT*TAU,el=Math.sin(ang),az=Math.cos(ang);
  SUNDIR.set(az,el,.38).normalize();
  const day=clamp(el*3.2,0,1);
  const edge=clamp(1-Math.abs(el)*5,0,1);
  
  tmpCol.copy(SKY_NIGHT).lerp(SKY_DAY,day);
  tmpCol.lerp(az>0?SKY_DAWN:SKY_DUSK,edge*.85);
  scene.background.copy(tmpCol);
  scene.fog.color.copy(tmpCol);
  
  sun.intensity=day*1.2+edge*.4;
  sun.color.setRGB(1,clamp(.94-edge*.22,.6,1),clamp(.84-edge*.5,.35,1));
  hemiLight.intensity=.45+day*.5;
  hemiLight.color.copy(MOON_HEMI).lerp(HEMI_DAY,day);
  
  const cam=camera.position;
  sunVis.position.set(cam.x+SUNDIR.x*1800,cam.y+SUNDIR.y*1800,cam.z+SUNDIR.z*1800);
  sunVis.visible=SUNDIR.y>-.06;
  moonVis.position.set(cam.x-SUNDIR.x*1800,cam.y-SUNDIR.y*1800,cam.z-SUNDIR.z*1800);
  moonVis.visible=SUNDIR.y<.12;
  starVis.position.set(cam.x,0,cam.z);
  starVis.rotation.z=ang*.5;
  starVis.userData.mat.opacity=clamp((1-day)*1.4,0,1);
  
  const lx=camera.position.x+SUNDIR.x*90,ly=Math.max(6,camera.position.y+SUNDIR.y*90),lz=camera.position.z+SUNDIR.z*90;
  sun.target.position.copy(camera.position);sun.position.set(lx,ly,lz);
  
  const hr=(dayT*24+6)%24,hh=Math.floor(hr),mm=Math.floor((hr-hh)*60);
  const phase=day>.55?(hh<12?'Morning':'Afternoon'):(edge>.35?(el>0?'Sunrise':'Sunset'):'Night');
  const tN=$('timeN');
  if(tN){const s=(hh<10?'0':'')+hh+':'+(mm<10?'0':'')+mm;
    if(tN.textContent!==s+' '+phase)tN.textContent=s+' '+phase;}
  const night=dayT>=.5;
  if(night!==nightFlag){nightFlag=night;if(state==='play')toast(night?'Night falls — wolves are on the prowl!':'Dawn breaks — the wolves slip away.');}
}

/* ---------- helpers ---------- */
const std=(c,o)=>new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:.92,metalness:0,flatShading:true},o||{}));
function place(o,x,y,z){o.position.set(x||0,y||0,z||0);return o;}
function box(w,h,d,m,x,y,z){return place(new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m),x,y,z);}
function cyl(rt,rb,h,m,x,y,z,seg){return place(new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg||10),m),x,y,z);}
function sph(r,m,x,y,z,seg){return place(new THREE.Mesh(new THREE.SphereGeometry(r,seg||10,Math.max(6,(seg||10)-3)),m),x,y,z);}
function cone(r,h,m,x,y,z,seg){return place(new THREE.Mesh(new THREE.ConeGeometry(r,h,seg||6),m),x,y,z);}
function shade(g,on){g.traverse(o=>{if(o.isMesh){o.castShadow=on!==false; o.receiveShadow=true;}});return g;}
function pivot(parent,x,y,z){const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);return g;}
/* batch repeated props into a few draw calls, each part sharing the instance matrix */
function instanced(parts,items){
  if(!items.length)return;
  const root=new THREE.Object3D(),tmp=new THREE.Matrix4();
  const meshes=parts.map(p=>{
    const im=new THREE.InstancedMesh(p.geo,p.mat,items.length);
    im.castShadow=!p.noShadow;im.receiveShadow=true;
    im.frustumCulled=false; /* instances span the whole island */
    scene.add(im);return im;
  });
  items.forEach((it,i)=>{
    root.position.set(it.x,it.y||0,it.z);
    root.rotation.set(it.rx||0,it.ry||0,it.rz||0);
    const s=it.s==null?1:it.s;
    root.scale.set(it.sx==null?s:it.sx,it.sy==null?s:it.sy,it.sz==null?s:it.sz);
    root.updateMatrix();
    parts.forEach((p,k)=>{
      if(p.local)tmp.multiplyMatrices(root.matrix,p.local);
      else tmp.copy(root.matrix);
      meshes[k].setMatrixAt(i,tmp);
    });
  });
  meshes.forEach(m=>{m.instanceMatrix.needsUpdate=true;});
}

/* ---------- world: grass, beach, ocean, sky ---------- */
const S=14;
const K=1.5;
/* the ground is a mosaic of big flat triangles: the signature low-poly look */
function facetTex(colors,rep,cells){
  const size=256,c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');
  const n=cells||4,step=size/n;
  const tri=(ax,ay,bx,by,cx,cy)=>{
    const col=colors[(rand()*colors.length)|0];
    g.fillStyle=col;g.strokeStyle=col;g.lineWidth=2;
    g.beginPath();g.moveTo(ax,ay);g.lineTo(bx,by);g.lineTo(cx,cy);g.closePath();g.fill();g.stroke();
  };
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const x0=x*step,y0=y*step;
    tri(x0,y0,x0+step,y0,x0,y0+step);
    tri(x0+step,y0,x0+step,y0+step,x0,y0+step);
  }
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rep,rep);
  t.magFilter=THREE.NearestFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.anisotropy=4;return t;
}
function grassTex(){
  const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');
  g.fillStyle='#5fae3d';g.fillRect(0,0,256,256);
  for(let i=0;i<1500;i++){g.fillStyle=rand()<.5?'#6bba48':'#53a034';const s=2+rand()*3;g.fillRect(rand()*256,rand()*256,s,s*1.7);}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(40*S,40*S);t.anisotropy=4;return t;
}
const grass=new THREE.Mesh(new THREE.CircleGeometry(58*S,40),new THREE.MeshStandardMaterial({map:grassTex(),roughness:1}));
grass.rotation.x=-Math.PI/2;grass.receiveShadow=true;scene.add(grass);
const SAND_FACETS=['#e9d9a0','#e3d093','#efdfa9','#ddca8b','#e6d59a'];
const sand=new THREE.Mesh(new THREE.RingGeometry(57.8*S,67*S,40),new THREE.MeshStandardMaterial({map:facetTex(SAND_FACETS,60,4),roughness:1,polygonOffset:true,polygonOffsetFactor:2,polygonOffsetUnits:4}));
sand.rotation.x=-Math.PI/2;sand.position.y=-0.03;sand.receiveShadow=true;scene.add(sand);
const foam=new THREE.Mesh(new THREE.RingGeometry(66.6*S,68.2*S,40),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.55}));
foam.rotation.x=-Math.PI/2;foam.position.y=-0.18;scene.add(foam);

/* ---------- biomes: desert and snowfield, out on the ocean ----------
   Both sit on the water just past the beach, so their inner edge meets the
   sand ring exactly (67*S) and they can be reached on foot. Nothing overlaps
   the grass/sand and no decal is left hovering a hair above the ground, which
   is what used to make the biome surfaces flicker. */
const ISLAND_R=67*S;
/* the desert and snowfield are island-sized too: same radius as the home grass,
   parked on the sea and still tucked just under the beach rim */
const BIOME_R=58*S;
const BIOME_C=ISLAND_R-62+BIOME_R;
const DESERT={x:-BIOME_C,z:0,r:BIOME_R}, SNOWZ={x:0,z:-BIOME_C,r:BIOME_R};
/* the savanna is the third ocean island, the same size as the other two.
   It sits 60 degrees around from the desert, so both islands tuck under the
   home beach and the savanna is a short stretch of water from the desert. */
const SAVAN={x:Math.round(BIOME_C*Math.cos(Math.PI*2/3)),z:Math.round(BIOME_C*Math.sin(Math.PI*2/3)),r:BIOME_R};
const BIOME_BY_NAME={desert:DESERT,snow:SNOWZ,savanna:SAVAN};
/* endgame lairs sit on the clear centre of the snowfield and desert */
const BOSS_ARENAS={
  snow:{x:SNOWZ.x,z:SNOWZ.z,r:21,name:'Frost Warden'},
  desert:{x:DESERT.x,z:DESERT.z,r:21,name:'Dune Sovereign'},
};
/* the sealed portal waits a short walk in front of the spawn meadow */
const SPAWN_PORTAL={x:0,z:-24,r:4.4};
/* Every biome island is ringed by five cities: two large ones and three
   smaller towns. The per-biome base angle keeps the layouts from repeating. */
const CITY_RING=BIOME_R*.42;
const CITY_BASE={desert:.2,snow:.7,savanna:1.2};
const CITY_PLAN=[
  {kind:'v1',houses:16,radius:50,homeR:58,count:10,clear:145,turbines:4,towers:true},
  {kind:'v4',houses:14,radius:46,homeR:54,count:10,clear:135,turbines:3,towers:true},
  {kind:'v5',houses:9,radius:36,homeR:44,count:8,clear:110,turbines:2,towers:false},
  {kind:'v6',houses:9,radius:36,homeR:44,count:8,clear:110,turbines:2,towers:false},
  {kind:'v3',houses:9,radius:36,homeR:44,count:8,clear:110,turbines:2,towers:false},
];
const BIOME_CITIES=[];
['desert','snow','savanna'].forEach(biome=>{
  const B=BIOME_BY_NAME[biome],base=CITY_BASE[biome];
  CITY_PLAN.forEach((p,k)=>{
    const a=base+k*TAU/CITY_PLAN.length;
    BIOME_CITIES.push({
      biome,kind:p.kind,houses:p.houses,radius:p.radius,homeR:p.homeR,count:p.count,
      clear:p.clear,turbines:p.turbines,towers:p.towers,
      x:Math.round(B.x+Math.cos(a)*CITY_RING),z:Math.round(B.z+Math.sin(a)*CITY_RING),
    });
  });
});
const CITY_THEMES={
  desert:{walls:[0xd9b36a,0xc9a05a,0xb98f4a,0xe0c078],roofs:[0x8a5a2c,0x9a6a3a,0x7a4a24]},
  snow:{walls:[0xd8e2ea,0xb8c8d8,0xc9d8e0,0xe6eef4],roofs:[0x3f5f7a,0x4a5f7a,0x5b6a7a]},
  savanna:{walls:[0xd8b878,0xc9a05a,0xbfa060,0xe0c080],roofs:[0x7a4a2c,0x8a5a2c,0x5b4636]},
};
const SAV_KINDS=['lion','tiger','elephant','zebra','meerkat','locust'];
function biomeAt(x,z){
  if(Math.hypot(x-DESERT.x,z-DESERT.z)<DESERT.r)return 'desert';
  if(Math.hypot(x-SAVAN.x,z-SAVAN.z)<SAVAN.r)return 'savanna';
  if(Math.hypot(x-SNOWZ.x,z-SNOWZ.z)<SNOWZ.r)return 'snow';
  return null;
}
function buildBiomeGround(B,facets,rimHex,tint){
  const g=new THREE.Group();
  /* keep the triangle size in step with the home island */
  const rep=Math.max(8,Math.round(B.r/20));
  const ground=new THREE.Mesh(new THREE.CircleGeometry(B.r,40),
    new THREE.MeshStandardMaterial({map:facetTex(facets,rep,4),color:tint||0xffffff,roughness:1,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4}));
  ground.rotation.x=-Math.PI/2;ground.position.y=.06;ground.receiveShadow=true;g.add(ground);
  /* island cliff: hides the drop to the sea and gives the shore a lip */
  const rim=new THREE.Mesh(new THREE.CylinderGeometry(B.r*1.004,B.r*1.05,1.5,40,1,true),std(rimHex,{roughness:1,side:THREE.DoubleSide}));
  rim.position.y=-.69;g.add(rim);
  g.position.set(B.x,0,B.z);scene.add(g);return ground;
}
const desertGround=buildBiomeGround(DESERT,
  ['#92702f','#a1803a','#7e612a','#b08c46','#8a692c','#9b7835'],0x6e5323);
const snowGround=buildBiomeGround(SNOWZ,
  ['#eaf3fb','#d5e4f2','#ffffff','#c8dcee','#e0eef8','#d0e0f0'],0x9db4c6,0x69819a);
const savanGround=buildBiomeGround(SAVAN,
  ['#5b5326','#6a6130','#48521f','#6f6531','#5f5728','#776c36'],0x3e3818);
const seabed=new THREE.Mesh(new THREE.PlaneGeometry(8200,8200),new THREE.MeshBasicMaterial({color:0x1d6a8c}));
seabed.rotation.x=-Math.PI/2;seabed.position.y=-3;scene.add(seabed);
const seaGeo=new THREE.PlaneGeometry(7200,7200,64,64);seaGeo.rotateX(-Math.PI/2);
const seaPos=seaGeo.attributes.position;const seaBase=new Float32Array(seaPos.count*2);
for(let i=0;i<seaPos.count;i++){seaBase[i*2]=seaPos.getX(i);seaBase[i*2+1]=seaPos.getZ(i);}
const sea=new THREE.Mesh(seaGeo,new THREE.MeshStandardMaterial({color:0x2b94d6,roughness:.1,metalness:.4,flatShading:true,transparent:true,opacity:.85}));
sea.position.y=-0.55;scene.add(sea);
let seaAnimAt=-9;
function animateSea(t){
  for(let i=0;i<seaPos.count;i++){
    const x=seaBase[i*2],z=seaBase[i*2+1];
    seaPos.setY(i,Math.sin(x*0.045+t*1.1)*0.22+Math.cos(z*0.06+t*1.4)*0.18+Math.sin((x+z)*0.11+t*2)*0.07);
  }
  seaPos.needsUpdate=true;
}
const clouds=[];
(function(){const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true});
  for(let i=0;i<13;i++){const g=new THREE.Group();const n=3+Math.floor(rand()*3);
    for(let k=0;k<n;k++){const s=sph(rnd(4,7),m,k*5.5-n*2.5,rnd(-1,1),rnd(-2,2),7);s.scale.y=.6;g.add(s);}
    g.position.set(rnd(-2600,2600),rnd(46,68),rnd(-2600,2600));g.userData.v=rnd(1,2.5);scene.add(g);clouds.push(g);}
})();

/* ---------- static props: trees ---------- */
const solids=[];
const LAKES=[
  {x:34,z:-26,r:15}, {x:-260,z:60,r:14}, {x:140,z:-60,r:16},
  {x:-70,z:330,r:13}, {x:330,z:-260,r:15}, {x:-330,z:-60,r:14},
  {x:330,z:180,r:13}, {x:-120,z:-330,r:14}, {x:-430,z:-230,r:13},
  {x:120,z:480,r:13}, {x:520,z:-260,r:14}
];
LAKES.forEach(L=>solids.push({x:L.x,z:L.z,r:L.r,water:true}));
function lakeAt(x,z){for(let i=0;i<LAKES.length;i++){const L=LAKES[i];if(Math.hypot(x-L.x,z-L.z)<L.r)return L;}return null;}
function nearestLake(x,z){let best=null,bd=1e9;LAKES.forEach(L=>{const d=Math.hypot(x-L.x,z-L.z);if(d<bd){bd=d;best=L;}});return best;}
const RIVERS=[
  {w:10,pts:[[330,180],[480,120],[620,60],[806,10]]},
  {w:9,pts:[[-120,-330],[-80,-480],[-40,-630],[0,-806]]},
  {w:8,pts:[[-430,-230],[-540,-300],[-650,-370],[-701,-397]]},
  {w:9,pts:[[-70,330],[-160,470],[-215,610],[-267,757]]}
];
/* Seven streams flow out of the biome islands, one through each gap between
   the five cities. Their surface sits just above the raised biome ground. */
const BIOME_RIVER_PLAN={desert:[0,2],snow:[1,3],savanna:[0,2,3]};
const BIOME_RIVER_W={desert:[9,8],snow:[8,9],savanna:[8,9,7]};
['desert','snow','savanna'].forEach(biome=>{
  const B=BIOME_BY_NAME[biome],base=CITY_BASE[biome];
  BIOME_RIVER_PLAN[biome].forEach((slot,ri)=>{
    const a=base+(slot+.5)*TAU/5,w=BIOME_RIVER_W[biome][ri],pts=[];
    [[.138,0],[.37,.035],[.665,-.04],[.993,.015]].forEach(([f,off])=>{
      const rr=BIOME_R*f,aa=a+off;
      pts.push([Math.round(B.x+Math.cos(aa)*rr),Math.round(B.z+Math.sin(aa)*rr)]);
    });
    RIVERS.push({w,pts,biome,waterY:.08,bankY:.07});
  });
});
function segDist(pts,x,z){
  let bd=1e9;
  for(let i=0;i<pts.length-1;i++){
    const ax=pts[i][0],az=pts[i][1],bx=pts[i+1][0],bz=pts[i+1][1];
    const dx=bx-ax,dz=bz-az,L2=dx*dx+dz*dz||1;
    let t=((x-ax)*dx+(z-az)*dz)/L2;t=t<0?0:t>1?1:t;
    const d=Math.hypot(x-(ax+dx*t),z-(az+dz*t));
    if(d<bd)bd=d;
  }
  return bd;
}
function riverAt(x,z){for(let i=0;i<RIVERS.length;i++){const R=RIVERS[i];if(segDist(R.pts,x,z)<R.w/2)return true;}return false;}
function nearRiver(x,z,pad){for(let i=0;i<RIVERS.length;i++){const R=RIVERS[i];if(segDist(R.pts,x,z)<R.w/2+(pad||0))return true;}return false;}
const SITES=[{x:-165,z:180,r:85},{x:225,z:172,r:85},{x:-150,z:-165,r:90},{x:262,z:-135,r:90},
  {x:-40,z:430,r:85},{x:0,z:-400,r:85},{x:450,z:-40,r:85},{x:-450,z:60,r:85}];
/* keep trees, cacti, pines and wandering animals out of the boss lairs and portal */
SITES.push({x:SNOWZ.x,z:SNOWZ.z,r:38},{x:DESERT.x,z:DESERT.z,r:38},{x:SPAWN_PORTAL.x,z:SPAWN_PORTAL.z,r:11});
/* keep cacti, pines, acacias and cities out of each other and the water */
BIOME_CITIES.forEach(c=>SITES.push({x:c.x,z:c.z,r:c.clear}));
/* the six cities on the home island, also used to place the home river bridges */
const HOME_CITIES=[
  {x:-130*K,z:140*K,kind:'v1'},
  {x:170*K,z:135*K,kind:'v2'},
  {x:-50,z:480,kind:'v3'},
  {x:0,z:-450,kind:'v4'},
  {x:500,z:-60,kind:'v5'},
  {x:-500,z:80,kind:'v6'},
];
function nearSite(x,z,pad){for(let i=0;i<SITES.length;i++){const s=SITES[i];if(Math.hypot(x-s.x,z-s.z)<s.r+(pad||0))return true;}return false;}

/* ---------- bridges: one deck where each river runs closest to a city ---------- */
const BRIDGES=[];
function nearestRiverPoint(R,x,z){
  let best={d:1e9};
  for(let i=0;i<R.pts.length-1;i++){
    const [ax,az]=R.pts[i],[bx,bz]=R.pts[i+1];
    const dx=bx-ax,dz=bz-az,L2=dx*dx+dz*dz||1;
    let t=((x-ax)*dx+(z-az)*dz)/L2;t=clamp(t,0,1);
    const px=ax+dx*t,pz=az+dz*t,d=Math.hypot(x-px,z-pz);
    if(d<best.d)best={d,x:px,z:pz,tx:dx/Math.sqrt(L2),tz:dz/Math.sqrt(L2)};
  }
  return best;
}
/* true while the player stands on a deck, so a bridge counts as dry land */
function bridgeAt(x,z){
  for(let i=0;i<BRIDGES.length;i++){
    const b=BRIDGES[i],dx=x-b.x,dz=z-b.z;
    const lx=dx*Math.cos(b.yaw)-dz*Math.sin(b.yaw);
    const lz=dx*Math.sin(b.yaw)+dz*Math.cos(b.yaw);
    if(Math.abs(lx)<=b.wid/2&&Math.abs(lz)<=b.len/2)return b;
  }
  return null;
}
function buildBridges(){
  const wood=std(0x8a5a2b),woodD=std(0x5b3a1d),stone=std(0x8f8f8a);
  RIVERS.forEach(R=>{
    let best=null;
    const cities=R.biome?BIOME_CITIES.filter(c=>c.biome===R.biome):HOME_CITIES;
    cities.forEach(c=>{
      const n=nearestRiverPoint(R,c.x,c.z);
      if(!best||n.d<best.d)best={...n,city:c};
    });
    if(!best)return;
    /* a biome stream only gets a deck when it actually passes a town */
    if(R.biome&&best.d>320)return;
    /* cross the flow, with the near rail on the city side */
    let nx=-best.tz,nz=best.tx;
    if((best.city.x-best.x)*nx+(best.city.z-best.z)*nz<0){nx=-nx;nz=-nz;}
    const yaw=Math.atan2(nx,nz),len=R.w+14,wid=6.2;
    BRIDGES.push({x:best.x,z:best.z,yaw,len,wid});
    const g=new THREE.Group();g.position.set(best.x,0,best.z);g.rotation.y=yaw;
    g.add(box(wid,.07,len,wood,0,.055,0));
    for(let z=-len/2+.45;z<len/2;z+=1.15)g.add(box(wid+.04,.015,.1,woodD,0,.098,z));
    [-1,1].forEach(s=>{
      g.add(box(.14,.12,len,woodD,s*(wid/2-.12),.01,0));
      g.add(box(.12,.1,len,woodD,s*(wid/2-.1),.82,0));
      for(let z=-len/2+.6;z<=len/2-.6;z+=2.4)g.add(box(.12,.78,.12,wood,s*(wid/2-.1),.44,z));
      g.add(box(wid+1.8,.2,2.3,stone,0,.03,s*(len/2-1.05)));
    });
    /* the railings are real collision, so you cannot slide off the deck */
    [-1,1].forEach(s=>{
      const p=wpos(best.x,best.z,yaw,s*(wid/2-.1),0);
      solids.push({x:p.x,z:p.z,w:.16,d:len,yaw});
    });
    shade(g);scene.add(g);
  });
}
const MOUNTS=[];
[[-230,-330,6],[340,250,5],[-380,260,4],[100,-430,4]].forEach(c=>{for(let i=0;i<c[2];i++){const a=rnd(0,TAU),d=rnd(0,70),r=rnd(55,105);MOUNTS.push({x:c[0]*K+Math.cos(a)*d,z:c[1]*K+Math.sin(a)*d,r,h:r*rnd(1.7,2.3)});}});
MOUNTS.forEach(m=>solids.push({x:m.x,z:m.z,r:m.r*.78}));

function buildWorldGeometry() {
  const spots=[];let tries=0;
  while(spots.length<480&&tries<7000){tries++;
    const a=rnd(0,TAU),d=Math.sqrt(rand())*55*S,x=Math.cos(a)*d,z=Math.sin(a)*d;
    if(Math.hypot(x,z-6)<8)continue;
    if(LAKES.some(L=>Math.hypot(x-L.x,z-L.z)<L.r+4))continue;
    if(RIVERS.some(R=>segDist(R.pts,x,z)<R.w/2+5))continue;
    if(MOUNTS.some(m=>Math.hypot(x-m.x,z-m.z)<m.r+6))continue;
    if(SITES.some(s=>Math.hypot(s.x-x,s.z-z)<s.r))continue;
    if(biomeAt(x,z))continue;
    if(spots.some(t=>Math.hypot(t.x-x,t.z-z)<5))continue;
    spots.push({x,z,s:rnd(.85,1.5),r:rnd(0,TAU)});
  }
  const n=spots.length;
  const tg=new THREE.CylinderGeometry(.35,.5,3,6);tg.translate(0,1.5,0);
  const f1=new THREE.ConeGeometry(2.3,3.4,6);f1.translate(0,3.9,0);
  const f2=new THREE.ConeGeometry(1.7,2.8,6);f2.translate(0,5.8,0);
  const trunk=new THREE.InstancedMesh(tg,std(0x7a4f2b),n);
  const l1=new THREE.InstancedMesh(f1,std(0xffffff),n);
  const l2=new THREE.InstancedMesh(f2,std(0xffffff),n);
  const d=new THREE.Object3D(),col=new THREE.Color();
  spots.forEach((t,i)=>{
    d.position.set(t.x,0,t.z);d.rotation.set(0,t.r,0);d.scale.set(t.s,t.s*rnd(.9,1.2),t.s);d.updateMatrix();
    trunk.setMatrixAt(i,d.matrix);l1.setMatrixAt(i,d.matrix);l2.setMatrixAt(i,d.matrix);
    col.setHSL(rnd(.28,.36),rnd(.45,.6),rnd(.26,.38));l1.setColorAt(i,col);l2.setColorAt(i,col);
    solids.push({x:t.x,z:t.z,r:.75*t.s});
  });
  [trunk,l1,l2].forEach(m=>{m.castShadow=true;m.receiveShadow=true;scene.add(m);});
}

const lakeWaters=[];
function buildWater() {
  LAKES.forEach(L=>{
    const shore=new THREE.Mesh(new THREE.RingGeometry(L.r-2,L.r+2.6,24),new THREE.MeshStandardMaterial({color:0xe9d9a0,roughness:1}));
    shore.rotation.x=-Math.PI/2;shore.position.set(L.x,.02,L.z);shore.receiveShadow=true;shore.userData.noCull=true;scene.add(shore);
    /* opaque water: transparent planes over the ground caused shimmer/sorting flicker */
    const w=new THREE.Mesh(new THREE.CircleGeometry(L.r,24),new THREE.MeshStandardMaterial({color:0x2b94d6,roughness:.1,metalness:.3}));
    w.rotation.x=-Math.PI/2;w.position.set(L.x,.05,L.z);w.userData.noCull=true;scene.add(w);lakeWaters.push(w);
    const pad=std(0x3f9a3a);
    for(let i=0;i<9;i++){const a=rnd(0,TAU),d=rnd(2,L.r-2),p=cyl(.55,.55,.04,pad,L.x+Math.cos(a)*d,.08,L.z+Math.sin(a)*d,10);p.userData.noCull=true;scene.add(p);}
  });

  RIVERS.forEach(R=>{
    const bankM=new THREE.MeshStandardMaterial({color:0xe9d9a0,roughness:1});
    const waterM=new THREE.MeshStandardMaterial({color:0x2b94d6,roughness:.1,metalness:.3});
    const bw=R.w+5,waterY=R.waterY==null?.05:R.waterY,bankY=R.bankY==null?.02:R.bankY;
    for(let i=0;i<R.pts.length-1;i++){
      const [ax,az]=R.pts[i],[bx,bz]=R.pts[i+1];
      const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz);
      const mx=(ax+bx)/2,mz=(az+bz)/2;
      const bank=new THREE.Mesh(new THREE.PlaneGeometry(bw,len+bw*.7),bankM);
      bank.rotation.x=-Math.PI/2;bank.rotation.z=yaw;bank.position.set(mx,bankY,mz);bank.receiveShadow=true;bank.userData.noCull=true;scene.add(bank);
      const w=new THREE.Mesh(new THREE.PlaneGeometry(R.w,len+bw*.7),waterM);
      w.rotation.x=-Math.PI/2;w.rotation.z=yaw;w.position.set(mx,waterY,mz);w.userData.noCull=true;scene.add(w);lakeWaters.push(w);
    }
    R.pts.forEach(([px,pz])=>{
      const b=new THREE.Mesh(new THREE.CircleGeometry(bw/2,20),bankM);
      b.rotation.x=-Math.PI/2;b.position.set(px,bankY,pz);b.userData.noCull=true;scene.add(b);
      const w=new THREE.Mesh(new THREE.CircleGeometry(R.w/2,20),waterM);
      w.rotation.x=-Math.PI/2;w.position.set(px,waterY,pz);w.userData.noCull=true;scene.add(w);lakeWaters.push(w);
    });
    for(let i=0;i<R.pts.length-1;i++){
      const [ax,az]=R.pts[i],[bx,bz]=R.pts[i+1];
      const len=Math.hypot(bx-ax,bz-az),n=Math.max(1,Math.round(len/6));
      for(let k=0;k<=n;k++){
        const t=k/n,x=ax+(bx-ax)*t,z=az+(bz-az)*t;
        if(!solids.some(s=>s.water&&Math.hypot(s.x-x,s.z-z)<s.r*.5))solids.push({x,z,r:R.w/2+1.2,water:true});
      }
    }
  });
  buildBridges();
}

/* ---------- Animals & Props ---------- */
const fishes=[];
function spawnFishes() {
  const cols=[0xf08a2c,0xc9d6dc,0xe85a3c,0xf2c744,0x8fb6c9];
  /* only stock the lakes nearest to the player — the rest fill when you visit */
  const near=LAKES.slice().sort((a,b)=>Math.hypot(a.x-P.x,a.z-P.z)-Math.hypot(b.x-P.x,b.z-P.z)).slice(0,4);
  for(let i=0;i<8;i++){
    const L=near[i%near.length];
    const g=new THREE.Group(),c=std(cols[i%cols.length]),dk=std(0x2a3b44);
    const body=sph(.4,c,0,0,0,8);body.scale.set(.55,.55,1.25);g.add(body);
    const tail=pivot(g,0,0,-.45);const tf=cone(.3,.5,c,0,0,-.22,4);tf.rotation.x=-Math.PI/2;tf.scale.set(.25,1,1);tail.add(tf);
    g.add(box(.04,.22,.3,dk,0,.2,0));
    [-1,1].forEach(s=>g.add(sph(.045,dk,s*.18,.07,.32,5)));
    g.position.set(L.x,.1,L.z);shade(g);scene.add(g);
    fishes.push({g,L,tail,a:rnd(0,TAU),fish:true,land:false,held:false,rr:rnd(9,L.r-1.5),sp:rnd(.15,.45)*(rand()<.5?-1:1),ph:rnd(0,TAU),jt:rnd(3,12),jump:-1});
  }
}
function releaseFish(f){
  const g=f.g;g.scale.setScalar(1);g.rotation.set(0,0,0);shade(g,true);scene.add(g);f.held=false;
  const fw0=fwdVec(),fl0=Math.hypot(fw0.x,fw0.z)||1,qx=P.x+fw0.x/fl0*1.2,qz=P.z+fw0.z/fl0*1.2;
  const L=lakeAt(qx,qz)||(()=>{const n=nearestLake(P.x,P.z);return n&&Math.hypot(P.x-n.x,P.z-n.z)<n.r+4?n:null;})();
  if(L){
    f.L=L;
    const qd=Math.hypot(qx-L.x,qz-L.z);
    if(qd<L.r-.8){f.a=Math.atan2(qz-L.z,qx-L.x);f.rr=clamp(qd,3,L.r-2);}
    else{f.a=Math.atan2(P.z-L.z,P.x-L.x);f.rr=L.r-2;}
    f.land=false;f.jump=-1;f.jt=rnd(2,5);
    burst(L.x+Math.cos(f.a)*f.rr,.2,L.z+Math.sin(f.a)*f.rr,0xbfe6ff,10);toast('Splash!');
  }
  else{const fw=fwdVec(),fl=Math.hypot(fw.x,fw.z)||1;f.land=true;g.position.set(P.x+fw.x/fl,.15,P.z+fw.z/fl);toast('The fish flops on the grass');}
}
function updateFish(dt,t){
  fishes.forEach(f=>{
    if(!awake(f))return;
    if(f.held){f.tail.rotation.y=Math.sin(t*14+f.ph)*.6;f.g.rotation.y=-1.2+Math.sin(t*5)*.15;return;}
    if(f.land){f.g.position.y=.15+Math.abs(Math.sin(t*8+f.ph))*.1;f.g.rotation.set(0,f.ph,Math.PI/2+Math.sin(t*12+f.ph)*.3);f.tail.rotation.y=Math.sin(t*16+f.ph)*.6;return;}
    f.a+=f.sp*dt*(10/f.rr);f.jt-=dt;
    const L=f.L||LAKES[0];
    const x=L.x+Math.cos(f.a)*f.rr,z=L.z+Math.sin(f.a)*f.rr,s=Math.sign(f.sp);
    const hx=-Math.sin(f.a)*s,hz=Math.cos(f.a)*s;
    let y=.1+Math.sin(t*2+f.ph)*.015,pitch=0;
    if(f.jump>=0){f.jump+=dt/.8;const k=Math.min(f.jump,1);y=.1+Math.sin(Math.PI*k)*1.2;pitch=-Math.cos(Math.PI*k)*.9;
      if(k>=1){f.jump=-1;f.jt=rnd(4,12);burst(x,.2,z,0xbfe6ff,8);}}
    else if(f.jt<=0){f.jump=0;burst(x,.2,z,0xbfe6ff,8);}
    f.g.position.set(x,y,z);f.g.rotation.set(pitch,Math.atan2(hx,hz),0);
    f.tail.rotation.y=Math.sin(t*10+f.ph)*.5;
  });
}

function spawnFishAt(x,z){
  const cols=[0xf08a2c,0xc9d6dc,0xe85a3c,0xf2c744,0x8fb6c9];
  const g=new THREE.Group(),c=std(cols[Math.floor(rand()*cols.length)]),dk=std(0x2a3b44);
  const body=sph(.4,c,0,0,0,8);body.scale.set(.55,.55,1.25);g.add(body);
  const tail=pivot(g,0,0,-.45);const tf=cone(.3,.5,c,0,0,-.22,4);tf.rotation.x=-Math.PI/2;tf.scale.set(.25,1,1);tail.add(tf);
  g.add(box(.04,.22,.3,dk,0,.2,0));
  [-1,1].forEach(s=>g.add(sph(.045,dk,s*.18,.07,.32,5)));
  g.position.set(x,.15,z);shade(g);scene.add(g);
  const f={g,tail,L:null,a:rnd(0,TAU),fish:true,land:true,held:false,rr:1,sp:rnd(.15,.45),ph:rnd(0,TAU),jt:5,jump:-1};
  fishes.push(f);return f;
}

const pets=[];
function buildCat(){
  const g=new THREE.Group(),cols=[0xe08a3a,0x8a8a90,0x2b2b2e,0xf2efe6,0xb07a4a];
  const c=std(cols[Math.floor(rand()*cols.length)]),pink=std(0xf2a6b5),eye=std(0x6fd04a),blk=std(0x111111);
  g.add(box(.3,.28,.7,c,0,.38,0));
  const head=pivot(g,0,.52,.38);head.add(box(.28,.26,.26,c,0,0,.06));
  [-1,1].forEach(s=>{head.add(cone(.06,.13,c,s*.09,.18,.04,4));head.add(sph(.03,eye,s*.07,.03,.2,6));head.add(sph(.014,blk,s*.07,.03,.225,5));});
  head.add(box(.05,.04,.03,pink,0,-.03,.2));
  const tail=pivot(g,0,.46,-.35);tail.rotation.x=-.8;tail.add(box(.06,.06,.45,c,0,0,-.22));
  const legs=[];[[-.1,.25],[.1,.25],[-.1,-.25],[.1,-.25]].forEach(p=>{const l=pivot(g,p[0],.26,p[1]);l.add(box(.08,.26,.08,c,0,-.13,0));legs.push(l);});
  g.userData={head,tail,legs};return shade(g);
}
function buildDog(){
  const g=new THREE.Group(),cols=[0x9a6a3a,0xd8b070,0x2a2420,0xe8e2d0];
  const c=std(cols[Math.floor(rand()*cols.length)]),ear=std(0x3a2a1c),snout=std(0xe6d3b3),blk=std(0x111111);
  g.add(box(.4,.4,.95,c,0,.62,0));
  const head=pivot(g,0,.88,.55);head.add(box(.34,.32,.36,c,0,0,.08));
  head.add(box(.2,.16,.22,snout,0,-.06,.34));head.add(box(.08,.06,.06,blk,0,.0,.46));
  [-1,1].forEach(s=>{const e=box(.1,.22,.07,ear,s*.19,.06,.02);e.rotation.z=s*.3;head.add(e);head.add(sph(.03,blk,s*.09,.08,.27,6));});
  const tail=pivot(g,0,.78,-.5);tail.rotation.x=-.6;tail.add(box(.07,.07,.42,c,0,0,-.2));
  const legs=[];[[-.14,.35],[.14,.35],[-.14,-.35],[.14,-.35]].forEach(p=>{const l=pivot(g,p[0],.45,p[1]);l.add(box(.12,.45,.12,c,0,-.22,0));legs.push(l);});
  g.userData={head,tail,legs};return shade(g);
}
function buildBunny(){
  const g=new THREE.Group();
  const c=std(0xe9e3db),pink=std(0xf2c4cc),blk=std(0x111111),wh=std(0xffffff);
  const body=sph(.3,c,0,.4,0,9);body.scale.set(1,.9,1.3);g.add(body);
  const head=pivot(g,0,.58,.42);
  head.add(sph(.22,c,0,0,0,9));
  [-1,1].forEach(s=>{
    const e=box(.11,.44,.06,pink,s*.12,.32,-.05);e.rotation.z=s*.15;e.rotation.x=-.12;head.add(e);
    head.add(sph(.04,blk,s*.11,.05,.18,6));
  });
  head.add(sph(.045,pink,0,-.03,.22,6));
  const tail=pivot(g,0,.42,-.44);tail.add(sph(.13,wh,0,0,0,7));
  const legs=[];[[-.15,.24],[.15,.24],[-.15,-.22],[.15,-.22]].forEach(p=>{const l=pivot(g,p[0],.26,p[1]);l.add(box(.13,.28,.17,c,0,-.14,0));legs.push(l);});
  g.userData={head,tail,legs};return shade(g);
}
function buildSheep() {
  const g=new THREE.Group();
  const wool=std(0xf0eee4), face=std(0x2a2a2c), blk=std(0x111111);
  const body=sph(.8,wool,0,.96,0,10);body.scale.set(1,.9,1.4);g.add(body);
  const head=pivot(g,0,1.36,.96);
  head.add(box(.48,.56,.64,face,0,0,.24));
  head.add(sph(.48,wool,0,.24,0,8));
  [-1,1].forEach(s=>{
    const ear=box(.24,.1,.1,face,s*.32,.08,.16);ear.rotation.z=-s*.4;head.add(ear);
    head.add(sph(.048,blk,s*.24,.08,.51,5));
  });
  const tail=pivot(g,0,.96,-1.04); tail.add(sph(.24,wool,0,0,0,6)); tail.rotation.x=-.4;
  const legs=[];[[-.32,.56],[.32,.56],[-.32,-.64],[.32,-.64]].forEach(p=>{
    const l=pivot(g,p[0],.64,p[1]);
    l.add(box(.19,.64,.19,face,0,-.32,0));
    legs.push(l);
  });
  g.userData={head,tail,legs}; return shade(g);
}
function buildChicken() {
  const g=new THREE.Group();
  const bodyC=std(rand()<.5?0xffffff:0x8a5a2b), red=std(0xd83a2a), beak=std(0xf0c030), blk=std(0x111111);
  const body=sph(.25,bodyC,0,.3,0,8); body.scale.set(1,.95,1.2); g.add(body);
  const head=pivot(g,0,.5,.25);
  head.add(sph(.15,bodyC,0,0,0,7));
  head.add(cone(.05,.12,beak,0,-.02,.16,4)); head.children[1].rotation.x=Math.PI/2;
  head.add(box(.04,.1,.08,red,0,.15,0));
  head.add(box(.04,.08,.06,red,0,-.1,.08));
  [-1,1].forEach(s=>head.add(sph(.02,blk,s*.09,.03,.1,5)));
  const tail=pivot(g,0,.35,-.25);
  const tf=box(.08,.2,.15,bodyC,0,.08,-.08); tf.rotation.x=-.4; tail.add(tf);
  const legs=[];[[-.1,.15],[.1,.15]].forEach(p=>{
    const l=pivot(g,p[0],.15,0);
    l.add(box(.04,.15,.04,beak,0,-.07,0));
    l.add(box(.08,.02,.1,beak,0,-.14,.03));
    legs.push(l);
  });
  g.userData={head,tail,legs}; return shade(g);
}
function buildWolf(){
  const g=new THREE.Group();
  const c=std(0x8d9199),dk=std(0x565b62),lt=std(0xc9cdd3),blk=std(0x111111);
  const body=box(.52,.56,1.25,c,0,.92,0);g.add(body);
  g.add(box(.46,.14,1.1,dk,0,1.24,-.05));
  const head=pivot(g,0,1.22,.72);
  head.add(box(.42,.4,.46,c,0,0,0));
  head.add(box(.28,.24,.34,lt,0,-.07,.38));
  head.add(box(.13,.1,.11,blk,0,-.03,.57));
  [-1,1].forEach(s=>{
    const e=cone(.09,.26,dk,s*.15,.28,-.05,4);e.rotation.z=s*.14;head.add(e);
    head.add(sph(.045,blk,s*.12,.07,.22,6));
  });
  const tail=pivot(g,0,1.02,-.68);tail.rotation.x=-.55;
  tail.add(box(.16,.16,.62,dk,0,0,-.31));tail.add(sph(.09,lt,0,0,-.62,6));
  const legs=[];[[-.19,.48],[.19,.48],[-.19,-.48],[.19,-.48]].forEach(p=>{const l=pivot(g,p[0],.68,p[1]);l.add(box(.16,.68,.16,c,0,-.34,0));l.add(box(.18,.11,.22,dk,0,-.67,.03));legs.push(l);});
  g.userData={head,tail,legs};return shade(g);
}
function buildBear(){
  const g=new THREE.Group(),cols=[0x5a3a24,0x24201e,0x7a5a3a];
  const c=std(cols[Math.floor(rand()*cols.length)]),tan=std(0xc9a27e),blk=std(0x111111);
  g.add(box(1.1,1.0,1.7,c,0,1.0,0));g.add(box(1.0,.5,.7,c,0,1.55,.4));
  const head=pivot(g,0,1.4,1.1);head.add(box(.6,.55,.6,c,0,0,.15));
  head.add(box(.32,.25,.3,tan,0,-.1,.55));head.add(box(.1,.08,.06,blk,0,-.02,.72));
  [-1,1].forEach(s=>{head.add(sph(.12,c,s*.25,.32,0,6));head.add(sph(.04,blk,s*.18,.1,.42,5));});
  const tail=pivot(g,0,1.2,-.9);tail.add(sph(.12,c,0,0,-.05,6));
  const legs=[];[[-.4,.6],[.4,.6],[-.4,-.6],[.4,-.6]].forEach(p=>{const l=pivot(g,p[0],.6,p[1]);l.add(box(.35,.6,.35,c,0,-.3,0));legs.push(l);});
  g.userData={head,tail,legs};return shade(g);
}
function buildDeer(){
  const g=new THREE.Group();
  const c=std(0xb98a52),belly=std(0xf0e6d0),dk=std(0x2a2118),anl=std(0xe8dcc0),blk=std(0x111111);
  g.add(box(.5,.55,1.3,c,0,1.25,0));g.add(box(.42,.12,1.1,belly,0,1.0,0));
  const neck=box(.22,.7,.26,c,0,1.75,.7);neck.rotation.x=.4;g.add(neck);
  const head=pivot(g,0,2.05,.95);head.rotation.x=.4;head.add(box(.2,.22,.45,c,0,-.05,.2));
  [-1,1].forEach(s=>{
    const a=box(.04,.5,.04,anl,s*.09,.3,0);a.rotation.z=-s*.3;head.add(a);
    const t=box(.03,.25,.03,anl,s*.17,.5,.04);t.rotation.z=-s*.6;head.add(t);
    const e=cone(.05,.16,c,s*.14,.1,-.04,4);e.rotation.z=-s*1.1;head.add(e);
    head.add(sph(.025,blk,s*.1,.02,.3,5));
  });
  head.add(box(.06,.05,.04,blk,0,-.03,.43));
  const tail=pivot(g,0,1.45,-.66);tail.add(box(.12,.16,.08,belly,0,0,-.04));
  const legs=[];[[-.17,.5],[.17,.5],[-.17,-.5],[.17,-.5]].forEach(p=>{const l=pivot(g,p[0],.95,p[1]);l.add(box(.11,.95,.11,c,0,-.475,0));l.add(box(.13,.1,.15,dk,0,-.9,0));legs.push(l);});
  g.userData={head,tail,legs};return shade(g);
}
function buildHorse(){
  const g=new THREE.Group(),cols=[0x7a4a2a,0x3a2a22,0xe8e2d4,0xa8642e,0x9a9a9e];
  const c=std(cols[Math.floor(rand()*cols.length)]),mane=std(0x241812),hoof=std(0x1a1410),blk=std(0x111111);
  g.add(box(.75,.85,1.8,c,0,1.35,0));
  const neck=box(.4,1.0,.45,c,0,2.0,1.0);neck.rotation.x=.45;g.add(neck);
  const head=pivot(g,0,2.45,1.3);head.rotation.x=.55;head.add(box(.3,.32,.8,c,0,-.12,.3));
  [-1,1].forEach(s=>{head.add(cone(.06,.2,c,s*.1,.18,-.05,4));head.add(sph(.035,blk,s*.16,0,.2,6));});
  const mn=box(.08,.9,.16,mane,0,2.15,.78);mn.rotation.x=.45;g.add(mn);
  const tail=pivot(g,0,1.7,-.95);tail.add(box(.12,.9,.14,mane,0,-.45,-.05));
  const legs=[];[[-.28,.7],[.28,.7],[-.28,-.7],[.28,-.7]].forEach(p=>{const l=pivot(g,p[0],.95,p[1]);l.add(box(.2,.95,.2,c,0,-.475,0));l.add(box(.22,.12,.24,hoof,0,-.9,0));legs.push(l);});
  g.userData={head,tail,legs};return shade(g);
}
function buildCamel(){
  const g=new THREE.Group(),cols=[0xc9a165,0xb98e52,0xd7b57c],c=std(cols[Math.floor(rand()*cols.length)]),dk=std(0x8e6c3e),blk=std(0x14100c),hoof=std(0x5a4630);
  g.add(box(.8,.9,2.1,c,0,1.6,0));
  const hump1=sph(.62,c,0,2.12,-.42,8);hump1.scale.set(1,.68,1.15);g.add(hump1);
  const hump2=sph(.55,c,0,2.0,.5,8);hump2.scale.set(1,.6,1.1);g.add(hump2);
  const neck=box(.34,1.3,.4,c,0,2.55,1.0);neck.rotation.x=.38;g.add(neck);
  const head=pivot(g,0,3.18,1.38);head.rotation.x=.32;
  head.add(box(.34,.36,.85,c,0,0,.3));
  head.add(box(.28,.2,.3,dk,0,.12,.72));
  head.add(sph(.04,blk,-.12,.13,.5,5));head.add(sph(.04,blk,.12,.13,.5,5));
  const earL=cone(.05,.18,dk,-.14,.26,-.08,4);earL.rotation.z=.3;head.add(earL);
  const earR=cone(.05,.18,dk,.14,.26,-.08,4);earR.rotation.z=-.3;head.add(earR);
  const tail=pivot(g,0,1.9,-1.05);tail.add(box(.1,.7,.1,dk,0,-.3,0));
  const legs=[];[[-.3,.75],[.3,.75],[-.3,-.75],[.3,-.75]].forEach(p=>{const l=pivot(g,p[0],1.15,p[1]);l.add(box(.22,1.15,.22,c,0,-.575,0));l.add(box(.3,.14,.3,hoof,0,-1.08,0));legs.push(l);});
  g.userData={head,tail,legs};return shade(g);
}
function buildCobra(){
  const g=new THREE.Group();
  const body=std(0x9c7a36),dark=std(0x5a4418),belly=std(0xdcc98e),
        hoodM=std(0x6a4c1a),hoodIn=std(0xd9b45a),red=std(0xc9342a),
        eye=std(0x111111),amber=std(0xe0a33a),fangM=std(0xf2e9cc);
  /* same segmented body rig as the grass snake, so the cobra slithers identically */
  const segs=[],N=12,segL=.2;
  let parent=g;
  for(let i=0;i<N;i++){
    const p=pivot(parent,0,i?0:.10,i?-segL:0);
    const k=i/(N-1),r=.17*(1-k*.73)+.022;
    const s=sph(r,body,0,0,-segL*.5,9);
    s.scale.set(1.02,.62,1.85);
    p.add(s);
    if(i%2===0&&i<N-2){
      const dm=box(r*.92,.018,segL*.82,dark,0,r*.5,-segL*.5);
      dm.rotation.y=Math.PI/4;p.add(dm);
    }
    segs.push(p);parent=p;
  }
  /* pale belly line */
  const bl=sph(.15,belly,0,.04,.02,8);bl.scale.set(.9,.45,2.3);g.add(bl);
  /* raised S-neck carrying the hood */
  const neck=pivot(g,0,.16,.30);
  const n1=cyl(.12,.20,.50,body,0,.24,0,8);n1.rotation.x=.20;neck.add(n1);
  const n2=pivot(neck,0,.48,0);
  const n3=cyl(.08,.13,.36,body,0,.17,0,8);n3.rotation.x=-.28;n2.add(n3);
  /* hooded head: head proud at the top, the fan spreading down and out behind it */
  const head=pivot(n2,0,.38,.06);
  const hs=new THREE.Shape();
  hs.moveTo(0,.14);
  hs.bezierCurveTo(.12,.14,.24,.06,.32,-.10);
  hs.bezierCurveTo(.37,-.34,.30,-.60,0,-.80);
  hs.bezierCurveTo(-.30,-.60,-.37,-.34,-.32,-.10);
  hs.bezierCurveTo(-.24,.06,-.12,.14,0,.14);
  const hg=new THREE.ExtrudeGeometry(hs,{depth:.09,bevelEnabled:true,bevelThickness:.03,bevelSize:.03,bevelSegments:2,curveSegments:14});
  hg.translate(0,0,-.045);
  const hood=new THREE.Mesh(hg,hoodM);hood.castShadow=true;head.add(hood);
  /* the twin "spectacle" mark on the back of the hood */
  [-1,1].forEach(s=>{const sp=sph(.075,hoodIn,s*.135,-.28,.075,8);sp.scale.set(1,.98,.16);head.add(sp);});
  head.add(box(.13,.04,.022,hoodIn,0,-.28,.082));
  /* rounded skull with a blunt snout, so the head reads as a reptile, not a box */
  const skull=sph(.26,body,0,.04,.20,10);skull.scale.set(1.05,.62,1.15);head.add(skull);
  head.add(box(.28,.13,.22,body,0,-.005,.52));
  const nose=sph(.11,body,0,-.005,.61,8);nose.scale.set(1.1,.85,.75);head.add(nose);
  head.add(box(.24,.05,.34,belly,0,-.05,.30));
  head.add(box(.05,.014,.30,dark,0,.192,.16));
  [-1,1].forEach(s=>{
    head.add(sph(.075,amber,s*.205,.115,.29,7));
    head.add(sph(.032,eye,s*.205,.115,.352,6));
    head.add(sph(.016,eye,s*.052,.018,.70,4));
    const fang=cone(.019,.12,fangM,s*.08,-.075,.60,4);fang.rotation.x=Math.PI;head.add(fang);
  });
  head.add(box(.21,.016,.022,dark,0,-.055,.665));
  /* a hinged lower jaw so the mouth can gape when it strikes */
  const jaw=pivot(head,0,-.045,.16);
  jaw.add(box(.22,.055,.34,body,0,-.01,.15));
  jaw.add(box(.18,.03,.17,belly,0,-.043,.34));
  const tongue=new THREE.Group();tongue.position.set(0,-.035,.34);tongue.visible=false;jaw.add(tongue);
  [-1,1].forEach(s=>{const f=box(.026,.018,.24,red,s*.032,-.005,.11);f.rotation.y=s*.22;tongue.add(f);});
  g.userData={head,jaw,tongue,neck,neck2:n2,hood,segs,spine:segs[0],rings:[],legs:[],tail:null};
  return shade(g);
}
/* a slender green grass snake: long segmented body, no hood, quick tongue */
function buildSnake(){
  const g=new THREE.Group();
  const body=std(0x5f7d3f),dark=std(0x435c2c),belly=std(0xd9d3a0),
        pattern=std(0x2f4420),eye=std(0x14180c),amber=std(0xe0a33a),red=std(0xb83232);
  const segs=[],N=12,segL=.19;
  let parent=g;
  for(let i=0;i<N;i++){
    const p=pivot(parent,0,i?0:.11,i?-segL:0);
    const t=i/(N-1),r=.16*(1-t*.76)+.02;
    const s=sph(r,body,0,0,-segL*.5,9);
    s.scale.set(1.02,.58,1.85);
    p.add(s);
    if(i%2===0&&i<N-2){
      const dm=box(r*.92,.018,segL*.8,pattern,0,r*.5,-segL*.5);
      dm.rotation.y=Math.PI/4;p.add(dm);
    }
    segs.push(p);parent=p;
  }
  /* pale belly line */
  const bl=sph(.135,belly,0,.035,.02,8);bl.scale.set(.9,.45,2.3);g.add(bl);
  /* neck and a small, unhooded head */
  const head=pivot(g,0,.20,.36);
  const skull=sph(.145,body,0,0,.02,9);skull.scale.set(1,.78,1.5);head.add(skull);
  const snout=box(.115,.075,.18,body,0,-.01,.17);head.add(snout);
  head.add(box(.09,.032,.13,belly,0,-.055,.19));
  [-1,1].forEach(s=>{
    head.add(sph(.038,amber,s*.082,.045,.05,6));
    head.add(box(.016,.032,.032,eye,s*.082,.05,.075));
  });
  const jaw=pivot(head,0,-.05,.12);
  jaw.add(box(.10,.03,.16,body,0,-.012,.05));
  const tongue=new THREE.Group();tongue.position.set(0,-.045,.13);tongue.visible=false;jaw.add(tongue);
  [-1,1].forEach(s=>{const f=box(.014,.012,.18,red,s*.02,-.01,.09);f.rotation.y=s*.26;tongue.add(f);});
  g.userData={head,jaw,tongue,segs,spine:segs[0],rings:[],legs:[],tail:null};
  return shade(g);
}
function buildPenguin(){
  const g=new THREE.Group(),blk=std(0x202a36),white=std(0xf7fafc),org=std(0xf0a12a),eye=std(0x101418);
  const body=sph(.42,blk,0,.52,0,10);body.scale.set(.92,1.3,.86);g.add(body);
  const belly=sph(.34,white,0,.5,.12,10);belly.scale.set(.82,1.15,.55);g.add(belly);
  const head=pivot(g,0,.98,.02);head.add(sph(.26,blk,0,0,0,9));
  head.add(sph(.19,white,0,-.02,.12,8));
  const beak=cone(.08,.24,org,0,-.03,.3,6);beak.rotation.x=Math.PI/2;head.add(beak);
  head.add(sph(.035,eye,-.1,.05,.2,5));head.add(sph(.035,eye,.1,.05,.2,5));
  const flips=[];[-1,1].forEach(s=>{const f=pivot(g,s*.36,.66,0);f.rotation.z=s*.18;f.add(box(.1,.52,.26,blk,0,-.22,0));flips.push(f);});
  const feet=[];[[-.15,.1],[.15,.1]].forEach(p=>{const l=pivot(g,p[0],.1,p[1]);l.add(box(.17,.06,.3,org,0,-.03,.04));feet.push(l);});
  g.userData={head,tail:null,legs:feet,flips};return shade(g);
}
function buildPolarBear(){
  const g=new THREE.Group(),c=std(0xeef3f8),pale=std(0xd7e2ec),blk=std(0x141414);
  g.add(box(1.15,1.05,1.8,c,0,1.05,0));g.add(box(1.05,.5,.75,pale,0,1.62,.42));
  const head=pivot(g,0,1.45,1.18);head.add(box(.66,.6,.66,c,0,0,.16));
  head.add(box(.34,.26,.32,pale,0,-.1,.6));head.add(box(.11,.09,.07,blk,0,-.02,.78));
  [-1,1].forEach(s=>{head.add(sph(.13,c,s*.28,.34,0,6));head.add(sph(.045,blk,s*.19,.1,.48,5));});
  const tail=pivot(g,0,1.25,-.95);tail.add(sph(.14,c,0,0,-.04,6));
  const legs=[];[[-.42,.62],[.42,.62],[-.42,-.62],[.42,-.62]].forEach(p=>{const l=pivot(g,p[0],.62,p[1]);l.add(box(.38,.62,.38,c,0,-.31,0));legs.push(l);});
  g.userData={head,tail,legs};return shade(g);
}

/* ---------- savanna animals ---------- */
function buildLion(){
  const g=new THREE.Group();
  const fur=std(0xc99a54),mane=std(0x8a5a2a),belly=std(0xe8d4a8),dk=std(0x2a1a10),blk=std(0x111111),amber=std(0xe0b040);
  g.add(box(.62,.64,1.5,fur,0,1.02,0));g.add(box(.5,.18,1.24,belly,0,.74,0));
  const head=pivot(g,0,1.35,.86);
  head.add(sph(.34,mane,0,.02,-.1,10));head.add(sph(.26,fur,0,.05,.12,9));
  head.add(box(.22,.16,.18,belly,0,-.03,.3));head.add(box(.14,.06,.05,dk,0,.03,.4));
  [-1,1].forEach(s=>{
    head.add(cone(.07,.14,mane,s*.2,.23,-.02,5));
    head.add(sph(.045,amber,s*.11,.09,.25,6));head.add(sph(.02,blk,s*.11,.09,.288,5));
  });
  head.add(box(.18,.018,.02,dk,0,-.1,.37));
  const tail=pivot(g,0,1.06,-.78);tail.rotation.x=-.55;
  tail.add(box(.07,.07,.66,fur,0,0,-.33));tail.add(sph(.1,mane,0,0,-.7,6));
  const legs=[];[[-.2,.5],[.2,.5],[-.2,-.5],[.2,-.5]].forEach(p=>{
    const l=pivot(g,p[0],.64,p[1]);l.add(box(.17,.64,.2,fur,0,-.32,0));l.add(box(.2,.1,.23,belly,0,-.6,.02));legs.push(l);
  });
  g.userData={head,tail,legs};return shade(g);
}
function buildTiger(){
  const g=new THREE.Group();
  const fur=std(0xd9822e),dark=std(0x2a1a10),white=std(0xf4ead6),blk=std(0x111111),amber=std(0xe8c040);
  g.add(box(.6,.62,1.55,fur,0,1.02,0));g.add(box(.5,.2,1.3,white,0,.74,0));
  for(let i=0;i<6;i++)g.add(box(.62,.05,.07,dark,0,1.35,-.62+i*.25));
  const head=pivot(g,0,1.32,.93);
  head.add(sph(.29,fur,0,.02,.08,9));head.add(box(.12,.1,.14,white,0,-.06,.32));
  head.add(box(.05,.04,.04,blk,0,.02,.39));
  [-1,1].forEach(s=>{
    head.add(cone(.07,.12,fur,s*.2,.21,-.02,5));
    head.add(sph(.045,amber,s*.11,.08,.23,6));head.add(sph(.02,blk,s*.11,.08,.266,5));
    head.add(box(.03,.12,.03,dark,s*.27,.02,.08));
  });
  const tail=pivot(g,0,1.05,-.8);tail.rotation.x=-.45;
  tail.add(box(.08,.08,.8,fur,0,0,-.4));
  for(let i=0;i<4;i++)tail.add(box(.085,.085,.04,dark,0,0,-.18-i*.16));
  const legs=[];[[-.19,.5],[.19,.5],[-.19,-.5],[.19,-.5]].forEach(p=>{
    const l=pivot(g,p[0],.64,p[1]);l.add(box(.17,.64,.19,fur,0,-.32,0));
    l.add(box(.19,.09,.22,white,0,-.6,.02));l.add(box(.18,.04,.04,dark,0,-.3,0));legs.push(l);
  });
  g.userData={head,tail,legs};return shade(g);
}
function buildElephant(){
  const g=new THREE.Group();
  const c=std(0x8b8d92),dk=std(0x6e7076),pale=std(0xb9bcc0),blk=std(0x141414),ivory=std(0xf2ead2);
  const body=sph(1,c,0,1.95,-.1,10);body.scale.set(1.1,.9,1.6);g.add(body);
  g.add(sph(.62,pale,0,1.55,.05,9));
  const head=pivot(g,0,2.12,1.28);
  head.add(sph(.52,c,0,.05,.12,10));
  head.add(sph(.34,c,0,.42,.02,8));
  [-1,1].forEach(s=>{
    const e=new THREE.Mesh(new THREE.SphereGeometry(.6,8,7),dk);
    e.scale.set(.16,.95,.72);e.position.set(s*.5,.14,-.02);e.rotation.y=s*.34;e.rotation.z=s*.1;head.add(e);
    head.add(sph(.05,blk,s*.2,.28,.52,5));
    const t=cone(.075,.8,ivory,s*.19,-.28,.46,5);t.rotation.x=1.5;t.rotation.z=s*.14;head.add(t);
  });
  const trunk=pivot(head,0,-.18,.4);
  const trunkSegs=[];
  let par=trunk;
  for(let i=0;i<6;i++){
    const seg=pivot(par,0,-.18,0);
    const r=.17-i*.02;
    seg.add(cyl(r*.88,r,.36,c,0,-.18,0,7));
    seg.rotation.x=i===0?.35:(i<3?.1:-.12);trunkSegs.push(seg);par=seg;
  }
  const tail=pivot(g,0,2.0,-1.45);tail.add(box(.07,.8,.07,dk,0,-.4,0));tail.add(sph(.09,blk,0,-.84,0,5));
  const legs=[];[[-.42,.7],[.42,.7],[-.42,-.7],[.42,-.7]].forEach(p=>{
    const l=pivot(g,p[0],1.22,p[1]);l.add(box(.4,1.22,.4,dk,0,-.61,0));l.add(box(.46,.16,.5,c,0,-1.14,0));legs.push(l);
  });
  g.userData={head,tail,legs,trunk,trunkSegs};
  g.userData={head,tail,legs,trunk};return shade(g);
}
function buildZebra(){
  const g=new THREE.Group();
  const wh=std(0xf2efe6),blk=std(0x22201c),dk=std(0x2a2118),blk2=std(0x111111);
  g.add(box(.62,.7,1.5,wh,0,1.3,0));
  for(let i=0;i<7;i++)g.add(box(.64,.5,.08,blk,0,1.32,-.62+i*.21));
  g.add(box(.5,.2,1.4,wh,0,1.03,0));
  const neck=box(.28,.9,.32,wh,0,1.85,.75);neck.rotation.x=.42;g.add(neck);
  for(let i=0;i<3;i++){const s=box(.3,.1,.34,blk,0,1.72+i*.17,.62+i*.06);s.rotation.x=.42;g.add(s);}
  const head=pivot(g,0,2.5,1.02);head.rotation.x=.5;
  head.add(box(.3,.3,.62,wh,0,-.05,.24));
  [-1,1].forEach(s=>{
    head.add(cone(.06,.22,wh,s*.1,.2,-.02,4));
    head.add(cone(.028,.11,blk2,s*.1,.34,-.06,4));
    head.add(sph(.035,blk2,s*.14,.02,.2,5));
    head.add(box(.03,.16,.03,blk,s*.11,.14,.26));
  });
  head.add(box(.26,.06,.1,dk,0,-.1,.55));
  g.add(box(.09,.18,.9,blk,0,2.18,.72));
  const tail=pivot(g,0,1.55,-.8);tail.add(box(.09,.9,.12,blk,0,-.45,-.04));
  const legs=[];[[-.24,.58],[.24,.58],[-.24,-.58],[.24,-.58]].forEach(p=>{
    const l=pivot(g,p[0],.9,p[1]);l.add(box(.17,.9,.17,wh,0,-.45,0));
    l.add(box(.18,.07,.19,blk,0,-.4,0));l.add(box(.2,.12,.22,dk,0,-.86,0));legs.push(l);
  });
  g.userData={head,tail,legs};return shade(g);
}
function buildMeerkat(){
  const g=new THREE.Group();
  const c=std(0xc9a26a),dk=std(0x6a4a2a),pale=std(0xe8d8b8),blk=std(0x111111);
  const body=sph(.22,c,0,.42,0,9);body.scale.set(.95,1.5,.95);g.add(body);
  g.add(sph(.16,pale,0,.4,.13,8));
  const head=pivot(g,0,.78,.02);
  head.add(sph(.17,c,0,0,.02,8));
  head.add(box(.2,.08,.16,pale,0,-.05,.12));head.add(box(.06,.03,.03,blk,0,-.01,.19));
  [-1,1].forEach(s=>{
    head.add(box(.06,.08,.02,dk,s*.09,.02,.14));head.add(sph(.015,blk,s*.09,.015,.155,5));
    head.add(sph(.035,c,s*.14,.12,-.01,5));
  });
  const tail=pivot(g,0,.25,-.18);tail.rotation.x=-.9;
  tail.add(box(.05,.05,.5,c,0,0,-.24));tail.add(sph(.06,dk,0,0,-.48,5));
  const legs=[];[[-.1,.08],[.1,.08]].forEach(p=>{
    const l=pivot(g,p[0],.18,0);l.add(box(.07,.18,.08,c,0,-.09,0));legs.push(l);
    const a=pivot(g,p[0],.42,.06);a.add(box(.06,.2,.06,dk,0,-.1,.02));
  });
  g.userData={head,tail,legs};return shade(g);
}
function buildLocust(){
  /* locusts share the blocky grasshopper body, with longer swept-back wings */
  return buildHopper({locust:true});
}

const bees=[],butterflies=[];
function buildBee(){
  const g=new THREE.Group(),y=std(0xf2c230),dk=std(0x1c1c1c),wm=std(0xffffff,{transparent:true,opacity:.6});
  const b=sph(.12,y,0,0,0,8);b.scale.set(.9,.9,1.4);g.add(b);
  [-.05,.07].forEach(z=>g.add(box(.23,.23,.04,dk,0,0,z)));
  g.add(sph(.075,dk,0,.01,.19,6));
  const wings=[];[-1,1].forEach(s=>{const w=box(.2,.015,.12,wm,s*.14,.1,-.02);wings.push(w);g.add(w);});
  const st=cone(.025,.07,dk,0,0,-.2,4);st.rotation.x=-Math.PI/2;g.add(st);
  g.userData={wings};return g;
}
function spawnBee(){
  const g=buildBee(),sp=nearSpot(18,65,4,null,true);
  g.position.set(sp.x,rnd(1,2.8),sp.z);scene.add(g);
  bees.push({g,bee:true,held:false,ambient:true,tx:sp.x,ty:g.position.y,tz:sp.z,sp:rnd(2.5,4),ph:rnd(0,TAU),bt:rnd(0,3),bz:rnd(0,1)});
}
function releaseBee(b){
  const g=b.g;g.scale.setScalar(1);g.rotation.set(0,0,0);
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
  g.position.set(P.x+f.x/fl,1.5,P.z+f.z/fl);scene.add(g);
  b.held=false;b.bt=0;toast('Let go');
}
function updateBee(b,dt,t){
  const g=b.g,u=g.userData,p=g.position;
  u.wings.forEach((w,i)=>{w.rotation.z=(i?1:-1)*Math.sin(t*(b.held?70:90)+b.ph)*.7;});
  if(b.held){g.rotation.y=-1.1+Math.sin(t*4)*.1;return;}
  if(stepKnock(b,dt,t))return;
  b.bt-=dt;
  const dx=b.tx-p.x,dy=b.ty-p.y,dz=b.tz-p.z,d=Math.hypot(dx,dy,dz);
  if(d<.4||b.bt<=0){
    const near=state==='play'&&Math.hypot(P.x-p.x,P.z-p.z)<20&&rand()<.5;
    if(near){b.tx=P.x+rnd(-3,3);b.tz=P.z+rnd(-3,3);b.ty=rnd(1,2.4);}
    else{b.tx=p.x+rnd(-8,8);b.tz=p.z+rnd(-8,8);b.ty=rnd(1,3);}
    const r=Math.hypot(b.tx,b.tz);if(!b.adminRoam&&r>52*S){b.tx*=52*S/r;b.tz*=52*S/r;}
    b.bt=rnd(2,5);b.sp=rnd(2.5,4);
  }else{const k=Math.min(1,b.sp*dt/d);p.x+=dx*k;p.y+=dy*k+Math.sin(t*9+b.ph)*.01;p.z+=dz*k;}
  g.rotation.y+=angDiff(g.rotation.y,Math.atan2(dx,dz))*Math.min(1,dt*5);
}

/* low-poly butterflies: four flapping wings, a tiny body and drifting flight */
function buildButterfly(){
  const g=new THREE.Group();
  const palettes=[
    [0xf28a2a,0x2a1c10,0xffd66a],
    [0x5a9cf0,0x1a2a55,0xcfe6ff],
    [0xf4d24a,0x5a4210,0xfff2b0],
    [0xf06a9a,0x501a30,0xffd0e0],
    [0xf2eee0,0x6a5a44,0xffffff],
  ];
  const pal=palettes[Math.floor(rand()*palettes.length)];
  const body=std(0x2a211a),wing=std(pal[0],{side:THREE.DoubleSide}),edge=std(pal[1]),spot=std(pal[2]),eye=std(0x111111);
  const ab=cyl(.045,.06,.3,body,0,.13,-.08,6);ab.rotation.x=Math.PI/2;g.add(ab);
  g.add(sph(.06,body,0,.15,.1,6));
  [-1,1].forEach(s=>{
    const ant=box(.014,.014,.22,body,s*.035,.24,.16);ant.rotation.x=-.55;ant.rotation.z=s*.18;g.add(ant);
    g.add(sph(.018,eye,s*.05,.16,.15,5));
  });
  const wings=[];
  [-1,1].forEach(s=>{
    const p=pivot(g,s*.035,.17,.02);
    p.add(box(.4,.012,.3,wing,s*.2,0,-.02));
    p.add(box(.4,.016,.05,edge,s*.2,.002,-.17));
    p.add(box(.09,.018,.09,spot,s*.26,.008,-.05));
    p.add(box(.3,.012,.23,wing,s*.15,-.012,.18));
    p.add(box(.3,.016,.04,edge,s*.15,-.01,.29));
    p.add(box(.07,.018,.07,spot,s*.19,-.002,.16));
    wings.push({p,s});
  });
  g.scale.setScalar(1.25);
  g.userData={wings};
  return shade(g);
}
function spawnButterfly(){
  const g=buildButterfly(),sp=nearSpot(7,40,4,null,true);
  g.position.set(sp.x,rnd(.7,2),sp.z);g.rotation.y=rnd(0,TAU);scene.add(g);
  butterflies.push({g,butterfly:true,held:false,ambient:true,tx:sp.x,ty:g.position.y,tz:sp.z,sp:rnd(.8,1.7),ph:rnd(0,TAU),fl:rnd(0,TAU),bt:rnd(0,2)});
}
function updateButterfly(b,dt,t){
  const g=b.g,u=g.userData,p=g.position;
  u.wings.forEach(w=>{w.p.rotation.z=w.s*(.28+Math.sin(t*17+b.fl+b.ph)*.85);});
  if(b.held){g.rotation.y=-1.1+Math.sin(t*4)*.1;return;}
  if(stepKnock(b,dt,t))return;
  b.bt-=dt;
  const dx=b.tx-p.x,dy=b.ty-p.y,dz=b.tz-p.z,d=Math.hypot(dx,dy,dz);
  if(d<.3||b.bt<=0){
    b.tx=p.x+rnd(-8,8);b.tz=p.z+rnd(-8,8);b.ty=rnd(.6,2.6);
    const r=Math.hypot(b.tx,b.tz);if(!b.adminRoam&&r>52*S){b.tx*=52*S/r;b.tz*=52*S/r;}
    b.bt=rnd(2,4.5);b.sp=rnd(.8,1.8);
  }else{
    const k=Math.min(1,b.sp*dt/d);
    p.x+=dx*k;p.z+=dz*k;p.y+=dy*k*.75+Math.sin(t*6+b.ph)*.012;
    g.rotation.y+=angDiff(g.rotation.y,Math.atan2(dx,dz))*Math.min(1,dt*4);
    g.rotation.z=Math.sin(t*9+b.ph)*.07;
  }
}

function releaseHeavy(c){
  const g=c.g;g.scale.setScalar(c.base);g.rotation.set(0,0,0);shade(g,true);
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
  g.position.set(P.x+f.x/fl*2.4,0,P.z+f.z/fl*2.4);g.rotation.y=Math.atan2(f.x,f.z);scene.add(g);
  c.held=false;
  if(c.bull){c.state='rest';c.st=3;c.cd=6;}else{c.state='graze';c.st=rnd(2,5);c.dir=g.rotation.y;}
  toast('Put it down');
}

const props=[];
function buildBale(){
  const g=new THREE.Group(),hay=std(0xe6bf48),band=std(0xb88a2a);
  const c=cyl(.85,.85,1.5,hay,0,.85,0,12);c.rotation.z=Math.PI/2;g.add(c);
  [-.35,.35].forEach(x=>{const s=cyl(.88,.88,.12,band,x,.85,0,12);s.rotation.z=Math.PI/2;g.add(s);});
  return shade(g);
}
function buildRock(){
  const g=new THREE.Group(),m=new THREE.Mesh(new THREE.IcosahedronGeometry(.85,0),std(0x8a8984));
  m.scale.set(1,.75,.9);m.position.y=.6;m.rotation.set(rnd(0,3),rnd(0,3),0);g.add(m);
  return shade(g);
}
function buildBarrel(){
  const g=new THREE.Group(),band=std(0x3a3a3a);
  g.add(cyl(.5,.5,1.1,std(0x8a5a2b),0,.55,0,12));
  [.22,.88].forEach(y=>g.add(cyl(.52,.52,.08,band,0,y,0,12)));
  return shade(g);
}
function spawnProp(kind,near){
  const g=kind==='bale'?buildBale():kind==='rock'?buildRock():buildBarrel();
  const sp=near?freeSpot(12,40,0):freeSpot(15,rand()<.5?130:50*S,0);
  g.position.set(sp.x,0,sp.z);g.rotation.y=rnd(0,TAU);scene.add(g);
  const D={bale:{h:.6,rad:.9,cy:.6,s:.28},rock:{h:.45,rad:.85,cy:.55,s:.3},barrel:{h:.65,rad:.7,cy:.55,s:.35}}[kind];
  const o={g,obj:true,kind,heavy:D.h,rad:D.rad,cy:D.cy,hs:D.s,held:false};
  props.push(o);return registerEntity(o,'prop');
}
function releaseProp(o){
  const g=o.g;g.scale.setScalar(1);g.rotation.set(0,rnd(0,TAU),0);shade(g,true);
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
  g.position.set(P.x+f.x/fl*2,0,P.z+f.z/fl*2);scene.add(g);
  o.held=false;toast('Put it down');
}

function nearBig(){
  if(P.baseY>0.2)return false;
  const f=fwdVec();
  return cows.concat(bulls,pets).some(h=>{
    if(!(h.cow||h.bull||h.kind==='bear'||h.kind==='deer'||h.kind==='sheep'||h.kind==='camel'||h.kind==='snowbear'||h.kind==='lion'||h.kind==='tiger'||h.kind==='elephant'||h.kind==='zebra'))return false;
    const dx=h.g.position.x-P.x,dz=h.g.position.z-P.z,d=Math.hypot(dx,dz);
    return d<5&&(dx*f.x+dz*f.z)/(d||1)>.6;
  });
}
function spawnPet(kind,forceBiome,pos){
  let g;
  if (kind==='cat') g=buildCat();
  else if (kind==='horse') g=buildHorse();
  else if (kind==='bear') g=buildBear();
  else if (kind==='deer') g=buildDeer();
  else if (kind==='bunny') g=buildBunny();
  else if (kind==='wolf') g=buildWolf();
  else if (kind==='sheep') g=buildSheep();
  else if (kind==='chicken') g=buildChicken();
  else if (kind==='camel') g=buildCamel();
  else if (kind==='cobra') g=buildCobra();
  else if (kind==='snake') g=buildSnake();
  else if (kind==='penguin') g=buildPenguin();
  else if (kind==='snowbear') g=buildPolarBear();
  else if (kind==='lion') g=buildLion();
  else if (kind==='tiger') g=buildTiger();
  else if (kind==='elephant') g=buildElephant();
  else if (kind==='zebra') g=buildZebra();
  else if (kind==='meerkat') g=buildMeerkat();
  else if (kind==='locust') g=buildLocust();
  else g=buildDog();
  
  /* each animal belongs to its own island; forceBiome lets a deer or snake
     live out on the savanna too */
  const wantDesert=kind==='camel'||kind==='cobra'||forceBiome==='desert';
  const wantSnow=kind==='penguin'||kind==='snowbear'||forceBiome==='snow';
  const wantSavan=SAV_KINDS.indexOf(kind)>=0||forceBiome==='savanna';
  const B=wantDesert?DESERT:wantSnow?SNOWZ:wantSavan?SAVAN:null;
  const sp=pos||(B?nearBiomeSpot(B,30,Math.min(110,B.r-14),12):nearSpot(30,130,12));
  g.position.set(sp.x,0,sp.z);g.rotation.y=rnd(0,TAU);scene.add(g);
  const pet={
      g,pet:true,ambient:true,kind,biome:wantDesert?'desert':wantSnow?'snow':wantSavan?'savanna':null,
      heavy:({horse:.8,bear:.6,sheep:.6,camel:.9,lion:.7,tiger:.7,elephant:1,zebra:.5})[kind]||0,
      rad:({horse:1.2,bear:1.2,deer:.9,bunny:.45,wolf:.7,sheep:1.3,chicken:.3,camel:1.5,cobra:.55,snake:.45,penguin:.45,snowbear:1.3,lion:1.1,tiger:1.1,elephant:2.6,zebra:1.2,meerkat:.32,locust:.34})[kind]||0,
      cy:({horse:1.3,bear:1,deer:1.3,bunny:.4,wolf:.7,sheep:1.3,chicken:.2,camel:2.3,cobra:.8,snake:.25,penguin:.6,snowbear:1.15,lion:1.0,tiger:1.0,elephant:2.0,zebra:1.4,meerkat:.5,locust:.3})[kind]||0,
      scale:({cat:.4,horse:.13,bear:.12,deer:.16,bunny:.55,sheep:.15,chicken:.8,camel:.09,cobra:.35,snake:.5,penguin:.45,snowbear:.085,lion:.1,tiger:.1,elephant:.08,zebra:.12,meerkat:.5,locust:.84})[kind]||.3,
      baseScale:g.scale.x||1,
      held:false,state:'rest',st:rnd(1,4),dir:g.rotation.y,t:rnd(0,9),eat:0,bmode:null,bcd:rnd(0,3),bt:null,ridden:false,rideSpd:0,strike:0,scd:rnd(0,2)
  };
  pets.push(pet);return registerEntity(pet,'pet');
}
function releasePet(c){
  const g=c.g;g.scale.setScalar(c.baseScale||1);g.rotation.set(0,0,0);shade(g,true);
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
  g.position.set(P.x+f.x/fl*1.2,0,P.z+f.z/fl*1.2);g.rotation.y=Math.atan2(f.x,f.z);scene.add(g);
  c.held=false;c.dir=g.rotation.y;c.state='rest';c.st=1;c.bmode=null;c.bt=null;c.bcd=2;toast('Let go');
}
function updatePet(c,dt,t){
  const g=c.g,u=g.userData,pos=g.position;c.t+=dt;
  if(c.held){
    if(u.legs)u.legs.forEach((l,i)=>{l.rotation.x=Math.sin(t*12+i*1.7)*.5;});
    if(u.hl)u.hl.forEach((h,i)=>{h.t.rotation.x=Math.sin(t*12+i*1.7)*.5;h.sh.rotation.x=Math.sin(t*11+i*1.9)*.5;});
    if(u.wings)u.wings.forEach((w,i)=>{w.rotation.z=(i?-1:1)*Math.sin(t*40+i)*.35;});
    if(u.tail) u.tail.rotation.z=Math.sin(t*9)*.5;
    if(u.segs)u.segs.forEach((s,i)=>{s.rotation.y=Math.sin(t*9-i*.6)*.22;});
    if(u.tongue)u.tongue.visible=Math.sin(t*5)>.4;
    g.rotation.y=-1.1+Math.sin(t*3)*.12;g.rotation.z=0;return;
  }
  if(stepKnock(c,dt,t))return;
  if(c.ridden){
    const sp=Math.min(1,(c.rideSpd||0)/6),w=t*(4+sp*10);
    u.legs.forEach((l,i)=>{l.rotation.x=sp*Math.sin(w+(i===0||i===3?0:Math.PI))*.7;});
    if(u.tail) u.tail.rotation.z=Math.sin(t*6+c.t)*.3;
    u.head.rotation.x=.1+sp*.15;
    pos.y=sp?Math.abs(Math.sin(w))*.09*sp:0;
    return;
  }
  
  if(c.kind==='cobra'){
    c.scd=Math.max(0,(c.scd||0)-dt);
    const dx=P.x-pos.x,dz=P.z-pos.z,d=Math.hypot(dx,dz)||1;
    const near=state==='play'&&d<9&&!P.ride;
    if(c.strike>0){
      c.strike-=dt;
      const k=1-Math.max(0,c.strike)/.5;
      const lunge=Math.sin(clamp((k-.12)/.72,0,1)*Math.PI);
      u.head.rotation.x=-lunge*.5;
      if(u.jaw)u.jaw.rotation.x=lunge*.7;
      u.neck.rotation.x=-.15-lunge*.18;
      if(u.neck2)u.neck2.rotation.x=-lunge*.12;
      u.hood.scale.x=1+lunge*.26;
      u.hood.scale.y=1+lunge*.08;
      u.tongue.visible=true;
      u.segs.forEach((s,i)=>{s.rotation.y=Math.sin(c.t*7-i*.55)*.1;});
      if(c.strike<=0){
        u.head.rotation.x=0;
        if(u.jaw)u.jaw.rotation.x=0;
        u.tongue.visible=false;
      }
      return;
    }
    let moving=0;
    if(near){
      c.dir=Math.atan2(dx,dz);
      g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*6);
      u.neck.rotation.x+=(-.32-u.neck.rotation.x)*Math.min(1,dt*5);
      u.head.rotation.x+=(-.1-u.head.rotation.x)*Math.min(1,dt*5);
      if(d<3.6&&c.scd<=0){
        c.strike=.5;c.scd=2.8;
        if(d<3.5)venom(pos.x,pos.z,'A cobra strikes!',2);
        return;
      }
    }else{
      u.neck.rotation.x+=(0-u.neck.rotation.x)*Math.min(1,dt*3);
      u.head.rotation.x+=(0-u.head.rotation.x)*Math.min(1,dt*3);
      c.st-=dt;
      if(c.st<=0){c.state=c.state==='walk'?'rest':'walk';c.st=c.state==='walk'?rnd(1.5,3):rnd(1.5,3.5);if(c.state==='walk')c.dir=rnd(0,TAU);}
      const sp=c.state==='walk'?1.05:0;
      if(sp){
        pos.x+=Math.sin(c.dir)*sp*dt;pos.z+=Math.cos(c.dir)*sp*dt;moving=1;
      }
      if(pushOut(pos,.4)||(!c.adminRoam&&boundDisc(pos,DESERT,DESERT.r-6))||(!c.adminRoam&&biomeAt(pos.x,pos.z)!=='desert'))c.dir+=Math.PI*rnd(.5,1.4);
      g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*4);
    }
    /* serpentine slither, exactly like the grass snake */
    const w=t*9+c.t*2.2;
    u.segs.forEach((s,i)=>{s.rotation.y=Math.sin(w-i*.62)*(moving?.19:.10);});
    u.spine.rotation.y=Math.sin(w+.45)*(moving?.10:.05);
    u.head.rotation.y=Math.sin(t*2.2+c.t)*(moving?.08:.18);
    u.head.rotation.z=Math.sin(t*1.7+c.t)*.05;
    u.head.position.y=.38+(moving?Math.abs(Math.sin(w))*.02:Math.sin(t*3+c.t)*.01);
    /* the hood spreads as you come near */
    const flare=near?1:0;
    u.hood.scale.x+=(1+flare*.30+Math.sin(t*2.2+c.t)*.02-u.hood.scale.x)*Math.min(1,dt*5);
    u.hood.scale.y+=(1+flare*.09-u.hood.scale.y)*Math.min(1,dt*5);
    u.neck.rotation.z=Math.sin(t*1.8+c.t)*.05;
    u.tongue.visible=Math.sin(t*2.9+c.t*1.9)>.86;
    if(u.tongue.visible)u.tongue.scale.z=.8+Math.abs(Math.sin(t*10))*.5;
    return;
  }
  if(c.kind==='snake'){
    c.scd=Math.max(0,(c.scd||0)-dt);
    const dx=P.x-pos.x,dz=P.z-pos.z,d=Math.hypot(dx,dz)||1;
    const near=state==='play'&&d<8&&!P.ride;
    if(c.strike>0){
      c.strike-=dt;
      const k=1-Math.max(0,c.strike)/.42;
      const lunge=Math.sin(clamp(k,0,1)*Math.PI);
      u.head.position.z=.36+lunge*.55;
      u.head.position.y=.20+lunge*.10;
      u.head.rotation.x=-lunge*.55;
      u.jaw.rotation.x=lunge*.7;
      u.tongue.visible=true;
      u.segs.forEach((s,i)=>{s.rotation.y=Math.sin(c.t*7-i*.55)*.1;});
      if(c.strike<=0){
        u.head.position.z=.36;u.head.position.y=.20;u.head.rotation.x=0;
        u.jaw.rotation.x=0;u.tongue.visible=false;
      }
      return;
    }
    let moving=0;
    if(near&&d>2.2){
      c.dir=Math.atan2(dx,dz);
      g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*5);
      const sp=2.1;
      pos.x+=Math.sin(c.dir)*sp*dt;pos.z+=Math.cos(c.dir)*sp*dt;moving=1;
      if(pushOut(pos,.35)){const sx=Math.cos(c.dir),sz=-Math.sin(c.dir);pos.x+=sx*sp*dt*.7;pos.z+=sz*sp*dt*.7;}
      boundPet(pos,'snake',c);
    }else if(near){
      c.dir=Math.atan2(dx,dz);
      g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*6);
      if(c.scd<=0){c.strike=.42;c.scd=3.6;venom(pos.x,pos.z,'A snake bites you!',1);return;}
    }else{
      c.st-=dt;
      if(c.st<=0){c.state=c.state==='walk'?'rest':'walk';c.st=c.state==='walk'?rnd(1.4,3):rnd(1.5,3.5);if(c.state==='walk')c.dir=rnd(0,TAU);}
      if(c.state==='walk'){
        const sp=1.7;
        pos.x+=Math.sin(c.dir)*sp*dt;pos.z+=Math.cos(c.dir)*sp*dt;moving=1;
        if(pushOut(pos,.35)||boundPet(pos,'snake',c))c.dir+=Math.PI*rnd(.5,1.4);
        g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*4);
      }
    }
    if(boundPet(pos,'snake',c))c.dir+=Math.PI*rnd(.5,1.4);
    /* serpentine wave: every segment lags the one in front of it */
    const w=t*9+c.t*2.2;
    u.segs.forEach((s,i)=>{s.rotation.y=Math.sin(w-i*.62)*(moving?.19:.10);});
    u.spine.rotation.y=Math.sin(w+.45)*(moving?.10:.05);
    u.head.rotation.y=Math.sin(t*2.2+c.t)*(moving?.08:.18);
    u.head.rotation.z=Math.sin(t*1.7+c.t)*.05;
    u.head.position.y=.20+(moving?Math.abs(Math.sin(w))*.02:Math.sin(t*3+c.t)*.01);
    u.tongue.visible=Math.sin(t*2.9+c.t*1.9)>.86;
    if(u.tongue.visible)u.tongue.scale.z=.8+Math.abs(Math.sin(t*10))*.5;
    return;
  }
  if(c.kind==='penguin'){
    c.st-=dt;
    if(c.st<=0){c.state=c.state==='rest'?'walk':'rest';c.st=c.state==='walk'?rnd(1.5,3.5):rnd(1.5,3);if(c.state==='walk')c.dir=rnd(0,TAU);}
    const sp=c.state==='walk'?1.2:0;
    pos.x+=Math.sin(c.dir)*sp*dt;pos.z+=Math.cos(c.dir)*sp*dt;
    if(pushOut(pos,.4)||boundPet(pos,'penguin',c)||(!c.adminRoam&&biomeAt(pos.x,pos.z)!=='snow'))c.dir+=Math.PI*rnd(.5,1.5);
    g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*5);
    const wob=sp?Math.sin(t*10+c.t):0;
    g.rotation.z=wob*.09;
    u.flips.forEach((f,i)=>{f.rotation.z=(i?1:-1)*(.16+Math.abs(wob)*.3);});
    u.head.rotation.y=c.state==='rest'?Math.sin(t*.9+c.t)*.35:0;
    pos.y=sp?Math.abs(Math.sin(t*10+c.t))*.02:0;
    return;
  }

  if(c.kind==='chicken') {
     if(c.eat>0){
         c.eat-=dt;
         u.head.rotation.x = .4 + Math.sin(t*15)*.3;
         if(c.eat<=0) u.head.rotation.x=0;
         return;
     }
     c.st-=dt;
     if(c.st<=0) {
         c.state = rand() < 0.3 ? 'peck' : (rand() < 0.5 ? 'walk' : 'rest');
         c.st = rnd(1,3);
         if(c.state==='walk') c.dir = rnd(0, TAU);
     }
     let sp=0;
     if(c.state==='walk') {
         sp = 1.2;
         pos.x+=Math.sin(c.dir)*sp*dt;pos.z+=Math.cos(c.dir)*sp*dt;
         if(pushOut(pos,.3)||(!c.adminRoam&&bound(pos,52*S))) c.dir+=Math.PI;
         g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*6);
         u.legs.forEach((l,i)=>l.rotation.x=Math.sin(t*12+(i===0?0:Math.PI))*.5);
         u.head.rotation.x = Math.sin(t*10)*.1;
     } else {
         u.legs.forEach(l=>l.rotation.x=0);
         u.head.rotation.x = c.state==='peck' ? .5 + Math.sin(t*8)*.3 : 0;
     }
     return;
  }

  if(c.eat>0){
    c.eat-=dt;
    u.legs.forEach(l=>{l.rotation.x=0;});
    if(u.tail) u.tail.rotation.z=Math.sin(t*16+c.t)*.6;
    u.head.rotation.x=.35+Math.sin(t*12)*.15;
    pos.y=Math.abs(Math.sin(t*9))*.04;
    g.rotation.y+=angDiff(g.rotation.y,Math.atan2(P.x-pos.x,P.z-pos.z))*Math.min(1,dt*8);
    if(c.eat<=0)pos.y=0;
    return;
  }
  
  if(c.kind==='wolf'){
    if(state!=='play'||(dayT<.5&&!c.adminRoam)){g.visible=false;c.bmode=null;return;}
    if(!g.visible){
      g.visible=true;
      const wa=rnd(0,TAU),wd=rnd(45,80);
      pos.x=P.x+Math.cos(wa)*wd;pos.z=P.z+Math.sin(wa)*wd;bound(pos,52*S);
      c.dir=rnd(0,TAU);g.rotation.y=c.dir;
    }
    c.bcd=Math.max(0,(c.bcd||0)-dt);
    const pdx=P.x-pos.x,pdz=P.z-pos.z,pd=Math.hypot(pdx,pdz)||1;
    if(!c.bmode&&c.bcd<=0&&pd<30){c.bmode='chase';toast('A wolf snarls out of the dark!');}
    if(c.bmode==='chase'){
      if(pd>38){c.bmode=null;c.bcd=2;}
      else{
        c.dir=Math.atan2(pdx,pdz);
        g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*9);
        const wsp=6.8;
        pos.x+=Math.sin(c.dir)*wsp*dt;pos.z+=Math.cos(c.dir)*wsp*dt;
        if(pushOut(pos,.7)){const sx=Math.cos(c.dir),sz=-Math.sin(c.dir);pos.x+=sx*wsp*dt*.8;pos.z+=sz*wsp*dt*.8;}
        if(!c.adminRoam)bound(pos,52*S);
        if(pd<2.7){c.bmode='wind';c.st=.35;}
        const w=t*15;
        u.legs.forEach((l,i)=>{l.rotation.x=Math.sin(w+(i===0||i===3?0:Math.PI))*.6;});
        u.tail.rotation.z=Math.sin(t*8+c.t)*.4;
        u.head.rotation.x=.15;
        return;
      }
    }
    if(c.bmode==='wind'){
      c.st-=dt;
      pos.x+=Math.sin(c.dir)*6*dt;pos.z+=Math.cos(c.dir)*6*dt;
      pushOut(pos,.7);if(!c.adminRoam)bound(pos,52*S);
      u.legs.forEach((l,i)=>{if(i<2)l.rotation.x=-1.0+Math.sin(t*26)*.15;});
      u.head.rotation.x=-.3;
      if(c.st<=0){
        const bx=P.x-pos.x,bz=P.z-pos.z,bd=Math.hypot(bx,bz)||1;
        if(bd<3.4)bite(pos.x,pos.z);
        c.bmode='cool';c.st=.7;c.bcd=2.4;
      }
      return;
    }
    if(c.bmode==='cool'){
      c.st-=dt;u.legs.forEach(l=>{l.rotation.x=0;});
      u.head.rotation.x+=(0-u.head.rotation.x)*Math.min(1,dt*4);
      if(c.st<=0)c.bmode=null;
      return;
    }
    c.st-=dt;
    if(c.st<=0){c.state=c.state==='rest'?'walk':'rest';c.st=c.state==='walk'?rnd(2,5):rnd(2,6);if(c.state==='walk')c.dir=rnd(0,TAU);}
    const wsp2=c.state==='walk'?2.4:0;
    pos.x+=Math.sin(c.dir)*wsp2*dt;pos.z+=Math.cos(c.dir)*wsp2*dt;pos.y=0;
    if(pushOut(pos,.6)||(!c.adminRoam&&bound(pos,52*S)))c.dir+=Math.PI*rnd(.6,1.4);
    g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*6);
    const w2=t*(wsp2>3?14:8);
    u.legs.forEach((l,i)=>{l.rotation.x=wsp2?Math.sin(w2+(i===0||i===3?0:Math.PI))*.5:0;});
    u.tail.rotation.z=Math.sin(t*(wsp2>0?8:4)+c.t)*.35;
    u.head.rotation.x+=(0-u.head.rotation.x)*Math.min(1,dt*4);
    return;
  }

  if((c.kind==='lion'||c.kind==='tiger')&&state==='play'){
    c.bcd=Math.max(0,(c.bcd||0)-dt);
    const pdx=P.x-pos.x,pdz=P.z-pos.z,pd=Math.hypot(pdx,pdz)||1;
    if(P.ride&&c.bmode){c.bmode=null;c.bcd=2;}
    if(!c.bmode&&c.bcd<=0&&pd<15&&!P.ride){
      c.bmode='chase';
      toast(c.kind==='lion'?'A lion stalks you — run!':'A tiger charges!');
    }
    if(c.bmode==='chase'){
      if(pd>24||P.ride){c.bmode=null;c.bcd=3;}
      else{
        c.dir=Math.atan2(pdx,pdz);
        g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*8);
        const bsp=c.kind==='tiger'?7.2:6.4;
        pos.x+=Math.sin(c.dir)*bsp*dt;pos.z+=Math.cos(c.dir)*bsp*dt;
        if(pushOut(pos,1.0)){const sx=Math.cos(c.dir),sz=-Math.sin(c.dir);pos.x+=sx*bsp*dt*.8;pos.z+=sz*bsp*dt*.8;}
        boundPet(pos,c.kind,c);
        if(pd<3.3){
          const dmg=c.kind==='tiger'?5:4;
          hurt(dmg,c.kind);
          toast(c.kind==='lion'?'The lion swipes you!':'The tiger bites you!');
          c.bmode=null;c.bcd=5;
        }
        const w=t*16;
        u.legs.forEach((l,i)=>{l.rotation.x=Math.sin(w+(i===0||i===3?0:Math.PI))*.62;});
        if(u.tail)u.tail.rotation.z=Math.sin(t*9+c.t)*.4;
        u.head.rotation.x=.12;
        return;
      }
    }
    c.st-=dt;
    if(c.st<=0){c.state=c.state==='rest'?'walk':'rest';c.st=c.state==='walk'?rnd(3,6):rnd(2,5);if(c.state==='walk')c.dir=rnd(0,TAU);}
    const wsp=c.state==='walk'?1.7:0;
    pos.x+=Math.sin(c.dir)*wsp*dt;pos.z+=Math.cos(c.dir)*wsp*dt;
    if(pushOut(pos,1.0)||boundPet(pos,c.kind,c))c.dir+=Math.PI*rnd(.5,1.4);
    g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*5);
    const w2=t*(wsp?9:4);
    u.legs.forEach((l,i)=>{l.rotation.x=wsp?Math.sin(w2+(i===0||i===3?0:Math.PI))*.45:0;});
    if(u.tail)u.tail.rotation.z=Math.sin(t*6+c.t)*.3;
    u.head.rotation.x+=(0-u.head.rotation.x)*Math.min(1,dt*4);
    return;
  }

  if(c.kind==='locust'){
    /* locusts do not walk: they hop, and now and then take off, buzz for two
       seconds, then drop back to the grass */
    if(c.lstate==null){c.lstate='wait';c.lt=rnd(.4,1.4);c.lvx=0;c.lvz=0;c.lvy=0;c.flyT=0;c.hk=0;c.hd=.5;c.hh=.8;c.hx0=pos.x;c.hz0=pos.z;c.hx1=pos.x;c.hz1=pos.z;c.dir=rnd(0,TAU);}
    const hop=()=>{
      c.lstate='hop';c.hk=0;c.hd=rnd(.45,.75);c.hh=rnd(.55,1.2);
      c.hx0=pos.x;c.hz0=pos.z;
      const a=rnd(0,TAU),d=rnd(1.2,3.4);
      c.hx1=pos.x+Math.sin(a)*d;c.hz1=pos.z+Math.cos(a)*d;
      if(!c.adminRoam){
        const dd=Math.hypot(c.hx1-SAVAN.x,c.hz1-SAVAN.z);
        if(dd>SAVAN.r-10){const k=(SAVAN.r-10)/dd;c.hx1=SAVAN.x+(c.hx1-SAVAN.x)*k;c.hz1=SAVAN.z+(c.hz1-SAVAN.z)*k;}
      }
      c.dir=Math.atan2(c.hx1-c.hx0,c.hz1-c.hz0);
    };
    if(c.lstate==='wait'){
      c.lt-=dt;pos.y=0;
      u.hl.forEach(h=>{h.t.rotation.x=0;h.sh.rotation.x=0;});
      u.wings.forEach((wp,i)=>{wp.rotation.set(-.02,(i?1:-1)*.04,0);});
      if(c.lt<=0)hop();
    }else if(c.lstate==='hop'){
      c.hk+=dt/c.hd;
      const k=Math.min(1,c.hk);
      pos.x=c.hx0+(c.hx1-c.hx0)*k;
      pos.z=c.hz0+(c.hz1-c.hz0)*k;
      pos.y=Math.sin(Math.PI*k)*c.hh;
      u.hl.forEach(h=>{h.t.rotation.x=-1.0;h.sh.rotation.x=1.4;});
      u.wings.forEach((wp,i)=>{wp.rotation.set(0,(i?1:-1)*.04,(i?-1:1)*.18);});
      if(c.hk>=1){
        pos.y=0;
        if(rand()<.35){
          c.lstate='fly';c.flyT=2.0;
          const a=rnd(0,TAU);
          c.lvx=Math.sin(a)*rnd(2.6,4.4);c.lvz=Math.cos(a)*rnd(2.6,4.4);
          c.lvy=0;
        }else{c.lstate='wait';c.lt=rnd(.35,1.2);}
      }
    }else if(c.lstate==='fly'){
      c.flyT-=dt;
      pos.x+=c.lvx*dt;pos.z+=c.lvz*dt;
      pos.y+=(2.0+Math.sin(t*6+c.t)*.25-pos.y)*Math.min(1,dt*4);
      if(!c.adminRoam&&boundPet(pos,'locust',c)){c.lvx*=-.7;c.lvz*=-.7;}
      c.dir=Math.atan2(c.lvx,c.lvz);
      u.wings.forEach((wp,i)=>{
        const beat=Math.abs(Math.sin(t*46))*.9;
        wp.rotation.set((i?-1:1)*.12,(i?1:-1)*.16,(i?-1:1)*(.32+beat));
      });
      u.hl.forEach(h=>{h.t.rotation.x=.15;h.sh.rotation.x=.4;});
      if(c.flyT<=0){c.lstate='fall';c.lvy=0;}
    }else{
      c.lvy-=16*dt;pos.y+=c.lvy*dt;
      u.wings.forEach((wp,i)=>{wp.rotation.set(0,(i?1:-1)*.08,(i?-1:1)*.5);});
      if(pos.y<=0){
        pos.y=0;c.lstate='wait';c.lt=rnd(.5,1.6);
        burst(pos.x,.15,pos.z,0xcdbb8a,3);
      }
    }
    g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*7);
    g.rotation.x=c.lstate==='fly'?.22:c.lstate==='hop'?-.1:0;
    if(u.head)u.head.rotation.x=c.lstate==='fly'?-.15:0;
    return;
  }
  
  if((c.kind==='bear'||c.kind==='snowbear')&&state==='play'){
    const polar=c.kind==='snowbear';
    const homeD=Math.hypot(pos.x-SNOWZ.x,pos.z-SNOWZ.z);
    if(!polar&&dayT<.5){
      c.bmode=null;c.bt=null;pos.y=0;
      u.legs.forEach(l=>{l.rotation.x=1.3;});
      u.head.rotation.x=.75;u.tail.rotation.z=.5;
      return;
    }
    c.bcd=Math.max(0,(c.bcd||0)-dt);
    const pdx=P.x-pos.x,pdz=P.z-pos.z,pd=Math.hypot(pdx,pdz)||1;
    if(!c.bmode&&c.bcd<=0){
      if(pd<(polar?17:14)&&pd>2.0&&(!polar||homeD<SNOWZ.r+16)){c.bmode='chase';c.bt=null;toast(polar?'A polar bear lumbers after you!':'A bear growls... run!');}
      else if(!polar){const who=nearestPerson(pos,12);if(who){c.bmode='chase';c.bt=who;}}
    }
    if(c.bmode){
      let tx,tz;
      if(c.bt){
        tx=c.bt.g.position.x;tz=c.bt.g.position.z;
        if(c.bt.knock>0){c.bmode=null;c.bt=null;c.bcd=1.5;}
      }else{
        tx=P.x;tz=P.z;
        if(pd>(polar?30:23)||(polar&&homeD>SNOWZ.r+26)){c.bmode=null;c.bcd=2;}
      }
      if(c.bmode){
        const bx=tx-pos.x,bz=tz-pos.z,bd2=Math.hypot(bx,bz)||1;
        c.dir=Math.atan2(bx,bz);
        g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*9);
        if(c.bmode==='chase'){
          const bsp=7.0;
          pos.x+=Math.sin(c.dir)*bsp*dt;pos.z+=Math.cos(c.dir)*bsp*dt;
          if(pushOut(pos,1.0)){const sx=Math.cos(c.dir),sz=-Math.sin(c.dir);pos.x+=sx*bsp*dt*.8;pos.z+=sz*bsp*dt*.8;}
          boundPet(pos,polar?'snowbear':'bear',c);
          if(bd2<3.1){c.bmode='wind';c.st=.45;}
        }else if(c.bmode==='wind'){
          c.st-=dt;
          pos.x+=Math.sin(c.dir)*5.5*dt;pos.z+=Math.cos(c.dir)*5.5*dt;
          pushOut(pos,1.0);boundPet(pos,polar?'snowbear':'bear',c);
          if(c.st<=0){
            const ax=tx-pos.x,az=tz-pos.z,ad=Math.hypot(ax,az)||1;
            if(c.bt){if(ad<3.7)hitPerson(c.bt,{cx:ax/ad,cz:az/ad},6,false);}
            else if(ad<4.4)maul(pos.x,pos.z);
            c.bmode='cool';c.st=.8;c.bcd=6;c.bt=null;
          }
        }else{
          c.st-=dt;if(c.st<=0){c.bmode=null;c.bcd=5;}
        }
        const w=t*(c.bmode==='chase'?14:6);
        u.legs.forEach((l,i)=>{
          l.rotation.x=(c.bmode==='wind'&&i<2)?-1.0+Math.sin(t*28)*.14:Math.sin(w+(i===0||i===3?0:Math.PI))*.55;
        });
        u.head.rotation.x=c.bmode==='wind'?-.55:.15;
        u.tail.rotation.z=Math.sin(t*6+c.t)*.35;
        return;
      }
    }
    if(polar&&!c.adminRoam&&homeD>SNOWZ.r-8)c.dir=Math.atan2(SNOWZ.x-pos.x,SNOWZ.z-pos.z);
    u.head.rotation.x+=(0-u.head.rotation.x)*Math.min(1,dt*4);
  }
  
  c.st-=dt;
  const dx=P.x-pos.x,dz=P.z-pos.z,d=Math.hypot(dx,dz)||1;
  const chase=c.kind==='dog'&&state==='play'&&d<16;
  if(c.tired>0)c.tired-=dt;
  const flee=(c.kind==='deer'||c.kind==='sheep'||c.kind==='zebra'||c.kind==='meerkat')&&state==='play'&&d<14&&!(c.tired>0);
  if(flee){c.ft=(c.ft||0)+dt;if(c.ft>3.5){c.tired=3;c.ft=0;}}
  let sp=0;
  if(flee){c.dir=Math.atan2(-dx,-dz)+Math.sin(c.t*1.5)*.5;sp=c.kind==='sheep'?4:c.kind==='meerkat'?4.5:c.kind==='zebra'?6.5:7;}
  else if(chase){c.dir=Math.atan2(dx,dz);if(d>3)sp=3.8;}
  else{
    if(c.st<=0){c.state=c.state==='rest'?'walk':'rest';c.st=c.state==='walk'?rnd(2,5):rnd(2,6);if(c.state==='walk')c.dir=rnd(0,TAU);}
    if(c.state==='walk')sp=({dog:2.2,horse:2.8,bear:1.6,deer:2.2,sheep:1.5,camel:2.2,snowbear:1.7,zebra:2.8,meerkat:1.8,elephant:1.1})[c.kind]||1.4;
  }
  if(c.tired>0)sp=0;
  pos.x+=Math.sin(c.dir)*sp*dt;pos.z+=Math.cos(c.dir)*sp*dt;pos.y=0;
  const hit=pushOut(pos,({horse:.9,bear:.9,deer:.6,sheep:.6,camel:1.2,snowbear:1.0,zebra:.8,elephant:1.6,meerkat:.25})[c.kind]||.5);if(boundPet(pos,c.kind,c)||hit){if(!chase)c.dir+=Math.PI*rnd(.6,1.4);}
  g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*6);
  if(c.kind==='camel'&&!c.adminRoam&&biomeAt(pos.x,pos.z)!=='desert'){
    const hx=DESERT.x-pos.x,hz=DESERT.z-pos.z,hd=Math.hypot(hx,hz)||1;
    pos.x+=hx/hd*1.8*dt;pos.z+=hz/hd*1.8*dt;
    g.rotation.y+=angDiff(g.rotation.y,Math.atan2(hx,hz))*Math.min(1,dt*4);
  }
  const w=t*(sp>3?14:8);
  u.legs.forEach((l,i)=>{l.rotation.x=sp?Math.sin(w+(i===0||i===3?0:Math.PI))*.5:0;});
  if(u.tail) u.tail.rotation.z=Math.sin(t*(sp?8:4)+c.t)*.35;
}

/* ---------- villages, farms, people ---------- */
const persons=[],HOMES=[],FARMS=[],TOWERS=[];
const LINES={
  villager:['Welcome to our city!','Lovely day, isn\'t it?','Have you seen my cat?','The fish bite at the lake.','Mind the bulls out there!','Grasshoppers everywhere...'],
  farmer:['Fine weather for farming!','My cows wander off again.','Mind the bulls, friend.','The harvest looks good.'],
  traveler:['Which way to the plaza?','Those mountains are tall!','Just passing through.'],
  hunter:['These woods are full of game.','That bear is too big for my rifle.','I only shoot what I can eat.','Mind the bulls — they gore anyone.']
};
function nearFarm(x,z,r){
  for(let i=0;i<FARMS.length;i++){const f=FARMS[i];if(Math.hypot(x-f.px,z-f.pz)<r)return true;}
  return false;
}
function nearVillage(x,z,r){
  for(let i=0;i<HOMES.length;i++){const h=HOMES[i];if(Math.hypot(x-h.x,z-h.z)<r)return true;}
  return false;
}
function wpos(x,z,yaw,lx,lz){return {x:x+lx*Math.cos(yaw)+lz*Math.sin(yaw),z:z-lx*Math.sin(yaw)+lz*Math.cos(yaw)};}
const turbines=[];
function windTurbine(x,z,sc,yaw,faceX,faceZ,gy){
  sc=(sc||1) * 3.2;
  const g=new THREE.Group();g.position.set(x,gy||0,z);g.scale.setScalar(sc);
  const wh=std(0xfafcff,{emissive:0x4a5056,emissiveIntensity:.22,side:THREE.DoubleSide}),
        gr=std(0xa0a5a8),dk=std(0x3a4046),
        lampM=std(0xffe6a0,{emissive:0xffd27a,emissiveIntensity:1});
  /* the tower is hollow: a doorway is cut into the base and the walls are a
     ring of collision boxes, so you can walk in and stand under the nacelle */
  const H=22,baseR=1.4,topR=.6,doorH=1.1,doorA=TAU/12;
  const doorYaw=Math.atan2((faceX==null?0:faceX)-x,(faceZ==null?0:faceZ)-z);
  const rDoor=baseR+(topR-baseR)*doorH/H;
  const lower=new THREE.Mesh(new THREE.CylinderGeometry(rDoor,baseR,doorH,12,1,true,doorYaw+doorA/2,TAU-doorA),wh);
  lower.position.y=doorH/2;g.add(lower);
  const upper=new THREE.Mesh(new THREE.CylinderGeometry(topR,rDoor,H-doorH,12,1,true),wh);
  upper.position.y=(H+doorH)/2;g.add(upper);
  const cap=new THREE.Mesh(new THREE.CircleGeometry(topR*.98,12),std(0x8f979d));
  cap.rotation.x=Math.PI/2;cap.position.y=H-.02;g.add(cap);
  /* concrete apron and interior floor */
  const apron=new THREE.Mesh(new THREE.RingGeometry(baseR*1.01,baseR*1.22,12),gr);
  apron.rotation.x=-Math.PI/2;apron.position.y=.035;g.add(apron);
  const flr=new THREE.Mesh(new THREE.CircleGeometry(baseR*1.04,12),std(0x8d969c,{emissive:0x2a2e32,emissiveIntensity:.55}));
  flr.rotation.x=-Math.PI/2;flr.position.y=.02;g.add(flr);
  /* door frame: two posts and a header around the opening */
  [-1,1].forEach(s=>{
    const a=doorYaw+s*doorA/2;
    const post=box(.09,doorH,.22,dk,Math.sin(a)*baseR,doorH/2,Math.cos(a)*baseR);
    post.rotation.y=a;g.add(post);
  });
  const header=box(2*baseR*Math.sin(doorA/2)+.06,.13,.22,dk,
    Math.sin(doorYaw)*baseR*Math.cos(doorA/2),doorH+.06,Math.cos(doorYaw)*baseR*Math.cos(doorA/2));
  header.rotation.y=doorYaw;g.add(header);
  /* a little lit maintenance room: lamp, ladder, control cabinet */
  const aB=doorYaw+Math.PI;
  g.add(box(.05,.3,.05,dk,Math.sin(aB)*1.18,.9,Math.cos(aB)*1.18));
  g.add(sph(.09,lampM,Math.sin(aB)*1.16,.74,Math.cos(aB)*1.16,8));
  const aL=doorYaw+Math.PI*.72;
  [-1,1].forEach(s=>{
    const rail=box(.035,2.2,.035,gr,Math.sin(aL)*1.22+s*Math.cos(aL)*.13,1.15,Math.cos(aL)*1.22-s*Math.sin(aL)*.13);
    rail.rotation.y=aL;g.add(rail);
  });
  for(let h=.22;h<2.15;h+=.22){
    const rung=box(.3,.03,.03,gr,Math.sin(aL)*1.22,h,Math.cos(aL)*1.22);
    rung.rotation.y=aL;g.add(rung);
  }
  const aC=doorYaw+Math.PI*1.2;
  const cab=pivot(g,Math.sin(aC)*1.1,.26,Math.cos(aC)*1.1);cab.rotation.y=aC;
  cab.add(box(.55,.45,.32,gr,0,0,0));
  cab.add(box(.3,.14,.03,lampM,0,.05,.18));
  const yawg=new THREE.Group();yawg.position.y=22;yawg.rotation.y=yaw||0;g.add(yawg);
  yawg.add(box(1.5,1.5,4.2,wh,0,0,-.6));
  const rotor=new THREE.Group();rotor.position.set(0,0,1.6);yawg.add(rotor);
  const hub=sph(.7,wh,0,0,0,8);
  hub.scale.set(1,1,1.3);
  rotor.add(hub);
  for(let i=0;i<3;i++){
    const b=new THREE.Group();b.rotation.z=i/3*TAU;
    const blade=cyl(.1,.6,11,wh,0,5.8,0,8);
    blade.scale.set(1,1,.15);
    blade.rotation.y=0.2;
    b.add(blade);
    rotor.add(b);
  }
  shade(g);scene.add(g);
  /* wall ring, minus the door segment */
  const rr=baseR*sc,N=12,seg=TAU/N;
  for(let i=0;i<N;i++){
    const a=doorYaw+i*seg;
    const da=Math.atan2(Math.sin(a-doorYaw),Math.cos(a-doorYaw));
    if(Math.abs(da)<seg*.5)continue;
    solids.push({x:x+Math.sin(a)*rr,z:z+Math.cos(a)*rr,w:2*rr*Math.sin(seg/2)*1.03,d:.26*sc,yaw:a});
  }
  solids.push({x:x+Math.sin(aC)*1.06*sc,z:z+Math.cos(aC)*1.06*sc,w:.72*sc,d:.42*sc,yaw:aC});
  turbines.push({rotor,sp:rnd(.25,.45),x,z,r:baseR*sc,doorYaw});
  return g;
}

function buildBuildings() {
  const walls=[0xe8d9b5,0xd9a38a,0xb8d0d8,0xe6c88a,0xc9d8a8],roofs=[0x8a3a2c,0x5b4636,0x3f5f7a,0x9a5a2c];
  const trim=std(0xf6ecd2),doorM=std(0x3a2418),glass=std(0x9fd0e8),brick=std(0x9a4a3a),wood=std(0x8a5a2b),stone=std(0x9a9a98),dirt=std(0xc9b58a);
  const pick=a=>a[Math.floor(rand()*a.length)];
  let cityTheme=null;
  function house(x,z,yaw,sc){
    sc=sc||1;
    const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=yaw;g.scale.setScalar(sc);
    const wall=std(pick(cityTheme?cityTheme.walls:walls)),roof=std(pick(cityTheme?cityTheme.roofs:roofs)),flr=std(0xc9a06a);
    g.add(box(7,.1,6,flr,0,.05,0));
    g.add(box(2.6,4,.2,wall,-2.2,2,3));
    g.add(box(2.6,4,.2,wall,2.2,2,3));
    g.add(box(1.8,1.4,.2,wall,0,3.3,3));
    g.add(box(7,4,.2,wall,0,2,-3));
    g.add(box(.2,4,6,wall,-3.5,2,0));
    g.add(box(.2,4,6,wall,3.5,2,0));
    g.add(box(3.4,.05,2.4,std(0xa8483c),0,.13,-.6));
    const gs=new THREE.Shape();gs.moveTo(-3.5,0);gs.lineTo(3.5,0);gs.lineTo(0,2.6);gs.lineTo(-3.5,0);
    const gable=new THREE.Mesh(new THREE.ExtrudeGeometry(gs,{depth:6,bevelEnabled:false}),wall);gable.position.set(0,4,-3);g.add(gable);
    const ang=Math.atan2(2.6,3.5);
    const rl=box(5.0,.3,6.8,roof,-1.8,5.42,0);rl.rotation.z=ang;g.add(rl);
    const rr=box(5.0,.3,6.8,roof,1.8,5.42,0);rr.rotation.z=-ang;g.add(rr);
    const dg=new THREE.Group();dg.position.set(-.9,0,2.95);dg.rotation.y=1.45;
    dg.add(box(1.7,2.5,.1,doorM,.85,1.25,0));g.add(dg);
    g.add(box(2.1,.16,.24,trim,0,2.72,3.06));
    [-2.2,2.2].forEach(x2=>{g.add(box(1.4,1.3,.1,trim,x2,2.4,3.03));g.add(box(1.1,1.0,.14,glass,x2,2.4,3.05));});
    g.add(box(.6,1.6,.6,brick,2,5.9,-1));
    scene.add(g);
    [[-2.4,-3,1.5],[0,-3,1.5],[2.4,-3,1.5],[-2.6,3,1.3],[2.6,3,1.3],[-3.5,-1.5,1.35],[-3.5,1.5,1.35],[3.5,-1.5,1.35],[3.5,1.5,1.35]].forEach(p=>{
      const w=wpos(x,z,yaw,p[0]*sc,p[1]*sc);solids.push({x:w.x,z:w.z,r:p[2]*sc});
    });
    return g;
  }
  function ringGeo(w,d,t,h){
    const s=new THREE.Shape();
    s.moveTo(-w/2,-d/2);s.lineTo(w/2,-d/2);s.lineTo(w/2,d/2);s.lineTo(-w/2,d/2);s.lineTo(-w/2,-d/2);
    const hole=new THREE.Path();
    hole.moveTo(-w/2+t,-d/2+t);hole.lineTo(-w/2+t,d/2-t);hole.lineTo(w/2-t,d/2-t);hole.lineTo(w/2-t,-d/2+t);hole.lineTo(-w/2+t,-d/2+t);
    s.holes.push(hole);
    const g=new THREE.ExtrudeGeometry(s,{depth:h,bevelEnabled:false});
    g.rotateX(-Math.PI/2);
    return g;
  }
  function skyscraper(cx,cz,yaw,h){
    const bodyCol=pick([0xb9c6cf,0xd8d2c4,0xa9bac6,0xe0d1b6]);
    const body=std(bodyCol);
    const glass=std(pick([0x6fa8c8,0x86c2d8,0x7fb0cc]),{emissive:0x24495a,emissiveIntensity:.4,transparent:true,opacity:.55,side:THREE.DoubleSide});
    const glass2=std(0x9ad4e4,{emissive:0x2c4a54,emissiveIntensity:.35});
    const trim=std(0xeef4f6),dark=std(0x4b5a66),concrete=std(0xa8a8a4),floorM=std(0xcfc8ba);
    const metal=std(0xb8c0c6,{metalness:.4,roughness:.35});
    const lampM=std(0xfff2cc,{emissive:0xffe6a8,emissiveIntensity:.9});
    const g=new THREE.Group();g.position.set(cx,0,cz);g.rotation.y=yaw;
    const bw=rnd(6.2,7.4),bd=rnd(6.0,7.0),lh=3.5,fh=2.9,wallT=.3;
    const floors=clamp(Math.round(h/2.9),7,13);
    const roofY=lh+(floors-1)*fh;
    const backZ=-bd/2+1.35;
    const floorY=i=>i?lh+(i-1)*fh:0;
    /* street plaza + lobby floor */
    g.add(box(bw+1.8,.08,bd+1.8,concrete,0,.04,0));
    g.add(box(bw-.2,.1,bd-.2,floorM,0,.05,0));
    const wallH=lh,wy=wallH/2,gap=2.8,segW=(bw-gap)/2,zF=bd/2-wallT/2;
    g.add(box(bw,wallH,wallT,body,0,wy,-bd/2+wallT/2));
    g.add(box(wallT,wallH,bd,body,-bw/2+wallT/2,wy,0));
    g.add(box(wallT,wallH,bd,body,bw/2-wallT/2,wy,0));
    [-1,1].forEach(s=>{
      const sx=s*(gap/2+segW/2);
      g.add(box(segW,wallH,wallT,body,sx,wy,zF));
      g.add(box(segW-1.0,1.1,.06,glass,sx,1.55,zF+.17));
      g.add(box(.5,2.6,.5,dark,s*(gap/2+.12),1.3,zF+.1));
    });
    g.add(box(gap,.9,wallT,dark,0,lh-.45,zF));
    g.add(box(gap+.7,.18,.7,concrete,0,lh+.09,zF+.05));
    /* hollow window bands: 2 solid spandrels + 1 glass band per floor */
    const bandGeo=ringGeo(bw,bd,.22,1);
    const solidIM=new THREE.InstancedMesh(bandGeo,body,(floors-1)*2);
    const glassIM=new THREE.InstancedMesh(bandGeo,glass,floors-1);
    const m4=new THREE.Matrix4();
    let si=0,gi=0;
    for(let i=1;i<floors;i++){
      const y=floorY(i);
      m4.makeScale(1,1.02,1);m4.setPosition(0,y,0);solidIM.setMatrixAt(si++,m4);
      m4.makeScale(1,1.16,1);m4.setPosition(0,y+1.02,0);glassIM.setMatrixAt(gi++,m4);
      m4.makeScale(1,.72,1);m4.setPosition(0,y+2.18,0);solidIM.setMatrixAt(si++,m4);
    }
    solidIM.instanceMatrix.needsUpdate=true;glassIM.instanceMatrix.needsUpdate=true;
    solidIM.frustumCulled=false;glassIM.frustumCulled=false;
    solidIM.castShadow=solidIM.receiveShadow=true;glassIM.castShadow=glassIM.receiveShadow=true;
    g.add(solidIM);g.add(glassIM);
    /* corner columns tie the window bands together */
    [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(k=>{
      g.add(box(.56,roofY,.56,body,k[0]*(bw/2-.22),roofY/2,k[1]*(bd/2-.22)));
    });
    /* floor slabs (one more than upper floors: the roof deck) */
    const slabIM=new THREE.InstancedMesh(new THREE.BoxGeometry(bw-.45,.22,bd-.45),floorM,floors);
    for(let i=1;i<=floors;i++){m4.makeTranslation(0,floorY(i)-.11,0);slabIM.setMatrixAt(i-1,m4);}
    slabIM.instanceMatrix.needsUpdate=true;slabIM.frustumCulled=false;slabIM.receiveShadow=true;slabIM.castShadow=true;
    g.add(slabIM);
    /* ceiling lights + lift pads, one set for every floor */
    const lampIM=new THREE.InstancedMesh(new THREE.BoxGeometry(2.0,.06,2.0),lampM,floors);
    const padIM=new THREE.InstancedMesh(new THREE.BoxGeometry(2.2,.05,2.2),metal,floors-1);
    for(let i=0;i<floors;i++){
      m4.makeTranslation(0,floorY(i)+fh-.32,0);lampIM.setMatrixAt(i,m4);
      if(i>0){m4.makeTranslation(0,floorY(i)+.12,backZ);padIM.setMatrixAt(i-1,m4);}
    }
    lampIM.instanceMatrix.needsUpdate=true;lampIM.frustumCulled=false;
    padIM.instanceMatrix.needsUpdate=true;padIM.frustumCulled=false;
    g.add(lampIM);g.add(padIM);
    /* elevator cab marker in the lobby, with a lit floor panel */
    g.add(box(2.2,.08,2.2,metal,0,.12,backZ));
    g.add(box(2.3,.06,2.3,std(0xffd76a,{emissive:0xffc94a,emissiveIntensity:.5}),0,.17,backZ));
    g.add(box(2.0,2.4,.1,std(0x2b3540),0,1.42,backZ-1.02));
    g.add(box(1.25,.62,.05,std(0x9fe0ff,{emissive:0x3f9fbf,emissiveIntensity:.9}),0,1.95,backZ-.96));
    [-1,1].forEach(s=>g.add(cyl(.05,.05,lh,metal,s*1.08,lh/2,backZ-1.0,6)));
    /* roof deck + parapet + crown */
    g.add(box(bw+.2,.16,bd+.2,trim,0,roofY+.08,0));
    const par=new THREE.Mesh(ringGeo(bw,bd,.3,.9),body);par.position.y=roofY+.16;par.castShadow=true;g.add(par);
    const th=Math.max(3,h*.13),tw=bw*.62,td=bd*.62;
    g.add(box(tw,th,td,body,0,roofY+.16+th/2,0));
    for(let y=roofY+1.5;y<roofY+.16+th-1.0;y+=2.6)g.add(box(tw+.12,.95,td+.12,glass2,0,y,0));
    g.add(box(tw*.6,.9,td*.6,dark,0,roofY+.16+th+.45,0));
    g.add(cyl(.09,.13,4.2,trim,0,roofY+.16+th+2.5,0,6));
    g.add(sph(.21,std(0xff5a4a,{emissive:0xff3a2a,emissiveIntensity:1}),0,roofY+.16+th+4.9,0,6));
    shade(g);scene.add(g);
    /* walls block movement but the doorway is a real gap */
    const addBoxSolid=(lx,lz,w,d)=>{
      const p=wpos(cx,cz,yaw,lx,lz);
      solids.push({x:p.x,z:p.z,w:w,d:d,yaw:yaw,r:Math.max(w,d)/2});
    };
    addBoxSolid(0,-bd/2+wallT/2,bw,wallT);
    addBoxSolid(-bw/2+wallT/2,0,wallT,bd);
    addBoxSolid(bw/2-wallT/2,0,wallT,bd);
    addBoxSolid(-(gap/2+segW/2),zF,segW,wallT);
    addBoxSolid(gap/2+segW/2,zF,segW,wallT);
    TOWERS.push({x:cx,z:cz,yaw:yaw,w:bw,d:bd,lh:lh,fh:fh,floors:floors,roofY:roofY,backZ:backZ,pad:wpos(cx,cz,yaw,0,backZ)});
  }
  function village(cx,cz,kind,opts){
    opts=opts||{};
    const gy=opts.gy||0;
    cityTheme=opts.theme||null;
    const plaza=new THREE.Mesh(new THREE.CircleGeometry(16,40),dirt);plaza.rotation.x=-Math.PI/2;plaza.position.set(cx,gy+.022,cz);plaza.receiveShadow=true;scene.add(plaza);
    const w=new THREE.Group();w.position.set(cx,gy,cz);
    w.add(cyl(1.4,1.4,.9,stone,0,.45,0,12));w.add(cyl(1.1,1.1,.05,std(0x1d4a6a),0,.88,0,12));
    [-1,1].forEach(s=>w.add(box(.12,2,.12,wood,s*1.2,1.5,0)));
    w.add(box(3.0,.12,1.8,std(0x8a3a2c),0,2.55,0));
    shade(w);scene.add(w);solids.push({x:cx,z:cz,r:1.6});
    const n=opts.houses||28,R=opts.radius||62; // Sprawling cities
    for(let i=0;i<n;i++){
      const a=i/n*TAU+rnd(-.12,.12),r=R+rnd(-3,5),hx=cx+Math.cos(a)*r,hz=cz+Math.sin(a)*r,yaw=Math.atan2(-Math.cos(a),-Math.sin(a));
      const big=(kind==='v1'&&i===0),sc=big?1.45:1;
      const hg=house(hx,hz,yaw,sc);
      if(big){
        hg.add(box(2.6,8,2.6,std(0xd9d2c0),-4.6,4,1));
        const rf=cone(2.2,3,std(0x5b4636),-4.6,9.5,1,4);rf.rotation.y=Math.PI/4;hg.add(rf);
        const tw=wpos(hx,hz,yaw,-4.6*sc,1*sc);solids.push({x:tw.x,z:tw.z,r:2.2*sc});
      }
      shade(hg);
      const L=r-3*sc-16,mid=16+L/2;
      if(L>1){const pth=box(2.0,.03,L,dirt,cx+Math.cos(a)*mid,gy+.026,cz+Math.sin(a)*mid);pth.rotation.y=yaw;pth.receiveShadow=true;scene.add(pth);}
    }
    for(let k=0;k<4;k++){
      const sa=k/4*TAU+.5,sx=cx+Math.cos(sa)*6.8,sz=cz+Math.sin(sa)*6.8;
      const st=new THREE.Group();st.position.set(sx,gy,sz);st.rotation.y=Math.atan2(-Math.cos(sa),-Math.sin(sa));
      st.add(box(2.6,.9,1.3,wood,0,.45,0));
      [-1.2,1.2].forEach(px=>[-.5,.5].forEach(pz=>st.add(box(.1,2.2,.1,wood,px,1.1,pz))));
      st.add(box(3.0,.1,1.8,std(k%2?0xc84a3a:0x3a7ac8),0,2.25,0));
      const gc=[0xd8402a,0xf0b030,0x6fb040,0xe0762a];
      for(let j=0;j<6;j++)st.add(sph(.18,std(gc[j%4]),-1.1+j*.45,1.08,0,6));
      shade(st);scene.add(st);solids.push({x:sx,z:sz,r:1.5});
    }
    [0.2,0.8,2.1,3.7].slice(0,opts.turbines==null?4:opts.turbines).forEach(a3=>{
      const tx=cx+Math.cos(a3)*(R+65),tz=cz+Math.sin(a3)*(R+65);
      windTurbine(tx,tz,rnd(1.0,1.3),Math.PI/2-a3,cx,cz,gy);
    });
    const towerPlan = kind==='v1' ? [[.35,31,36],[2.2,37,29],[4.1,33,25],[5.5,38,20]]
                    : kind==='v2' ? [[.8,32,31],[3.4,35,25],[5.3,30,21]]
                    : kind==='v4' ? [[1.6,33,27]]
                    : [[1.6,33,27],[4.2,36,22]];
    if(opts.towers!==false)towerPlan.forEach(t=>{
      const tx=cx+Math.cos(t[0])*t[1],tz=cz+Math.sin(t[0])*t[1];
      /* doors face the plaza at the middle of the village */
      skyscraper(tx,tz,Math.atan2(-Math.cos(t[0]),-Math.sin(t[0])),t[2]);
    });
    HOMES.push({x:cx,z:cz,r:opts.homeR||75,role:'villager',count:opts.count||25,biome:opts.biome||null,gy:gy});
    cityTheme=null;
  }
  function farm(cx,cz,crop){
    const g=new THREE.Group();g.position.set(cx,0,cz);
    const wall=std(0xb8392c),trm=std(0xf6ecd2),roof=std(0x5b4636),dm=std(0x3a2418);
    g.add(box(10,5,8,wall,0,2.5,0));
    const gs=new THREE.Shape();gs.moveTo(-5,0);gs.lineTo(5,0);gs.lineTo(0,3);gs.lineTo(-5,0);
    const gb=new THREE.Mesh(new THREE.ExtrudeGeometry(gs,{depth:8,bevelEnabled:false}),wall);gb.position.set(0,5,-4);g.add(gb);
    const ang=Math.atan2(3,5);
    const rl=box(6.6,.4,9,roof,-2.55,6.55,0);rl.rotation.z=ang;g.add(rl);
    const rr=box(6.6,.4,9,roof,2.55,6.55,0);rr.rotation.z=-ang;g.add(rr);
    g.add(box(3.4,3.7,.2,dm,0,1.85,4.05));g.add(box(3.8,.2,.22,trm,0,3.78,4.08));
    g.add(box(.2,3.8,.22,trm,-1.8,1.9,4.08));g.add(box(.2,3.8,.22,trm,1.8,1.9,4.08));
    const xa=Math.atan2(3.6,3.4);
    const x1=box(4.6,.2,.16,trm,0,1.85,4.2);x1.rotation.z=xa;g.add(x1);
    const x2=box(4.6,.2,.16,trm,0,1.85,4.2);x2.rotation.z=-xa;g.add(x2);
    shade(g);scene.add(g);
    [-3.5,0,3.5].forEach(o=>solids.push({x:cx+o,z:cz,r:4.3}));
    const silo=new THREE.Group();silo.position.set(cx+10,0,cz-2);
    silo.add(cyl(1.9,1.9,9,std(0xc9d0d6),0,4.5,0,14));
    const dome=sph(1.9,std(0x9aa5ae),0,9,0,14);dome.scale.y=.7;silo.add(dome);
    for(let i=0;i<4;i++)silo.add(cyl(1.95,1.95,.18,std(0x8d979f),0,1.5+i*2,0,14));
    shade(silo);scene.add(silo);solids.push({x:cx+10,z:cz-2,r:2.1});
    const hay=std(0xe6bf48),band=std(0xb88a2a);
    [[-8,0,3],[-8.2,0,5.2],[-7.3,1.55,4.1]].forEach(p=>{
      const b=new THREE.Group();const c=cyl(.85,.85,1.5,hay,0,0,0,12);c.rotation.z=Math.PI/2;b.add(c);
      [-.35,.35].forEach(xx=>{const s1=cyl(.88,.88,.12,band,xx,0,0,12);s1.rotation.z=Math.PI/2;b.add(s1);});
      b.position.set(cx+p[0],.85+p[1],cz+p[2]);shade(b);scene.add(b);
    });
    solids.push({x:cx-8,z:cz+3,r:1.2},{x:cx-8.2,z:cz+5.2,r:1.2});
    house(cx-26,cz-4,0,1);
    const px=cx,pz=cz+22,N=22,PR=11;
    for(let i=0;i<N;i++){
      const a0=i/N*TAU,a1=(i+1)/N*TAU,x0=px+Math.cos(a0)*PR,z0=pz+Math.sin(a0)*PR,x1=px+Math.cos(a1)*PR,z1=pz+Math.sin(a1)*PR;
      const post=box(.25,1.3,.25,wood,x0,.65,z0);post.castShadow=true;scene.add(post);
      const len=Math.hypot(x1-x0,z1-z0),yw=Math.atan2(x1-x0,z1-z0);
      [.45,.95].forEach(yy=>{const rl2=box(.1,.1,len,wood,(x0+x1)/2,yy,(z0+z1)/2);rl2.rotation.y=yw;scene.add(rl2);});
    }
    FARMS.push({px,pz});
    const fx=cx+32,fz=cz+12;
    const patch=new THREE.Mesh(new THREE.PlaneGeometry(30,24),std(0x6b4a2b));patch.rotation.x=-Math.PI/2;patch.position.set(fx,.025,fz);patch.receiveShadow=true;scene.add(patch);
    const wheat=crop==='wheat';
    const geo=wheat?new THREE.BoxGeometry(.3,1,.3):new THREE.SphereGeometry(.42,7,5);geo.translate(0,wheat?.5:.35,0);
    const nx=19,nz=15,im=new THREE.InstancedMesh(geo,std(0xffffff),nx*nz);
    const d=new THREE.Object3D(),col=new THREE.Color();let k=0;
    for(let ix=0;ix<nx;ix++)for(let iz=0;iz<nz;iz++){
      d.position.set(fx-14+ix*1.55+rnd(-.1,.1),0,fz-11+iz*1.6);d.rotation.set(0,rnd(0,TAU),0);const s=rnd(.8,1.2);d.scale.set(s,wheat?rnd(.8,1.3):s,s);d.updateMatrix();
      if(wheat)col.setHSL(rnd(.11,.14),rnd(.6,.8),rnd(.45,.58));else col.setHSL(rnd(.05,.08),rnd(.8,.95),rnd(.45,.55));
      im.setColorAt(k,col);k++;
    }
    im.castShadow=true;im.receiveShadow=true;scene.add(im);
    HOMES.push({x:cx,z:cz+8,r:30,role:'farmer',count:3});
  }
  /* six home-island cities, then five themed cities on each biome island */
  HOME_CITIES.forEach(c=>village(c.x,c.z,c.kind));
  BIOME_CITIES.forEach(c=>village(c.x,c.z,c.kind,{
    gy:.075,theme:CITY_THEMES[c.biome],biome:c.biome,
    houses:c.houses,radius:c.radius,homeR:c.homeR,count:c.count,
    turbines:c.turbines,towers:c.towers,
  }));
  farm(-120*K,-130*K,'wheat'); farm(195*K,-110*K,'pumpkin');
}

function buildPerson(role){
  const hunter=role==='hunter',farmer=role==='farmer';
  const g=new THREE.Group();
  const skin=std([0xf0c49a,0xd9a577,0xa86f45,0x7a4a2a][Math.floor(rand()*4)]);
  const shirt=std(hunter?0x7a5a32:new THREE.Color().setHSL(rand(),.5,.5)),pants=std(hunter?0x3e4a2a:rand()<.5?0x2f3f66:0x4a3a2a);
  const hair=std([0x2a1a10,0x6a4a2a,0xd8b060,0x888888][Math.floor(rand()*4)]),blk=std(0x111111);
  g.add(box(.5,.7,.28,shirt,0,1.15,0));
  g.add(sph(.17,skin,0,1.68,0,8));g.add(box(.3,.1,.3,hair,0,1.8,-.02));
  [-1,1].forEach(s=>g.add(sph(.02,blk,s*.06,1.7,.15,5)));
  const arms=[],legs=[];
  [-1,1].forEach(s=>{
    const a=pivot(g,s*.33,1.45,0);a.add(box(.12,.6,.12,shirt,0,-.3,0));a.add(box(.11,.12,.11,skin,0,-.62,0));arms.push(a);
    const l=pivot(g,s*.13,.8,0);l.add(box(.16,.8,.16,pants,0,-.4,0));legs.push(l);
  });
  if(farmer){const straw=std(0xe0c068);g.add(cyl(.32,.32,.04,straw,0,1.86,0,10));g.add(cyl(.18,.18,.14,straw,0,1.93,0,10));}
  let flash=null,alert=null,meatHand=null;
  if(hunter){
    const coat=std(0x5d452a),coatDark=std(0x3d2d1b),leather=std(0x4a2e18),
          leather2=std(0x6d4a2a),metal=std(0x2b2f36),steel=std(0x777f88),
          wood=std(0x744922),scarf=std(0x9b3428),brass=std(0xd0a54a),
          hat=std(0x7c5c38),band=std(0x332417);
    /* open hunting coat over a darker shirt */
    g.add(box(.56,.62,.3,coat,0,1.15,0));
    [-1,1].forEach(s=>{
      g.add(box(.17,.52,.045,coatDark,s*.18,1.18,.16));
      g.add(box(.15,.12,.055,leather2,s*.18,1.04,.19));
      g.add(box(.16,.035,.06,leather,s*.18,1.105,.193));
      g.add(box(.16,.1,.055,coat,s*.18,1.39,.18));
    });
    g.add(box(.59,.09,.33,leather,0,.94,0));
    g.add(box(.12,.075,.035,brass,0,.94,.18));
    g.add(box(.27,.07,.3,coatDark,0,1.46,0));
    /* bandolier with four brass rounds */
    const bando=box(.115,.78,.035,leather,0,1.16,.18);
    bando.rotation.z=.6;g.add(bando);
    for(let i=0;i<4;i++)g.add(box(.055,.075,.045,brass,.14-i*.085,1.4-i*.145,.2));
    /* neckerchief, satchel and shoulder patch */
    g.add(box(.24,.1,.07,scarf,0,1.46,.14));
    const knot=box(.1,.1,.07,scarf,0,1.39,.17);knot.rotation.z=Math.PI/4;g.add(knot);
    g.add(box(.34,.3,.14,leather2,0,1.18,-.2));
    g.add(box(.38,.055,.16,leather,0,1.02,-.2));
    g.add(box(.1,.1,.025,brass,-.28,1.36,.17));
    /* nose, ears, brows and stubble */
    g.add(box(.065,.06,.09,skin,0,1.65,.19));
    [-1,1].forEach(s=>{
      g.add(sph(.035,skin,s*.17,1.68,0,6));
      g.add(box(.075,.03,.03,hair,s*.06,1.735,.17));
    });
    g.add(box(.27,.13,.035,hair,0,1.58,.16));
    /* wide-brimmed hat with band, buckle and feather */
    g.add(cyl(.41,.41,.05,hat,0,1.84,0,14));
    g.add(cyl(.23,.27,.2,hat,0,1.95,0,12));
    g.add(cyl(.235,.255,.05,band,0,1.87,0,12));
    g.add(box(.085,.055,.045,brass,0,1.87,.25));
    const feather=box(.035,.24,.025,scarf,.3,2.04,-.02);feather.rotation.z=-.45;g.add(feather);
    /* boots, cuffs and gloves */
    legs.forEach(l=>{
      l.add(box(.175,.16,.24,leather,0,-.72,.035));
      l.add(box(.185,.045,.27,leather2,0,-.795,.055));
      l.add(box(.17,.1,.09,coatDark,0,-.62,.055));
    });
    arms.forEach(a=>{
      a.add(box(.14,.075,.14,coatDark,0,-.45,0));
      a.add(box(.13,.13,.13,leather2,0,-.64,.01));
    });
    /* lever-action rifle: walnut stock, long barrel, loop lever and muzzle flash */
    const rifle=new THREE.Group();rifle.position.set(0,-.65,.05);
    rifle.add(box(.09,.34,.13,wood,0,.27,0));
    rifle.add(box(.1,.14,.14,wood,0,.05,0));
    rifle.add(box(.085,.24,.11,metal,0,-.05,0));
    rifle.add(box(.075,.3,.09,wood,0,-.30,.012));
    rifle.add(cyl(.022,.028,.72,steel,0,-.42,0,8));
    rifle.add(box(.026,.05,.05,steel,0,-.73,0));
    const lever=new THREE.Mesh(new THREE.TorusGeometry(.075,.014,6,10),metal);
    lever.rotation.x=Math.PI/2;lever.position.set(0,-.01,.085);rifle.add(lever);
    rifle.add(box(.035,.07,.055,metal,0,.09,-.055));
    const rf=new THREE.Group();
    const fmat=new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:.95,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
    const f1=new THREE.Mesh(new THREE.PlaneGeometry(.28,.28),fmat);rf.add(f1);
    const f2=f1.clone();f2.rotation.z=Math.PI/4;rf.add(f2);
    const f3=f1.clone();f3.rotation.y=Math.PI/2;rf.add(f3);
    const smoke=new THREE.Mesh(new THREE.SphereGeometry(.13,6,5),new THREE.MeshBasicMaterial({color:0xbfbfbf,transparent:true,opacity:.3,depthWrite:false}));
    smoke.position.set(0,-.08,.02);rf.add(smoke);
    rf.position.set(0,-.79,0);rf.visible=false;rifle.add(rf);
    arms[1].add(rifle);flash=rf;
    /* a red alert mark appears when the hunter is provoked */
    alert=new THREE.Group();
    const red=new THREE.MeshBasicMaterial({color:0xff3b30,depthTest:false,depthWrite:false});
    alert.add(box(.075,.24,.035,red,0,.2,0));
    alert.add(box(.085,.085,.035,red,0,0,0));
    alert.position.set(0,2.3,0);alert.visible=false;g.add(alert);
    meatHand=pivot(arms[0],0,-.55,.03);
  }
  g.userData={arms,legs,flash,alert,meatHand};
  shade(g);
  if(flash)flash.traverse(o=>{if(o.isMesh)o.castShadow=false;});
  if(alert)alert.traverse(o=>{if(o.isMesh)o.castShadow=false;});
  return g;
}
function spawnPerson(home){
  const g=buildPerson(home.role),a=rnd(0,TAU),r=Math.sqrt(rand())*home.r*.6;
  const x=home.x+Math.cos(a)*r,z=home.z+Math.sin(a)*r,gy=home.gy||0;
  g.position.set(x,gy,z);g.rotation.y=rnd(0,TAU);scene.add(g);
  const c={g,home,wild:!!home.wild,kind:home.role==='villager'?'human':home.role,person:true,hp:home.role==='hunter'?5:home.role==='farmer'?4:3,role:home.role,biome:home.biome||null,gy,st:rnd(0,4),moving:false,sp:rnd(1.1,1.6),run:rnd(3.2,4.0),fleeSide:rand()<.5?-1:1,fleeing:false,ph:rnd(0,TAU),tx:x,tz:z,line:Math.floor(rand()*6),talk:0,knock:0,landed:false,y:0,vx:0,vz:0,vy:0,sx:0,sz:0,dead:false,deadT:0,huntCd:rnd(1.5,6),shotT:0,flashT:0,angry:0,angerSaid:false,meal:null,mealState:null,mealT:0};
  persons.push(c);return registerEntity(c,'person');
}
function updatePerson(c,dt,t){
  const g=c.g,p=g.position,u=g.userData;
  if(u.flash)u.flash.visible=false;
  if(u.alert)u.alert.visible=false;
  u.arms.forEach(a=>{a.rotation.z=0;});
  if(c.dead){
    c.deadT-=dt;
    if(c.deadT<=0){
      burst(p.x,.35,p.z,0xcdbb8a,8);
      scene.remove(g);
      if(c.id)entitiesById.delete(c.id);
      const di=persons.indexOf(c);if(di>=0)persons.splice(di,1);
      return;
    }
  }
  if(c.knock>0){
    c.knock-=dt;
    p.x+=c.vx*dt;p.z+=c.vz*dt;
    c.vy-=22*dt;c.y+=c.vy*dt;
    if(c.y>0){
      g.rotation.x+=c.sx*dt;g.rotation.z+=c.sz*dt;
      u.arms.forEach((a,i)=>{a.rotation.x=Math.sin(t*17+i*2.1)*1.3;});
      u.legs.forEach((l,i)=>{l.rotation.x=Math.sin(t*15+i*1.6)*1.2;});
    }else{
      c.y=0;
      if(!c.landed){
        c.landed=true;c.vy=0;c.vx*=.25;c.vz*=.25;
        g.rotation.x=0;g.rotation.z=(Math.sin(g.rotation.z)>=0?1:-1)*1.45;
        burst(p.x,.3,p.z,0xcdbb8a,10);
      }
      u.arms.forEach((a,i)=>{a.rotation.x=.4+Math.sin(t*6+i)*.15;});
      u.legs.forEach((l,i)=>{l.rotation.x=.2+Math.sin(t*5+i)*.12;});
    }
    p.y=(c.gy||0)+c.y;
    pushOut(p,.4);if(!c.adminRoam)boundPerson(p,c);
    if(c.knock<=0&&c.landed){
      if(c.dead){c.knock=0;p.y=c.gy||0;c.y=0;return;}
      c.knock=0;c.landed=false;p.y=c.gy||0;c.y=0;
      g.rotation.set(0,g.rotation.y,0);
      u.arms.forEach(a=>{a.rotation.x=0;});u.legs.forEach(l=>{l.rotation.x=0;});
      c.st=0;c.moving=false;
    }
    return;
  }
  if(c.dead){p.y=c.gy||0;return;}
  if(c.held){
    u.arms.forEach((a,i)=>{a.rotation.x=Math.sin(t*9+i*2.2)*1.1;});
    u.legs.forEach((l,i)=>{l.rotation.x=Math.sin(t*8+i*1.9)*.9;});
    g.rotation.y=-1.1+Math.sin(t*3)*.12;g.rotation.x=0;g.rotation.z=0;
    return;
  }
  let threat=null,td=99;
  if(!c.angry){
    bulls.forEach(f=>{
      if(f.held||(f.state!=='wind'&&f.state!=='charge'&&f.state!=='ride'))return;
      const bd=Math.hypot(f.g.position.x-p.x,f.g.position.z-p.z);
      const rad=f.target===c?26:(f.state!=='wind'?14:9);
      if(bd<rad&&bd<td){td=bd;threat=f;}
    });
    pets.forEach(f=>{
      if(f.kind!=='bear'||f.held)return;
      if(f.bmode!=='chase'&&f.bmode!=='wind')return;
      const bd=Math.hypot(f.g.position.x-p.x,f.g.position.z-p.z);
      const rad=f.bt===c?22:11;
      if(bd<rad&&bd<td){td=bd;threat=f;}
    });
  }
  if(threat&&td>1.2){
    const bx=threat.g.position.x,bz=threat.g.position.z;
    let ax=p.x-bx,az=p.z-bz;
    const ad=Math.hypot(ax,az)||1;
    c.dir=Math.atan2(ax/ad,az/ad)+Math.sin(t*3+c.ph)*.16*c.fleeSide;
    const spd=c.run;
    p.x+=Math.sin(c.dir)*spd*dt;p.z+=Math.cos(c.dir)*spd*dt;
    if(pushOut(p,.4))c.fleeSide*=-1;
    if(!c.adminRoam)boundPerson(p,c);
    g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*9);
    c.talk=0;c.moving=false;c.st=0;c.fleeing=true;
    const s=Math.sin(t*13+c.ph);
    u.legs[0].rotation.x=s*.95;u.legs[1].rotation.x=-s*.95;
    u.arms[0].rotation.x=-s*.85;u.arms[1].rotation.x=s*.85;
    return;
  }
  c.fleeing=false;
  if(c.talk<=0&&updateHumanHunt(c,dt,t))return;
  if(c.talk>0){
    c.talk-=dt;c.moving=false;
    g.rotation.y+=angDiff(g.rotation.y,Math.atan2(P.x-p.x,P.z-p.z))*Math.min(1,dt*6);
  }else{
    c.st-=dt;
    if(c.moving){
      const dx=c.tx-p.x,dz=c.tz-p.z,d=Math.hypot(dx,dz);
      if(d<.5||c.st<=0){c.moving=false;c.st=rnd(2,7);}
      else{p.x+=dx/d*c.sp*dt;p.z+=dz/d*c.sp*dt;g.rotation.y+=angDiff(g.rotation.y,Math.atan2(dx,dz))*Math.min(1,dt*6);}
    }else if(c.st<=0){
      for(let i=0;i<10;i++){
        const a=rnd(0,TAU),r=Math.sqrt(rand())*c.home.r,x=c.home.x+Math.cos(a)*r,z=c.home.z+Math.sin(a)*r;
        if(solids.some(s=>Math.hypot(s.x-x,s.z-z)<s.r+.8))continue;
        c.tx=x;c.tz=z;c.moving=true;c.st=rnd(6,14);break;
      }
      if(!c.moving)c.st=1;
    }
  }
  if(pushOut(p,.4)&&c.moving){c.moving=false;c.st=rnd(.5,2);}
  const s=c.moving?Math.sin(t*7+c.ph):0;
  u.legs[0].rotation.x=s*.6;u.legs[1].rotation.x=-s*.6;u.arms[0].rotation.x=-s*.5;u.arms[1].rotation.x=s*.5;
}
/* everyday humans swat the bugs around them; hunters carry a rifle and
   bring down game animals. Big game takes two well-placed shots. */
const HUNT_KINDS=new Set(['cow','sheep','chicken','deer','bunny','horse','camel','zebra','meerkat','penguin','bear','snowbear','bull']);
const HUNTER_HEAVY=new Set(['bear','snowbear','bull']);
function bugPreyNear(c,r){
  const p=c.g.position;
  let best=null,bd=r;
  const consider=(a,kind)=>{
    if(!a||a.held||a.ridden||a.dead||!a.g.parent)return;
    const q=a.g.position;
    const d=Math.hypot(q.x-p.x,q.z-p.z);
    if(d<bd){bd=d;best={a,kind};}
  };
  hoppers.forEach(a=>consider(a,'hopper'));
  ants.forEach(a=>consider(a,'ant'));
  bees.forEach(a=>consider(a,'bee'));
  butterflies.forEach(a=>consider(a,'butterfly'));
  pets.forEach(a=>{if(a.kind==='locust')consider(a,'locust');});
  return best;
}
function hunterPreyNear(c,r){
  const p=c.g.position;
  let best=null,bd=r;
  const consider=(a,kind)=>{
    if(!a||a.held||a.ridden||a.dead||!a.g.parent)return;
    if(!HUNT_KINDS.has(kind))return;
    const q=a.g.position;
    const d=Math.hypot(q.x-p.x,q.z-p.z);
    if(d<bd){bd=d;best={a,kind};}
  };
  cows.forEach(a=>consider(a,'cow'));
  bulls.forEach(a=>consider(a,'bull'));
  pets.forEach(a=>consider(a,a.kind));
  return best;
}
function bugKilled(a,kind){
  if(kind==='hopper'||kind==='locust'){killEdible(a,kind,true);return;}
  const list=kind==='ant'?ants:kind==='bee'?bees:butterflies;
  const i=list.indexOf(a);if(i>=0)list.splice(i,1);
  const q=a.g.position;
  burst(q.x,Math.max(.2,q.y),q.z,kind==='bee'?0xf2c230:kind==='butterfly'?0xffb050:0x8a2a1a,5);
  scene.remove(a.g);
}
function updateHumanHunt(c,dt,t){
  if(c.role==='hunter')return updateHunterHunt(c,dt,t);
  if(c.hunt&&(c.hunt.a.held||c.hunt.a.dead||!c.hunt.a.g.parent))c.hunt=null;
  if(!c.hunt){
    c.huntCd=Math.max(0,(c.huntCd||0)-dt);
    if(c.huntCd>0)return false;
    c.hunt=bugPreyNear(c,c.role==='farmer'&&nearFarm(c.g.position.x,c.g.position.z,60)?17:11);
    c.hitT=.4;
    if(!c.hunt){c.huntCd=rnd(3,7);return false;}
  }
  const p=c.g.position,u=c.g.userData,a=c.hunt.a,q=a.g.position;
  const dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz)||1;
  c.dir=Math.atan2(dx,dz);c.moving=false;c.st=0;
  c.g.rotation.y+=angDiff(c.g.rotation.y,c.dir)*Math.min(1,dt*7);
  if(d>1.7){
    const sp=3.1;
    p.x+=Math.sin(c.dir)*sp*dt;p.z+=Math.cos(c.dir)*sp*dt;
    if(pushOut(p,.4))c.dir+=Math.PI*rnd(.5,1.2);
    if(!c.adminRoam)boundPerson(p,c);
    const s=Math.sin(t*11+c.ph);
    u.legs[0].rotation.x=s*.8;u.legs[1].rotation.x=-s*.8;
    u.arms[0].rotation.x=-s*.7;u.arms[1].rotation.x=s*.7;
    return true;
  }
  c.hitT-=dt;
  const swing=Math.sin(t*22)*.8;
  u.arms[0].rotation.x=-1.25+swing;u.arms[1].rotation.x=-.55-swing*.5;
  u.legs[0].rotation.x=.15;u.legs[1].rotation.x=-.15;
  if(c.hitT<=0){
    c.hitT=1.15;
    bugKilled(a,c.hunt.kind);
    c.hunt=null;c.huntCd=rnd(5,11);
  }
  return true;
}
function hunterFindMeat(x,z,r){
  let best=null,bd=r;
  for(let i=0;i<meats.length;i++){
    const m=meats[i];
    if(!m||m.held||!m.g||!m.g.parent)continue;
    const p=m.g.position,d=Math.hypot(p.x-x,p.z-z);
    if(d<bd){bd=d;best=m;}
  }
  return best;
}
function hunterDropMeal(c){
  const m=c.meal;
  if(m&&m.held&&m.g.parent){
    c.g.userData.meatHand.remove(m.g);
    const p=c.g.position,a=c.g.rotation.y+Math.PI*.5;
    m.g.position.set(p.x+Math.sin(a)*.9,0,p.z+Math.cos(a)*.9);
    m.g.rotation.set(0,rnd(0,TAU),0);m.g.scale.setScalar(1);scene.add(m.g);m.held=false;
  }
  c.meal=null;c.mealState=null;c.mealT=0;
}
function hunterEatMeal(c){
  const m=c.meal;if(!m)return;
  const i=meats.indexOf(m);if(i>=0)meats.splice(i,1);
  if(m.id)entitiesById.delete(m.id);
  if(m.g.parent)m.g.parent.remove(m.g);
  const p=c.g.position;
  burst(p.x,1.55,p.z,0xcf4436,7);
  burst(p.x,1.58,p.z,0xf1dcc0,4);
  c.meal=null;c.mealState=null;c.mealT=0;
}
function hunterStartMeal(c,x,z){
  const m=hunterFindMeat(x,z,5);
  if(!m)return false;
  c.meal=m;c.mealState='walk';c.mealT=0;c.hunt=null;return true;
}
function updateHunterMeal(c,dt,t){
  const m=c.meal,u=c.g.userData,p=c.g.position;
  if(!m||m.dead||!m.g||meats.indexOf(m)<0||(m.held&&c.mealState!=='hold')){
    c.meal=null;c.mealState=null;c.mealT=0;return false;
  }
  if(c.mealState==='walk'){
    const q=m.g.position,dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz)||1;
    c.dir=Math.atan2(dx,dz);c.moving=false;c.st=0;
    c.g.rotation.y+=angDiff(c.g.rotation.y,c.dir)*Math.min(1,dt*8);
    if(d>1.15){
      const sp=3.1;
      p.x+=Math.sin(c.dir)*sp*dt;p.z+=Math.cos(c.dir)*sp*dt;
      if(pushOut(p,.4))c.dir+=Math.PI*rnd(.5,1.2);
      if(!c.adminRoam)boundPerson(p,c);
      const s=Math.sin(t*10+c.ph);
      u.legs[0].rotation.x=s*.7;u.legs[1].rotation.x=-s*.7;
      u.arms[0].rotation.x=-s*.4;u.arms[1].rotation.x=s*.4;
      return true;
    }
    m.held=true;scene.remove(m.g);
    m.g.position.set(0,-.03,.02);m.g.rotation.set(-.5,0,0);m.g.scale.setScalar(.78);
    if(u.meatHand)u.meatHand.add(m.g);else c.g.add(m.g);
    c.mealState='hold';c.mealT=rnd(1.05,1.55);
    return true;
  }
  c.moving=false;c.st=0;
  c.g.rotation.y+=angDiff(c.g.rotation.y,Math.atan2(P.x-p.x,P.z-p.z))*Math.min(1,dt*3);
  const bob=Math.sin(t*11)*.09;
  u.arms[0].rotation.x=-1.25+bob;u.arms[0].rotation.z=.78;
  u.arms[1].rotation.x=-.22;
  u.legs[0].rotation.x=.08;u.legs[1].rotation.x=-.08;
  c.mealT-=dt;
  if(c.mealT<=0){
    hunterEatMeal(c);
    const next=hunterFindMeat(p.x,p.z,4.5);
    if(next){c.meal=next;c.mealState='walk';c.mealT=0;}
    else{c.mealState=null;c.huntCd=rnd(5,10);}
  }
  return true;
}
function hunterTracer(x1,y1,z1,x2,y2,z2){
  try{
    const geo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x1,y1,z1),new THREE.Vector3(x2,y2,z2)]);
    const mat=new THREE.LineBasicMaterial({color:0xffdf7a,transparent:true,opacity:.9});
    const line=new THREE.Line(geo,mat);scene.add(line);
    setTimeout(()=>{scene.remove(line);geo.dispose();mat.dispose();},70);
  }catch(_){}
}
function provokeHunter(c,silent){
  if(!c||c.dead||c.role!=='hunter')return;
  if(c.meal)hunterDropMeal(c);
  c.angry=22;c.hunt=null;c.huntCd=0;c.shotT=.8;c.talk=0;c.angerSaid=false;
  if(!silent)toast('The hunter turns on you!');
}
function updateHunterHunt(c,dt,t){
  const u=c.g.userData,p=c.g.position;
  if(u.flash)u.flash.visible=false;
  if(c.flashT>0){c.flashT-=dt;if(u.flash)u.flash.visible=true;}
  if(c.angry>0){
    if(P.hp<=0||state!=='play'||c.dead){c.angry=0;return false;}
    c.angry-=dt;
    if(u.alert)u.alert.visible=true;
    if(c.meal)hunterDropMeal(c);
    c.hunt=null;
    const dx=P.x-p.x,dz=P.z-p.z,d=Math.hypot(dx,dz)||1;
    c.dir=Math.atan2(dx,dz);c.moving=false;c.st=0;
    c.g.rotation.y+=angDiff(c.g.rotation.y,c.dir)*Math.min(1,dt*9);
    if(d>38){c.angry=0;if(u.alert)u.alert.visible=false;return false;}
    if(d>8.5){
      const sp=4.2;
      p.x+=Math.sin(c.dir)*sp*dt;p.z+=Math.cos(c.dir)*sp*dt;
      if(pushOut(p,.4))c.dir+=Math.PI*rnd(.5,1.2);
      if(!c.adminRoam)boundPerson(p,c);
      const s=Math.sin(t*13+c.ph);
      u.legs[0].rotation.x=s*.9;u.legs[1].rotation.x=-s*.9;
      u.arms[0].rotation.x=-s*.7;u.arms[1].rotation.x=s*.7;
      return true;
    }
    u.legs[0].rotation.x=.12;u.legs[1].rotation.x=-.12;
    u.arms[0].rotation.x=-1.3;u.arms[1].rotation.x=-1.55;
    c.shotT-=dt;
    if(c.shotT<=0){
      c.shotT=rnd(.95,1.3);c.flashT=.08;
      if(u.flash)u.flash.visible=true;
      if(state==='play'&&Math.hypot(p.x-P.x,p.z-P.z)<45)gunSfx(.85);
      const fx=Math.sin(c.g.rotation.y),fz=Math.cos(c.g.rotation.y);
      hunterTracer(p.x+fx*.8,(c.gy||0)+1.45,p.z+fz*.8,P.x,(P.baseY||0)+(P.jy||0)+1.05,P.z);
      burst(p.x+fx*.65,(c.gy||0)+1.4,p.z+fz*.65,0xffd76a,5);
      burst(p.x+fx*.7,(c.gy||0)+1.38,p.z+fz*.7,0xc9a24a,2);
      if(rand()<.84||d<7){
        if(!c.angerSaid){c.angerSaid=true;toast('The hunter shoots you — run or fight!');}
        const fl=$('flash');if(fl){fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),90);}
        hurt(2,'hunter');
      }else burst(P.x,(P.baseY||0)+1.1,P.z,0xcdbb8a,4);
    }
    return true;
  }
  if(c.mealState&&updateHunterMeal(c,dt,t))return true;
  if(c.hunt&&(c.hunt.a.held||c.hunt.a.ridden||c.hunt.a.dead||!c.hunt.a.g.parent))c.hunt=null;
  if(!c.hunt){
    c.huntCd=Math.max(0,(c.huntCd||0)-dt);
    if(c.huntCd>0)return false;
    c.hunt=hunterPreyNear(c,30);
    c.shotT=.55;
    if(!c.hunt){c.huntCd=rnd(3,7);return false;}
  }
  const a=c.hunt.a,q=a.g.position,kind=c.hunt.kind;
  const dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz)||1;
  c.dir=Math.atan2(dx,dz);c.moving=false;c.st=0;
  c.g.rotation.y+=angDiff(c.g.rotation.y,c.dir)*Math.min(1,dt*7);
  if(d>8.5){
    if(d>36){c.hunt=null;c.huntCd=rnd(2,5);return false;}
    const sp=3.5;
    p.x+=Math.sin(c.dir)*sp*dt;p.z+=Math.cos(c.dir)*sp*dt;
    if(pushOut(p,.4))c.dir+=Math.PI*rnd(.5,1.2);
    if(!c.adminRoam)boundPerson(p,c);
    const s=Math.sin(t*11+c.ph);
    u.legs[0].rotation.x=s*.8;u.legs[1].rotation.x=-s*.8;
    u.arms[0].rotation.x=-s*.7;u.arms[1].rotation.x=s*.7;
    return true;
  }
  u.legs[0].rotation.x=.12;u.legs[1].rotation.x=-.12;
  u.arms[0].rotation.x=-1.3;u.arms[1].rotation.x=-1.55;
  c.shotT-=dt;
  if(c.shotT<=0){
    c.shotT=rnd(1,1.45);c.flashT=.09;
    if(u.flash)u.flash.visible=true;
    if(state==='play'&&Math.hypot(p.x-P.x,p.z-P.z)<45)gunSfx(.75);
    if(HUNTER_HEAVY.has(kind))gunSfx(1.15);
    const cy=a.cy||1;
    burst(q.x,q.y+cy,q.z,kind==='bull'||kind==='bear'||kind==='snowbear'?0xffb04a:0xffd76a,kind==='bull'?7:4);
    burst(q.x,q.y+cy,q.z,0xcf4436,kind==='bull'?7:5);
    const max=ANIMAL_HP[kind]||2;
    const dmg=HUNTER_HEAVY.has(kind)?Math.ceil(max/2):2;
    a.hp=(a.hp==null?max:a.hp)-dmg;
    if(a.hp<=0){
      const hx=q.x,hz=q.z;
      killEdible(a,kind,true);
      hunterStartMeal(c,hx,hz);
      c.hunt=null;c.huntCd=rnd(8,15);
      if(HUNTER_HEAVY.has(kind)&&state==='play'&&Math.hypot(p.x-P.x,p.z-P.z)<50)toast('A hunter brings down the '+kind+'!');
    }
  }
  return true;
}
function findPerson(){
  if(P.baseY>0.2)return null;
  const f=fwdVec();let best=null,bd=.4;
  persons.forEach(c=>{if(c.knock>0||c.dead)return;const dx=c.g.position.x-P.x,dz=c.g.position.z-P.z,d=Math.hypot(dx,dz);if(d>4.5)return;const dot=(dx*f.x+dz*f.z)/(d||1);if(dot>bd){bd=dot;best=c;}});
  return best;
}
function personNear(){return !!findPerson();}
function talkNear(){
  const c=findPerson();if(!c)return false;
  const L=LINES[c.role];toast('“'+L[c.line%L.length]+'”',true);c.line++;c.talk=3;return true;
}

function nearestPerson(p,r){
  let best=null,bd=r;
  persons.forEach(c=>{
    if(c.knock>0||c.dead)return;
    const d=Math.hypot(c.g.position.x-p.x,c.g.position.z-p.z);
    if(d<bd){bd=d;best=c;}
  });
  return best;
}

function buildMountains() {
  const rock1=std(0x7d7a74),rock2=std(0x6c6a66),snow=std(0xf4f8fb),foot=std(0x5b7a45);
  MOUNTS.forEach((m,i)=>{
    const g=new THREE.Group();g.position.set(m.x,.02,m.z);g.userData.noCull=true;
    const ry=rnd(0,TAU),sz=rnd(.8,1.15);
    /* the stone foot wraps around the body instead of cutting through it */
    const skirt=new THREE.Mesh(new THREE.CylinderGeometry(m.r*1.08,m.r*1.3,m.h*.22,9,1,true),foot);
    skirt.position.y=m.h*.11;skirt.scale.z=sz;skirt.rotation.y=ry;g.add(skirt);
    const body=new THREE.Mesh(new THREE.ConeGeometry(m.r,m.h,8,1),i%2?rock1:rock2);body.position.y=m.h/2;body.scale.z=sz;body.rotation.y=ry;g.add(body);
    /* the snow cap fully covers the rock tip — no coincident cone tips to z-fight */
    const capH=m.h*.38;
    const cap=new THREE.Mesh(new THREE.ConeGeometry(m.r*.43,capH,8,1,true),snow);
    cap.position.y=m.h*.64+capH/2+.002;cap.scale.z=sz;cap.rotation.y=ry;g.add(cap);
    scene.add(g);
  });
}

const birds=[],ants=[],HILLS=[],SAV_HILLS=[];
function buildHills() {
  let tries=0;const dirt=std(0x8a6a48),crumbM=std(0xf6ecd2);
  while(HILLS.length<6&&tries<400){tries++;
    const a=rnd(0,TAU),d=rnd(25,50*S*.8),x=Math.cos(a)*d,z=Math.sin(a)*d,fa=rnd(0,TAU),fd=rnd(7,11),fx=x+Math.cos(fa)*fd,fz=z+Math.sin(fa)*fd;
    if(solids.some(s=>Math.hypot(s.x-x,s.z-z)<s.r+4||Math.hypot(s.x-fx,s.z-fz)<s.r+3))continue;
    if(SITES.some(s=>Math.hypot(s.x-x,s.z-z)<s.r+8||Math.hypot(s.x-fx,s.z-fz)<s.r+8))continue;
    HILLS.push({x,z,fx,fz});
    const m=cone(1.3,1.0,dirt,x,.5,z,9);m.receiveShadow=true;scene.add(m);solids.push({x,z,r:1.0});
    for(let k=0;k<5;k++)scene.add(box(.14,.1,.14,crumbM,fx+rnd(-.35,.35),.05,fz+rnd(-.35,.35)));
  }
}

/* ---------- biome scenery: desert cacti + rocks, snowy pines + drifts ----------
   The biomes are island-sized now, so each prop is a batch of InstancedMeshes:
   hundreds of cacti/pines at a handful of draw calls. */
function buildBiomeProps(){
  const placed=[];
  const spot=(x,z,r)=>{
    if(nearSite(x,z,r+2))return false;
    if(nearRiver(x,z,r+1.5))return false;
    for(let i=0;i<placed.length;i++){const p=placed[i];if(Math.hypot(p.x-x,p.z-z)<p.r+r+1.4)return false;}
    placed.push({x,z,r});return true;
  };
  const mat4=(x,y,z,rz)=>{const o=new THREE.Object3D();o.position.set(x,y,z);if(rz)o.rotation.z=rz;o.updateMatrix();return o.matrix.clone();};
  const matS=(x,y,z,sx,sy,sz)=>{const o=new THREE.Object3D();o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.updateMatrix();return o.matrix.clone();};
  const mul=(a,b)=>new THREE.Matrix4().multiplyMatrices(a,b);

  /* desert cacti */
  const cactusM=std(0x4f8a3c),cactusD=std(0x3c6d2c),cacti=[];
  for(let i=0;i<300;i++){
    const a=rnd(0,TAU),d=Math.sqrt(rand())*DESERT.r*.94;
    const x=DESERT.x+Math.cos(a)*d,z=DESERT.z+Math.sin(a)*d,s=rnd(.8,1.4);
    if(!spot(x,z,.9*s))continue;
    cacti.push({x,z,s,ry:rnd(0,TAU)});
    solids.push({x,z,r:.55*s});
  }
  const cactusBody=new THREE.CylinderGeometry(.22,.3,1.9,7);cactusBody.translate(0,.95,0);
  instanced([
    {geo:cactusBody,mat:cactusM},
    {geo:new THREE.SphereGeometry(.2,6,5),mat:cactusM,local:mat4(0,1.9,0)},
    {geo:new THREE.CylinderGeometry(.12,.14,.72,6),mat:cactusM,local:mul(mat4(-.22,1.12,0,.9),mat4(-.34,0,0))},
    {geo:new THREE.CylinderGeometry(.11,.13,.6,6),mat:cactusD,local:mul(mat4(.22,.92,0,-.9),mat4(.3,0,0))}
  ],cacti);

  /* desert rocks */
  const rocks=[];
  for(let i=0;i<130;i++){
    const a=rnd(0,TAU),d=Math.sqrt(rand())*DESERT.r*.94;
    const x=DESERT.x+Math.cos(a)*d,z=DESERT.z+Math.sin(a)*d,r=rnd(.6,1.8);
    if(!spot(x,z,r*.9))continue;
    rocks.push({x,y:r*.42,z,rx:rnd(0,TAU),ry:rnd(0,TAU),rz:rnd(0,TAU),sx:r,sy:r*.7,sz:r});
    solids.push({x,z,r:r*.8});
  }
  instanced([{geo:new THREE.IcosahedronGeometry(1,0),mat:std(0xa9835a)}],rocks);

  /* snowy pines */
  const pineM=std(0x2f5a44),snowM=std(0xeef6ff),snowD=std(0xd8e6f2),pines=[];
  for(let i=0;i<340;i++){
    const a=rnd(0,TAU),d=Math.sqrt(rand())*SNOWZ.r*.94;
    const x=SNOWZ.x+Math.cos(a)*d,z=SNOWZ.z+Math.sin(a)*d,s=rnd(.85,1.4);
    if(!spot(x,z,s))continue;
    pines.push({x,z,s,ry:rnd(0,TAU)});
    solids.push({x,z,r:.6*s});
  }
  const trunkG=new THREE.CylinderGeometry(.16,.22,1.1,6);trunkG.translate(0,.55,0);
  instanced([
    {geo:trunkG,mat:std(0x6a4a30)},
    {geo:new THREE.ConeGeometry(1.45,1.5,7),mat:snowD,local:mat4(0,1.25,0)},
    {geo:new THREE.ConeGeometry(1.13,1.35,7),mat:pineM,local:mat4(0,2.10,0)},
    {geo:new THREE.ConeGeometry(.81,1.2,7),mat:snowM,local:mat4(0,2.95,0)},
    {geo:new THREE.ConeGeometry(.5,.6,7),mat:snowM,local:mat4(0,3.70,0)}
  ],pines);

  /* snow drifts */
  const drifts=[];
  for(let i=0;i<190;i++){
    const a=rnd(0,TAU),d=Math.sqrt(rand())*SNOWZ.r*.94;
    const x=SNOWZ.x+Math.cos(a)*d,z=SNOWZ.z+Math.sin(a)*d,r=rnd(.8,2.1);
    if(!spot(x,z,r*.9))continue;
    drifts.push({x,y:rnd(.05,.2),z,sx:r,sy:r*rnd(.25,.45),sz:r});
  }
  instanced([{geo:new THREE.SphereGeometry(1,8,6),mat:std(0xc9d9e7)}],drifts);

  /* savanna: umbrella-thorn acacias, dry grass tufts and termite mounds */
  const acacias=[];
  for(let i=0;i<1150;i++){
    const a=rnd(0,TAU),d=Math.sqrt(rand())*SAVAN.r*.95;
    const x=SAVAN.x+Math.cos(a)*d,z=SAVAN.z+Math.sin(a)*d,s=rnd(.9,1.5);
    if(!spot(x,z,s*2.0))continue;
    acacias.push({x,z,s,ry:rnd(0,TAU)});
    solids.push({x,z,r:.5*s});
  }
  const acTrunk=new THREE.CylinderGeometry(.16,.34,4.2,6);acTrunk.translate(0,2.1,0);
  instanced([
    {geo:acTrunk,mat:std(0x4a3320)},
    {geo:new THREE.CylinderGeometry(.07,.13,1.7,5),mat:std(0x4a3320),local:mat4(-.45,3.9,0,.8)},
    {geo:new THREE.CylinderGeometry(.07,.13,1.7,5),mat:std(0x4a3320),local:mat4(.45,3.9,0,-.8)},
    {geo:new THREE.SphereGeometry(1,10,7),mat:std(0x4c5c24),local:matS(0,4.75,0,2.9,.5,2.9)},
    {geo:new THREE.SphereGeometry(1,9,6),mat:std(0x586830),local:matS(-.4,5.15,.2,2.0,.42,2.0)}
  ],acacias);

  const tufts=[],tuftsDry=[];
  for(let i=0;i<5200;i++){
    const a=rnd(0,TAU),d=Math.sqrt(rand())*SAVAN.r*.97;
    const x=SAVAN.x+Math.cos(a)*d,z=SAVAN.z+Math.sin(a)*d;
    if(nearSite(x,z,0)||nearRiver(x,z,1))continue;
    const it={x,y:0,z,ry:rnd(0,TAU),
      sx:rnd(.8,1.5),sy:rnd(.75,1.45),sz:rnd(.8,1.5)};
    (rand()<.62?tuftsDry:tufts).push(it);
  }
  /* a tuft is a small fan of blades, not a cone: it reads as dry grass */
  const tuftG=(function(){
    const pos=[];
    for(let i=0;i<7;i++){
      const a=i/7*TAU+rnd(0,.5),r=rnd(.02,.11),h=rnd(.4,.95),w=rnd(.03,.055);
      const bx=Math.cos(a)*r,bz=Math.sin(a)*r;
      const tx=Math.cos(a+Math.PI/2)*w,tz=Math.sin(a+Math.PI/2)*w;
      pos.push(bx-tx,0,bz-tz, bx+tx,0,bz+tz, bx+Math.cos(a)*.3,h,bz+Math.sin(a)*.3);
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.computeVertexNormals();return g;
  })();
  /* straw and green tufts, batched: no shadows, they would never be seen */
  instanced([{geo:tuftG,mat:std(0x7a6c30,{side:THREE.DoubleSide}),noShadow:true}],tuftsDry);
  instanced([{geo:tuftG,mat:std(0x596426,{side:THREE.DoubleSide}),noShadow:true}],tufts);

  const mounds=[];
  for(let i=0;i<70;i++){
    const a=rnd(0,TAU),d=Math.sqrt(rand())*SAVAN.r*.9;
    const x=SAVAN.x+Math.cos(a)*d,z=SAVAN.z+Math.sin(a)*d,s=rnd(.7,1.5);
    if(!spot(x,z,1.1*s))continue;
    mounds.push({x,y:0,z,s,ry:rnd(0,TAU)});
    solids.push({x,z,r:.9*s});
  }
  const moundG=new THREE.ConeGeometry(1.0,2.0,7);moundG.translate(0,1.0,0);
  instanced([{geo:moundG,mat:std(0x6f5636)}],mounds);

  /* two savanna ant hills, with their own little colonies */
  for(let k=0;k<2;k++){
    let x=0,z=0,ok=false;
    for(let t=0;t<60&&!ok;t++){
      const a=rnd(0,TAU),d=rnd(SAVAN.r*.2,SAVAN.r*.75);
      x=SAVAN.x+Math.cos(a)*d;z=SAVAN.z+Math.sin(a)*d;
      if(spot(x,z,2.2))ok=true;
    }
    if(!ok)continue;
    const fa=rnd(0,TAU),fd=rnd(7,11),fx=x+Math.cos(fa)*fd,fz=z+Math.sin(fa)*fd;
    SAV_HILLS.push({x,z,fx,fz,sav:true});
    const m=cone(1.3,1.0,std(0x5e4830),x,.5,z,9);m.receiveShadow=true;scene.add(m);
    solids.push({x,z,r:1.0});
    const crumbM=std(0xf6ecd2);
    for(let j=0;j<5;j++)scene.add(box(.14,.1,.14,crumbM,fx+rnd(-.35,.35),.05,fz+rnd(-.35,.35)));
  }
}
/* ---------- flowers: low-poly blossom patches on every island ---------- */
function buildFlowers(){
  const groups={
    yellow:{color:0xf2cf3a,center:0x8a5a1f,items:[]},
    white:{color:0xf7f4e4,center:0xd8a53a,items:[]},
    pink:{color:0xe86a9a,center:0x8a4a1f,items:[]},
    blue:{color:0x7a8ef0,center:0xf0d070,items:[]},
    orange:{color:0xf08a2a,center:0x6b3a10,items:[]},
    purple:{color:0xb06ae8,center:0xf0d070,items:[]},
  };
  const flowerSpot=(x,z)=>{
    if(nearSite(x,z,1.5))return false;
    if(nearRiver(x,z,1.5))return false;
    if(nearFarm(x,z,50))return false;
    for(let i=0;i<LAKES.length;i++){
      const L=LAKES[i];
      if(Math.hypot(x-L.x,z-L.z)<L.r+1.2)return false;
    }
    for(let i=0;i<solids.length;i++){
      const s=solids[i];
      if(Math.hypot(s.x-x,s.z-z)<(s.r||.8)+.8)return false;
    }
    return true;
  };
  const push=(x,z,colors)=>{
    if(!flowerSpot(x,z))return;
    const g=groups[colors[(rand()*colors.length)|0]];
    const biome=biomeAt(x,z);
    g.items.push({x,y:biome ? .07 : 0,z,s:rnd(.72,1.3),ry:rnd(0,TAU)});
  };
  const patch=(cx,cz,reach,colors,count)=>{
    for(let t=0;t<10;t++){
      const a=rnd(0,TAU),d=Math.sqrt(rand())*reach;
      const px=cx+Math.cos(a)*d,pz=cz+Math.sin(a)*d;
      if(!flowerSpot(px,pz))continue;
      const R=rnd(2.4,6.8);
      for(let i=0;i<count;i++){
        const aa=rnd(0,TAU),dd=Math.sqrt(rand())*R;
        push(px+Math.cos(aa)*dd,pz+Math.sin(aa)*dd,colors);
      }
      return;
    }
  };
  const HOME=['yellow','yellow','white','pink','blue','purple','yellow','white','pink'];
  for(let i=0;i<18;i++)patch(0,6,20,HOME,16); /* a dense welcome meadow around the spawn */
  for(let i=0;i<360;i++)patch(0,0,54*S,HOME,10);
  const SAV=['yellow','orange','white','pink','purple','yellow'];
  for(let i=0;i<150;i++)patch(SAVAN.x,SAVAN.z,SAVAN.r*.86,SAV,9);
  const DES=['orange','yellow','white','orange'];
  for(let i=0;i<70;i++)patch(DESERT.x,DESERT.z,DESERT.r*.84,DES,6);
  const SNOW=['white','white','blue','purple'];
  for(let i=0;i<50;i++)patch(SNOWZ.x,SNOWZ.z,SNOWZ.r*.84,SNOW,6);

  const stemG=new THREE.CylinderGeometry(.016,.026,.3,5);stemG.translate(0,.15,0);
  const bloomG=new THREE.CylinderGeometry(.115,.025,.09,5);bloomG.translate(0,.34,0);
  const centerG=new THREE.IcosahedronGeometry(.035,0);centerG.translate(0,.395,0);
  Object.keys(groups).forEach(k=>{
    const g=groups[k];
    if(!g.items.length)return;
    instanced([
      {geo:stemG,mat:std(0x4f8a32),noShadow:true},
      {geo:bloomG,mat:std(g.color),noShadow:true},
      {geo:centerG,mat:std(g.center),noShadow:true},
    ],g.items);
  });
}
function buildAnt(){
  const g=new THREE.Group(),c=std(rand()<.5?0x2a1a14:0x8a2a1a),dk=std(0x111111),crumb=std(0xf6ecd2);
  const ab=sph(.075,c,0,.11,-.14,7);ab.scale.set(.9,.8,1.3);g.add(ab);
  g.add(sph(.05,c,0,.11,0,7));g.add(sph(.055,c,0,.115,.11,7));
  [-1,1].forEach(s=>{const a=box(.012,.012,.1,dk,s*.03,.16,.19);a.rotation.y=-s*.4;g.add(a);});
  const legs=[];let k=0;
  [-1,1].forEach(s=>[-.04,0,.04].forEach(z=>{const l=pivot(g,s*.04,.1,z);const seg=box(.1,.012,.012,dk,s*.05,-.03,0);seg.rotation.z=-s*.5;l.add(seg);legs.push({l,k:k++});}));
  const cr=box(.06,.06,.06,crumb,0,.2,.08);cr.visible=false;g.add(cr);
  g.scale.setScalar(.6);g.userData={legs,crumb:cr};return g;
}
function spawnAntOn(h){
  if(!h)return;
  const g=buildAnt(),k=rand();
  g.position.set(h.x+(h.fx-h.x)*k,0,h.z+(h.fz-h.z)*k);scene.add(g);
  ants.push({g,ant:true,held:false,hill:h,out:rand()<.5,carry:false,sp:rnd(.9,1.5),ph:rnd(0,TAU)});
}
function spawnAnt(i){spawnAntOn(HILLS[i%HILLS.length]);}
function releaseAnt(a){
  const g=a.g;g.scale.setScalar(.6);g.rotation.set(0,0,0);
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
  g.position.set(P.x+f.x/fl,0,P.z+f.z/fl);scene.add(g);
  a.held=false;a.out=false;a.carry=false;g.userData.crumb.visible=false;toast('Let go');
}
function updateAnt(a,dt,t){
  const g=a.g,u=g.userData,p=g.position;
  const gait=sp=>u.legs.forEach(L=>{L.l.rotation.y=Math.sin(t*sp+(L.k%2)*Math.PI)*.5;});
  if(a.held){gait(26);g.rotation.y=-1.1+Math.sin(t*5)*.2;return;}
  if(stepKnock(a,dt,t))return;
  const tx=a.out?a.hill.fx:a.hill.x,tz=a.out?a.hill.fz:a.hill.z,dx=tx-p.x,dz=tz-p.z,d=Math.hypot(dx,dz)||1;
  if(d<.35){if(a.out){a.out=false;a.carry=true;}else{a.out=true;a.carry=false;}u.crumb.visible=a.carry;}
  else{const k=a.sp*dt/d,w=Math.sin(t*5+a.ph)*.12*dt;p.x+=dx*k-dz/d*w;p.z+=dz*k+dx/d*w;}
  g.rotation.y+=angDiff(g.rotation.y,Math.atan2(dx,dz))*Math.min(1,dt*8);
  gait(18);
}
function buildBird(){
  const g=new THREE.Group();g.rotation.order='YXZ';
  const cols=[0xc8372d,0x3f7fd0,0x8a6a4a,0xf0c030,0x2a2a30,0xe8e4da];
  const col=cols[Math.floor(rand()*cols.length)],c=std(col),wc=std(col,{roughness:.8}),dk=std(0x222222),org=std(0xf29a2e);
  const body=sph(.2,c,0,.28,0,8);body.scale.set(.9,.9,1.3);g.add(body);
  const head=pivot(g,0,.38,.2);head.add(sph(.12,c,0,.04,.04,8));
  const beak=cone(.04,.14,org,0,.02,.19,4);beak.rotation.x=Math.PI/2;head.add(beak);
  [-1,1].forEach(s=>head.add(sph(.02,dk,s*.07,.07,.12,5)));
  g.add(box(.1,.03,.28,dk,0,.28,-.32));
  [-1,1].forEach(s=>g.add(box(.02,.16,.02,org,s*.06,.08,0)));
  const wings=[];[-1,1].forEach(s=>{const p=pivot(g,s*.15,.32,0);p.add(box(.45,.025,.22,wc,s*.225,0,0));wings.push({p,s});});
  g.scale.setScalar(1.4);g.userData={head,wings};return g;
}
function spawnBird(){
  const g=buildBird(),sp=nearSpot(30,100,6,null,true),fly=rand()<.4;
  g.position.set(sp.x,fly?rnd(6,14):0,sp.z);g.rotation.y=rnd(0,TAU);scene.add(g);
  birds.push({g,bird:true,held:false,ambient:true,state:fly?'fly':'ground',land:false,tx:sp.x,ty:g.position.y,tz:sp.z,sp:rnd(6,9),st:rnd(3,10),ph:rnd(0,TAU),cr:rnd(0,3),eat:0,huntCd:rnd(4,14),prey:null});
}
function birdTarget(b,landing){
  const p=b.g.position;
  for(let i=0;i<20;i++){
    const a=rnd(0,TAU),d=rnd(20,45),x=p.x+Math.cos(a)*d,z=p.z+Math.sin(a)*d;
    if(!b.adminRoam&&Math.hypot(x,z)>52*S)continue;
    if(landing&&solids.some(s=>Math.hypot(s.x-x,s.z-z)<s.r+1.5))continue;
    b.tx=x;b.tz=z;b.ty=landing?0:rnd(6,14);b.land=landing;return;
  }
  b.tx=0;b.tz=0;b.ty=landing?0:10;b.land=false;
}
function setWings(u,t,ph,flap,speed){u.wings.forEach(w=>{w.p.rotation.z=w.s*(flap?Math.sin(t*speed+ph)*.8:-1.2);});}
function releaseBird(b){
  const g=b.g;g.scale.setScalar(1.4);g.rotation.set(0,0,0);
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
  g.position.set(P.x+f.x/fl,1.4,P.z+f.z/fl);g.rotation.y=Math.atan2(f.x,f.z);scene.add(g);
  b.held=false;b.state='fly';birdTarget(b,false);toast('It flies away');
}
/* birds hunt the little things: grasshoppers first, then ants, bees and butterflies */
function birdPreyNear(b){
  const p=b.g.position;
  let best=null,bd=46;
  const consider=(a,kind)=>{
    if(!a||a.held||!a.g.parent)return;
    const q=a.g.position,d=Math.hypot(q.x-p.x,q.z-p.z);
    if(d<bd){bd=d;best={a,kind};}
  };
  hoppers.forEach(a=>consider(a,'grasshopper'));
  ants.forEach(a=>consider(a,'ant'));
  bees.forEach(a=>consider(a,'bee'));
  butterflies.forEach(a=>consider(a,'butterfly'));
  return best;
}
function eatBirdPrey(b,pr){
  const list=pr.kind==='grasshopper'?hoppers:pr.kind==='ant'?ants:pr.kind==='butterfly'?butterflies:bees;
  const i=list.indexOf(pr.a);if(i>=0)list.splice(i,1);
  const q=pr.a.g.position;
  scene.remove(pr.a.g);
  burst(q.x,Math.max(.2,q.y+.1),q.z,pr.kind==='bee'?0xf2c230:pr.kind==='ant'?0x8a2a1a:pr.kind==='butterfly'?0xffb050:0x6ec228,5);
  b.prey=null;b.eat=1.3;b.huntCd=rnd(14,30);
}
function updateBird(b,dt,t){
  const g=b.g,u=g.userData,p=g.position;
  b.cr-=dt;
  if(b.cr<=0){b.cr=b.held?rnd(.9,2):rnd(2,6);
    if(b.held)chirp(.2,0,rnd(2400,3400),3);
    else if(state==='play'){const dx=p.x-P.x,dz=p.z-P.z,d=Math.hypot(dx,dz)||1;chirp(Math.pow(clamp(1-d/30,0,1),2)*.2,(dx*Math.cos(yaw)-dz*Math.sin(yaw))/d,rnd(2400,3400),3);}}
  if(b.held){setWings(u,t,b.ph,true,26);u.head.rotation.x=Math.sin(t*6)*.2;g.rotation.y=-1.1+Math.sin(t*3)*.12;return;}
  if(stepKnock(b,dt,t)){setWings(u,t,b.ph,true,26);return;}
  /* catch a grasshopper, ant or bee if one is close */
  b.huntCd=Math.max(0,(b.huntCd||0)-dt);
  if(b.prey&&(b.prey.a.held||!b.prey.a.g.parent)){b.prey=null;b.huntCd=rnd(4,9);}
  if(!b.prey&&b.huntCd<=0){b.prey=birdPreyNear(b);if(!b.prey)b.huntCd=rnd(3,7);}
  if(b.prey){
    const q=b.prey.a.g.position;
    const dx=q.x-p.x,dy=(q.y+.25)-p.y,dz=q.z-p.z,d=Math.hypot(dx,dy,dz)||1;
    if(Math.hypot(dx,dz)<1.0&&Math.abs(dy)<1.8){eatBirdPrey(b,b.prey);return;}
    const k=Math.min(1,11*dt/d);
    p.x+=dx*k;p.y+=dy*k;p.z+=dz*k;
    setWings(u,t,b.ph,true,24);
    u.head.rotation.x=.3;
    g.rotation.y+=angDiff(g.rotation.y,Math.atan2(dx,dz))*Math.min(1,dt*7);
    g.rotation.x=-Math.asin(clamp(dy/d,-.7,.7));
    return;
  }
  if(b.eat>0){
    b.eat-=dt;setWings(u,t,b.ph,true,26);
    u.head.rotation.x=.3+Math.max(0,Math.sin(t*20+b.ph))*.5;
    if(b.eat<=0&&b.state!=='ground'){b.ty=Math.max(b.ty||0,6);birdTarget(b,false);}
    return;
  }
  if(b.state==='ground'){
    setWings(u,t,b.ph,false,0);g.rotation.x=0;p.y=0;
    u.head.rotation.x=Math.max(0,Math.sin(t*5+b.ph))*.8;
    b.st-=dt;
    const dp=Math.hypot(p.x-P.x,p.z-P.z);
    if(b.st<=0||(state==='play'&&dp<1.5)){b.state='fly';birdTarget(b,false);b.ty=rnd(5,12);}
    return;
  }
  u.head.rotation.x=0;setWings(u,t,b.ph,true,16);
  const dx=b.tx-p.x,dy=b.ty-p.y,dz=b.tz-p.z,d=Math.hypot(dx,dy,dz)||1;
  if(d<.6){
    if(b.land){b.state='ground';b.st=rnd(5,12);p.y=0;g.rotation.x=0;return;}
    birdTarget(b,rand()<.45);
  }else{const k=Math.min(1,b.sp*dt/d);p.x+=dx*k;p.y+=dy*k;p.z+=dz*k;}
  g.rotation.y+=angDiff(g.rotation.y,Math.atan2(dx,dz))*Math.min(1,dt*4);
  g.rotation.x=-Math.asin(clamp(dy/d,-.7,.7));
}

function buildCow(){
  const g=new THREE.Group();
  const white=std(0xf4f1ea),pink=std(0xf2a6b5),dkPatch=rand()<.75?std(0x1c1c1c):std(0x6b3f24),horn=std(0xefe6c8),hoof=std(0x2a2118),eye=std(0x111111);
  g.add(box(1.15,1.1,2.5,white,0,1.45,0));
  for(let i=0;i<4;i++){
    const sd=rand()<.5?-1:1;
    g.add(box(.06,rnd(.3,.6),rnd(.4,.9),dkPatch,sd*.58,rnd(1.25,1.8),rnd(-.9,.9)));
  }
  g.add(box(rnd(.4,.7),.05,rnd(.5,.9),dkPatch,rnd(-.2,.2),2.0,rnd(-.6,.6)));
  const head=pivot(g,0,1.75,1.2);
  head.add(box(.72,.7,.8,white,0,0,.4));
  head.add(box(.52,.38,.3,pink,0,-.15,.88));
  head.add(box(.2,.2,.02,dkPatch,.2,.2,.8));
  [-1,1].forEach(s=>{
    head.add(sph(.07,eye,s*.3,.12,.72,6));
    head.add(cone(.07,.28,horn,s*.3,.5,.2,6));
    const ear=box(.4,.1,.22,white,s*.55,.28,.1);ear.rotation.z=-s*.25;head.add(ear);
    head.add(box(.04,.04,.04,eye,s*.12,-.1,1.04));
  });
  const tail=pivot(g,0,1.9,-1.25);tail.add(box(.1,.9,.1,white,0,-.45,0));tail.add(box(.16,.25,.16,dkPatch,0,-.95,0));tail.rotation.x=.15;
  const udder=sph(.34,pink,0,.92,-.65,8);udder.scale.y=.8;g.add(udder);
  const legs=[];
  [[-.38,.9],[.38,.9],[-.38,-.9],[.38,-.9]].forEach(p=>{const l=pivot(g,p[0],1.0,p[1]);l.add(box(.27,1.0,.27,white,0,-.5,0));l.add(box(.3,.14,.32,hoof,0,-.95,.02));legs.push(l);});
  g.scale.setScalar(.9);
  g.userData={head,tail,legs,udder};
  return shade(g);
}
function buildBull(){
  const g=new THREE.Group();
  const dark=std(0x4b2f22),dark2=std(0x3a2218),snout=std(0xc9a27e),horn=std(0xf3ead0),gold=std(0xe0b030);
  const eyeMat=std(0x111111,{emissive:0xff2200,emissiveIntensity:0});
  g.add(box(2.0,1.7,3.2,dark,0,2.0,0));
  g.add(box(1.9,.9,1.4,dark2,0,3.0,.9));
  const head=pivot(g,0,2.4,2.3);
  head.add(box(1.2,1.2,1.3,dark,0,0,0));
  head.add(box(.9,.6,.5,snout,0,-.3,.8));
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.18,.045,6,12),gold);ring.position.set(0,-.55,1.05);head.add(ring);
  [-1,1].forEach(s=>{
    const e=sph(.12,eyeMat,s*.48,.2,.55,6);e.userData.eye=true;head.add(e);
    const h1=cone(.18,.9,horn,s*.8,.55,0,6);h1.rotation.z=-s*1.15;head.add(h1);
    const h2=cone(.13,.6,horn,s*1.25,.95,.05,6);h2.rotation.z=-s*.35;head.add(h2);
    const ear=box(.45,.1,.28,dark2,s*.75,.3,-.2);ear.rotation.z=-s*.35;head.add(ear);
  });
  const legs=[];
  [[-.7,1.1],[.7,1.1],[-.7,-1.1],[.7,-1.1]].forEach(p=>{const l=pivot(g,p[0],1.2,p[1]);l.add(box(.5,1.2,.5,dark2,0,-.6,0));l.add(box(.54,.2,.56,std(0x1c1109),0,-1.1,0));legs.push(l);});
  const tail=box(.15,1.2,.15,dark2,0,2.4,-1.75);tail.rotation.x=.3;g.add(tail);
  g.userData={head,legs,eyeMat};
  return shade(g);
}
const HS=.06;
const BUG_PALETTES={
  green:{body:0x60c62b,body2:0x4aa51f,light:0x8cdc43,lt:0xa9e75c,pale:0xd6f394,dark:0x2a7316,leg:0x58b328,joint:0x235f10,wing:0x4ba922},
  brown:{body:0x9a6b32,body2:0x7d5525,light:0xbd8d4d,lt:0xd0a76c,pale:0xe0c58e,dark:0x4f3515,leg:0xa57538,joint:0x3f2a10,wing:0x8a5a28},
  orange:{body:0xe08a2a,body2:0xc4731c,light:0xf2ad52,lt:0xf7c477,pale:0xffd79a,dark:0x8a4a10,leg:0xd9842a,joint:0x6d390b,wing:0xc97620},
  yellow:{body:0xe0c23a,body2:0xc4a92a,light:0xf2dc72,lt:0xf7e89a,pale:0xfff1ae,dark:0x7a6510,leg:0xd6b632,joint:0x63500c,wing:0xc9a92c},
  pink:{body:0xe86a9a,body2:0xcf5585,light:0xf59ab8,lt:0xf7b4ca,pale:0xffcfe0,dark:0x8a2f50,leg:0xe2749c,joint:0x71243f,wing:0xd45a88},
};
function pickBugPalette(locust){
  const r=rand();
  if(locust)return r<.30?'yellow':r<.60?'orange':r<.80?'brown':r<.95?'green':'pink';
  return r<.40?'green':r<.65?'brown':r<.85?'orange':r<.95?'yellow':'pink';
}
function buildHopper(opts){
  const locust=!!(opts&&opts.locust);
  const pal=BUG_PALETTES[(opts&&opts.palette)||pickBugPalette(locust)];
  const g=new THREE.Group(),b=new THREE.Group();g.add(b);const wings=[],hl=[];
  const green=std(pal.body),green2=std(pal.body2),bodyLt=std(pal.light),lt=std(pal.lt),pale=std(pal.pale),
        dk=std(pal.dark),leg=std(pal.leg),jointC=std(pal.joint),
        eyeM=std(0x0b2030,{roughness:.45,metalness:.1}),
        wingM=std(pal.wing,{side:THREE.DoubleSide});

  /* blocky segmented abdomen, tapering to a blunt tail */
  b.add(box(1.52,1.16,1,green,0,1.52,-.55));
  b.add(box(1.36,1.05,.96,green,0,1.47,-1.43));
  b.add(box(1.14,.9,.86,green,0,1.42,-2.22));
  b.add(box(.82,.64,.64,green2,0,1.34,-2.85));
  /* lighter top plates and dark seams give the segmented shell */
  b.add(box(1.44,.06,.82,bodyLt,0,2.12,-.55));
  b.add(box(1.28,.06,.78,bodyLt,0,2.01,-1.43));
  b.add(box(1.04,.06,.68,bodyLt,0,1.88,-2.22));
  b.add(box(1.48,.08,.15,dk,0,2.15,-1.02));
  b.add(box(1.32,.08,.15,dk,0,2.04,-1.92));
  b.add(box(1.08,.08,.15,dk,0,1.91,-2.6));

  /* thorax and neck */
  b.add(box(1.54,1.2,1.18,green,0,1.54,.38));
  b.add(box(1.48,.07,.94,dk,0,2.16,.35));
  b.add(box(1.02,.9,.72,green2,0,1.58,1.12));

  /* head: broad wedge, huge faceted eye, swept-back antennae */
  const headGrp=pivot(b,0,1.7,1.7);
  headGrp.add(box(1.18,1.02,1.1,green,0,0,0));
  headGrp.add(box(.92,.48,.6,green2,0,-.32,.42));
  headGrp.add(box(.56,.12,.22,dk,0,-.55,.6));
  [-1,1].forEach(s=>{
    const eye=cyl(.37,.37,.07,eyeM,s*.6,.06,.18,6);
    eye.rotation.z=Math.PI/2;
    headGrp.add(eye);
    const ant=pivot(headGrp,s*.3,.5,.18);
    ant.rotation.x=-.45;ant.rotation.z=-s*.16;
    headGrp.add(ant);
    ant.add(box(.085,1.04,.085,green2,0,.52,0));
    const tip=pivot(ant,0,1.04,0);tip.rotation.x=-.35;ant.add(tip);
    tip.add(box(.07,.8,.07,lt,0,.4,0));
  });

  /* folded wings: slim, dark-edged covers along the back; locusts get a long tip */
  const wingLen=locust?3.7:2.6,wingW=locust?.5:.46;
  [-1,1].forEach(s=>{
    const wing=pivot(b,s*.37,2.17,.2);
    wing.rotation.y=s*.04;wing.rotation.x=-.02;
    wing.add(box(wingW,.09,wingLen,wingM,0,0,-wingLen/2));
    wing.add(box(wingW+.06,.05,wingLen,dk,0,.07,-wingLen/2));
    if(locust){
      wing.add(box(wingW*.72,.07,wingLen*.42,wingM,0,.01,-wingLen*1.18));
      wing.add(box(wingW*.78,.045,wingLen*.42,dk,0,.075,-wingLen*1.18));
    }
    b.add(wing);wings.push(wing);
  });

  /* four small legs, bent and splayed out at the sides */
  const mkLeg=(s,z,tilt,bend)=>{
    const hip=pivot(b,s*.72,1.08,z);
    hip.rotation.x=tilt;hip.rotation.z=-s*.22;b.add(hip);
    hip.add(box(.16,.6,.16,green2,0,-.3,0));
    const knee=pivot(hip,0,-.6,0);
    knee.rotation.x=bend;knee.add(box(.13,.6,.13,leg,0,-.3,0));
    knee.add(box(.2,.1,.36,dk,0,-.62,.11));
  };
  [-1,1].forEach(s=>{
    mkLeg(s,1.15,-.55,.95);
    mkLeg(s,.38,.18,.55);
  });

  /* oversized hind legs: thick striped femur, long tibia, blocky knee */
  [-1,1].forEach(s=>{
    const t=pivot(b,s*.82,1.54,-.28);t.rotation.x=1.1;b.add(t);
    t.add(box(.58,.7,1.55,green,0,0,-.75));
    t.add(box(.05,.38,1.28,pale,s*.3,.03,-.75));
    t.add(box(.6,.08,1.55,dk,0,-.34,-.75));
    t.add(box(.66,.66,.66,jointC,0,0,-1.56));
    const sh=pivot(t,0,0,-1.58);sh.rotation.x=-.85;t.add(sh);
    sh.add(box(.27,3.05,.27,leg,0,-1.525,0));
    sh.add(box(.05,2.2,.12,lt,s*.15,-1.2,0));
    sh.add(box(.46,.18,.8,dk,0,-3,.2));
    hl.push({t,sh});
  });

  const baseScale=HS*(locust?1.2:1);
  g.scale.setScalar(baseScale);
  g.userData={b,hl,wings,head:headGrp,locust,baseScale};
  return shade(g);
}

/* ---------- state ---------- */
let state='menu';
let godMode=false,adminUnlocked=false,adminFly=false,adminLift=false,adminOneShot=false;
const P={x:0,z:6,kx:0,kz:0,walkT:0,holding:null,ride:null,bump:0,sw:0,inW:false,jy:0,jv:0,fl:0,hp:10,hunger:10,punchT:0,starve:0,hungerWarn:false,sword:false,swordIdx:0,swordDmg:6,baseY:0,floor:0,tower:-1,lift:null,tornado:null,tornadoCool:0,
  armorName:'Traveler Clothes',armorRed:0,relics:new Set(),swords:new Set(),realm:null,pniCp:0,pniCpAt:null,realmGround:false,pniSupport:null,portalCool:0,lastPortalF:0};
const keys={};let fireHeld=false;const joy={x:0,y:0};
let yaw=0,pitch=-0.08;
let cows=[],bulls=[],hoppers=[],parts=[];
let toastT=0,clock=0;

/* ---------- multiplayer state ---------- */
let net=null;
let netRole=boot && boot.role ? boot.role : 'solo';
let netSelfId=boot && boot.peerId ? boot.peerId : null;
let netSelfName=(boot && boot.name) || 'You';
let netHostPeerId=boot && boot.hostPeerId ? boot.hostPeerId : null;
let netConnected=false;
let netInputT=0;
let netSnapT=0;
let netSeq=0;
let cmdSeq=0;
let netLastSnapTick=0;
let netWorldChecksum='';
let inviteOpen=false;
let netWelcome=null;
let netReconnectAttempts=0;
let netReconnectTimer=null;
let netLeaving=false;
let netEverOpen=false;
let netPing=null;
let netStatusT=0;
let netUnloadWired=false;
let netRestarting=false;
let netFatal=false;
const netRemotes=new Map(); /* id -> actor { id, name, x, z, ... } */
const netRoster=new Map();  /* id -> { id, name, host } */

/* Small read-only debug surface used by the browser integration test and by
   developers inspecting a live room from DevTools. */
if(typeof window!=='undefined'){
  window.__GH_NET__={
    get role(){return netRole;},
    get state(){return state;},
    get connected(){return netConnected;},
    get room(){return boot?boot.room:null;},
    get self(){return netSelfId;},
    get hostPeer(){return netHostPeerId;},
    get seed(){return worldSeed;},
    get checksum(){return netWorldChecksum;},
    get ping(){return netPing;},
    get reconnecting(){return netReconnectTimer!=null;},
    get reconnectAttempts(){return netReconnectAttempts;},
    get peers(){return net?Array.from(net.peers.keys()):[];},
    get remoteCount(){return netRemotes.size;},
    get remotes(){return Array.from(netRemotes.values()).map(a=>{
      const u=a.avatar&&a.avatar.userData;
      return {id:a.id,name:a.name,g:a.gender||'unknown',avatarGender:u?u.gender:null,
        x:a.x,y:a.y,z:a.z,yaw:a.yaw,seq:a.seq,inputAge:a.inputT,
        walkT:a.walkT,netSpeed:a.netSpeed,legX:u&&u.legs?u.legs[0].hip.rotation.x:null,
        armX:u&&u.arms?u.arms[0].sh.rotation.x:null,
        held:!!a.held,ride:!!a.ride,scale:a.avatar?a.avatar.scale.x:null};
    });},
    get counters(){return net?{sent:net.sentMessages,received:net.receivedMessages,relay:net.relayMode,opened:net.opened,pendingRelay:net.pendingRelay,relayPoll:!!net.relayPollTimer,relayBusy:net.relayBusy,relayFailures:net.relayFailures,lastRelayError:net.lastRelayError}:null;},
    get recent(){return net?net.recent:[];},
    get welcome(){return !!netWelcome;},
    get keys(){return {...keys};},
    get dayT(){return dayT;},
    /* world layout used by the browser integration test */
    get world(){return {
      bridges:BRIDGES.map(b=>({x:b.x,z:b.z,yaw:b.yaw,len:b.len,wid:b.wid})),
      biomeCities:BIOME_CITIES.map(c=>({biome:c.biome,kind:c.kind,x:c.x,z:c.z,clear:c.clear})),
      homeCities:HOME_CITIES.map(c=>({kind:c.kind,x:c.x,z:c.z})),
      biomes:Object.fromEntries(Object.entries(BIOME_BY_NAME).map(([k,B])=>[k,{x:B.x,z:B.z,r:B.r}])),
      rivers:RIVERS.map(R=>({w:R.w,biome:R.biome||null,pts:R.pts.map(p=>[p[0],p[1]])})),
      villages:HOMES.filter(h=>h.role==='villager').map(h=>({x:h.x,z:h.z,biome:h.biome||null})),
    };},
    /* water/bridge probe used by the browser integration test */
    probeBridge(x,z){
      x=Number(x);z=Number(z);
      const onDeck=!!bridgeAt(x,z);
      return {onDeck,water:(!!lakeAt(x,z)||riverAt(x,z))&&!onDeck};
    },
    sendInput(ax=0,ay=0,btn=0){
      if(netRole!=='client'||!net||!netConnected)return false;
      return net.send(CHANNEL.STATE,{
        t:MSG.INPUT,seq:++netSeq,
        ax:+clamp(Number(ax)||0,-1,1).toFixed(3),
        ay:+clamp(Number(ay)||0,-1,1).toFixed(3),
        yaw:+yaw.toFixed(3),pitch:+pitch.toFixed(3),
        btn:Number(btn)||0,g:playerGender,
        sw:+P.sw.toFixed(2),h:P.holding?1:0,rd:P.ride?1:0,pt:+P.punchT.toFixed(3),
      },true);
    },
    /* deterministic animation tick for the browser integration test */
    tickRemotes(dt=.05){
      updateRemoteAvatars(clamp(Number(dt)||.05,.001,.1));
      return Array.from(netRemotes.values()).map(a=>({
        id:a.id,walkT:a.walkT,netSpeed:a.netSpeed,
        legX:a.avatar&&a.avatar.userData.legs?a.avatar.userData.legs[0].hip.rotation.x:null,
        armX:a.avatar&&a.avatar.userData.arms?a.avatar.userData.arms[0].sh.rotation.x:null,
      }));
    },
    get focus(){return {hasFocus:typeof document!=='undefined'&&document.hasFocus(),active:typeof document!=='undefined'&&document.activeElement&&document.activeElement.id};},
    get entityCount(){return entitiesById.size;},
    get player(){return {x:P.x,y:P.baseY+P.jy,z:P.z,yaw};},
    get thirdPerson(){return thirdPerson;},
    get avatarVisible(){return avatar.visible;},
    get gender(){return playerGender;},
    get debug(){
      if(!net)return null;
      const channel=(link,label)=>link&&link.channels&&link.channels[label]?link.channels[label].readyState:null;
      if(netRole==='host'){
        return {role:'host',peers:Array.from(net.peers.values()).map(p=>({
          id:p.id,open:p.open,
          relay:!!p.relay,
          pc:p.link&&p.link.pc?p.link.pc.connectionState:null,
          ice:p.link&&p.link.pc?p.link.pc.iceConnectionState:null,
          ctrl:channel(p.link,'ctrl'),state:channel(p.link,'state'),
        }))};
      }
      return {role:'client',relay:net.relayMode,link:net.link?{
        pc:net.link.pc.connectionState,ice:net.link.pc.iceConnectionState,
        ctrl:channel(net.link,'ctrl'),state:channel(net.link,'state'),
      }:null,polling:!!net.pollTimer};
    },
  };
}
const entitiesById=new Map();
let nextEntityId=1;
function newEntityId(prefix='e'){return prefix+'_'+(nextEntityId++);}
function registerEntity(e,netType){
  if(!e)return e;
  if(!e.id)e.id=newEntityId();
  e.netType=netType||e.netType||'entity';
  entitiesById.set(e.id,e);
  return e;
}

/* ---------- collection: field notes ---------- */
const FOUND_TOTAL=27;
const found=new Set();
function speciesOf(h){
  if(h.hopper)return 'grasshopper';
  if(h.fish)return 'fish';
  if(h.bee)return 'bee';
  if(h.bird)return 'bird';
  if(h.ant)return 'ant';
  if(h.cow)return 'cow';
  if(h.bull)return 'bull';
  if(h.pet)return h.kind;
  return null;
}
function updateFound(){const n=found.size;$('foundN').textContent=n+'/'+FOUND_TOTAL;$('foundPill').classList.toggle('done',n>=FOUND_TOTAL);}
const HEART_MAX=10;
function updateHearts(){
  const el=$('hearts');
  if(el.children.length!==HEART_MAX){el.innerHTML='';for(let i=0;i<HEART_MAX;i++){const s=document.createElement('span');s.className='ht';s.textContent='♥';el.appendChild(s);}}
  const hp=Math.max(0,P.hp||0);
  for(let i=0;i<HEART_MAX;i++)el.children[i].classList.toggle('off',i>=hp);
  const fill=$('hpFill');
  if(fill){fill.style.width=(clamp(hp/HEART_MAX,0,1)*100)+'%';fill.parentElement.classList.toggle('low',hp<=3);}
  const n=$('hpN');if(n)n.textContent=Math.ceil(hp)+'/'+HEART_MAX;
}
/* ---------- hunger ---------- */
const HUNGER_MAX=10;
const HUNGER_DRAIN=26;      /* seconds of play per hunger point */
const STARVE_TICK=3.4;      /* seconds between heart losses once starving */
function updateHunger(){
  const el=$('hunger');
  if(el.children.length!==HUNGER_MAX){
    el.innerHTML='';
    for(let i=0;i<HUNGER_MAX;i++){const s=document.createElement('span');s.className='hg';el.appendChild(s);}
  }
  const h=clamp(P.hunger==null?HUNGER_MAX:P.hunger,0,HUNGER_MAX);
  for(let i=0;i<HUNGER_MAX;i++){
    const c=el.children[i];
    c.classList.toggle('off',i>=Math.ceil(h));
    c.classList.toggle('low',h<=3&&i<Math.ceil(h));
  }
  const fill=$('foodFill');
  if(fill){fill.style.width=(h/HUNGER_MAX*100)+'%';fill.parentElement.classList.toggle('low',h<=3);}
  const n=$('foodN');if(n)n.textContent=h.toFixed(1)+'/'+HUNGER_MAX;
}
function starve(n){
  if(P.hp<=0)return;
  const fl=$('flash');fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),120);
  toast('You are starving! Eat something!');
  hurt(n,'starve');
}
function markFound(sp){
  if(!sp||found.has(sp))return false;
  found.add(sp);updateFound();return true;
}
(function initHud(){
  updateFound();updateHearts();updateHunger();
})();

const PLAYER_GENDERS={
  unknown:{skin:0xb9b6c4,knuck:0xa7a3b4,sleeve:0x5a4b7a,cuff:0x463a61},
  female:{skin:0xf2c7a5,knuck:0xe3b18c,sleeve:0xd85c8a,cuff:0xb64b74},
  male:{skin:0xe9b98e,knuck:0xddab7e,sleeve:0x3f6d4a,cuff:0x2f5639}
};
let playerGender='unknown';
const pHandM=std(0xf0c49a),pSkinM=std(0xe9b98e),pKnuckM=std(0xddab7e),pSleeveM=std(0x3f6d4a),pCuffM=std(0x2f5639);
/* shared question-mark badge: worn on the fist and on the avatar's chest */
const qBadgeMat=(function(){
  const qc=document.createElement('canvas');qc.width=qc.height=128;
  const qg=qc.getContext('2d');
  qg.clearRect(0,0,128,128);
  qg.fillStyle='#2c2340';qg.beginPath();qg.arc(64,64,58,0,Math.PI*2);qg.fill();
  qg.strokeStyle='#fff7dc';qg.lineWidth=15;qg.lineCap='round';
  qg.beginPath();qg.arc(64,50,25,Math.PI*1.08,Math.PI*2.42);qg.stroke();
  qg.beginPath();qg.moveTo(64,72);qg.lineTo(64,88);qg.stroke();
  qg.fillStyle='#fff7dc';qg.beginPath();qg.arc(64,105,8,0,Math.PI*2);qg.fill();
  return new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(qc),transparent:true,depthWrite:false,side:THREE.DoubleSide});
})();
/* tiled question marks for the unknown avatar: the whole body is covered in them */
const qPatternTex=(function(){
  const c=document.createElement('canvas');c.width=c.height=256;
  const g=c.getContext('2d');
  g.fillStyle='#4a3d68';g.fillRect(0,0,256,256);
  g.fillStyle='#e6e0f4';g.textAlign='center';g.textBaseline='middle';
  g.font='900 104px Arial Black,Arial,sans-serif';
  [[46,48],[160,48],[103,128],[210,128],[46,208],[160,208]].forEach(p=>g.fillText('?',p[0],p[1]));
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  return t;
})();
/* ---------- player avatar factory (local player + every remote player) ---------- */
/* Each avatar gets its own materials so changing one player's gender or colour
   never repaints anybody else. */
function avatarMaterials(key){
  const c=PLAYER_GENDERS[key]||PLAYER_GENDERS.unknown;
  const unknown=key==='unknown';
  const body=hex=>{
    const m=std(unknown?0xffffff:hex);
    if(unknown){m.map=qPatternTex;m.needsUpdate=true;}
    return m;
  };
  return {
    head:body(key==='male'?0xffcc4d:c.skin),
    skin:body(c.skin),shirt:body(c.sleeve),pants:body(c.cuff),shoe:body(0x241c16),
    hair:std(0x35251a),hat:std(0x8a5a2b),hatBand:std(0x4a2f18),cheek:std(0xe88a8a),
    eye:std(0x16120e),mouth:std(0x9a5a4a),
  };
}
function applyAvatarLook(g,key){
  const k=PLAYER_GENDERS[key]?key:'unknown';
  const u=g.userData;
  if(!u||!u.mats)return;
  const c=PLAYER_GENDERS[k],m=u.mats,unknown=k==='unknown';
  /* the girl is the same height as the villagers */
  g.scale.setScalar(k==='female'?.82:.94);
  [['skin',c.skin],['head',k==='male'?0xffcc4d:c.skin],['shirt',c.sleeve],['pants',c.cuff],['shoe',0x241c16]].forEach(pair=>{
    const mat=m[pair[0]];
    mat.map=unknown?qPatternTex:null;
    mat.color.setHex(unknown?0xffffff:pair[1]);
    mat.needsUpdate=true;
  });
  u.gender=k;
  u.hairTop.visible=u.hairBack.visible=u.sideHairL.visible=u.sideHairR.visible=k==='female';
  u.hat.visible=k==='male';
  /* villagers have a simple dot-eye face; the girl shares the boy's face */
  u.eyes.forEach(e=>{e.visible=!unknown;});
  u.brows.forEach(b=>{b.visible=false;});
  u.ears.forEach(e=>{e.visible=!unknown;});
  u.nose.visible=false;
  u.mouth.visible=false;
  u.smile.visible=false;
  u.cheeks.forEach(ch=>{ch.visible=false;});
  u.faceBadge.visible=unknown;
  u.chestBadge.visible=unknown;
}
function buildPlayerAvatar(key){
  const g=new THREE.Group();
  const m=avatarMaterials(key);
  g.add(box(.58,.74,.32,m.shirt,0,1.44,0));
  g.add(box(.62,.1,.34,m.pants,0,1.08,0));
  const head=pivot(g,0,2.02,0);
  head.add(sph(.23,m.head,0,0,.02,8));
  const nose=sph(.04,m.head,0,-.03,.23,5);head.add(nose);
  /* a hair cap that reaches the forehead, leaving the face open */
  const hairTop=new THREE.Mesh(new THREE.SphereGeometry(.245,8,6,0,Math.PI*2,0,Math.acos(.13/.245)),m.hair);
  hairTop.position.set(0,0,.02);head.add(hairTop);
  const hairBack=box(.36,.68,.14,m.hair,0,-.2,-.16);head.add(hairBack);
  const sideHairL=box(.08,.5,.12,m.hair,-.21,-.14,-.01);head.add(sideHairL);
  const sideHairR=box(.08,.5,.12,m.hair,.21,-.14,-.01);head.add(sideHairR);
  /* the male's hat: no hair, just a brimmed straw hat */
  const hat=new THREE.Group();
  hat.add(cyl(.34,.34,.05,m.hat,0,.22,0,8));
  hat.add(cyl(.17,.2,.18,m.hat,0,.32,0,8));
  hat.add(cyl(.205,.205,.05,m.hatBand,0,.25,0,8));
  head.add(hat);
  const eyes=[],brows=[],ears=[];
  [-1,1].forEach(s=>{
    const eye=sph(.028,m.eye,s*.085,.05,.205,6);head.add(eye);eyes.push(eye);
    const brow=box(.1,.022,.02,m.hair,s*.085,.115,.19);head.add(brow);brows.push(brow);
    const e=sph(.045,m.head,s*.225,-.01,0,6);e.scale.set(.5,1,.7);head.add(e);ears.push(e);
  });
  const mouth=box(.08,.02,.02,m.mouth,0,-.12,.208);head.add(mouth);
  /* the male's emoji smile and rosy cheeks */
  const smile=new THREE.Mesh(new THREE.TorusGeometry(.075,.012,6,8,Math.PI),m.mouth);
  smile.position.set(0,-.055,.216);smile.rotation.z=Math.PI;head.add(smile);
  const cheeks=[];
  [-1,1].forEach(s=>{
    const ch=sph(.055,m.cheek,s*.135,-.04,.198,8);ch.scale.set(1,.6,.35);head.add(ch);cheeks.push(ch);
  });
  /* the unknown's face is one big question mark */
  const faceBadge=new THREE.Mesh(new THREE.PlaneGeometry(.3,.3),qBadgeMat);
  faceBadge.position.set(0,.02,.255);head.add(faceBadge);
  const arms=[];
  [-1,1].forEach(s=>{
    const sh=pivot(g,s*.38,1.72,0);
    sh.add(box(.15,.44,.17,m.shirt,0,-.22,0));
    const el=pivot(sh,0,-.44,0);
    el.add(box(.13,.36,.14,m.shirt,0,-.18,0));
    el.add(box(.145,.14,.15,m.skin,0,-.4,0));
    arms.push({sh,el});
  });
  const legs=[];
  [-1,1].forEach(s=>{
    const hip=pivot(g,s*.16,1.06,0);
    hip.add(box(.18,.5,.19,m.pants,0,-.25,0));
    const knee=pivot(hip,0,-.5,0);
    knee.add(box(.155,.44,.16,m.pants,0,-.22,0));
    knee.add(box(.2,.11,.31,m.shoe,0,-.465,.06));
    legs.push({hip,knee});
  });
  const chestBadge=new THREE.Mesh(new THREE.PlaneGeometry(.21,.21),qBadgeMat);
  chestBadge.position.set(0,1.5,.171);
  chestBadge.visible=false;
  g.add(chestBadge);
  g.userData={gender:key,mats:m,head,hairTop,hairBack,sideHairL,sideHairR,hat,eyes,brows,ears,nose,mouth,smile,cheeks,faceBadge,arms,legs,chestBadge,px:null,pz:null};
  applyAvatarLook(g,key);
  return shade(g);
}

const hand=new THREE.Group();hand.position.set(.32,-.34,-.62);hand.visible=false;camera.add(hand);
/* the carried object hangs in front of the camera at its real size */
const carry=new THREE.Group();camera.add(carry);
(function(){
  hand.add(box(.26,.06,.3,pHandM,0,-.06,.02));
  const th=box(.07,.07,.2,pHandM,-.15,-.03,-.02);th.rotation.y=.5;hand.add(th);
  for(let i=0;i<4;i++){const f=box(.05,.05,.17,pHandM,-.09+i*.055,-.04,-.2);f.rotation.x=.25;hand.add(f);}
})();

/* ---------- the fist: your bare hand, ready to punch ---------- */
const fist=new THREE.Group();fist.position.set(.30,-.34,-.62);fist.visible=false;camera.add(fist);
(function(){
  const arm=box(.19,.19,.5,pSkinM,0,0,.22);fist.add(arm);
  fist.add(box(.235,.235,.13,pCuffM,0,0,.44));
  fist.add(box(.26,.26,.1,pSleeveM,0,0,.53));
  const h=new THREE.Group();h.position.set(0,.02,-.04);fist.add(h);
  h.add(box(.25,.22,.2,pSkinM,0,0,0));
  for(let i=0;i<4;i++){
    const k=box(.058,.085,.09,pKnuckM,-.078+i*.052,.045,-.12);
    k.rotation.x=.12;h.add(k);
  }
  const thumb=box(.075,.13,.13,pSkinM,.125,-.01,-.03);thumb.rotation.z=-.2;h.add(thumb);
  /* the unknown skin wears a question mark on the back of the hand */
  const badge=new THREE.Mesh(new THREE.PlaneGeometry(.15,.15),qBadgeMat);
  badge.name='qBadge';
  badge.position.set(0,.137,-.04);badge.rotation.x=-1.15;
  fist.add(badge);
})();
const fistLeft=fist.clone(true);
fistLeft.name='leftHand';
fistLeft.scale.x=-1;
fistLeft.position.set(-.30,-.34,-.62);
fistLeft.visible=false;
camera.add(fistLeft);
/* keep the question mark readable after the left fist is mirrored */
{const b=fistLeft.getObjectByName('qBadge');if(b)b.scale.x=-1;}

/* ---------- third-person avatar (F3) ---------- */
const avatar=buildPlayerAvatar('unknown');
avatar.visible=false;
scene.add(avatar);
/* held objects hang beside the avatar's right hand in third person */
const avatarHold=new THREE.Group();
avatarHold.position.set(.42,1.4,.7);
avatar.add(avatarHold);

/* F3: first person <-> third person, where you can see your avatar */
let thirdPerson=false;
function avatarStandY(){
  if(P.ride){
    const a=P.ride;
    return a.g.position.y+(a.bull?1.85:a.kind==='camel'?1.05:.78);
  }
  return P.baseY+P.jy-.95*P.sw;
}
function poseAvatar(u,o){
  if(!u||!u.arms||!u.legs)return;
  o=o||{};
  const w=o.walkT||0,punch=o.punch||0;
  if(o.ride){
    u.legs.forEach((l,i)=>{l.hip.rotation.x=-1.15;l.knee.rotation.x=1.15;l.hip.rotation.z=i?-.12:.12;});
    u.arms.forEach((a,i)=>{a.sh.rotation.x=-.45;a.el.rotation.x=-.35;a.sh.rotation.z=i?.16:-.16;});
    u.head.rotation.x=.08;
  }else if(o.jump){
    u.legs.forEach((l,i)=>{l.hip.rotation.x=i?.35:-.35;l.knee.rotation.x=.6;l.hip.rotation.z=0;});
    u.arms.forEach((a,i)=>{a.sh.rotation.x=-.9;a.el.rotation.x=-.45;a.sh.rotation.z=i?.2:-.2;});
    u.head.rotation.x=0;
  }else{
    const amp=(o.mv||0)*.62;
    u.legs.forEach((l,i)=>{
      const ph=w+(i?Math.PI:0);
      l.hip.rotation.x=Math.sin(ph)*amp;
      l.knee.rotation.x=Math.max(0,Math.sin(ph))*amp*.9;
      l.hip.rotation.z=0;
    });
    u.arms.forEach((a,i)=>{
      const ph=w+(i?0:Math.PI);
      a.sh.rotation.x=-Math.sin(ph)*amp*.8;
      a.el.rotation.x=-.12-Math.abs(Math.sin(ph))*.2;
      a.sh.rotation.z=i?.06:-.06;
    });
    u.head.rotation.x=0;
  }
  if(punch>0&&!o.ride){
    u.arms[1].sh.rotation.x=-1.3*punch;
    u.arms[1].el.rotation.x=-.5*punch;
  }
  if(o.hold&&!o.ride){
    u.arms.forEach(a=>{a.sh.rotation.x=-1.15;a.el.rotation.x=-.25;});
  }
}
function updateAvatar(dt){
  if(!thirdPerson||state!=='play'){avatar.visible=false;return;}
  avatar.visible=true;
  const u=avatar.userData;
  avatar.position.set(P.x,avatarStandY(),P.z);
  avatar.rotation.y=P.ride?P.ride.g.rotation.y:yaw+Math.PI;
  const mv=Math.min(1,Math.hypot(P.x-(u.px??P.x),P.z-(u.pz??P.z))/Math.max(dt,.001)/4.5);
  u.px=P.x;u.pz=P.z;
  const punch=P.punchT>0?Math.sin((1-P.punchT/.32)*Math.PI):0;
  poseAvatar(u,{
    walkT:P.walkT,mv,punch,
    ride:!!P.ride,jump:P.jy>.05||P.sw>.15,hold:!!P.holding,
  });
}
function toggleThirdPerson(){
  if(state!=='play')return;
  thirdPerson=!thirdPerson;
  avatar.visible=thirdPerson;
  syncHeldView();
  toast(thirdPerson?'Third person — press F3 to see through your eyes again':'First person');
}


function applyPlayerGender(g){
  const key=PLAYER_GENDERS[g]?g:'unknown';
  playerGender=key;
  const c=PLAYER_GENDERS[key];
  pHandM.color.setHex(c.skin);
  pSkinM.color.setHex(c.skin);
  pKnuckM.color.setHex(c.knuck);
  pSleeveM.color.setHex(c.sleeve);
  pCuffM.color.setHex(c.cuff);
  [fist,fistLeft].forEach(f=>{const b=f.getObjectByName('qBadge');if(b)b.visible=key==='unknown';});
  applyAvatarLook(avatar,key);
  document.querySelectorAll('.genderBtn').forEach(b=>{
    const on=b.getAttribute('data-gender')===key;
    b.classList.toggle('on',on);
    b.setAttribute('aria-pressed',on?'true':'false');
  });
  if(netSelfId)netRoster.set(netSelfId,{id:netSelfId,name:netSelfName,host:netRole==='host',gender:key});
  netInputT=0; /* send the new appearance with the next input tick */
  if(inviteOpen)refreshInvite();
  try{localStorage.setItem('grasshopperGender',key);}catch(_){}
}
(function wirePlayerGender(){
  document.querySelectorAll('.genderBtn').forEach(b=>b.addEventListener('click',()=>applyPlayerGender(b.getAttribute('data-gender'))));
  let saved='unknown';
  try{saved=localStorage.getItem('grasshopperGender')||'unknown';}catch(_){}
  applyPlayerGender(saved);
})();

/* ---------- loot swords: one blade is drawn, thirty are hidden in chests ---------- */
const SWORD_DEFS=[
  {name:'Rusty Shortsword',   dmg:6,  col:0x9a6b45},
  {name:'Wooden Practice Blade',dmg:5,col:0xb98a4a},
  {name:"Farmer's Machete",   dmg:8,  col:0x9aa0a6},
  {name:"Hunter's Knife",     dmg:10, col:0xc9a24a},
  {name:'Iron Sword',         dmg:12, col:0xb8c4cc},
  {name:'Steel Saber',        dmg:15, col:0xd7e2e8},
  {name:'Twin Fang',          dmg:18, col:0xe8eef2},
  {name:'Bone Cleaver',       dmg:22, col:0xe6dcc0},
  {name:'Copper Edge',        dmg:26, col:0xd08a4a},
  {name:'Obsidian Blade',     dmg:30, col:0x4a3f5a},
  {name:'Frostfang',          dmg:36, col:0x9adcf0},
  {name:'Sandreaver',         dmg:40, col:0xe0b060},
  {name:'Cactus Spine',       dmg:44, col:0x6fae4a},
  {name:'Storm Saber',        dmg:48, col:0x8ab6f0},
  {name:'Ember Blade',        dmg:52, col:0xff7a3a},
  {name:'Glacier Edge',       dmg:56, col:0xbfefff},
  {name:'Mirage Sword',       dmg:60, col:0xf0d080},
  {name:'Thunderclap',        dmg:65, col:0xffe066},
  {name:'Nightfall',          dmg:70, col:0x7a6ad0},
  {name:'Bloodstone',         dmg:75, col:0xd03a3a},
  {name:'Sunspear',           dmg:80, col:0xffb020},
  {name:'Mooncleaver',        dmg:85, col:0xc0d8ff},
  {name:'Voidreaver',         dmg:90, col:0x9a5aff},
  {name:'Scorpion Sting',     dmg:95, col:0xd8a03a},
  {name:'Avalanche',          dmg:100,col:0xd8f4ff},
  {name:"Pharaoh's Wrath",    dmg:110,col:0xffd24a},
  {name:"Winter's End",       dmg:120,col:0xaee8ff},
  {name:"Pni's Feather",      dmg:130,col:0xcfe8ff},
  {name:'Relic Blade',        dmg:140,col:0xffe08a},
  {name:'Worldbreaker',       dmg:150,col:0xff5a3a},
];
const swordRoot=new THREE.Group();
swordRoot.position.set(.30,-.36,-.55);swordRoot.visible=false;camera.add(swordRoot);
let swordBladeMesh=null,swordEdgeMesh=null,swordTipMesh=null;
(function(){
  const steel=std(SWORD_DEFS[0].col),edge=std(0xeef4f6),gold=std(0xc9a24a),grip=std(0x5a3a24),skin=pSkinM,sleeve=pSleeveM,cuff=pCuffM;
  swordRoot.add(box(.17,.17,.36,skin,0,0,.30));
  swordRoot.add(box(.22,.22,.1,cuff,0,0,.49));
  swordRoot.add(box(.24,.24,.08,sleeve,0,0,.55));
  swordRoot.add(box(.16,.15,.16,skin,0,0,.15));
  swordRoot.add(box(.06,.06,.26,grip,0,0,.06));
  swordRoot.add(box(.09,.09,.09,gold,0,0,.21));
  swordRoot.add(box(.28,.05,.07,gold,0,0,-.1));
  swordBladeMesh=box(.08,.025,.82,steel,0,0,-.52);swordRoot.add(swordBladeMesh);
  swordEdgeMesh=box(.028,.03,.78,edge,0,.022,-.52);swordRoot.add(swordEdgeMesh);
  swordTipMesh=cone(.075,.18,steel,0,0,-.99,4);swordTipMesh.rotation.x=-Math.PI/2;swordRoot.add(swordTipMesh);
})();
function setSwordSkin(d){
  if(!d)return;
  if(swordBladeMesh)swordBladeMesh.material.color.setHex(d.col);
  if(swordTipMesh)swordTipMesh.material.color.setHex(d.col);
  if(swordEdgeMesh)swordEdgeMesh.material.color.setHex(new THREE.Color(d.col).lerp(new THREE.Color(0xffffff),.55).getHex());
}

function toast(t,dialog){
  const el=$('toast');if(!el)return;
  el.textContent=t;
  /* gameplay notes sit low; only face-to-face dialogue uses the top slot */
  el.classList.toggle('low',!dialog);
  el.classList.add('on');
  clearTimeout(toastT);
  toastT=setTimeout(()=>el.classList.remove('on'),1900);
}

/* ---------- multiplayer: avatars, input, snapshots ---------- */
let playStarted=false;

function makeNameTag(name){
  const c=document.createElement('canvas');c.width=256;c.height=64;
  const g=c.getContext('2d');
  g.clearRect(0,0,c.width,c.height);
  g.font='700 28px Nunito, sans-serif';
  g.textAlign='center';g.textBaseline='middle';
  g.lineWidth=6;g.strokeStyle='rgba(0,0,0,.55)';g.strokeText(name,128,32);
  g.fillStyle='#fff7dc';g.fillText(name,128,32);
  const tex=new THREE.CanvasTexture(c);
  tex.minFilter=THREE.LinearFilter;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
  sprite.scale.set(3.4,.85,1);
  sprite.position.y=2.35;
  return sprite;
}

function makeRemoteAvatar(a){
  const g=buildPlayerAvatar(a.gender||'unknown');
  g.add(makeNameTag(a.name||'Player'));
  scene.add(g);
  return g;
}
function setRemoteGender(a,gender){
  const key=PLAYER_GENDERS[gender]?gender:'unknown';
  if((a.gender||'unknown')===key)return;
  a.gender=key;
  if(a.avatar){scene.remove(a.avatar);a.avatar=null;}
}

function ensureRemote(id,name,gender){
  let a=netRemotes.get(id);
  if(a){if(name)a.name=name;if(gender)setRemoteGender(a,gender);return a;}
  a={
    id,name:name||'Player',gender:PLAYER_GENDERS[gender]?gender:'unknown',
    x:0,z:6,y:0,
    rx:0,rz:6,ry:0,
    baseY:0,jy:0,jv:0,kx:0,kz:0,fl:0,bump:0,iy:0,
    sw:0,punchT:0,held:false,ride:false,netSpeed:0,snapAt:null,
    yaw:0,pitch:0,walkT:0,
    hp:10,hunger:10,
    lastInput:null,inputT:0,seq:-1,lastSeen:clock,
    avatar:null,
  };
  netRemotes.set(id,a);
  return a;
}

function ensureRemoteAvatar(a){
  if(a.avatar&&a.avatar.userData.gender!==(a.gender||'unknown')){
    scene.remove(a.avatar);a.avatar=null;
  }
  if(!a.avatar){a.avatar=makeRemoteAvatar(a);a.avatar.position.set(a.rx,a.y,a.rz);}
  return a.avatar;
}

function removeRemote(id){
  const a=netRemotes.get(id);
  if(!a)return;
  if(a.avatar){scene.remove(a.avatar);a.avatar=null;}
  netRemotes.delete(id);
}

function applyRemoteInput(id,msg){
  const a=ensureRemote(id);
  const seq=Number(msg.seq)||0;
  if(a.lastSeq!=null&&seq<a.lastSeq)return;
  a.lastSeq=seq;
  a.lastSeen=clock;
  a.lastInput={
    ax:clamp(Number(msg.ax)||0,-1,1),
    ay:clamp(Number(msg.ay)||0,-1,1),
    yaw:Number(msg.yaw)||0,
    pitch:clamp(Number(msg.pitch)||0,-1.45,1.45),
    btn:Number(msg.btn)||0,
  };
  a.seq=Number(msg.seq)||0;
  a.inputT=0;
  /* appearance and pose state travel with the movement input */
  if(msg.g){
    setRemoteGender(a,msg.g);
    const entry=netRoster.get(id);
    if(entry)entry.gender=a.gender;
    else netRoster.set(id,{id,name:a.name,host:false,gender:a.gender});
    if(inviteOpen)refreshInvite();
  }
  a.sw=clamp(Number(msg.sw)||0,0,1);
  a.held=!!msg.h;
  a.ride=!!msg.rd;
  if(Number(msg.pt)>0)a.punchT=Math.max(a.punchT||0,Number(msg.pt));
}

function stepRemoteActors(dt){
  for(const a of netRemotes.values()){
    if(a.lastInput){
      a.inputT+=dt;
      if(a.inputT>2){a.lastInput=null;}
    }
    const inp=a.lastInput;
    if(!inp){a.netSpeed=0;continue;}
    const sprint=!!(inp.btn&INPUT.SPRINT);
    const speed=sprint?9.5:5.8;
    const fx=-Math.sin(inp.yaw),fz=-Math.cos(inp.yaw);
    const rx=Math.cos(inp.yaw),rz=-Math.sin(inp.yaw);
    const mx=fx*inp.ay+rx*inp.ax,mz=fz*inp.ay+rz*inp.ax;
    a.yaw=inp.yaw;a.pitch=inp.pitch;
    if((inp.btn&INPUT.JUMP)&&a.jy<=0&&a.jv<=0)a.jv=7;
    a.jv-=20*dt;a.jy+=a.jv*dt;if(a.jy<=0){a.jy=0;a.jv=0;}
    const px=a.x,pz=a.z;
    a.x+=(mx*speed+a.kx)*dt;a.z+=(mz*speed+a.kz)*dt;
    const kd=Math.pow(a.jy>0?.35:.01,dt);a.kx*=kd;a.kz*=kd;
    pushOut(a,.5,true);pushFrom(a,.5,cows,1.15);pushFrom(a,.5,bulls,1.6);pushFrom(a,.5,props,.9);pushFrom(a,.5,persons,.55);boundPlayer(a);
    a.netSpeed=Math.hypot(a.x-px,a.z-pz)/Math.max(dt,.001);
    a.y=a.baseY+a.jy;
    a.x=clamp(a.x,-4000,4000);a.z=clamp(a.z,-4000,4000);
  }
}

function updateRemoteAvatars(dt){
  const k=Math.min(1,dt*14);
  for(const a of netRemotes.values()){
    const g=ensureRemoteAvatar(a);
    a.rx+=(a.x-a.rx)*k;
    a.rz+=(a.z-a.rz)*k;
    a.iy+=(a.y-a.iy)*k;
    a.ry+=angDiff(a.ry,a.yaw+Math.PI)*Math.min(1,dt*10);
    g.position.set(a.rx,a.iy,a.rz);
    g.rotation.y=a.ry;
    a.punchT=Math.max(0,(a.punchT||0)-dt);
    const speed=a.netSpeed||0;
    const mv=clamp(speed/5.8,0,1);
    if(mv>.05)a.walkT+=dt*(speed>7?12:9);
    const punch=a.punchT>0?Math.sin((1-a.punchT/.32)*Math.PI):0;
    poseAvatar(g.userData,{
      walkT:a.walkT,mv,punch,
      ride:!!a.ride,jump:!a.ride&&a.jy>.05,hold:!!a.held,
    });
    if(clock-a.lastSeen>8)removeRemote(a.id);
  }
}

function playerSnapshot(){
  const players=[{
    i:netSelfId||'host',n:netSelfName,g:playerGender,
    x:+P.x.toFixed(2),y:+(P.baseY+P.jy).toFixed(2),z:+P.z.toFixed(2),
    r:+yaw.toFixed(3),p:+pitch.toFixed(3),
    hp:P.hp,hunger:Math.round(P.hunger||0),
    h:P.holding?1:0,rd:P.ride?1:0,j:+P.jy.toFixed(2),sw:+P.sw.toFixed(2),
    pt:+P.punchT.toFixed(3),w:guns.weapon,sword:P.sword?1:0,
  }];
  for(const a of netRemotes.values()){
    players.push({
      i:a.id,n:a.name,g:a.gender||'unknown',
      x:+a.x.toFixed(2),y:+(a.y||0).toFixed(2),z:+a.z.toFixed(2),
      r:+a.yaw.toFixed(3),p:+a.pitch.toFixed(3),
      hp:a.hp,hunger:Math.round(a.hunger||0),
      h:a.held?1:0,rd:a.ride?1:0,j:+(a.jy||0).toFixed(2),sw:+(a.sw||0).toFixed(2),
      pt:+(a.punchT||0).toFixed(3),w:0,sword:0,
    });
  }
  const endgame={
    relics:Array.from(P.relics),
    portalOpen,pniFight,pniDefeated,
    bosses:bosses.map(b=>({id:b.bossId,hp:+b.hp.toFixed(1),dead:!!b.dead,aggro:!!b.aggro,phase:b.phase,x:+b.g.position.x.toFixed(2),z:+b.g.position.z.toFixed(2),ry:+b.g.rotation.y.toFixed(3)})),
  };
  return {t:MSG.SNAP,tick:Math.round(clock*1000),dayT:+dayT.toFixed(5),players,endgame};
}

function sendSnapshot(){
  if(netRole!=='host'||!net||!netConnected)return;
  const base=playerSnapshot();
  for(const peer of net.peers.values()){
    if(!peer.open)continue;
    const a=netRemotes.get(peer.id);
    const px=a?a.x:P.x,pz=a?a.z:P.z;
    const snap={...base,ents:snapshotEntitiesFor(px,pz)};
    net.sendTo(peer.id,CHANNEL.STATE,snap,true);
  }
}

const NET_ENTITY_TYPES=new Set(['cow','bull','hopper','pet','person','prop','meat','chest']);

function netKindOf(e){
  if(!e)return null;
  if(e.cow)return 'cow';
  if(e.bull)return 'bull';
  if(e.hopper)return 'hopper';
  if(e.pet)return 'pet';
  if(e.person)return 'person';
  if(e.obj)return 'prop';
  if(e.meatItem)return 'meat';
  if(e.chest)return 'chest';
  return null;
}

function snapshotEntitiesFor(px,pz){
  const out=[];
  const R=180,R2=R*R;
  const push=(e,type)=>{
    if(!e||!e.g||e.held||!e.id)return;
    const p=e.g.position;
    const dx=p.x-px,dz=p.z-pz;
    if(dx*dx+dz*dz>R2)return;
    if(out.length>=70)return;
    let flags=0;
    if(e.held)flags|=1;
    if(e.ridden)flags|=2;
    if(e.dead)flags|=4;
    if(e.opened)flags|=8;
    out.push({
      i:e.id,k:type,
      x:+p.x.toFixed(2),y:+p.y.toFixed(2),z:+p.z.toFixed(2),
      r:+(e.g.rotation.y||0).toFixed(3),
      s:e.state||'',
      kd:e.pet?e.kind:e.person?e.kind:e.obj?e.kind:undefined,
      f:flags,
      hp:e.hp,
    });
  };
  cows.forEach(e=>push(e,'cow'));
  bulls.forEach(e=>push(e,'bull'));
  hoppers.forEach(e=>push(e,'hopper'));
  pets.forEach(e=>push(e,'pet'));
  persons.forEach(e=>push(e,'person'));
  props.forEach(e=>push(e,'prop'));
  meats.forEach(e=>push(e,'meat'));
  chests.forEach(e=>push(e,'chest'));
  return out;
}

function removeNetEntity(id){
  const e=entitiesById.get(id);
  if(!e)return;
  if(e.g)scene.remove(e.g);
  const lists=[cows,bulls,hoppers,pets,persons,props,meats,chests];
  for(const list of lists){
    const i=list.indexOf(e);
    if(i>=0)list.splice(i,1);
  }
  entitiesById.delete(id);
}

function spawnNetEntity(e){
  const pos={x:Number(e.x)||0,z:Number(e.z)||0};
  let created=null;
  if(e.k==='cow')created=spawnCow(pos);
  else if(e.k==='bull')created=spawnBull(false,pos);
  else if(e.k==='hopper')created=spawnHopper(pos);
  else if(e.k==='pet')created=spawnPet(e.kd||'dog',null,pos);
  else if(e.k==='person')created=spawnPerson({x:pos.x,z:pos.z,r:0,role:e.kd||'human',wild:true});
  else if(e.k==='prop'){created=spawnProp(e.kd||'bale',false);if(created&&created.g)created.g.position.set(pos.x,0,pos.z);}
  else if(e.k==='meat')created=dropMeat(pos.x,pos.z);
  else if(e.k==='chest')created=spawnChest(pos.x,pos.z);
  if(!created)return null;
  const oldId=created.id;
  if(oldId)entitiesById.delete(oldId);
  created.id=e.i;
  created.netType=e.k;
  entitiesById.set(e.i,created);
  created.lastNetSeen=clock;
  return created;
}

function applyEntitySnapshot(e){
  if(!e||!e.i||!NET_ENTITY_TYPES.has(e.k))return;
  let ent=entitiesById.get(e.i);
  if(!ent)ent=spawnNetEntity(e);
  if(!ent)return;
  const g=ent.g;
  if(g){
    g.position.x=Number(e.x)||0;
    g.position.z=Number(e.z)||0;
    if(Number.isFinite(Number(e.y)))g.position.y=Number(e.y);
    g.rotation.y=Number(e.r)||0;
  }
  if(e.s)ent.state=e.s;
  if(e.k==='pet'&&e.kd)ent.kind=e.kd;
  if(e.k==='person'&&e.kd)ent.kind=e.kd;
  if(e.k==='prop'&&e.kd)ent.kind=e.kd;
  if(e.hp!=null)ent.hp=e.hp;
  if(e.f&4)ent.dead=true;
  if(e.f&8){
    ent.opened=true;
    if(ent.lid)ent.lid.rotation.x=-1.95;
    if(ent.glow)ent.glow.visible=false;
  }
  ent.lastNetSeen=clock;
}

function applySnapshot(msg){
  if(!msg)return;
  if(msg.tick&&netLastSnapTick&&msg.tick<netLastSnapTick)return;
  if(msg.tick)netLastSnapTick=msg.tick;
  /* the host owns the clock, so every device sees the same time of day */
  if(msg.dayT!=null&&netRole==='client'){
    const v=Number(msg.dayT);
    if(Number.isFinite(v))dayT=((v%1)+1)%1;
  }
  if(netRole==='client'&&msg.endgame)applyEndgameSnapshot(msg.endgame);
  if(Array.isArray(msg.players)){
    const seen=new Set();
    for(const p of msg.players){
      if(!p||!p.i)continue;
      netRoster.set(p.i,{id:p.i,name:p.n||'Player',host:p.i===netHostPeerId,gender:p.g||'unknown'});
      if(p.i===netSelfId)continue;
      const a=ensureRemote(p.i,p.n,p.g);
      const ox=a.x,oz=a.z,prevAt=a.snapAt;
      a.x=Number(p.x)||0;a.z=Number(p.z)||0;a.y=Number(p.y)||0;
      a.yaw=Number(p.r)||0;a.pitch=Number(p.p)||0;
      a.hp=Number(p.hp)||0;a.hunger=Number(p.hunger)||0;
      a.jy=Number(p.j)||0;
      a.sw=clamp(Number(p.sw)||0,0,1);
      a.held=!!p.h;a.ride=!!p.rd;
      a.punchT=Number(p.pt)||0;
      if(prevAt!=null){
        const sdt=Math.max(clock-prevAt,.02);
        a.netSpeed=Math.min(14,Math.hypot(a.x-ox,a.z-oz)/sdt);
      }
      a.snapAt=clock;
      a.lastSeen=clock;
      seen.add(p.i);
      ensureRemoteAvatar(a);
    }
    for(const id of Array.from(netRemotes.keys())){
      if(!seen.has(id)&&clock-netRemotes.get(id).lastSeen>4)removeRemote(id);
    }
  }
  if(netRole==='client'&&Array.isArray(msg.ents)){
    for(const e of msg.ents)applyEntitySnapshot(e);
    for(const [id,ent] of Array.from(entitiesById.entries())){
      if(ent.lastNetSeen!=null&&clock-ent.lastNetSeen>4)removeNetEntity(id);
    }
  }
}

function sendWelcome(peerId){
  const players=[{id:netSelfId,name:netSelfName,host:true,gender:playerGender}];
  for(const p of net.peers.values()){
    const a=netRemotes.get(p.id);
    players.push({id:p.id,name:p.name,host:false,gender:a?a.gender:'unknown'});
  }
  net.sendTo(peerId,CHANNEL.CTRL,{
    t:MSG.WELCOME,
    self:peerId,
    host:netSelfId,
    seed:worldSeed,
    checksum:netWorldChecksum,
    dayT:+dayT.toFixed(5),
    players,
  });
}

function currentInviteLink(){
  const u=new URL(window.location.origin+window.location.pathname);
  if(boot&&boot.room)u.searchParams.set('join',boot.room);
  return u.toString();
}

function refreshInvite(){
  if(!boot)return;
  const code=$('inviteCode'),link=$('inviteLink'),qr=$('inviteQr'),list=$('invitePlayers');
  if(code)code.textContent=boot.room;
  const url=currentInviteLink();
  if(link)link.value=url;
  const hint=$('inviteHint');
  if(hint){
    const local=['localhost','127.0.0.1','::1','[::1]'].includes(window.location.hostname);
    hint.textContent=local
      ? 'You opened localhost. For phones on Wi-Fi, use the Network URL printed by Next (for example 192.168.x.x:3000) or replace localhost in the link with this PC\'s IP.'
      : 'Scan the QR or send this link. The room code is enough if the link is inconvenient.';
  }
  if(qr){
    QRCode.toCanvas(qr,url,{width:220,margin:1,color:{dark:'#24331c',light:'#fff7dc'}}).catch(()=>{});
  }
  if(list){
    /* Roster is built from welcome + snapshots, so it stays correct when more
       players join after this client connected. */
    const players=Array.from(netRoster.values()).sort((a,b)=>(b.host?1:0)-(a.host?1:0));
    const roster=players.length?players:[
      {id:netSelfId,name:netSelfName,host:netRole==='host'},
    ];
    list.replaceChildren();
    for(const p of roster){
      const el=document.createElement('div');
      el.className='invitePlayer'+(p.host?' host':'');
      el.textContent=(p.name||'Player')+(p.id===netSelfId?' (you)':p.host?' · host':'');
      list.appendChild(el);
    }
  }
  const btn=$('inviteCloseRoom');
  if(btn)btn.textContent=netRole==='host'?'Close room':'Leave room';
}

function openInvite(){
  if(!boot){toast('Join a room first');return;}
  inviteOpen=true;
  for(const k in keys)keys[k]=false;
  try{document.exitPointerLock();}catch(_){}
  $('invitePanel').hidden=false;
  refreshInvite();
}

function closeInvite(){
  if(!inviteOpen)return;
  inviteOpen=false;
  $('invitePanel').hidden=true;
  if(state==='play')reqLock();
}

async function copyInvite(){
  const url=currentInviteLink();
  try{
    await navigator.clipboard.writeText(url);
    toast('Invite link copied');
  }catch(_){
    const input=$('inviteLink');
    if(input){input.select();try{document.execCommand('copy');toast('Invite link copied');}catch(__){}}
  }
}

async function shareInvite(){
  const url=currentInviteLink();
  if(navigator.share){
    try{await navigator.share({title:'Grasshopper Pasture',text:'Join my pasture room '+boot.room,url});return;}catch(_){}
  }
  copyInvite();
}

async function leaveCurrentRoom(){
  if(netRole==='host'&&!window.confirm('Close the room for everyone?'))return;
  netLeaving=true;
  if(netReconnectTimer){clearTimeout(netReconnectTimer);netReconnectTimer=null;}
  try{if(boot)await leaveRoom(boot);}catch(_){}
  clearSession();
  try{if(net)net.stop();}catch(_){}
  window.location.href='/';
}

function sendCmd(type,extra){
  if(netRole!=='client'||!net||!netConnected)return false;
  return net.send(CHANNEL.CTRL,{t:MSG.CMD,cid:++cmdSeq,type,...(extra||{})},false);
}

function sendUseCommand(){
  const portal=targetPortal();
  if(portal){usePortal(portal);return;}
  const relic=targetRelic();
  const chest=targetChest();
  const meat=targetMeat();
  sendCmd('use',{target:chest?chest.id:meat?meat.id:undefined,relic:relic?relic.bossId:undefined});
}

function sendLocalInput(dt){
  if(netRole!=='client'||!net||!netConnected)return;
  netInputT-=dt;
  if(netInputT>0)return;
  netInputT=.05;
  let ax=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0)+joy.x;
  let ay=(keys.w||keys.arrowup?1:0)-(keys.s||keys.arrowdown?1:0)-joy.y;
  const len=Math.hypot(ax,ay);if(len>1){ax/=len;ay/=len;}
  let btn=0;
  if(keys[' '])btn|=INPUT.JUMP;
  if(keys.shift)btn|=INPUT.SPRINT;
  if(fireHeld)btn|=INPUT.FIRE;
  if(keys.f)btn|=INPUT.USE;
  net.send(CHANNEL.STATE,{
    t:MSG.INPUT,seq:++netSeq,
    ax:+ax.toFixed(3),ay:+ay.toFixed(3),
    yaw:+yaw.toFixed(3),pitch:+pitch.toFixed(3),btn,
    g:playerGender,
    sw:+P.sw.toFixed(2),
    h:P.holding?1:0,
    rd:P.ride?1:0,
    pt:+P.punchT.toFixed(3),
  },true);
}

function showNetLost(message){
  const el=$('netLost');
  if(!el)return;
  const msg=$('netLostMsg');
  if(msg)msg.textContent=message||'The connection was lost.';
  el.hidden=false;
  const retry=$('netRetryBtn');
  if(retry)retry.disabled=netRole==='host';
  updateNetStatus(true);
}
function hideNetLost(){
  const el=$('netLost');
  if(el)el.hidden=true;
  netFatal=false;
  updateNetStatus(true);
}
function updateNetStatus(force){
  if(!boot)return;
  if(force!==true&&clock-netStatusT<.4)return;
  netStatusT=clock;
  const pill=$('netPill'),label=$('netRoom');
  if(!pill||!label)return;
  label.textContent=boot.room||'—';
  let players=netRoster.size||1;
  if(netRole==='host'&&net&&net.peers)players=net.peers.size+1;
  const bits=[players+(players===1?' player':' players')];
  if(netRole==='client')bits.push(net&&net.relayMode?'relay':'direct');
  else bits.push('host');
  if(netRole==='client'&&netPing!=null)bits.push(netPing+' ms');
  if(!netConnected)bits.push(netLeaving?'leaving':netFatal?'offline':'connecting');
  pill.title='Room '+(boot.room||'')+' · '+bits.join(' · ');
}
function applyRoster(list,hostId){
  if(!Array.isArray(list))return;
  for(const p of list){
    if(!p||!p.id)continue;
    netRoster.set(p.id,{id:p.id,name:p.name||'Player',host:!!p.host||p.id===hostId,gender:p.gender||'unknown'});
  }
}
function handleNetFatal(message){
  netFatal=true;
  netReconnectAttempts=0;
  if(netReconnectTimer){clearTimeout(netReconnectTimer);netReconnectTimer=null;}
  netConnected=false;
  try{if(net)net.stop();}catch(_){}
  showNetLost(message);
}
function scheduleReconnect(){
  if(netLeaving||netFatal||netRole!=='client'||!boot)return;
  if(netReconnectAttempts>=5){
    showNetLost('Could not reach the host. Check your connection, then retry.');
    return;
  }
  netReconnectAttempts++;
  const attempt=netReconnectAttempts;
  const delay=Math.min(8000,1000*Math.pow(2,attempt-1));
  showNetLost(attempt===1?'Connection lost — reconnecting…':'Reconnecting (attempt '+attempt+'/5)…');
  if(netReconnectTimer)clearTimeout(netReconnectTimer);
  netReconnectTimer=setTimeout(()=>{netReconnectTimer=null;void reconnectClient();},delay);
}
async function reconnectClient(){
  if(netLeaving||netRole!=='client'||!boot)return;
  try{
    const re=await rejoinRoom(boot);
    if(re&&re.seed)boot.seed=re.seed;
    if(re&&re.token){boot.token=re.token;saveSession(boot);}
    const iceServers=await getIceServers(boot);
    await startNetSession(boot,iceServers);
  }catch(err){
    console.warn('[net] reconnect failed',err);
    const code=err&&err.code;
    if(code==='host_offline'||code==='room_not_found'||code==='room_expired'||code==='version_mismatch'||code==='peer_not_found'){
      handleNetFatal(code==='host_offline'?'The host is offline right now.':'The room has ended.');
      return;
    }
    scheduleReconnect();
  }
}
async function startNetSession(cfg,iceServers){
  netRestarting=true;
  try{if(net)net.stop();}catch(_){}
  net=new NetSession({role:cfg.role,session:cfg,callbacks:makeNetCallbacks(cfg),iceServers});
  try{await net.start();}
  finally{netRestarting=false;}
}
function makeNetCallbacks(cfg){
  return {
    onError:(err)=>{
      if(netRestarting||netLeaving)return;
      console.warn('[net]',err);
      const code=err&&err.code;
      if(code==='room_expired'||code==='room_not_found'){
        if(netRole==='host')handleNetFatal('This room expired. Create a new room to keep playing.');
        else handleNetFatal('The room has ended.');
        return;
      }
      if(code==='host_offline'||code==='peer_not_found'){
        if(netRole==='client')handleNetFatal('The host is offline right now.');
        return;
      }
      if(netRole==='client'&&!netConnected)toast('Connection problem — '+(code||'network'));
    },
    onPeerOpen:(peerId,name)=>{
      netConnected=true;
      const existed=netRemotes.has(peerId);
      ensureRemote(peerId,name);
      netRoster.set(peerId,{id:peerId,name:name||'Player',host:false});
      sendWelcome(peerId);
      sendSnapshot();
      if(!existed)toast(name+' joined');
      if(inviteOpen)refreshInvite();
      updateNetStatus(true);
    },
    onPeerMessage:(peerId,channel,msg)=>{
      if(!msg)return;
      if(msg.t===MSG.INPUT)applyRemoteInput(peerId,msg);
      else if(msg.t===MSG.PING)net.sendTo(peerId,CHANNEL.STATE,{t:MSG.PONG,at:msg.at},true);
      else if(msg.t===MSG.CMD)handleRemoteCommand(peerId,msg);
    },
    onPeerClose:(peerId,name)=>{
      if(netLeaving||netRestarting)return;
      removeRemote(peerId);
      netRoster.delete(peerId);
      if(name)toast(name+' left');
      netConnected=!!(net&&net.peers&&net.peers.size>0);
      if(inviteOpen)refreshInvite();
      updateNetStatus(true);
    },
    onOpen:()=>{
      netConnected=true;
      netEverOpen=true;
      netReconnectAttempts=0;
      netFatal=false;
      if(netReconnectTimer){clearTimeout(netReconnectTimer);netReconnectTimer=null;}
      hideNetLost();
      try{net.ping();}catch(_){}
      if(netWelcome)startClientPlay();
      else toast('Connected — waiting for host');
      updateNetStatus(true);
    },
    onMessage:(channel,msg)=>{
      if(!msg)return;
      if(msg.t===MSG.WELCOME){
        netWelcome=msg;
        /* A welcome proves the link works even if onOpen was superseded by a
         * late WebRTC close during the relay fallback. */
        netConnected=true;
        if(msg.dayT!=null){
          const v=Number(msg.dayT);
          if(Number.isFinite(v))dayT=((v%1)+1)%1;
        }
        applyRoster(msg.players,msg.host||cfg.peerId);
        netRoster.set(netSelfId,{id:netSelfId,name:netSelfName,host:netRole==='host',gender:playerGender});
        hideNetLost();
        startClientPlay();
        if(inviteOpen)refreshInvite();
        updateNetStatus(true);
      }
      else if(msg.t===MSG.SNAP)applySnapshot(msg);
      else if(msg.t===MSG.EV&&msg.text)toast(msg.text);
      else if(msg.t===MSG.PING)net.send(CHANNEL.STATE,{t:MSG.PONG,at:msg.at},true);
    },
    onPing:(rtt)=>{netPing=rtt;updateNetStatus();},
    onStall:()=>{if(netRole==='client')toast('Waiting for the host — keep its tab open');},
    onTransport:(mode,reason)=>{
      console.info('[net] transport',mode,reason);
      if(mode==='relay')toast('Direct connection blocked — using the relay');
    },
    onClose:(reason)=>{
      if(netRestarting||netLeaving)return;
      netConnected=false;
      netEverOpen=false;
      console.warn('[net] closed',reason);
      if(netRole==='client')scheduleReconnect();
    },
  };
}
function wireNetUnload(){
  if(netUnloadWired)return;
  netUnloadWired=true;
  const bye=()=>{
    if(!boot)return;
    /* A host leaving kills the room. A client keeps its session so a reload
       can re-register and reconnect through the rejoin route. */
    if(netRole==='host'){leaveRoom(boot);clearSession();}
    else markSessionRejoin();
  };
  window.addEventListener('beforeunload',bye);
  window.addEventListener('pagehide',e=>{if(!e.persisted)bye();});
  window.addEventListener('online',()=>{
    if(netRole==='client'&&!netConnected&&!netLeaving&&!netFatal){
      netReconnectAttempts=0;
      void reconnectClient();
    }
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&netRole==='host'&&boot)toast('Keep this tab open — the world runs here');
  });
}
function beginMultiplayer(cfg){
  netRole=cfg.role;
  netSelfId=cfg.peerId;
  netSelfName=cfg.name||'Player';
  netHostPeerId=cfg.hostPeerId||cfg.peerId;
  netRoster.clear();
  netRoster.set(netSelfId,{id:netSelfId,name:netSelfName,host:cfg.role==='host',gender:playerGender});
  const run=async()=>{
    wireNetUnload();
    if(cfg.role==='client'&&cfg.rejoin){
      try{
        const re=await rejoinRoom(cfg);
        if(re&&re.seed)cfg.seed=re.seed;
        if(re&&re.token)cfg.token=re.token;
        cfg.rejoin=false;
        saveSession(cfg);
      }catch(err){
        console.warn('[net] rejoin failed',err);
        clearSession();
        toast('Room is no longer available — host a new one or join again');
        $('menu').hidden=false;
        return;
      }
    }
    let iceServers;
    try{iceServers=await getIceServers(cfg);}catch(_){iceServers=undefined;}
    try{await startNetSession(cfg,iceServers);}
    catch(err){
      console.warn('[net] start failed',err);
      toast('Multiplayer unavailable in this browser');
      $('menu').hidden=false;
      return;
    }
    if(cfg.role==='host'){
      beginPlay();
      toast('Room '+cfg.room+' — share the code');
      updateNetStatus(true);
    }
  };
  void run();
}

function startClientPlay(){
  if(playStarted)return;
  if(netWelcome&&netWelcome.checksum&&netWorldChecksum&&netWelcome.checksum!==netWorldChecksum){
    toast('World mismatch — ask the host to restart the room');
    try{net.stop();}catch(_){}
    clearSession();
    return;
  }
  beginPlay();
}

function handleRemoteCommand(peerId,msg){
  if(!msg||!msg.type)return;
  const actor=netRemotes.get(peerId);
  if(!actor||actor.dead||actor.hp<=0)return;
  if(msg.type==='punch'||msg.type==='shoot'){
    const target=entitiesById.get(msg.target);
    if(!target||!target.g||target.held||target.dead)return;
    const dx=target.g.position.x-actor.x,dz=target.g.position.z-actor.z;
    const range=msg.type==='shoot'?90:6.4;
    if(dx*dx+dz*dz>range*range)return;
    if(target.boss){
      const dmg=clamp(Number(msg.dmg)||4,1,800);
      damageBoss(target,dmg,msg.type==='shoot'?'gun':'melee');
      const text=(actor.name||'A player')+' hit '+target.name+' ('+Math.ceil(target.hp)+' HP left)';
      toast(text);
      if(target.dead)net.broadcast(CHANNEL.CTRL,{t:MSG.EV,type:'boss',text:target.name+' has fallen'});
      return;
    }
    const kind=target.cow?'cow':target.bull?'bull':target.hopper?'hopper':target.pet?target.kind:target.person?target.kind:'';
    if(!kind)return;
    const max=EDIBLE_HP[kind]||2;
    const dmg=msg.type==='shoot'?4:1;
    target.hp=(target.hp==null?max:target.hp)-dmg;
    burst(target.g.position.x,1,target.g.position.z,0xefe8da,8);
    if(target.hp<=0){
      if(target.person)killPerson(target,kind);else killEdible(target,kind);
      const text=(netRemotes.get(peerId)?.name||'A player')+' killed a '+kind;
      toast(text);
      net.broadcast(CHANNEL.CTRL,{t:MSG.EV,type:'kill',text});
    }else{
      net.sendTo(peerId,CHANNEL.CTRL,{t:MSG.EV,type:'hit',text:'Hit the '+kind+' ('+target.hp+' left)'});
    }
    return;
  }
  if(msg.type==='use'){
    if(msg.relic){
      const r=relicItems.find(x=>x.bossId===msg.relic);
      if(!r)return;
      const dx=r.g.position.x-actor.x,dz=r.g.position.z-actor.z;
      if(dx*dx+dz*dz>4.2*4.2)return;
      pickupRelic(r);
      const text=(actor.name||'A player')+' recovered a gold relic';
      toast(text);
      net.broadcast(CHANNEL.CTRL,{t:MSG.EV,type:'relic',text});
      return;
    }
    const target=entitiesById.get(msg.target);
    if(!target)return;
    if(target.relic){
      const dx=target.g.position.x-actor.x,dz=target.g.position.z-actor.z;
      if(dx*dx+dz*dz>4.2*4.2)return;
      pickupRelic(target);
      const text=(actor.name||'A player')+' recovered a gold relic';
      toast(text);
      net.broadcast(CHANNEL.CTRL,{t:MSG.EV,type:'relic',text});
      return;
    }
    if(!target.chest||target.opened)return;
    const dx=target.g.position.x-actor.x,dz=target.g.position.z-actor.z;
    if(dx*dx+dz*dz>4.2*4.2)return;
    openChest(target);
    const text=(actor.name||'A player')+' opened a chest';
    toast(text);
    net.broadcast(CHANNEL.CTRL,{t:MSG.EV,type:'chest',text});
    return;
  }
}

function pushOut(p,r,sw){let hit=false;for(let i=0;i<solids.length;i++){const s=solids[i];if(sw&&s.water)continue;
  if(s.w&&s.d){
    const c=Math.cos(s.yaw),sn=Math.sin(s.yaw);
    const dx=p.x-s.x,dz=p.z-s.z;
    let lx=dx*c-dz*sn,lz=dx*sn+dz*c;
    const hx=s.w/2+r,hz=s.d/2+r;
    if(Math.abs(lx)<hx&&Math.abs(lz)<hz){
      const ox=hx-Math.abs(lx),oz=hz-Math.abs(lz);
      if(ox<oz)lx=lx>=0?hx:-hx;else lz=lz>=0?hz:-hz;
      p.x=s.x+lx*c+lz*sn;p.z=s.z-lx*sn+lz*c;hit=true;
    }
    continue;
  }
  const dx=p.x-s.x,dz=p.z-s.z,m=r+s.r,d2=dx*dx+dz*dz;if(d2<m*m){const d=Math.sqrt(d2)||.001;p.x=s.x+dx/d*m;p.z=s.z+dz/d*m;hit=true;}}return hit;}
function pushFrom(p,r,list,ar){list.forEach(a=>{if(a.held)return;const dx=p.x-a.g.position.x,dz=p.z-a.g.position.z,m=r+ar,d2=dx*dx+dz*dz;if(d2<m*m){const d=Math.sqrt(d2)||.001;p.x=a.g.position.x+dx/d*m;p.z=a.g.position.z+dz/d*m;}});}
function bound(p,R){const d=Math.hypot(p.x,p.z);if(d>R){p.x*=R/d;p.z*=R/d;return true;}return false;}
function boundDisc(p,B,R){const dx=p.x-B.x,dz=p.z-B.z,d=Math.hypot(dx,dz);if(d>R){p.x=B.x+dx/d*R;p.z=B.z+dz/d*R;return true;}return false;}
function biomeOfKind(kind){
  if(kind==='camel'||kind==='cobra')return DESERT;
  if(kind==='penguin'||kind==='snowbear')return SNOWZ;
  if(SAV_KINDS.indexOf(kind)>=0)return SAVAN;
  return null;
}
/* biome animals live out on their island, so clamp them to it, not the pasture */
function boundPet(p,kind,who){
  if(who&&who.adminRoam)return boundPlayer(p);
  const B=who&&who.biome?BIOME_BY_NAME[who.biome]:biomeOfKind(kind);
  return B?boundDisc(p,B,B.r-6):bound(p,52*S);
}
/* villagers of a biome city stay on their own island */
function boundPerson(p,c){
  const B=c&&c.biome?BIOME_BY_NAME[c.biome]:null;
  return B?boundDisc(p,B,B.r-8):bound(p,52*S);
}
/* the player may roam the pasture plus the three ocean islands */
function boundPlayer(p){
  if(Math.hypot(p.x,p.z)<=ISLAND_R||
     Math.hypot(p.x-DESERT.x,p.z-DESERT.z)<=DESERT.r||
     Math.hypot(p.x-SAVAN.x,p.z-SAVAN.z)<=SAVAN.r||
     Math.hypot(p.x-SNOWZ.x,p.z-SNOWZ.z)<=SNOWZ.r)return false;
  const dD=Math.hypot(p.x-DESERT.x,p.z-DESERT.z)-DESERT.r;
  const dV=Math.hypot(p.x-SAVAN.x,p.z-SAVAN.z)-SAVAN.r;
  const dS=Math.hypot(p.x-SNOWZ.x,p.z-SNOWZ.z)-SNOWZ.r;
  const dI=Math.hypot(p.x,p.z)-ISLAND_R;
  if(dD<dV&&dD<dS&&dD<dI)return boundDisc(p,DESERT,DESERT.r);
  if(dV<dS&&dV<dI)return boundDisc(p,SAVAN,SAVAN.r);
  if(dS<dI)return boundDisc(p,SNOWZ,SNOWZ.r);
  return bound(p,ISLAND_R);
}
function freeSpot(minD,maxD,avoid){
  for(let i=0;i<60;i++){const a=rnd(0,TAU),d=rnd(minD,maxD),x=Math.cos(a)*d,z=Math.sin(a)*d;
    if(solids.some(s=>Math.hypot(s.x-x,s.z-z)<s.r+2.5))continue;
    if(SITES.some(s=>Math.hypot(s.x-x,s.z-z)<s.r*.6))continue;
    if(avoid&&Math.hypot(P.x-x,P.z-z)<avoid)continue;
    return {x,z};}
  return {x:rnd(-20,20),z:rnd(0,20)};
}
function biomeSpot(B,rMin,rMax,avoid){
  for(let i=0;i<50;i++){const a=rnd(0,TAU),d=rnd(rMin,rMax),x=B.x+Math.cos(a)*d,z=B.z+Math.sin(a)*d;
    if(solids.some(s=>Math.hypot(s.x-x,s.z-z)<s.r+1.8))continue;
    if(avoid&&Math.hypot(P.x-x,P.z-z)<avoid)continue;
    return {x,z};}
  return {x:B.x,z:B.z};
}
/* spawn around the player, never out in a far-away part of the world */
function nearSpot(minD,maxD,avoid,biome,anywhere){
  for(let i=0;i<70;i++){
    const a=rnd(0,TAU),d=rnd(minD,maxD),x=P.x+Math.cos(a)*d,z=P.z+Math.sin(a)*d;
    if(biome){if(biomeAt(x,z)!==biome)continue;}
    else if(!anywhere&&biomeAt(x,z))continue;
    if(biome){
      const B=BIOME_BY_NAME[biome];
      if(!B||Math.hypot(x-B.x,z-B.z)>B.r-8)continue;
    }else if(anywhere){
      const onLand=Math.hypot(x,z)<ISLAND_R-6||Math.hypot(x-DESERT.x,z-DESERT.z)<DESERT.r-6||
        Math.hypot(x-SAVAN.x,z-SAVAN.z)<SAVAN.r-6||Math.hypot(x-SNOWZ.x,z-SNOWZ.z)<SNOWZ.r-6;
      if(!onLand)continue;
    }else if(Math.hypot(x,z)>ISLAND_R-6)continue;
    if(solids.some(s=>Math.hypot(s.x-x,s.z-z)<s.r+2.5))continue;
    if(SITES.some(s=>Math.hypot(s.x-x,s.z-z)<s.r*.6))continue;
    if(avoid&&Math.hypot(P.x-x,P.z-z)<avoid)continue;
    return {x,z};
  }
  return {x:P.x+rnd(-8,8),z:P.z+rnd(-8,8)};
}
function nearBiomeSpot(B,rMin,rMax,avoid){
  for(let i=0;i<60;i++){
    const a=rnd(0,TAU),d=rnd(rMin,rMax),x=P.x+Math.cos(a)*d,z=P.z+Math.sin(a)*d;
    if(Math.hypot(x-B.x,z-B.z)>B.r-8)continue;
    if(solids.some(s=>Math.hypot(s.x-x,s.z-z)<s.r+2.2))continue;
    if(avoid&&Math.hypot(P.x-x,P.z-z)<avoid)continue;
    return {x,z};
  }
  return {x:B.x,z:B.z};
}
const partGeo=new THREE.BoxGeometry(.18,.18,.18),partMats={};
function burst(x,y,z,color,n){
  const m=partMats[color]||(partMats[color]=new THREE.MeshBasicMaterial({color}));
  for(let i=0;i<n;i++){const o=new THREE.Mesh(partGeo,m);o.position.set(x,y,z);scene.add(o);
    parts.push({o,vx:rnd(-4,4),vy:rnd(2,6),vz:rnd(-4,4),life:rnd(.4,.8),max:.8});}
}

/* ---------- spawning ---------- */
function spawnCow(pos){
  const sp=pos||nearSpot(35,140,10);
  const g=buildCow();g.position.set(sp.x,0,sp.z);g.rotation.y=rnd(0,TAU);scene.add(g);
  const c={g,cow:true,ambient:true,rad:1.4,cy:1.3,heavy:.7,base:.9,held:false,state:'graze',st:rnd(1,5),dir:g.rotation.y,t:rnd(0,9)};
  cows.push(c);return registerEntity(c,'cow');
}
function spawnBull(edge,pos){
  const g=buildBull();g.userData.eyeMat=g.userData.eyeMat.clone();
  g.userData.head.children.forEach(ch=>{if(ch.userData&&ch.userData.eye)ch.material=g.userData.eyeMat;});
  const sp=pos||nearSpot(45,150,18);
  g.position.set(sp.x,0,sp.z);g.rotation.y=rnd(0,TAU);scene.add(g);
  const b={g,bull:true,ambient:true,rad:1.9,cy:2,heavy:.5,base:1,held:false,r:1.6,state:'wander',wt:rnd(0,2),dir:rnd(0,TAU),st:0,cd:rnd(4,8),cx:0,cz:1,hit:false,hitP:[],t:0,target:null,ridden:false,riderT:0,boltT:0,warned:false};
  bulls.push(b);return registerEntity(b,'bull');
}
function spawnHopper(pos){
  const sp=pos||nearSpot(25,120,5);
  const g=buildHopper();g.position.set(sp.x,0,sp.z);g.rotation.y=rnd(0,TAU);scene.add(g);
  const h={hopper:true,ambient:true,rub:0,ct:rnd(.3,4),g,state:'wait',wait:rnd(.2,2),t:0,dur:.45,sx:0,sz:0,ex:0,ez:0,held:false};
  hoppers.push(h);return registerEntity(h,'hopper');
}

/* ---------- hunting: punch an edible animal, eat the meat ---------- */
const meats=[];
/* ---------- wild fruit: apples and four kinds of berries ---------- */
const FRUIT_DEFS={
  apple:     {name:'Apple',       col:0xd8342b, leaf:0x4f9a34, hunger:1.6, hp:1},
  blueberry: {name:'Blueberries', col:0x4a6ad8, leaf:0x4f8a34, hunger:1.0, hp:.5},
  strawberry:{name:'Strawberry',  col:0xe23a4a, leaf:0x3f8a2c, hunger:1.2, hp:1},
  blackberry:{name:'Blackberries',col:0x3a2a4a, leaf:0x3d6b2a, hunger:1.1, hp:1},
  berry:     {name:'Wild Berry',  col:0x9a3ac0, leaf:0x4a7a30, hunger:.8,  hp:.5},
};
const fruits=[];
const ANIMAL_HP={cow:3,sheep:3,chicken:2,bull:100,bear:50,snowbear:50,wolf:4,deer:4,camel:6,cobra:3,snake:2,penguin:2,bunny:2,horse:5,cat:2,dog:2,hopper:1,human:3,villager:3,farmer:4,traveler:3,hunter:5,lion:14,tiger:16,elephant:34,zebra:7,meerkat:2,locust:1};
const MEAT_N={cow:2,bull:3,bear:3,snowbear:3,deer:2,camel:3,horse:2,wolf:1,cobra:1,snake:1,penguin:1,bunny:1,sheep:1,chicken:1,cat:0,dog:0,hopper:0,lion:3,tiger:3,elephant:5,zebra:2,meerkat:0,locust:0};
const EDIBLE_HP=ANIMAL_HP;
function edibleNear(){
  if(P.baseY>0.2)return null;
  const f=fwdVec(),ex=P.x,ez=P.z;
  let best=null,bd=.58;
  const bonus=P.sword?.8:0;
  const check=(a,r)=>{
    if(!a||a.held||a.dead)return;
    const p=a.g.position,dx=p.x-ex,dz=p.z-ez,d=Math.hypot(dx,dz);
    if(d>r)return;
    const dot=(dx*f.x+dz*f.z)/(d||1);
    if(dot>bd){bd=dot;best=a;}
  };
  cows.forEach(c=>check(c,3.4+bonus));
  bulls.forEach(b=>{if(!b.ridden)check(b,3.8+bonus);});
  pets.forEach(c=>check(c,3.4+bonus+Math.min(.8,(c.rad||0)*.4)));
  hoppers.forEach(c=>check(c,2.6+bonus));
  persons.forEach(c=>check(c,3.5+bonus));
  bosses.forEach(c=>{if(!c.dead)check(c,5.4+bonus);});
  return best;
}
function dropMeat(x,z){
  const g=new THREE.Group();
  const meat=std(0xb8443a),fat=std(0xf1dcc0),bone=std(0xf6efdf);
  const m=box(.34,.15,.26,meat,0,.09,0);m.rotation.y=rnd(0,TAU);g.add(m);
  g.add(box(.36,.05,.1,fat,0,.16,0));
  g.add(box(.1,.1,.12,bone,0,.09,0));
  g.position.set(x,0,z);g.rotation.y=rnd(0,TAU);
  shade(g);scene.add(g);
  const item={g,meatItem:true,rad:.35,cy:.12,held:false,t:rnd(0,6)};
  meats.push(item);return registerEntity(item,'meat');
}
/* ---------- fruit bushes ---------- */
function buildFruitBush(kind){
  const d=FRUIT_DEFS[kind]||FRUIT_DEFS.berry;
  const g=new THREE.Group();
  const bark=std(0x6a4628),leaf=std(d.leaf),leaf2=std(new THREE.Color(d.leaf).multiplyScalar(.8).getHex());
  if(kind==='apple'){
    g.add(cyl(.13,.17,1.05,bark,0,.52,0,7));
    const crown=sph(.72,leaf,0,1.25,0,8);crown.scale.set(1.12,.86,1.12);g.add(crown);
    const crown2=sph(.5,leaf2,.42,1.02,.18,7);g.add(crown2);
    [[-.38,1.38,.32],[.34,1.52,-.16],[-.05,1.02,.58],[.5,1.12,.42],[-.48,1.02,-.38],[.16,1.72,.12]].forEach(p=>{
      g.add(sph(.14,std(d.col),p[0],p[1],p[2],7));
      g.add(box(.03,.08,.03,bark,p[0],p[1]+.12,p[2]));
    });
  }else{
    const bush=sph(.62,leaf,0,.38,0,8);bush.scale.set(1.1,.72,1.1);g.add(bush);
    g.add(sph(.4,leaf2,.38,.28,.2,7));
    g.add(sph(.34,leaf2,-.34,.3,-.16,7));
    const n=7,mat=std(d.col);
    for(let i=0;i<n;i++){
      const a=i/n*TAU,rr=.25+rand()*.38;
      g.add(sph(.075,mat,Math.cos(a)*rr,.35+rand()*.4,Math.sin(a)*rr,6));
    }
  }
  shade(g);return g;
}
function spawnFruitBush(kind,x,z){
  const g=buildFruitBush(kind);
  g.position.set(x,0,z);g.rotation.y=rnd(0,TAU);scene.add(g);
  const f={g,fruit:true,kind,eaten:false,rad:.55,cy:.55,t:rnd(0,6),baseY:0};
  fruits.push(f);return registerEntity(f,'fruit');
}
function fruitSpot(B,rMin,rMax){
  for(let i=0;i<40;i++){
    const a=rnd(0,TAU),d=rnd(rMin,rMax),x=B.x+Math.cos(a)*d,z=B.z+Math.sin(a)*d;
    if(LAKES.some(L=>Math.hypot(x-L.x,z-L.z)<L.r+2))continue;
    if(riverAt(x,z))continue;
    if(solids.some(s=>Math.hypot(s.x-x,s.z-z)<s.r+2))continue;
    if(fruits.some(f=>Math.hypot(f.g.position.x-x,f.g.position.z-z)<3))continue;
    if(chests.some(c=>Math.hypot(c.g.position.x-x,c.g.position.z-z)<3))continue;
    return {x,z};
  }
  return null;
}
function scatterFruits(){
  const kinds=['apple','blueberry','strawberry','blackberry','berry'];
  const counts={apple:10,blueberry:12,strawberry:12,blackberry:10,berry:12};
  kinds.forEach(kind=>{
    for(let i=0;i<counts[kind];i++){
      const sp=fruitSpot({x:0,z:0},10,52*S);
      if(sp)spawnFruitBush(kind,sp.x,sp.z);
    }
  });
  /* a few berry patches follow the warmer islands */
  for(const B of [SAVAN,DESERT]){
    for(let i=0;i<6;i++){
      const sp=fruitSpot(B,8,B.r*.8);
      if(sp)spawnFruitBush(i%2?'berry':'strawberry',sp.x,sp.z);
    }
  }
}
function targetFruit(){
  if(P.baseY>0.2||P.holding||P.ride)return null;
  const f=fwdVec(),ex=P.x,ez=P.z;let best=null,bd=.45;
  fruits.forEach(a=>{
    if(a.eaten)return;
    const p=a.g.position,dx=p.x-ex,dz=p.z-ez,d=Math.hypot(dx,dz);
    if(d>3.1)return;
    const dot=(dx*f.x+dz*f.z)/(d||1);
    if(dot>bd){bd=dot;best=a;}
  });
  return best;
}
function eatFruit(f){
  if(!f||f.eaten)return;
  const d=FRUIT_DEFS[f.kind]||FRUIT_DEFS.berry;
  f.eaten=true;
  if(f.id)entitiesById.delete(f.id);
  burst(f.g.position.x,.65,f.g.position.z,d.col,12);
  scene.remove(f.g);
  const i=fruits.indexOf(f);if(i>=0)fruits.splice(i,1);
  P.hunger=Math.min(HUNGER_MAX,(P.hunger==null?HUNGER_MAX:P.hunger)+d.hunger);
  P.hp=Math.min(HEART_MAX,(P.hp||0)+d.hp);
  updateHunger();updateHearts();
  toast('Ate '+d.name.toLowerCase()+' — hunger +'+d.hunger.toFixed(1)+(d.hp>0?' and +'+d.hp+' heart':''));
}
function updateFruits(t){
  for(const f of fruits){
    if(!f.g)continue;
    f.g.rotation.z=Math.sin(t*1.4+f.t)*.025;
    f.g.position.y=f.baseY+Math.abs(Math.sin(t*1.1+f.t))*.015;
  }
}
/* =====================================================================
   ENDGAME: Raoar (snow), Lala (desert), the sealed portal and Pni's sky
   parkour.  The two wardens drop gold relics; both relics open the portal
   near spawn; the sky course ends in Pni, the 2000 HP final boss.
   ===================================================================== */
const BOSS_DEFS=[
  {id:'raoar',name:'Raoar',title:'Frost Warden',maxHp:1005,biome:'snow',arena:BOSS_ARENAS.snow,entrance:Math.PI/2,rad:2.8,cy:3.4,speed:2.6,melee:8,rangedCd:3.4},
  {id:'lala', name:'Lala', title:'Dune Sovereign',maxHp:1000,biome:'desert',arena:BOSS_ARENAS.desert,entrance:0,rad:3.2,cy:2.9,speed:3.1,melee:9,rangedCd:3.0},
  {id:'pni',  name:'Pni',  title:'The Strongest',maxHp:2000,biome:'pni',arena:null,entrance:0,rad:4.4,cy:7.5,speed:4.2,melee:11,rangedCd:2.4},
];
const bosses=[],relicItems=[],bossShots=[],bossWaves=[];
const SWORD_BY_NAME=Object.fromEntries(SWORD_DEFS.map((d,i)=>[d.name,i]));
let bossWorldRoot=null,portalRoot=null,portalDisc=null,portalGlow=null,portalBeam=null,portalRunes=[];
let portalOpen=false,portalLit=false,pniFight=false,pniDefeated=false,winPending=0,gameWon=false,winOpen=false;
let pniBarrier=null,pniNextMarker=null,pniReturnPortal=null,pniRealmRoot=null;
const bossArenaRoots=[],bossBeams=[];
let netRelicCount=0;
const mapSeen={raoar:false,lala:false};
const PNI={
  x:2400,z:2400,
  startTop:80,failY:56,
  start:{x:0,z:18,w:9,d:9},
  arena:{x:0,z:-26,r:13,top:92.5},
  platforms:[],checkpoints:[],
};

function makeWorldLabel(lines,bg,fg,w,h){
  const cv=document.createElement('canvas');cv.width=512;cv.height=256;
  const g=cv.getContext('2d');
  g.fillStyle=bg||'#24331c';g.fillRect(0,0,512,256);
  g.strokeStyle=fg||'#fff7dc';g.lineWidth=12;g.strokeRect(10,10,492,236);
  g.textAlign='center';g.textBaseline='middle';
  g.fillStyle=fg||'#fff7dc';g.font='bold 58px Titan One, Arial Black, sans-serif';
  const arr=Array.isArray(lines)?lines:[lines];
  arr.forEach((line,i)=>g.fillText(line,256,128+(i-(arr.length-1)/2)*68));
  const tex=new THREE.CanvasTexture(cv);tex.anisotropy=4;
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w||8,h||4),new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide}));
  mesh.userData.noCull=true;
  return mesh;
}

function buildRaoarModel(){
  const g=new THREE.Group();
  const stone=std(0x3d4756),stone2=std(0x2b3340),stone3=std(0x515e70),ice=std(0x9fe8ff),ice2=std(0x62c4e8),dark=std(0x141a24),gold=std(0xc9a24a);
  const eye=new THREE.MeshBasicMaterial({color:0xb9f7ff});
  const armL=pivot(g,-1.55,3.2,0),armR=pivot(g,1.55,3.2,0);
  [armL,armR].forEach((a,i)=>{
    a.add(box(.62,.95,.62,stone,0,-.48,0));
    a.add(box(.72,.38,.72,stone3,0,-1.02,0));
    const f=box(.86,.7,.78,stone2,0,-1.48,0);f.rotation.x=.1;a.add(f);
    for(let k=0;k<3;k++)a.add(box(.16,.52,.16,ice,(i?.28:-.28)+k*.1,-.95,-.15+k*.12));
    a.add(box(.2,.28,.2,dark,i?-.36:.36,-1.47,.22));
  });
  const legL=pivot(g,-.62,1.55,0),legR=pivot(g,.62,1.55,0);
  [legL,legR].forEach((l,i)=>{
    l.add(box(.7,1.05,.7,stone2,0,-.52,0));
    l.add(box(.82,.4,.86,stone,0,-1.15,0));
    l.add(box(.78,.2,1.02,dark,0,-1.34,.08));
    l.add(box(.22,.58,.22,ice,i?-.24:.24,-.55,.2));
  });
  const torso=box(2.3,2.15,1.35,stone,0,2.7,0);g.add(torso);
  g.add(box(1.55,.8,.16,stone3,0,2.9,.7));
  g.add(box(.22,.5,.18,ice,0,2.9,.81));
  g.add(box(1.7,.3,1.5,stone2,0,1.75,0));
  const head=pivot(g,0,4.15,0);
  head.add(box(1.15,1.05,1.02,stone2,0,0,0));
  head.add(box(1.22,.22,.18,stone3,0,.28,.55));
  head.add(box(.24,.18,.08,eye,-.27,.03,.57));
  head.add(box(.24,.18,.08,eye,.27,.03,.57));
  head.add(box(.55,.15,.1,dark,0,-.28,.57));
  [-1,1].forEach(s=>{
    const horn=cone(.14,.82,ice2,s*.6,.75,0,5);horn.rotation.z=-s*.35;head.add(horn);
  });
  g.add(head);
  /* shoulder boulders and a crown of ice */
  [-1,1].forEach(s=>{
    g.add(box(.72,.72,.9,stone3,s*1.35,3.75,0));
    const spike=cone(.27,1.25,ice,s*1.5,4.5,0,5);spike.rotation.z=-s*.3;g.add(spike);
  });
  for(let k=0;k<4;k++){const c=cone(.16,.9,ice,-.65+k*.43,4.1,-.5,5);c.rotation.x=-.25;g.add(c);}
  g.add(box(.42,.15,.12,gold,0,2.35,.73));
  shade(g);g.scale.setScalar(1.12);
  return {g,parts:{armL,armR,legL,legR,head,eyes:[eye]}};
}

function buildLalaModel(){
  const g=new THREE.Group();
  const sand=std(0xc9a05a),sand2=std(0xa87a3a),sand3=std(0xe0c078),dark=std(0x3a2a18),gold=std(0xd8b04a),claw=std(0xf0e0b0);
  const eye=new THREE.MeshBasicMaterial({color:0xffb23a});
  const legL=pivot(g,-1.25,1.2,0),legR=pivot(g,1.25,1.2,0);
  [legL,legR].forEach((l,i)=>{
    l.add(box(1.0,1.15,1.0,sand2,0,-.55,0));
    l.add(box(1.15,.35,1.25,sand,0,-1.1,.08));
    for(let k=-1;k<=1;k++)l.add(cone(.11,.4,claw,k*.28,-1.26,1.0,4));
  });
  const body=sph(1.8,sand,0,2.35,0,9);body.scale.set(1.35,1.0,1.1);g.add(body);
  g.add(box(3.6,.55,2.4,sand2,0,1.55,0));
  g.add(box(2.8,1.0,2.2,sand3,0,2.55,.2));
  const head=pivot(g,0,3.65,1.25);
  head.add(box(2.05,1.65,1.6,sand,0,0,0));
  head.add(box(1.7,.55,.35,sand3,0,-.55,.82));
  head.add(box(.3,.22,.08,eye,-.5,.12,.83));
  head.add(box(.3,.22,.08,eye,.5,.12,.83));
  head.add(box(.7,.18,.12,dark,0,-.28,.82));
  [-1,1].forEach(s=>{
    const tusk=cone(.1,.5,claw,s*.55,-.55,.86,5);tusk.rotation.x=Math.PI/2;head.add(tusk);
  });
  g.add(head);
  const earL=pivot(g,-1.15,4.2,1.0),earR=pivot(g,1.15,4.2,1.0);
  [earL,earR].forEach((e,i)=>{
    const ear=box(1.1,2.3,.38,sand,i?-.5:0,0,0);ear.rotation.z=i?.18:-.18;e.add(ear);
    e.add(box(.7,1.7,.12,sand3,i?-.5:0,0,.22));
    e.add(box(.12,.9,.12,dark,i?-.5:0,.1,.29));
  });
  /* back plates and a little saddle of gold */
  for(let k=0;k<5;k++){const c=cone(.2,.8,sand2,-.8+k*.4,3.4,-1.0,5);c.rotation.x=-.3;g.add(c);}
  g.add(box(1.5,.18,1.2,gold,0,3.12,-.35));
  g.add(box(.55,.2,.2,gold,0,3.32,-.35));
  shade(g);g.scale.setScalar(1.18);
  return {g,parts:{legL,legR,head,earL,earR}};
}

function buildPniModel(){
  const g=new THREE.Group();
  const white=std(0xdce8f2),white2=std(0xb8cede),blue=std(0x6a9ac8),blue2=std(0x3f6fa8),dark=std(0x1a2430),gold=std(0xd8b04a);
  const eye=new THREE.MeshBasicMaterial({color:0x9fe8ff});
  const legL=pivot(g,-1.2,4.2,0),legR=pivot(g,1.2,4.2,0);
  [legL,legR].forEach((l,i)=>{
    l.add(box(.42,2.6,.45,white2,0,-1.3,0));
    l.add(box(.55,.25,1.1,gold,0,-2.6,.28));
    for(let k=-1;k<=2;k++)l.add(cone(.09,.42,dark,k*.16,-2.72,.75,4));
  });
  const body=sph(2.3,white,0,7.1,0,10);body.scale.set(1.25,1.15,1.7);g.add(body);
  g.add(box(3.2,1.9,3.2,white2,0,6.8,-.4));
  const neck=pivot(g,0,7.8,1.0);
  neck.add(box(1.0,4.1,1.0,white,0,1.8,.25));
  neck.add(box(1.2,.5,1.2,blue2,0,1.5,.25));
  const head=pivot(neck,0,3.95,.35);
  head.add(box(2.05,1.8,1.9,white,0,0,0));
  head.add(box(1.55,.55,.4,white2,0,.45,.95));
  head.add(box(.34,.26,.1,eye,-.5,.1,1.0));
  head.add(box(.34,.26,.1,eye,.5,.1,1.0));
  const beak=cone(.42,2.0,gold,0,-.15,1.85,7);beak.rotation.x=Math.PI/2;head.add(beak);
  head.add(box(.16,.2,.16,dark,-.36,.62,1.0));head.add(box(.16,.2,.16,dark,.36,.62,1.0));
  neck.add(head);g.add(neck);
  const wingL=pivot(g,-1.9,7.8,0),wingR=pivot(g,1.9,7.8,0);
  [wingL,wingR].forEach((w,i)=>{
    w.add(box(4.8,.35,2.6,white2,i?2.4:-2.4,0,-.2));
    w.add(box(3.8,.2,1.8,white,i?3.1:-3.1,.25,-.5));
    for(let k=0;k<4;k++){
      const f=box(1.0,.12,2.8,blue,i?(1.0+k*.95):-(1.0+k*.95),-.08,-1.7);
      f.rotation.y=(i?-1:1)*.18;w.add(f);
    }
  });
  /* tail fan */
  for(let k=-2;k<=2;k++){
    const f=box(.75,.14,3.1,white2,k*.55,6.1,-2.4);
    f.rotation.x=-.25;f.rotation.y=k*.12;g.add(f);
  }
  g.add(box(2.4,.25,.3,gold,0,8.2,.95));
  shade(g);
  return {g,parts:{legL,legR,neck,head,wings:[wingL,wingR]}};
}

function buildBossModel(id){
  if(id==='raoar')return buildRaoarModel();
  if(id==='lala')return buildLalaModel();
  return buildPniModel();
}

function spawnBoss(def){
  const model=buildBossModel(def.id);
  const g=model.g;
  const b={
    g,parts:model.parts,boss:true,bossId:def.id,name:def.name,title:def.title,
    hp:def.maxHp,maxHp:def.maxHp,dead:false,deadT:0,aggro:false,sealed:false,
    phase:1,t:rnd(0,8),atk:rnd(1.5,3),windup:0,pending:null,hitT:0,roarT:0,
    rad:def.rad,cy:def.cy,speed:def.speed,melee:def.melee,rangedCd:def.rangedCd,
    baseY:0,homeX:0,homeZ:0,
  };
  b.id='boss_'+def.id;
  if(def.id==='pni'){
    b.baseY=PNI.arena.top;
    b.homeX=PNI.arena.x;b.homeZ=PNI.arena.z-7;
    g.position.set(b.homeX,b.baseY,b.homeZ);
    g.rotation.y=Math.PI;
  }else{
    const A=def.arena;
    const ex=Math.cos(def.entrance),ez=Math.sin(def.entrance);
    b.homeX=A.x-ex*4;b.homeZ=A.z-ez*4;
    g.position.set(b.homeX,0,b.homeZ);
    g.rotation.y=Math.atan2(-ex,-ez);
  }
  scene.add(g);
  bosses.push(b);
  registerEntity(b,'boss');
  return b;
}

function buildBossArena(def){
  const A=def.arena,snow=def.id==='raoar';
  const root=new THREE.Group();root.position.set(A.x,0,A.z);scene.add(root);bossArenaRoots.push(root);
  const stoneA=snow?std(0x6f8494):std(0xc9a05a);
  const stoneB=snow?std(0x536777):std(0xa87a3a);
  const stoneC=snow?std(0x9ab4c4):std(0xe0c078);
  const glowCol=snow?0x9fe8ff:0xffb23a;
  const ex=Math.cos(def.entrance),ez=Math.sin(def.entrance);
  const px=-ez,pz=ex;
  const floor=cyl(A.r+4,A.r+4,.24,stoneA,0,.12,0,36);floor.receiveShadow=true;root.add(floor);
  root.add(cyl(A.r+2,A.r+2.2,.3,stoneB,0,.19,0,36));
  /* rune rings */
  const runeMat=new THREE.MeshBasicMaterial({color:glowCol,transparent:true,opacity:.55,side:THREE.DoubleSide,depthWrite:false});
  const ring=new THREE.Mesh(new THREE.RingGeometry(5.2,5.8,40),runeMat);ring.rotation.x=-Math.PI/2;ring.position.y=.28;root.add(ring);
  const ring2=new THREE.Mesh(new THREE.RingGeometry(11.5,12.0,40),runeMat);ring2.rotation.x=-Math.PI/2;ring2.position.y=.28;root.add(ring2);
  for(let k=0;k<8;k++){
    const a=k/8*TAU+.2;
    const r=box(.22,.06,2.6,stoneC,Math.cos(a)*8.6,.31,Math.sin(a)*8.6);
    r.rotation.y=-a;root.add(r);
  }
  /* ring wall with one wide entrance */
  for(let k=0;k<20;k++){
    const a=k/20*TAU;
    let da=Math.atan2(Math.sin(a-def.entrance),Math.cos(a-def.entrance));
    if(Math.abs(da)<.31)continue;
    const wx=Math.cos(a)*22,wz=Math.sin(a)*22;
    const wall=box(7.4,snow?5.2:4.8,2.5,k%3?stoneB:stoneA,wx,(snow?2.6:2.4),wz);
    wall.rotation.y=-a+Math.PI/2;root.add(wall);
    const cap=box(7.7,.55,2.9,stoneC,wx,(snow?5.3:4.9),wz);cap.rotation.y=-a+Math.PI/2;root.add(cap);
    solids.push({x:A.x+wx,z:A.z+wz,r:4.2});
    if(k%4===0){
      const spike=cone(.45,snow?2.2:1.5,snow?std(0xdff6ff):std(0x8a5a2c),wx,(snow?6.5:5.8),wz,5);
      spike.rotation.z=.08;root.add(spike);
    }
  }
  /* entrance arch and sign */
  const arch=new THREE.Group();arch.position.set(ex*22,.2,ez*22);arch.rotation.y=Math.atan2(ex,ez);root.add(arch);
  [-4.2,4.2].forEach(x=>{
    arch.add(box(1.35,6.4,1.35,stoneA,x,3.2,0));
    arch.add(box(1.7,.45,1.7,stoneC,x,6.45,0));
  });
  arch.add(box(10.2,1.15,1.5,stoneC,0,7.0,0));
  arch.add(box(8.4,.22,1.7,stoneB,0,7.62,0));
  const banner=new THREE.Mesh(new THREE.PlaneGeometry(7.4,3.4),new THREE.MeshBasicMaterial({color:snow?0x2f5f8a:0x8a4a22,side:THREE.DoubleSide}));
  banner.position.set(0,5.2,.8);arch.add(banner);
  const sign=makeWorldLabel([def.id==='raoar'?"RAOAR'S LAIR":"LALA'S LAIR",'DUNGEON'],snow?'#1d3448':'#4a2a14','#fff7dc',7.2,3.6);
  sign.position.set(0,5.2,1.0);arch.add(sign);
  /* torches */
  const flames=[];
  for(let k=0;k<6;k++){
    const a=def.entrance+Math.PI*.35+k/6*TAU*1.05;
    if(Math.abs(Math.atan2(Math.sin(a-def.entrance),Math.cos(a-def.entrance)))<.38)continue;
    const tx=Math.cos(a)*18.5,tz=Math.sin(a)*18.5;
    root.add(cyl(.18,.25,2.6,stoneB,tx,1.3,tz,7));
    const f=new THREE.Mesh(new THREE.SphereGeometry(.35,7,6),new THREE.MeshBasicMaterial({color:snow?0x9fe8ff:0xffb23a}));
    f.position.set(tx,2.8,tz);root.add(f);flames.push(f);
  }
  root.userData.flames=flames;
  /* armory chest just inside the mouth, vault chest at the back */
  const armX=ex*13+px*7.2,armZ=ez*13+pz*7.2;
  const arm=spawnChest(A.x+armX,A.z+armZ);
  arm.loot=snow?'armorySnow':'armoryDesert';arm.fixedLoot=arm.loot;
  arm.g.rotation.y=Math.atan2(-armX,-armZ);
  const armLabel=makeWorldLabel('ARMORY','#24331c','#f1c24b',3.2,1.6);armLabel.position.set(A.x+armX,2.2,A.z+armZ);armLabel.rotation.y=arm.g.rotation.y;scene.add(armLabel);
  const vx=-ex*13,vz=-ez*13;
  const vault=spawnChest(A.x+vx,A.z+vz);
  vault.loot=snow?'vaultSnow':'vaultDesert';vault.fixedLoot=vault.loot;vault.lockedBoss=def.id;
  vault.g.rotation.y=Math.atan2(-vx,-vz);
  const vaultLabel=makeWorldLabel('WARDEN VAULT',snow?'#1d3448':'#4a2a14','#f1c24b',4.2,1.8);vaultLabel.position.set(A.x+vx,2.3,A.z+vz);vaultLabel.rotation.y=vault.g.rotation.y;scene.add(vaultLabel);
  /* dais and sword rack behind the vault */
  root.add(cyl(2.5,2.9,.55,stoneC,vx,.45,vz,12));
  const rack=new THREE.Group();rack.position.set(vx*.82-px*7,.2,vz*.82-pz*7);rack.rotation.y=Math.atan2(-vx,-vz);root.add(rack);
  rack.add(box(3.8,2.6,.35,stoneB,0,1.5,0));
  for(let k=0;k<7;k++){
    const sd=SWORD_DEFS[k*3+2];
    const blade=box(.11,.045,1.55,std(sd.col),-1.45+k*.48,1.7,.3);
    blade.rotation.z=.06;rack.add(blade);
    rack.add(box(.28,.08,.1,std(0xc9a24a),-1.45+k*.48,2.45,.3));
    rack.add(box(.12,.4,.12,std(0x5a3a24),-1.45+k*.48,2.7,.3));
  }
  /* beacon visible above the lair */
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.8,120,10,1,true),
    new THREE.MeshBasicMaterial({color:glowCol,transparent:true,opacity:.11,depthWrite:false,side:THREE.DoubleSide}));
  beam.position.set(A.x,60,A.z);beam.userData.noCull=true;scene.add(beam);bossBeams.push(beam);
  return {root,flames,arm,vault,beam};
}

function buildSpawnPortal(){
  const root=new THREE.Group();root.position.set(SPAWN_PORTAL.x,0,SPAWN_PORTAL.z);scene.add(root);portalRoot=root;
  const stone=std(0x4a4f5a),stone2=std(0x353a44),rune=0x9a5aff;
  root.add(cyl(5.2,5.8,.35,stone,0,.17,0,20));
  root.add(cyl(4.2,4.2,.12,stone2,0,.38,0,20));
  [-3.6,3.6].forEach(x=>{
    root.add(box(1.5,6.8,1.6,stone,x,3.5,0));
    root.add(box(1.9,.55,1.9,stone2,x,7.0,0));
    for(let k=0;k<4;k++)root.add(box(.3,.3,.2,stone2,x,1.4+k*1.3,.85));
  });
  const arch=box(8.8,1.25,1.7,stone2,0,7.6,0);root.add(arch);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(3.45,.34,8,32),new THREE.MeshStandardMaterial({color:0x4a3a62,roughness:.7,metalness:.2,flatShading:true}));
  ring.position.set(0,4.1,.1);root.add(ring);
  portalDisc=new THREE.Mesh(new THREE.CircleGeometry(3.1,36),new THREE.MeshBasicMaterial({color:0x2a1f3a,transparent:true,opacity:.86,side:THREE.DoubleSide,depthWrite:false}));
  portalDisc.position.set(0,4.1,.2);root.add(portalDisc);
  portalGlow=new THREE.Mesh(new THREE.CircleGeometry(3.55,36),new THREE.MeshBasicMaterial({color:rune,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));
  portalGlow.position.set(0,4.1,.05);root.add(portalGlow);
  portalRunes=[];
  for(let k=0;k<10;k++){
    const a=k/10*TAU;
    const r=new THREE.Mesh(new THREE.BoxGeometry(.18,.36,.16),new THREE.MeshBasicMaterial({color:0x6a5a7a}));
    r.position.set(Math.cos(a)*4.0,4.1+Math.sin(a)*4.0,.28);root.add(r);portalRunes.push(r);
  }
  portalBeam=new THREE.Mesh(new THREE.CylinderGeometry(1.5,2.4,130,12,1,true),
    new THREE.MeshBasicMaterial({color:rune,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
  portalBeam.position.set(SPAWN_PORTAL.x,66,SPAWN_PORTAL.z);portalBeam.userData.noCull=true;scene.add(portalBeam);
  const sign=makeWorldLabel(['SEALED PORTAL','TWO GOLD RELICS'],'#2a1f3a','#e0c8ff',6.2,3.1);
  sign.position.set(0,8.8,.95);root.add(sign);
  const step=box(7.2,.25,2.2,stone2,0,.3,5.0);root.add(step);
  return root;
}

function buildPniRealm(){
  const root=new THREE.Group();root.position.set(PNI.x,0,PNI.z);scene.add(root);pniRealmRoot=root;
  const rock=std(0x737b88),rock2=std(0x565e6c),rock3=std(0x9aa8b6),moss=std(0x5d9a64),gold=std(0xd8b04a);
  const glow=new THREE.MeshBasicMaterial({color:0x9fe8ff,transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false});
  const addPlatform=(x,z,top,w,d,cp)=>{
    const g=new THREE.Group();g.position.set(x,top,z);root.add(g);
    const slab=box(w,.8,d,rock,0,-.4,0);g.add(slab);
    g.add(box(w+.35,.18,d+.35,rock3,0,.06,0));
    const under=cone(Math.min(w,d)*.56,2.8,rock2,0,-1.75,0,7);under.rotation.x=Math.PI;g.add(under);
    const ring=new THREE.Mesh(new THREE.RingGeometry(Math.min(w,d)*.42,Math.min(w,d)*.5,28),glow);
    ring.rotation.x=-Math.PI/2;ring.position.y=.17;g.add(ring);
    if(cp){
      const pole=cyl(.09,.11,2.4,gold,0,1.2,0,6);g.add(pole);
      const flag=new THREE.Mesh(new THREE.PlaneGeometry(1.0,.62),new THREE.MeshBasicMaterial({color:0xffd24a,side:THREE.DoubleSide}));
      flag.position.set(.55,2.3,0);g.add(flag);
    }
    return g;
  };
  const pts=[
    [0,18,80,9,9,true],[3.4,14.8,80.8,3.8,3.8],[6.2,11.4,81.6,3.8,3.8],
    [5.4,7.4,82.5,4.2,4.2,true],[2.2,5.2,83.3,3.8,3.8],[-1.6,5.2,84.1,3.8,3.8],
    [-4.8,7.4,84.9,4.2,4.2],[-6.2,11.2,85.7,3.8,3.8,true],[-4.8,15.2,86.5,3.8,3.8],
    [-1.2,17.0,87.3,3.8,3.8],[2.2,15.0,88.1,4.2,4.2],[5.0,11.8,88.9,3.8,3.8,true],
    [5.6,7.8,89.7,3.8,3.8],[3.2,4.2,90.5,4.2,4.2],[0.2,1.2,91.3,4.2,4.2],
    [0,-3.0,92.0,4.2,4.2],[0,-7.0,92.5,4.2,4.2,true],
  ];
  PNI.platforms=[];PNI.checkpoints=[];
  pts.forEach((p,i)=>{
    const rec={x:PNI.x+p[0],z:PNI.z+p[1],top:p[2],w:p[3],d:p[4],cp:!!p[5],index:i};
    PNI.platforms.push(rec);
    if(rec.cp)PNI.checkpoints.push(rec);
    addPlatform(p[0],p[1],p[2],p[3],p[4],rec.cp);
  });
  PNI.startPlatform=PNI.platforms[0];
  PNI.arena={x:PNI.x,z:PNI.z-26,r:14,top:92.5};
  /* final arena */
  const arena=new THREE.Group();arena.position.set(0,PNI.arena.top,-26);root.add(arena);
  arena.add(cyl(14.6,15.2,1.1,rock,0,-.55,0,36));
  arena.add(cyl(13.6,13.6,.22,rock3,0,.1,0,36));
  for(let k=0;k<18;k++){
    const a=k/18*TAU;
    arena.add(box(1.0,2.6,1.0,rock2,Math.cos(a)*13.6,1.2,Math.sin(a)*13.6));
    if(k%3===0){
      const c=cone(.32,1.6,std(0x9fe8ff),Math.cos(a)*13.2,2.5,Math.sin(a)*13.2,5);arena.add(c);
    }
  }
  const sig=new THREE.Mesh(new THREE.RingGeometry(5.0,5.8,36),glow);sig.rotation.x=-Math.PI/2;sig.position.y=.24;arena.add(sig);
  /* Pni's perch */
  const perch=new THREE.Group();perch.position.set(0,0,-7);arena.add(perch);
  perch.add(cyl(3.2,4.2,1.6,rock2,0,.8,0,10));
  for(let k=0;k<5;k++){
    const c=cone(.3,2.2,rock3,Math.cos(k/5*TAU)*2.3,2.0,Math.sin(k/5*TAU)*2.3,5);perch.add(c);
  }
  const throne=box(2.6,.35,1.2,gold,0,1.75,0);perch.add(throne);
  /* barrier for the fight */
  pniBarrier=new THREE.Mesh(new THREE.CylinderGeometry(14.4,14.4,11,36,1,true),
    new THREE.MeshBasicMaterial({color:0x9fe8ff,transparent:true,opacity:.18,side:THREE.DoubleSide,depthWrite:false}));
  pniBarrier.position.set(0,5.5,-26);pniBarrier.visible=false;root.add(pniBarrier);
  /* floating decoration and clouds */
  for(let k=0;k<16;k++){
    const a=rnd(0,TAU),r=rnd(18,34),y=rnd(70,104);
    const c=cone(rnd(.6,1.6),rnd(2,5),rock2,Math.cos(a)*r,y,Math.sin(a)*r,6);c.rotation.z=rnd(-.3,.3);root.add(c);
  }
  const cloudMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.55});
  for(let k=0;k<14;k++){
    const c=new THREE.Mesh(new THREE.SphereGeometry(rnd(2.4,5),7,6),cloudMat);
    c.position.set(rnd(-40,40),rnd(72,108),rnd(-40,40));c.scale.y=.35;root.add(c);
  }
  /* return portal on the start island */
  pniReturnPortal=new THREE.Group();pniReturnPortal.position.set(0,80.12,21.2);root.add(pniReturnPortal);
  pniReturnPortal.add(cyl(.9,.9,.25,rock2,0,.12,0,12));
  const rr=new THREE.Mesh(new THREE.TorusGeometry(1.65,.18,8,24),new THREE.MeshStandardMaterial({color:0x6a4a8a,roughness:.7,flatShading:true}));
  rr.position.y=2.0;pniReturnPortal.add(rr);
  const rd=new THREE.Mesh(new THREE.CircleGeometry(1.5,26),new THREE.MeshBasicMaterial({color:0x9a5aff,transparent:true,opacity:.55,side:THREE.DoubleSide,depthWrite:false}));
  rd.position.set(0,2.0,.05);pniReturnPortal.add(rd);
  const back=makeWorldLabel(['RETURN','PASTURE'],'#2a1f3a','#e0c8ff',2.8,1.4);back.position.set(0,4.0,.1);pniReturnPortal.add(back);
  /* next-platform beacon */
  pniNextMarker=new THREE.Mesh(new THREE.ConeGeometry(.55,1.1,5),new THREE.MeshBasicMaterial({color:0xffd24a}));
  pniNextMarker.rotation.x=Math.PI;root.add(pniNextMarker);
  const title=makeWorldLabel(["PNI'S SKY PATH",'CLIMB THE STONES'],'#1a2430','#9fe8ff',10,4.6);
  title.position.set(0,84.2,24.5);root.add(title);
  return root;
}

function spawnRelic(b){
  const g=new THREE.Group();
  const rock=std(0x4a3f2a),gold=std(0xd8b04a),shine=new THREE.MeshBasicMaterial({color:0xffe08a});
  const base=sph(.52,rock,0,.3,0,8);base.scale.y=.7;g.add(base);
  for(let k=0;k<5;k++){
    const a=k/5*TAU;
    const c=cone(.14,.55,gold,Math.cos(a)*.3,.62,Math.sin(a)*.3,5);
    c.rotation.z=Math.cos(a)*.35;c.rotation.x=Math.sin(a)*.35;g.add(c);
  }
  g.add(sph(.14,shine,0,.72,0,7));
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.68,.05,6,20),shine);
  ring.rotation.x=Math.PI/2;ring.position.y=.3;g.add(ring);
  g.position.set(b.g.position.x,.1,b.g.position.z);scene.add(g);
  const item={g,relic:true,bossId:b.bossId,rad:.65,cy:.55,held:false,t:rnd(0,6),baseY:.1,ring};
  relicItems.push(item);registerEntity(item,'relic');return item;
}
function targetRelic(){
  if(P.baseY>0.2||P.holding||P.ride)return null;
  const f=fwdVec(),ex=P.x,ez=P.z;let best=null,bd=.4;
  relicItems.forEach(r=>{
    if(r.taken)return;
    const p=r.g.position,dx=p.x-ex,dz=p.z-ez,d=Math.hypot(dx,dz);
    if(d>3.6)return;
    const dot=(dx*f.x+dz*f.z)/(d||1);
    if(dot>bd){bd=dot;best=r;}
  });
  return best;
}
function pickupRelic(r){
  if(!r||r.taken)return;
  r.taken=true;
  if(r.id)entitiesById.delete(r.id);
  scene.remove(r.g);
  const i=relicItems.indexOf(r);if(i>=0)relicItems.splice(i,1);
  P.relics.add(r.bossId);
  updateRelicHud();
  burst(r.g.position.x,.9,r.g.position.z,0xffe08a,24);
  const both=hasBothRelics();
  toast('Gold relic recovered ('+P.relics.size+'/2)'+(both?' — the portal near spawn is awake!':' — find the other warden'));
  if(both){portalLit=true;updatePortalVisual(0,clock);}
}
function hasBothRelics(){return P.relics.has('raoar')&&P.relics.has('lala');}
function updateRelicHud(){
  const n=$('relicN');
  if(n)n.textContent='◇ '+Math.max(P.relics.size,netRelicCount)+'/2';
  const pill=$('relicPill');if(pill)pill.classList.toggle('done',hasBothRelics()||portalOpen);
}
function buildBossWorld(){
  if(bossWorldRoot){scene.remove(bossWorldRoot);bossWorldRoot=null;}
  bosses.forEach(b=>scene.remove(b.g));bosses.length=0;
  relicItems.forEach(r=>scene.remove(r.g));relicItems.length=0;
  clearBossHazards();
  bossArenaRoots.splice(0).forEach(r=>scene.remove(r));
  bossBeams.splice(0).forEach(b=>scene.remove(b));
  if(portalRoot){scene.remove(portalRoot);portalRoot=null;}
  if(portalBeam){scene.remove(portalBeam);portalBeam=null;}
  if(pniRealmRoot){scene.remove(pniRealmRoot);pniRealmRoot=null;}
  portalOpen=false;portalLit=false;pniFight=false;pniDefeated=false;winPending=0;gameWon=false;winOpen=false;
  portalDisc=null;portalGlow=null;portalBeam=null;portalRunes=[];
  pniBarrier=null;pniNextMarker=null;pniReturnPortal=null;
  BOSS_DEFS.forEach(def=>{
    if(def.id==='pni')return;
    buildBossArena(def);
    spawnBoss(def);
  });
  buildSpawnPortal();
  buildPniRealm();
  spawnBoss(BOSS_DEFS[2]);
  updateRelicHud();updateGearHud();updateBossBar();
}

/* ---------- endgame progression, combat and HUD ---------- */
function bossById(id){for(const b of bosses)if(b.bossId===id)return b;return null;}
function bossAlive(id){const b=bossById(id);return !!(b&&!b.dead);}
function nearestBoss(maxD){
  let best=null,bd=maxD==null?1e9:maxD;
  for(const b of bosses){
    if(b.dead)continue;
    const d=Math.hypot(P.x-b.g.position.x,P.z-b.g.position.z);
    if(d<bd){bd=d;best=b;}
  }
  return best;
}
function updateGearHud(){
  const ap=$('armorPill'),an=$('armorN');
  if(ap){
    ap.hidden=!(P.armorRed>0);
    if(an)an.textContent=Math.round((P.armorRed||0)*100)+'%';
    ap.title=(P.armorName||'Traveler Clothes')+' — blocks '+Math.round((P.armorRed||0)*100)+'% of incoming damage';
  }
  const sp=$('swordPill'),sn=$('swordName'),sd=$('swordDmg');
  if(sp){
    sp.hidden=!P.sword;
    const d=SWORD_DEFS[P.swordIdx]||SWORD_DEFS[0];
    if(sn)sn.textContent=P.sword?d.name:'Sword';
    if(sd)sd.textContent=P.sword?String(P.swordDmg||d.dmg):'';
    sp.title=P.sword?d.name+' — '+P.swordDmg+' damage. Press Q to cycle owned swords.':'Find a sword in a chest';
  }
  updateRelicHud();
  updateAmmoHud();
}
function giveSword(i,silent){
  let idx=i;
  if(idx==null||idx<0||idx>=SWORD_DEFS.length){
    const pool=[];
    for(let k=0;k<SWORD_DEFS.length;k++)if(!P.swords.has(k))pool.push(k);
    idx=pool.length?pool[Math.floor(rand()*pool.length)]:P.swordIdx;
  }
  const d=SWORD_DEFS[idx];
  if(!d)return false;
  const isNew=!P.swords.has(idx);
  P.swords.add(idx);
  P.sword=true;P.swordIdx=idx;P.swordDmg=d.dmg;
  setSwordSkin(d);
  swordRoot.visible=true;
  updateGearHud();
  if(!silent)toast(isNew?'Chest: '+d.name+'! '+d.dmg+' damage — press Q to cycle swords':'Chest: '+d.name+' polish — already owned');
  return isNew;
}
function cycleSword(){
  if(!P.sword)return;
  const owned=Array.from(P.swords).sort((a,b)=>a-b);
  if(!owned.length)return;
  const at=owned.indexOf(P.swordIdx);
  P.swordIdx=owned[(at+1)%owned.length];
  const d=SWORD_DEFS[P.swordIdx];
  P.swordDmg=d.dmg;setSwordSkin(d);updateGearHud();
  toast(d.name+' — '+d.dmg+' damage');
}
function giveArmor(id,silent){
  const d=typeof id==='string'?armorDef(id):null;
  if(!d)return false;
  if(d.red<=P.armorRed+.001){
    if(!silent)toast('Chest: '+d.name+' — your current armor is already stronger');
    return false;
  }
  P.armorName=d.name;P.armorRed=d.red;
  updateGearHud();
  if(!silent)toast('Chest: '+d.name+'! Damage blocked: '+Math.round(d.red*100)+'%');
  return true;
}
function bestArmorUpgrade(){
  const pool=ARMOR_DEFS.filter(a=>a.red>P.armorRed+.001);
  return pool.length?pool[Math.min(pool.length-1,Math.floor(rand()*pool.length))]:null;
}
function updateBossBar(){
  const el=$('bossbar');
  if(!el)return;
  let show=null;
  if(pniFight&&bossAlive('pni'))show=bossById('pni');
  else{
    const b=nearestBoss(75);
    if(b&&b.aggro&&(P.realm==null||b.bossId==='pni'))show=b;
  }
  if(!show){
    el.hidden=true;
    document.body.classList.remove('bossbar');
    return;
  }
  const wasHidden=el.hidden;
  el.hidden=false;
  document.body.classList.add('bossbar');
  const r=clamp((show.hp==null?show.maxHp:show.hp)/show.maxHp,0,1);
  const name=$('bossName'),hpN=$('bossHpN'),fill=$('bossFill'),hint=$('bossHint');
  if(name)name.textContent=show.name;
  if(hpN)hpN.textContent=Math.max(0,Math.ceil(show.hp))+' / '+show.maxHp;
  if(fill)fill.style.width=(r*100)+'%';
  if(hint)hint.textContent=show.title+(show.phase>1?' — ENRAGED':pniFight?' — FINAL BATTLE':'');
  el.classList.toggle('enraged',show.phase>1||r<.28);
  if(wasHidden)syncBossbarOffset();
}
/* the toast sits under the boss bar; keep clear of however many HUD rows wrapped */
function syncBossbarOffset(){
  const bar=$('bossbar');
  if(!bar||bar.hidden)return;
  document.documentElement.style.setProperty('--bossbar-bottom',Math.round(bar.getBoundingClientRect().bottom)+'px');
}
if(typeof window!=='undefined')window.addEventListener('resize',syncBossbarOffset);
function updatePortalVisual(dt,t){
  const ready=hasBothRelics()||portalOpen;
  if(portalDisc){
    const m=portalDisc.material;
    m.color.setHex(portalOpen?0x9a5aff:ready?0x634a8a:0x2a1f3a);
    m.opacity=portalOpen?.78+Math.sin(t*3.2)*.08:.84;
    portalDisc.rotation.z+=dt*(portalOpen?1.35:.1);
  }
  if(portalGlow){
    portalGlow.material.opacity=portalOpen?.34+Math.sin(t*2.6)*.12:ready?.15+Math.sin(t*1.5)*.06:0;
    portalGlow.rotation.z-=dt*.5;
  }
  if(portalBeam)portalBeam.material.opacity=portalOpen?.2+Math.sin(t*1.8)*.05:ready?.055:0;
  for(let i=0;i<portalRunes.length;i++){
    const r=portalRunes[i];
    r.rotation.z+=dt*(portalOpen?2.6:.35);
    r.material.color.setHex(portalOpen?0xd8b4ff:ready?0xc9a24a:0x6a5a7a);
  }
}
function targetPortal(){
  if(P.ride||P.holding)return null;
  if(P.realm==='pni'){
    if(!pniReturnPortal)return null;
    const d=Math.hypot(P.x-pniReturnPortal.position.x,P.z-pniReturnPortal.position.z);
    return d<4.8&&Math.abs(P.jy-80.12)<4?'return':null;
  }
  const d=Math.hypot(P.x-SPAWN_PORTAL.x,P.z-SPAWN_PORTAL.z);
  return d<7.2&&P.baseY<2?'spawn':null;
}
function usePortal(which){
  if(which==='return'){leavePniRealm();return;}
  if(P.realm==='pni')return;
  if(!hasBothRelics()){
    toast('The portal is sealed — defeat Raoar and Lala for both gold relics');
    return;
  }
  if(!portalOpen){
    portalOpen=true;portalLit=true;
    P.portalCool=.9;
    updatePortalVisual(0,clock);updateRelicHud();
    burst(SPAWN_PORTAL.x,4.2,SPAWN_PORTAL.z,0x9a5aff,30);
    toast('The two relics unlock the portal — press F again to step through');
    return;
  }
  if(P.portalCool>0)return;
  enterPniRealm();
}
function enterPniRealm(){
  if(P.realm==='pni')return;
  if(P.ride)dismountRide();
  if(P.holding)release();
  if(!pniDefeated)resetPniEncounter(false);
  P.realm='pni';P.pniCp=0;P.pniCpAt=clock;
  const S=PNI.startPlatform;
  P.pniSupport=S;
  P.x=S.x;P.z=S.z;P.baseY=0;P.jy=S.top;P.jv=0;
  P.kx=0;P.kz=0;P.fl=0;P.bump=1.2;P.sw=0;P.inW=false;P.tower=-1;P.lift=null;P.tornado=null;
  for(const k in keys)keys[k]=false;
  state='play';
  const fl=$('flash');if(fl){fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),180);}
  burst(P.x,P.jy+.8,P.z,0x9a5aff,26);
  toast("Pni's sky path — jump the stones and reach the arena");
  updateBossBar();
}
function leavePniRealm(){
  if(P.realm!=='pni')return;
  P.realm=null;P.pniSupport=null;P.pniFight=false;
  if(pniBarrier)pniBarrier.visible=false;
  P.x=SPAWN_PORTAL.x;P.z=SPAWN_PORTAL.z+9;P.baseY=0;P.jy=0;P.jv=0;
  P.kx=0;P.kz=0;P.fl=0;P.bump=1.5;P.portalCool=1.6;
  for(const k in keys)keys[k]=false;
  shotFlash(0x9a5aff);
  toast('You step back into the pasture');
  updateBossBar();
}
function shotFlash(color){
  const fl=$('flash');
  if(fl){fl.style.background='radial-gradient(ellipse at center,rgba(255,255,255,0) 35%,'+(color||'#9a5aff')+' 150%)';fl.classList.add('on');setTimeout(()=>{fl.classList.remove('on');fl.style.background='';},160);}
}
function pniSupportContains(rec,x,z,pad){
  if(!rec)return false;
  const p=pad||0;
  if(rec.arena)return Math.hypot(x-rec.x,z-rec.z)<=rec.r+p;
  return Math.abs(x-rec.x)<=rec.w/2+p&&Math.abs(z-rec.z)<=rec.d/2+p;
}
function pniArenaRec(){
  return {x:PNI.arena.x,z:PNI.arena.z,top:PNI.arena.top,arena:true,r:PNI.arena.r};
}
function pniLanding(prevY){
  let land=null;
  for(const rec of PNI.platforms){
    if(!pniSupportContains(rec,P.x,P.z,.06))continue;
    if(prevY>=rec.top-.03&&P.jy<=rec.top+.03&&(!land||rec.top>land.top))land=rec;
  }
  const A=pniArenaRec();
  if(pniSupportContains(A,P.x,P.z,-.4)&&prevY>=A.top-.03&&P.jy<=A.top+.03)land=A;
  return land;
}
function onPniLand(rec){
  if(!rec)return;
  if(rec.arena){startPniFight();return;}
  if(rec.cp&&rec.index>=P.pniCp){
    if(rec.index>P.pniCp){
      P.pniCp=rec.index;P.pniCpAt=clock;
      burst(P.x,rec.top+.7,P.z,0xffd24a,14);
      toast('Checkpoint '+(PNI.checkpoints.indexOf(rec)+1)+'/'+PNI.checkpoints.length+' — the sky holds you');
    }
  }
  const next=PNI.platforms[rec.index+1];
  if(next)toast('Next stone ahead — follow the gold marker');
}
function resetToPniCheckpoint(){
  const cp=PNI.platforms[P.pniCp]||PNI.startPlatform;
  P.x=cp.x;P.z=cp.z;P.jy=cp.top;P.jv=0;P.pniSupport=cp;P.kx=0;P.kz=0;P.fl=0;
  shotFlash(0x9a5aff);
  hurt(1,'void');
  if(state==='play')toast('You fell — back to the last checkpoint');
}
function updatePniPlayer(dt,mx,mz){
  const spd=keys.shift?8.2:6.2;
  const ctl=P.fl>0?.25:1;
  P.x+=(mx*spd*ctl+P.kx)*dt;
  P.z+=(mz*spd*ctl+P.kz)*dt;
  const kd=Math.pow(.02,dt);P.kx*=kd;P.kz*=kd;P.bump-=dt;P.fl=Math.max(0,P.fl-dt);
  P.walkT+=dt*Math.hypot(mx,mz)*10;
  let grounded=!!P.pniSupport;
  if(grounded&&!pniSupportContains(P.pniSupport,P.x,P.z,.28)){P.pniSupport=null;grounded=false;}
  if(grounded){
    P.jy=P.pniSupport.top;P.jv=0;
    if(keys[' ']){P.jv=8.6;P.pniSupport=null;grounded=false;P.jy+=.04;}
  }
  if(!grounded){
    const prevY=P.jy;
    P.jv-=22*dt;P.jy+=P.jv*dt;
    if(P.jv<=0){
      const land=pniLanding(prevY);
      if(land){P.jy=land.top;P.jv=0;P.pniSupport=land;onPniLand(land);}
    }
  }
  if(pniFight&&bossAlive('pni')){
    const A=PNI.arena,d=Math.hypot(P.x-A.x,P.z-A.z);
    if(d>A.r-1.1&&P.jy>A.top-3.5){
      P.x=A.x+(P.x-A.x)/d*(A.r-1.1);
      P.z=A.z+(P.z-A.z)/d*(A.r-1.1);
    }
  }
  if(P.jy<PNI.failY||Math.hypot(P.x-PNI.x,P.z-PNI.z)>95)resetToPniCheckpoint();
}
function startPniFight(){
  if(pniFight||pniDefeated)return;
  const b=bossById('pni');
  if(!b||b.dead)return;
  pniFight=true;b.aggro=true;b.phase=1;b.atk=1.2;
  if(pniBarrier)pniBarrier.visible=true;
  shotFlash(0x9fe8ff);
  toast('PNI AWAKENS — the final battle begins!');
  updateBossBar();
}
function resetPniEncounter(force){
  pniFight=false;
  if(pniBarrier)pniBarrier.visible=false;
  if(pniDefeated)return;
  const b=bossById('pni');
  if(!b)return;
  if(!force&&P.realm==='pni')return;
  const def=BOSS_DEFS.find(d=>d.id==='pni')||BOSS_DEFS[2];
  b.hp=b.maxHp;b.dead=false;b.deadT=0;b.aggro=false;b.phase=1;b.atk=1.5;b.windup=0;b.pending=null;
  b.speed=def.speed;b.rangedCd=def.rangedCd;
  b.g.visible=true;b.g.position.set(b.homeX,b.baseY,b.homeZ);b.g.rotation.set(0,Math.PI,0);
  clearBossHazards();
  updateBossBar();
}
function clearBossHazards(){
  bossShots.forEach(s=>{if(s.mesh)scene.remove(s.mesh);});
  bossShots.length=0;
  bossWaves.forEach(w=>{if(w.mesh)scene.remove(w.mesh);});
  bossWaves.length=0;
}
function bossExplosion(b){
  const p=b.g.position;
  burst(p.x,p.y+b.cy*.7,p.z,0xffd76a,30);
  burst(p.x,p.y+b.cy*.85,p.z,0xff7a3c,24);
  shotFlash(0xffa050);
}
function damageBoss(b,dmg,source){
  if(!b||b.dead||state!=='play')return;
  if(b.bossId==='pni'&&!pniFight){toast('Pni is shielded — reach the sky arena to begin the fight');return;}
  b.aggro=true;b.hitT=.14;
  b.hp=Math.max(0,(b.hp==null?b.maxHp:b.hp)-Math.max(0,dmg));
  const p=b.g.position;
  burst(p.x,p.y+b.cy*.8,p.z,0xffe08a,8);
  if(b.hp>0&&source==='rpg')bossExplosion(b);
  updateBossBar();
  if(b.hp<=0)killBoss(b);
  else if(b.bossId==='pni'&&b.phase===1&&b.hp<=b.maxHp*.5){
    b.phase=2;b.atk=Math.min(b.atk,.7);b.rangedCd*=.72;b.speed*=1.18;
    toast('Pni enrages — the final phase begins!');
    shotFlash(0xff6a4a);updateBossBar();
  }
}
function killBoss(b){
  if(!b||b.dead)return;
  b.dead=true;b.deadT=3.4;b.aggro=false;b.hp=0;
  b.g.rotation.z=0;
  if(b.bossId==='pni'){
    pniFight=false;pniDefeated=true;winPending=3.4;
    if(pniBarrier)pniBarrier.visible=false;
    shotFlash(0xffd24a);
    toast('PNI FALLS — the sky realm is free. You win the pasture!');
  }else{
    spawnRelic(b);
    toast('You defeated '+b.name+'! A gold relic drops beside the body');
  }
  updateBossBar();
}
function bossShoot(b){
  const def=BOSS_DEFS.find(d=>d.id===b.bossId)||BOSS_DEFS[0];
  const ox=b.g.position.x,oy=b.g.position.y+b.cy*.78,oz=b.g.position.z;
  const ty=P.baseY+P.jy+1.15;
  const dx=P.x-ox,dy=ty-oy,dz=P.z-oz,dl=Math.hypot(dx,dy,dz)||1;
  const colors={raoar:0x9fe8ff,lala:0xffb23a,pni:0xd8b4ff};
  const speeds={raoar:15,lala:13.5,pni:19};
  const count=b.bossId==='pni'&&b.phase>1?3:1;
  for(let i=0;i<count;i++){
    const mesh=new THREE.Mesh(new THREE.OctahedronGeometry(b.bossId==='pni'?.33:.28,0),
      new THREE.MeshBasicMaterial({color:colors[b.bossId]||0xffffff}));
    mesh.position.set(ox,oy,oz);mesh.userData.noCull=true;scene.add(mesh);
    const spread=count>1?(i-1)*.075:0;
    const ang=Math.atan2(dx,dz)+spread;
    const sp=speeds[b.bossId]||14;
    bossShots.push({
      mesh,owner:b,kind:b.bossId,life:4.6,dmg:b.bossId==='pni'?2:b.bossId==='lala'?1.5:1.2,
      x:ox,y:oy,z:oz,
      vx:Math.sin(ang)*sp*Math.cos(Math.atan2(dy,Math.hypot(dx,dz))),
      vy:dy/dl*sp,
      vz:Math.cos(ang)*sp*Math.cos(Math.atan2(dy,Math.hypot(dx,dz))),
    });
  }
  burst(ox,oy,oz,colors[b.bossId]||0xffffff,7);
}
function bossMelee(b){
  const d=Math.hypot(P.x-b.g.position.x,P.z-b.g.position.z);
  const vertical=Math.abs((P.baseY+P.jy)-(b.g.position.y+b.baseY*.02));
  if(d<6.2&&vertical<5){
    hurt(b.melee+(b.phase>1?2:0),'boss');
    const dx=P.x-b.g.position.x,dz=P.z-b.g.position.z,dl=Math.hypot(dx,dz)||1;
    P.kx+=dx/dl*7;P.kz+=dz/dl*7;P.fl=.5;
    burst(P.x,P.baseY+P.jy+1.1,P.z,0xcf4436,16);
    shotFlash(0xd0432f);
  }else bossShoot(b);
}
function bossWave(b){
  const radius=b.bossId==='pni'?2.2:1.8;
  const mesh=new THREE.Mesh(new THREE.RingGeometry(.88,1.08,32),
    new THREE.MeshBasicMaterial({color:b.bossId==='raoar'?0x9fe8ff:b.bossId==='lala'?0xffb23a:0x9a5aff,transparent:true,opacity:.72,side:THREE.DoubleSide,depthWrite:false}));
  mesh.rotation.x=-Math.PI/2;
  const y=b.bossId==='pni'?PNI.arena.top+.3:(b.baseY||0)+.3;
  mesh.position.set(b.g.position.x,y,b.g.position.z);mesh.userData.noCull=true;scene.add(mesh);
  bossWaves.push({mesh,owner:b,kind:b.bossId,r:radius,maxR:b.bossId==='pni'?17:14,speed:b.bossId==='pni'?10:8,dmg:b.bossId==='pni'?2:1.5,hit:false});
  burst(b.g.position.x,y+.3,b.g.position.z,b.bossId==='raoar'?0x9fe8ff:b.bossId==='lala'?0xffb23a:0x9a5aff,10);
}
function updateBossShots(dt){
  for(let i=bossShots.length-1;i>=0;i--){
    const s=bossShots[i];
    s.life-=dt;s.x+=s.vx*dt;s.y+=s.vy*dt;s.z+=s.vz*dt;
    s.mesh.position.set(s.x,s.y,s.z);
    s.mesh.rotation.x+=dt*5;s.mesh.rotation.y+=dt*4;
    const py=P.baseY+P.jy+1.05;
    const hit=state==='play'&&Math.hypot(P.x-s.x,py-s.y,P.z-s.z)<1.15;
    if(hit){
      hurt(s.dmg,'boss');
      burst(s.x,s.y,s.z,s.kind==='raoar'?0x9fe8ff:s.kind==='lala'?0xffb23a:0xd8b4ff,14);
      shotFlash(s.kind==='raoar'?0x9fe8ff:s.kind==='lala'?0xffb23a:0xd8b4ff);
    }
    if(hit||s.life<=0||s.y<PNI.failY-.5||s.y>220){
      scene.remove(s.mesh);bossShots.splice(i,1);
    }
  }
}
function updateBossWaves(dt){
  for(let i=bossWaves.length-1;i>=0;i--){
    const w=bossWaves[i];
    w.r+=w.speed*dt;
    const k=clamp(w.r/w.maxR,0,1);
    w.mesh.scale.setScalar(w.r);
    w.mesh.material.opacity=.72*(1-k*.82);
    if(!w.hit&&state==='play'){
      const d=Math.hypot(P.x-w.mesh.position.x,P.z-w.mesh.position.z);
      const sameLevel=Math.abs((P.baseY+P.jy)-w.mesh.position.y)<3.3;
      if(sameLevel&&Math.abs(d-w.r)<1.25){
        w.hit=true;hurt(w.dmg,'boss');
        burst(P.x,P.baseY+P.jy+1,P.z,0xffd24a,12);
      }
    }
    if(k>=1){scene.remove(w.mesh);bossWaves.splice(i,1);}
  }
}
function animateBoss(b,dt,t){
  b.t=(b.t||0)+dt;
  const p=b.parts||{};
  const aggro=b.aggro&&!b.dead;
  const sw=Math.sin(b.t*(aggro?6.2:1.4));
  if(p.armL&&p.armR){
    p.armL.rotation.x=sw*(aggro?.42:.12);
    p.armR.rotation.x=-sw*(aggro?.42:.12);
    p.armL.rotation.z=.06;
    p.armR.rotation.z=-.06;
  }
  if(p.legL&&p.legR){
    p.legL.rotation.x=sw*(aggro?.55:.08);
    p.legR.rotation.x=-sw*(aggro?.55:.08);
  }
  if(p.head)p.head.rotation.y=Math.sin(b.t*(aggro?2.4:.7))*.1;
  if(p.earL&&p.earR){
    p.earL.rotation.z=-.05+Math.sin(b.t*2.8)*.12;
    p.earR.rotation.z=.05-Math.sin(b.t*2.8)*.12;
  }
  if(p.wings){
    p.wings[0].rotation.z=-.08-Math.sin(b.t*(aggro?7:2.4))*.5;
    p.wings[1].rotation.z=.08+Math.sin(b.t*(aggro?7:2.4))*.5;
  }
  if(p.neck)p.neck.rotation.x=(b.windup>0?-.28:0)+Math.sin(b.t*1.8)*.04;
  if(b.hitT>0)b.hitT-=dt;
  const bob=b.dead?0:Math.sin(b.t*(aggro?5:1.5))*.05;
  b.g.position.y=(b.baseY||0)+bob;
}
function updateBosses(dt,t){
  if(netRole==='client'){
    for(const b of bosses)animateBoss(b,dt,t);
    return;
  }
  for(const b of bosses){
    if(b.dead){
      b.deadT-=dt;
      if(b.deadT>0){
        b.g.rotation.z=Math.min(1.3,(3.4-b.deadT)*.55);
        b.g.position.y=(b.baseY||0)-Math.min(2.6,(3.4-b.deadT)*.45);
      }else b.g.visible=false;
      continue;
    }
    animateBoss(b,dt,t);
    if(state!=='play')continue;
    const def=BOSS_DEFS.find(d=>d.id===b.bossId)||BOSS_DEFS[0];
    const d=Math.hypot(P.x-b.g.position.x,P.z-b.g.position.z);
    if(b.bossId==='pni'){
      if(!pniFight){b.aggro=false;continue;}
      if(P.realm!=='pni'){b.aggro=false;continue;}
      b.aggro=true;
    }else{
      if(P.realm!=null){b.aggro=false;continue;}
      if(!b.aggro&&d<def.arena.r+9){
        b.aggro=true;
        toast(b.name+' the '+b.title+' awakens — '+b.maxHp+' HP');
        updateBossBar();
      }
      if(b.aggro&&d>def.arena.r+34)b.aggro=false;
    }
    if(!b.aggro)continue;
    const dx=P.x-b.g.position.x,dz=P.z-b.g.position.z,dl=Math.hypot(dx,dz)||1;
    const targetYaw=Math.atan2(dx,dz);
    b.g.rotation.y+=angDiff(b.g.rotation.y,targetYaw)*Math.min(1,dt*4.5);
    const meleeRange=b.bossId==='pni'?6.2:4.8;
    if(dl>meleeRange){
      const sp=b.speed*(b.phase>1?1.3:1);
      b.g.position.x+=dx/dl*sp*dt;
      b.g.position.z+=dz/dl*sp*dt;
    }
    /* keep the boss inside its ring */
    if(b.bossId==='pni'){
      const dxa=b.g.position.x-PNI.arena.x,dza=b.g.position.z-PNI.arena.z,da=Math.hypot(dxa,dza)||1,rr=PNI.arena.r-5.4;
      if(da>rr){b.g.position.x=PNI.arena.x+dxa/da*rr;b.g.position.z=PNI.arena.z+dza/da*rr;}
    }else{
      const A=def.arena,dxa=b.g.position.x-A.x,dza=b.g.position.z-A.z,da=Math.hypot(dxa,dza)||1,rr=A.r-6;
      if(da>rr){b.g.position.x=A.x+dxa/da*rr;b.g.position.z=A.z+dza/da*rr;}
    }
    if(b.windup>0){
      b.windup-=dt;
      if(b.windup<=0){
        if(b.pending==='melee')bossMelee(b);else if(b.pending==='wave')bossWave(b);else bossShoot(b);
        b.pending=null;
      }
      continue;
    }
    b.atk=(b.atk==null?2:b.atk)-dt;
    if(b.atk<=0){
      const rage=b.phase>1?.68:1;
      b.atk=(b.rangedCd+rnd(.15,.6))*(b.bossId==='pni'?rage:1);
      if(b.attackCount==null)b.attackCount=0;
      b.attackCount++;
      if(dl<meleeRange+1.2&&b.attackCount%3===0){b.windup=.55;b.pending='wave';}
      else if(dl<meleeRange+1.8){b.windup=.42;b.pending='melee';}
      else bossShoot(b);
    }
  }
  updateBossShots(dt);
  updateBossWaves(dt);
}
function updateEndgame(dt,t){
  P.portalCool=Math.max(0,(P.portalCool||0)-dt);
  if(state==='play')updatePortalVisual(dt,t);
  for(const r of relicItems){
    r.t=(r.t||0)+dt;
    r.g.rotation.y+=dt*1.15;
    r.g.position.y=.1+Math.sin(r.t*1.8)*.12;
    if(r.ring)r.ring.rotation.z+=dt*.9;
  }
  if(pniNextMarker){
    let rec=null;
    if(P.realm==='pni'&&P.pniSupport&&P.pniSupport.index!=null)rec=PNI.platforms[P.pniSupport.index+1];
    else if(P.realm==='pni'&&!P.pniSupport)rec=PNI.platforms[Math.min(P.pniCp+1,PNI.platforms.length-1)];
    if(rec){
      pniNextMarker.visible=true;
      pniNextMarker.position.set(rec.x,rec.top+1.35+Math.sin(t*3)*.14,rec.z);
      pniNextMarker.rotation.y+=dt*2;
    }else pniNextMarker.visible=false;
  }
  if(pniBarrier&&pniBarrier.visible)pniBarrier.material.opacity=.14+Math.sin(t*3.2)*.06;
  if(winPending>0){
    winPending-=dt;
    if(winPending<=0)showWin();
  }
  updateMapCanvas(t);
  updateBossBar();
}
/* ---------- local minimap ---------- */
let mapDrawAt=0;
function mapBgForZone(){
  if(P.realm==='pni')return '#1a2430';
  const b=biomeAt(P.x,P.z);
  return b==='snow'?'#dce8f0':b==='desert'?'#e0c078':b==='savanna'?'#d8b878':'#5d9a64';
}
function updateMapCanvas(t){
  if(state!=='play'&&state!=='dead')return;
  if(t-mapDrawAt<.16)return;
  mapDrawAt=t;
  const cv=$('minimap');
  if(!cv)return;
  const ctx=cv.getContext('2d');
  if(!ctx)return;
  const W=cv.width,H=cv.height,cx=W/2,cy=H/2;
  ctx.clearRect(0,0,W,H);
  if(P.realm==='pni'){
    updatePniMap(ctx,W,H,cx,cy);
  }else{
    updateWorldMap(ctx,W,H,cx,cy);
  }
  drawMapPlayer(ctx,cx,cy);
  const zone=$('mapZone');
  if(zone){
    let label=P.realm==='pni'?"Pni's Sky Path":biomeAt(P.x,P.z)==='snow'?'Snowfield':biomeAt(P.x,P.z)==='desert'?'Desert':biomeAt(P.x,P.z)==='savanna'?'Savanna':'Pasture';
    for(const b of bosses){
      if(b.dead||!b.bossId||b.bossId==='pni')continue;
      const def=BOSS_DEFS.find(d=>d.id===b.bossId);
      if(def&&Math.hypot(P.x-def.arena.x,P.z-def.arena.z)<60)label=b.name+"'s Lair";
    }
    if(P.realm!=='pni'&&Math.hypot(P.x-SPAWN_PORTAL.x,P.z-SPAWN_PORTAL.z)<55)label='Sealed Portal';
    zone.textContent=label;
  }
}
function updateWorldMap(ctx,W,H,cx,cy){
  const scale=1.28;
  const toMap=(x,z)=>[cx+(x-P.x)*scale,cy+(z-P.z)*scale];
  ctx.fillStyle='#2b94d6';ctx.fillRect(0,0,W,H);
  const isl=[
    {x:0,z:0,r:ISLAND_R,c:'#5d9a64'},
    {x:DESERT.x,z:DESERT.z,r:DESERT.r,c:'#e0c078'},
    {x:SNOWZ.x,z:SNOWZ.z,r:SNOWZ.r,c:'#dce8f0'},
    {x:SAVAN.x,z:SAVAN.z,r:SAVAN.r,c:'#d8b878'},
  ];
  for(const L of isl){
    const [x,y]=toMap(L.x,L.z);
    ctx.fillStyle=L.c;ctx.beginPath();ctx.arc(x,y,L.r*scale,0,TAU);ctx.fill();
  }
  /* beaches */
  ctx.strokeStyle='#e9d9a0';ctx.lineWidth=Math.max(1,2.2*scale);
  for(const L of isl){const [x,y]=toMap(L.x,L.z);ctx.beginPath();ctx.arc(x,y,L.r*scale,0,TAU);ctx.stroke();}
  /* lakes and rivers */
  ctx.fillStyle='#2b94d6';
  for(const L of LAKES){const [x,y]=toMap(L.x,L.z);ctx.beginPath();ctx.arc(x,y,L.r*scale,0,TAU);ctx.fill();}
  ctx.strokeStyle='#2b94d6';ctx.lineCap='round';ctx.lineJoin='round';
  for(const R of RIVERS){
    ctx.lineWidth=Math.max(1.5,R.w*scale);
    ctx.beginPath();
    R.pts.forEach((p,i)=>{const [x,y]=toMap(p[0],p[1]);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});
    ctx.stroke();
  }
  /* boss dungeons: discovered when close, then kept as faint markers */
  for(const def of BOSS_DEFS){
    if(!def.arena)continue;
    const d=Math.hypot(P.x-def.arena.x,P.z-def.arena.z);
    if(d<110)mapSeen[def.id]=true;
    if(!mapSeen[def.id])continue;
    const [x,y]=toMap(def.arena.x,def.arena.z);
    if(x<-12||x>W+12||y<-12||y>H+12)continue;
    const b=bossById(def.id);
    const dead=!!(b&&b.dead);
    ctx.globalAlpha=d<150?1:.58;
    ctx.fillStyle=dead?'#5a6152':'#d0432f';
    ctx.strokeStyle='#24331c';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(x,y-6);ctx.lineTo(x+6,y);ctx.lineTo(x,y+6);ctx.lineTo(x-6,y);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle='#fff7dc';ctx.font='bold 8px Nunito, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(dead?'✓':def.id==='raoar'?'R':'L',x,y+.5);
    ctx.globalAlpha=1;
  }
  /* portal */
  const pd=Math.hypot(P.x-SPAWN_PORTAL.x,P.z-SPAWN_PORTAL.z);
  if(pd<120||portalLit){
    const [x,y]=toMap(SPAWN_PORTAL.x,SPAWN_PORTAL.z);
    if(x>-10&&x<W+10&&y>-10&&y<H+10){
      ctx.strokeStyle=portalOpen?'#d8b4ff':'#9a5aff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,5,0,TAU);ctx.stroke();
      ctx.fillStyle=portalOpen?'#d8b4ff':'#6a4a8a';ctx.beginPath();ctx.arc(x,y,2.4,0,TAU);ctx.fill();
    }
  }
  /* chests very close by show as tiny gold specks */
  ctx.fillStyle='#f1c24b';
  for(const c of chests){
    if(c.opened)continue;
    const d=Math.hypot(P.x-c.g.position.x,P.z-c.g.position.z);
    if(d>26)continue;
    const [x,y]=toMap(c.g.position.x,c.g.position.z);
    ctx.fillRect(x-1.4,y-1.4,2.8,2.8);
  }
  ctx.strokeStyle='rgba(36,51,28,.34)';ctx.lineWidth=1;ctx.strokeRect(.5,.5,W-1,H-1);
}
function updatePniMap(ctx,W,H,cx,cy){
  const scale=1.55;
  ctx.fillStyle='#1a2430';ctx.fillRect(0,0,W,H);
  const toMap=(x,z)=>[cx+(x-P.x)*scale,cy+(z-P.z)*scale];
  /* faint distant platforms */
  for(const rec of PNI.platforms){
    const [x,y]=toMap(rec.x,rec.z);
    const w=Math.max(4,rec.w*scale),d=Math.max(4,rec.d*scale);
    ctx.fillStyle=rec.cp?'#3c5a6a':'#2c4050';
    ctx.strokeStyle=rec.cp?'#f1c24b':'#9fe8ff';ctx.lineWidth=rec.cp?2:1;
    ctx.beginPath();ctx.roundRect?ctx.roundRect(x-w/2,y-d/2,w,d,3):ctx.rect(x-w/2,y-d/2,w,d);
    ctx.fill();ctx.stroke();
  }
  const [ax,ay]=toMap(PNI.arena.x,PNI.arena.z);
  ctx.fillStyle='rgba(154,90,255,.28)';ctx.strokeStyle='#d8b4ff';ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(ax,ay,PNI.arena.r*scale,0,TAU);ctx.fill();ctx.stroke();
  estimateMapCorners(ctx,W,H);
}
function estimateMapCorners(ctx,W,H){
  ctx.fillStyle='rgba(255,247,220,.55)';ctx.font='bold 8px Nunito, sans-serif';ctx.textAlign='center';
  ctx.fillText('N',W/2,10);
  ctx.fillText('S',W/2,H-4);
  ctx.fillText('W',5,H/2);
  ctx.fillText('E',W-5,H/2);
}
function drawMapPlayer(ctx,cx,cy){
  ctx.save();
  ctx.translate(cx,cy);
  ctx.rotate(-yaw);
  ctx.fillStyle='#fff7dc';ctx.strokeStyle='#24331c';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(5,5);ctx.lineTo(0,2.4);ctx.lineTo(-5,5);ctx.closePath();
  ctx.fill();ctx.stroke();
  ctx.restore();
  ctx.strokeStyle='rgba(255,247,220,.22)';ctx.lineWidth=1;
  ctx.beginPath();ctx.arc(cx,cy,9,0,TAU);ctx.stroke();
}
/* ---------- win screen ---------- */
function showWin(){
  if(gameWon)return;
  gameWon=true;winPending=0;winOpen=true;
  for(const k in keys)keys[k]=false;
  try{document.exitPointerLock();}catch(_){}
  const msg=$('winMsg');
  if(msg)msg.textContent='Pni has fallen. The snowfield, the desert and the sky realm are safe.';
  const stats=$('winStats');
  if(stats){
    const armor=P.armorName||'Traveler Clothes';
    stats.innerHTML='<span>Relics 2/2</span><span>Bosses 3/3</span><span>'+armor+'</span><span>'+P.swords.size+'/'+SWORD_DEFS.length+' swords</span>';
  }
  if($('bossbar')){$('bossbar').hidden=true;document.body.classList.remove('bossbar');}
  if($('hud'))$('hud').hidden=true;
  const menu=$('winMenu');
  if(menu)menu.hidden=false;
  const wc=$('winContinue');if(wc){try{wc.focus();}catch(_){}}
  burst(P.x,P.baseY+P.jy+1.3,P.z,0xffd24a,40);
}
function continueAfterWin(){
  const menu=$('winMenu');if(menu)menu.hidden=true;
  winOpen=false;
  if($('hud'))$('hud').hidden=false;
  state='play';
  reqLock();
  toast('The pasture is yours — keep exploring');
}
function removeRelicVisual(bossId){
  for(let i=relicItems.length-1;i>=0;i--){
    const r=relicItems[i];
    if(r.bossId!==bossId)continue;
    if(r.id)entitiesById.delete(r.id);
    scene.remove(r.g);relicItems.splice(i,1);
  }
}
function applyEndgameSnapshot(eg){
  if(!eg)return;
  if(Array.isArray(eg.relics)){
    P.relics=new Set(eg.relics);
    netRelicCount=P.relics.size;
    for(const id of eg.relics)removeRelicVisual(id);
    if(hasBothRelics())portalLit=true;
    updateRelicHud();
  }
  if(eg.portalOpen&&!portalOpen){
    portalOpen=true;portalLit=true;updatePortalVisual(0,clock);
  }
  if(eg.pniDefeated&&!pniDefeated){
    pniDefeated=true;pniFight=false;
    if(pniBarrier)pniBarrier.visible=false;
    if(P.realm==='pni')winPending=Math.max(winPending,2.4);
  }else if(eg.pniFight!==pniFight&&!pniDefeated){
    pniFight=!!eg.pniFight;
    if(pniBarrier)pniBarrier.visible=pniFight;
  }
  if(Array.isArray(eg.bosses)){
    for(const s of eg.bosses){
      const b=bossById(s.id);
      if(!b)continue;
      if(Number.isFinite(Number(s.x)))b.g.position.x=Number(s.x);
      if(Number.isFinite(Number(s.z)))b.g.position.z=Number(s.z);
      if(Number.isFinite(Number(s.ry)))b.g.rotation.y=Number(s.ry);
      if(Number.isFinite(Number(s.hp)))b.hp=Number(s.hp);
      b.aggro=!!s.aggro;
      if(Number.isFinite(Number(s.phase)))b.phase=Number(s.phase);
      if(s.dead&&!b.dead){
        b.dead=true;b.hp=0;b.aggro=false;b.deadT=3.4;b.g.rotation.z=0;
        if(s.id!=='pni'&&!P.relics.has(s.id)&&!relicItems.some(r=>r.bossId===s.id))spawnRelic(b);
      }else if(!s.dead&&b.dead){
        b.dead=false;b.g.visible=true;b.deadT=0;b.g.rotation.z=0;
      }
    }
  }
  updateBossBar();
}
function killEdible(a,kind,quiet){
  const px=a.g.position.x,py=a.g.position.y,pz=a.g.position.z;
  burst(px,py+.8,pz,0xcf4436,20);
  burst(px,py+1.0,pz,0xf4efe6,10);
  if(a.id)entitiesById.delete(a.id);
  scene.remove(a.g);
  let i=cows.indexOf(a);if(i>=0)cows.splice(i,1);
  i=pets.indexOf(a);if(i>=0)pets.splice(i,1);
  i=bulls.indexOf(a);if(i>=0)bulls.splice(i,1);
  i=hoppers.indexOf(a);if(i>=0)hoppers.splice(i,1);
  const n=MEAT_N[kind]==null?1:MEAT_N[kind];
  for(let k=0;k<n;k++)dropMeat(px+rnd(-.6,.6),pz+rnd(-.6,.6));
  if(!quiet)toast(kind==='hopper'?'You squashed the grasshopper!':kind==='chicken'?'You killed a chicken — it dropped meat!':kind==='bull'?'You felled the bull — meat on the ground!':'You killed a '+kind+' — meat on the ground!');
}
function killPerson(c,kind,fling){
  if(!c||c.dead)return;
  if(c.meal)hunterDropMeal(c);
  const p=c.g.position;
  c.dead=true;c.deadT=5;c.hp=0;
  if(fling!==false){
    c.knock=3.2;c.landed=false;c.y=0;
    const dx=p.x-P.x,dz=p.z-P.z,d=Math.hypot(dx,dz)||1;
    c.vx=dx/d*rnd(4,7);c.vz=dz/d*rnd(4,7);
    c.vy=rnd(16,22);c.sx=rnd(-8,8);c.sz=rnd(-8,8);
  }else{
    /* non-bull animals knock a human down where they stand; no flying */
    c.knock=1.1;c.landed=false;c.y=0;
    c.vx=0;c.vz=0;c.vy=0;c.sx=0;c.sz=0;
  }
  burst(p.x,.9,p.z,0xcf4436,16);
  burst(p.x,1.2,p.z,0xf4efe6,8);
}
function punch(){
  if(state!=='play'||P.ride||P.holding)return;
  if(P.punchT>0)return;
  P.punchT=.32;
  const a=edibleNear();
  if(!a)return;
  if(a.boss){
    const dmg=adminOneShot?9999:(P.sword?P.swordDmg:2);
    damageBoss(a,dmg,'melee');
    const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1,p0=a.g.position;
    burst(p0.x,p0.y+(a.cy||2),p0.z,0xffe08a,10);
    P.kx+=f.x/fl*1.2;P.kz+=f.z/fl*1.2;
    if(!a.dead)toast((P.sword?'You slash '+a.name:'You strike '+a.name)+'! '+Math.ceil(a.hp)+' HP left');
    return;
  }
  const kind=a.cow?'cow':a.bull?'bull':a.hopper?'hopper':a.kind;
  const dmg=adminOneShot?9999:P.sword?P.swordDmg:1;
  a.hp=(a.hp==null?EDIBLE_HP[kind]||2:a.hp)-dmg;
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1,p=a.g.position;
  burst(p.x,1.0,p.z,kind==='chicken'?0xf6f2e6:0xefe8da,8);
  if(a.hp<=0){if(a.person)killPerson(a,kind);else killEdible(a,kind);return;}
  const hunter=a.person&&a.role==='hunter';
  p.x+=f.x/fl*.3;p.z+=f.z/fl*.3;
  if(hunter)provokeHunter(a,true);
  toast(hunter?(P.sword?'You slash the hunter — he turns on you!':'You punch the hunter — he turns on you!'):((P.sword?'You slash the ':'You punch the ')+kind+'! ('+a.hp+' more)'));
}
function targetMeat(){
  if(P.baseY>0.2)return null;
  const f=fwdVec(),ex=P.x,ez=P.z;
  let best=null,bd=.55;
  meats.forEach(m=>{
    if(m.held)return;
    const p=m.g.position,dx=p.x-ex,dz=p.z-ez,d=Math.hypot(dx,dz);
    if(d>2.8)return;
    const dot=(dx*f.x+dz*f.z)/(d||1);
    if(dot>bd){bd=dot;best=m;}
  });
  return best;
}
function eatMeat(m){
  if(!m)return;
  if((P.hunger||0)>=HUNGER_MAX){toast('You are not hungry yet');return;}
  const i=meats.indexOf(m);if(i>=0)meats.splice(i,1);
  if(m.id)entitiesById.delete(m.id);
  const px=m.g.position.x,pz=m.g.position.z;
  scene.remove(m.g);
  P.hunger=Math.min(HUNGER_MAX,(P.hunger||0)+3);
  P.hungerWarn=false;updateHunger();
  burst(px,.7,pz,0xffd08a,12);
  toast('You eat the meat — hunger '+Math.round(P.hunger)+'/'+HUNGER_MAX);
}

/* ---------- loot chests ---------- */
const chests=[];
function buildChest(){
  const g=new THREE.Group();
  const wood=std(0x8a5a2b),wood2=std(0xa06c34),dark=std(0x5d3a1a),band=std(0x3c3f45),gold=std(0xc9a24a);
  g.add(box(1.06,.6,.72,wood,0,.3,0));
  g.add(box(1.1,.07,.76,dark,0,.035,0));
  for(const x of [-.4,.4])g.add(box(.075,.62,.76,band,x,.3,0));
  for(const x of [-.42,.42])for(const z of [-.25,.25])g.add(box(.12,.09,.12,dark,x,.045,z));
  g.add(box(.22,.2,.07,gold,0,.44,.38));
  const lid=pivot(g,0,.62,-.36);
  lid.add(box(1.1,.18,.78,wood2,0,.09,.39));
  for(const x of [-.4,.4])lid.add(box(.075,.2,.8,band,x,.09,.39));
  lid.add(box(.17,.14,.07,gold,0,0,.79));
  shade(g);
  const glow=new THREE.Mesh(new THREE.OctahedronGeometry(.15,0),new THREE.MeshBasicMaterial({color:0xffd75e,transparent:true,opacity:.92}));
  glow.position.y=1.32;glow.castShadow=false;g.add(glow);
  return {g,lid,glow};
}
function rollChestLoot(){
  const roll=rand();
  return roll<.18?'ammo':roll<.38?'food':roll<.56?'sword':roll<.77?'gun':roll<.88?'armor':roll<.96?'ak47':'biggame';
}
function spawnChest(x,z){
  const c=buildChest();
  c.g.position.set(x,0,z);c.g.rotation.y=rnd(0,TAU);
  scene.add(c.g);
  const ch={g:c.g,lid:c.lid,glow:c.glow,opened:false,loot:rollChestLoot(),chest:true,rad:.85,cy:.6,held:false};
  chests.push(ch);return registerEntity(ch,'chest');
}
function spawnChestInFront(){
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
  const x=P.x+f.x/fl*3.2,z=P.z+f.z/fl*3.2;
  const ch=spawnChest(x,z);
  ch.g.rotation.y=Math.atan2(P.x-x,P.z-z);
  burst(x,.9,z,0xffd76a,14);
  toast('A loot chest appears in front of you');
}
function villageChestSpot(h){
  for(let i=0;i<60;i++){
    const a=rnd(0,TAU),r=rnd(11,h.r*.82);
    const x=h.x+Math.cos(a)*r,z=h.z+Math.sin(a)*r;
    if(LAKES.some(L=>Math.hypot(x-L.x,z-L.z)<L.r+2))continue;
    if(riverAt(x,z))continue;
    if(solids.some(s=>Math.hypot(s.x-x,s.z-z)<s.r+2.4))continue;
    if(chests.some(c=>Math.hypot(c.g.position.x-x,c.g.position.z-z)<5))continue;
    return {x,z};
  }
  return null;
}
function scatterChests(){
  chests.forEach(c=>scene.remove(c.g));chests.length=0;
  chestRestockT=CHEST_RESTOCK;
  HOMES.filter(h=>h.role==='villager').forEach(h=>{
    for(let i=0;i<Math.min(3,h.count);i++){const sp=villageChestSpot(h);if(sp)spawnChest(sp.x,sp.z);}
  });
}
function targetChest(){
  if(P.baseY>0.2)return null;
  const f=fwdVec(),ex=P.x,ez=P.z;let best=null,bd=.5;
  chests.forEach(c=>{
    if(c.opened)return;
    const p=c.g.position,dx=p.x-ex,dz=p.z-ez,d=Math.hypot(dx,dz);
    if(d>3.6)return;
    const dot=(dx*f.x+dz*f.z)/(d||1);
    if(dot>bd){bd=dot;best=c;}
  });
  return best;
}
function giveChestAmmo(){
  const owned=GUN_DEFS.filter(d=>d.owned);
  if(!owned.length){
    giveGun(0,true);
    toast('Chest: a pistol with a full mag!');
    return;
  }
  let loaded=0;
  owned.forEach(d=>{loaded+=Math.max(0,d.cap-d.ammo);d.ammo=d.cap;});
  updateAmmoHud();
  toast(loaded>0
    ?'Chest: ammo! '+owned.map(d=>d.name).join(', ')+' reloaded'
    :'Chest: ammo! Your guns are already full');
}
function openChest(c){
  if(!c||c.opened)return;
  if(c.lockedBoss&&bossAlive(c.lockedBoss)){
    const b=bossById(c.lockedBoss);
    toast('The vault is sealed — defeat '+(b?b.name:'the warden')+' first');
    return;
  }
  c.opened=true;
  const px=c.g.position.x,pz=c.g.position.z;
  burst(px,.9,pz,0xffd76a,18);
  if(c.fixedLoot){
    const fixed=c.fixedLoot;
    burst(px,1.25,pz,0xffe08a,22);
    if(fixed==='armorySnow'){
      giveArmor('frost');giveGun(5,true);
      toast('Frostguard Armory: Frostguard Armor + Frostbite Rifle!');
    }else if(fixed==='armoryDesert'){
      giveArmor('sun');giveGun(6,true);
      toast('Sunforged Armory: Sunforged Aegis + Sandstorm LMG!');
    }else if(fixed==='vaultSnow'){
      giveArmor('raoar');giveSword(SWORD_BY_NAME["Winter's End"],true);
      toast("Raoar's Vault: Warden Plate + Winter's End sword!");
    }else if(fixed==='vaultDesert'){
      giveArmor('pni');giveSword(SWORD_BY_NAME["Pharaoh's Wrath"],true);giveGun(7,true);
      toast("Lala's Vault: Skyguard Armor + Pharaoh's Wrath + Pni's Bane RPG (5 rockets)!");
    }
    for(let i=0;i<2;i++)dropMeat(px+rnd(-1.2,1.2),pz+rnd(-1.2,1.2));
    updateGearHud();
    return;
  }
  let loot=c.loot||rollChestLoot();
  if(loot==='food'){
    for(let i=0;i<3;i++)dropMeat(px+rnd(-1.2,1.2),pz+rnd(-1.2,1.2));
    P.hunger=Math.min(HUNGER_MAX,(P.hunger==null?HUNGER_MAX:P.hunger)+1.5);updateHunger();
    toast('Chest: food! 3 meat dropped — press F to eat');
  }else if(loot==='ammo'){
    burst(px,1.1,pz,0xffd75e,12);
    giveChestAmmo();
  }else if(loot==='sword'){
    burst(px,1.1,pz,0xd7e6ea,12);
    const pool=[];
    for(let i=0;i<SWORD_DEFS.length;i++)if(!P.swords.has(i))pool.push(i);
    if(pool.length)giveSword(pool[Math.floor(rand()*pool.length)]);
    else giveChestAmmo();
    toast(guns.armed?'Holster your guns and press Q to pick a blade':'Press E to swing your new blade');
  }else if(loot==='armor'){
    const up=bestArmorUpgrade();
    if(up){burst(px,1.15,pz,0xc9d8e8,14);giveArmor(up.id);}
    else giveChestAmmo();
  }else if(loot==='ak47'){
    burst(px,1.2,pz,0xff8a5c,14);
    giveGun(3);
  }else if(loot==='biggame'){
    burst(px,1.25,pz,0xffd76a,18);
    burst(px,1.05,pz,0xff8a5c,10);
    giveGun(4);
  }else{
    giveGun([0,1,2][Math.floor(rand()*3)]);
  }
}
/* Every 7 seconds the villagers reroll what sits inside the chests and re-close looted ones. */
const CHEST_RESTOCK=7;
let chestRestockT=CHEST_RESTOCK;
function restockChests(){
  let nearRestock=false;
  chests.forEach(c=>{
    if(c.held||c.fixedLoot)return;
    c.loot=rollChestLoot();
    const p=c.g.position,d=Math.hypot(p.x-P.x,p.z-P.z);
    if(c.opened){
      c.opened=false;c.lid.rotation.x=0;c.glow.visible=true;
      if(d<16)nearRestock=true;
    }
    if(d<28)burst(p.x,.9,p.z,0xffd76a,5);
  });
  if(nearRestock)toast('A villager restocked the chest');
}
function updateChests(dt,t){
  chestRestockT-=dt;
  if(chestRestockT<=0){chestRestockT+=CHEST_RESTOCK;restockChests();}
  chests.forEach(c=>{
    if(c.held||!awake(c))return;
    if(c.opened){c.glow.visible=false;c.lid.rotation.x+=(-1.95-c.lid.rotation.x)*Math.min(1,dt*5);}
    else{c.glow.visible=true;c.glow.rotation.y+=dt*2.2;c.glow.position.y=1.32+Math.sin(t*2+c.g.position.x*.3)*.09;}
  });
}

/* ---------- armor ---------- */
const ARMOR_DEFS=[
  {id:'scrap',    name:'Scrap Armor',       red:.15},
  {id:'leather',  name:'Leather Armor',     red:.25},
  {id:'iron',     name:'Iron Armor',        red:.40},
  {id:'frost',    name:'Frostguard Armor',  red:.50},
  {id:'raoar',    name:"Raoar's Warden Plate",red:.62},
  {id:'sun',      name:'Sunforged Aegis',   red:.70},
  {id:'pni',      name:"Pni's Skyguard",    red:.78},
];
function armorDef(id){return ARMOR_DEFS.find(a=>a.id===id)||null;}

/* ---------- guns ---------- */
const GUN_DEFS=[
  {id:'pistol', name:'Pistol',  dmg:2, rate:.30, range:80,  spread:.004,  pellets:1, cap:12, ammo:12, power:.55, owned:false},
  {id:'shotgun',name:'Shotgun', dmg:4, rate:.80, range:36,  spread:.052,  pellets:7, cap:6,  ammo:6,  power:1, owned:false},
  {id:'rifle',  name:'Rifle',   dmg:5, rate:.14, range:150, spread:.0018, pellets:1, cap:24, ammo:24, power:.8, owned:false},
  {id:'ak47',   name:'AK-47',   dmg:4, rate:.055, range:130, spread:.006, pellets:1, cap:30, ammo:30, power:.86, owned:false, rare:true, auto:true},
  {id:'biggame',name:'Big Game Rifle',dmg:35,rate:1.15,range:220,spread:.0008,pellets:1,cap:2,ammo:2,power:1.5,owned:false,rare:true},
  {id:'frost',  name:'Frostbite Rifle',dmg:55,rate:.24,range:260,spread:.0012,pellets:1,cap:12,ammo:12,power:1.35,owned:false,rare:true},
  {id:'sandstorm',name:'Sandstorm LMG',dmg:20,rate:.062,range:180,spread:.009,pellets:1,cap:60,ammo:60,power:1.05,owned:false,rare:true,auto:true},
  {id:'rpg',    name:"Pni's Bane RPG",dmg:700,rate:2.3,range:300,spread:.002,pellets:1,cap:5,ammo:5,power:2.2,owned:false,rare:true,explosive:true},
];
const guns={armed:false,weapon:0,cool:0,recoil:0,flash:0,infAmmo:false};
const gunRoot=new THREE.Group();
gunRoot.position.set(.25,-.29,-.55);
gunRoot.scale.setScalar(.72);
gunRoot.rotation.y=-.18;
gunRoot.visible=false;
camera.add(gunRoot);
const gunModels=[],gunFlashes=[];
(function buildGuns(){
  const metal=std(0x30343c),dark=std(0x1c1f24),wood=std(0x7b4a25),steel=std(0x666d7a),brass=std(0xc9a24a);
  const mk=kind=>{
    const g=new THREE.Group();
    if(kind==='pistol'){
      g.add(box(.085,.105,.34,metal,0,.03,-.11));
      g.add(box(.055,.055,.14,dark,0,.035,-.32));
      g.add(box(.09,.02,.2,steel,0,.092,-.12));
      const grip=box(.082,.22,.12,wood,0,-.12,.06);grip.rotation.x=.26;g.add(grip);
      g.add(box(.02,.028,.05,brass,0,.088,.01));
    }else if(kind==='shotgun'){
      g.add(box(.1,.12,.26,metal,0,.02,-.02));
      const b1=cyl(.038,.038,.62,dark,0,.05,-.34,10);b1.rotation.x=Math.PI/2;g.add(b1);
      const b2=cyl(.045,.045,.4,metal,0,-.015,-.24,10);b2.rotation.x=Math.PI/2;g.add(b2);
      const stock=box(.085,.13,.26,wood,0,-.03,.24);stock.rotation.x=-.12;g.add(stock);
      g.add(box(.1,.1,.12,wood,0,-.05,-.1));
      g.add(box(.02,.03,.05,brass,0,.09,.05));
    }else if(kind==='ak47'){
      g.add(box(.1,.12,.46,metal,0,.02,-.08));
      const b=cyl(.026,.026,.55,dark,0,.045,-.46,10);b.rotation.x=Math.PI/2;g.add(b);
      g.add(box(.075,.07,.3,wood,0,.03,-.28));
      g.add(box(.09,.1,.18,wood,0,-.02,.18));
      const stock=box(.08,.12,.28,wood,0,-.04,.36);stock.rotation.x=-.08;g.add(stock);
      const grip=box(.07,.2,.1,wood,0,-.12,.06);grip.rotation.x=.32;g.add(grip);
      const mag=box(.09,.28,.16,dark,0,-.14,-.18);mag.rotation.x=.42;g.add(mag);
      g.add(box(.025,.03,.05,brass,0,.09,-.02));
    }else if(kind==='biggame'){
      /* heavy double-barrelled rifle: long barrels, walnut stock, small scope */
      g.add(box(.12,.14,.34,metal,0,.02,.02));
      [-.045,.045].forEach(x=>{
        const b=cyl(.036,.036,.78,dark,x,.06,-.44,10);b.rotation.x=Math.PI/2;g.add(b);
      });
      g.add(box(.13,.055,.66,steel,0,.062,-.42));
      const stock=box(.11,.15,.4,wood,0,-.035,.33);stock.rotation.x=-.1;g.add(stock);
      g.add(box(.12,.1,.2,wood,0,.015,.17));
      const grip=box(.075,.2,.1,wood,0,-.12,.09);grip.rotation.x=.28;g.add(grip);
      const scope=cyl(.045,.045,.3,dark,0,.145,-.1,12);scope.rotation.x=Math.PI/2;g.add(scope);
      [-.05,.05].forEach(x=>g.add(box(.025,.04,.04,brass,x,.13,.02)));
      g.add(box(.16,.04,.06,brass,0,-.02,-.79));
    }else if(kind==='frost'){
      /* pale ice rifle with a long cryo barrel and blue coils */
      const ice=std(0xbfeef8),ice2=std(0x79cfe8),glow=std(0xd9fbff);
      g.add(box(.11,.13,.42,ice,0,.02,-.06));
      const b=cyl(.033,.033,.88,ice2,0,.05,-.5,12);b.rotation.x=Math.PI/2;g.add(b);
      g.add(box(.075,.055,.68,ice,0,.06,-.5));
      for(const z of [-.18,-.34,-.5,-.66])g.add(cyl(.05,.05,.035,glow,0,.075,z,12));
      const stock=box(.1,.14,.36,ice2,0,-.035,.3);stock.rotation.x=-.1;g.add(stock);
      g.add(box(.09,.1,.2,ice,0,.015,.15));
      const grip=box(.07,.19,.1,ice2,0,-.11,.06);grip.rotation.x=.28;g.add(grip);
      const scope=cyl(.05,.05,.28,ice2,0,.145,-.12,12);scope.rotation.x=Math.PI/2;g.add(scope);
      g.add(box(.18,.035,.055,glow,0,-.02,-.9));
    }else if(kind==='sandstorm'){
      /* fat drum-fed machine gun with brass trim */
      const brass2=std(0xb8862e),drum=std(0x3b3f46);
      g.add(box(.14,.15,.5,metal,0,.02,-.08));
      const b=cyl(.038,.038,.62,dark,0,.05,-.48,10);b.rotation.x=Math.PI/2;g.add(b);
      g.add(box(.08,.07,.34,brass2,0,.05,-.3));
      const stock=box(.1,.15,.34,wood,0,-.04,.3);stock.rotation.x=-.1;g.add(stock);
      const grip=box(.075,.2,.1,wood,0,-.12,.08);grip.rotation.x=.3;g.add(grip);
      const mag=cyl(.17,.17,.16,drum,0,-.17,-.12,14);mag.rotation.z=Math.PI/2;g.add(mag);
      g.add(box(.15,.04,.08,brass2,0,-.06,-.17));
      g.add(box(.03,.03,.04,brass2,0,.095,.02));
    }else if(kind==='rpg'){
      /* rocket tube: wide mouth, wooden heatshield, rocket tip */
      const olive=std(0x5f6b3a),olive2=std(0x46502c),rocket=std(0xd8d8c8),warhead=std(0xc0392b);
      const tube=cyl(.13,.13,1.12,olive,0,.03,-.34,14);tube.rotation.x=Math.PI/2;g.add(tube);
      const bandA=cyl(.155,.155,.16,olive2,0,.03,-.84,14);bandA.rotation.x=Math.PI/2;g.add(bandA);
      const bandB=cyl(.155,.155,.16,olive2,0,.03,.16,14);bandB.rotation.x=Math.PI/2;g.add(bandB);
      const shield=box(.1,.22,.3,wood,0,-.1,-.16);g.add(shield);
      const grip=box(.075,.2,.1,wood,0,-.14,.04);grip.rotation.x=.3;g.add(grip);
      const scope=cyl(.045,.045,.22,dark,.07,.16,-.2,12);scope.rotation.x=Math.PI/2;g.add(scope);
      const rk=cyl(.11,.13,.32,rocket,0,.03,-.96,12);rk.rotation.x=Math.PI/2;g.add(rk);
      const wh=cone(.12,.24,warhead,0,.03,-1.22,12);wh.rotation.x=-Math.PI/2;g.add(wh);
    }else{
      g.add(box(.09,.11,.4,metal,0,.02,-.1));
      const b=cyl(.028,.028,.5,dark,0,.045,-.44,10);b.rotation.x=Math.PI/2;g.add(b);
      g.add(box(.06,.06,.2,steel,0,.045,-.28));
      const scope=cyl(.048,.048,.22,dark,0,.13,-.1,12);scope.rotation.x=Math.PI/2;g.add(scope);
      const stock=box(.08,.12,.26,wood,0,-.035,.24);stock.rotation.x=-.1;g.add(stock);
      const grip=box(.07,.19,.1,wood,0,-.11,.05);grip.rotation.x=.3;g.add(grip);
      g.add(box(.03,.03,.03,brass,0,.09,.05));
    }
    const fmat=new THREE.MeshBasicMaterial({color:0xffdf7a,transparent:true,opacity:.95,depthWrite:false,side:THREE.DoubleSide});
    const flash=new THREE.Group();
    const tip=kind==='pistol'?-.4:kind==='shotgun'?-.66:kind==='biggame'?-.86:-.7;
    const fs=kind==='biggame'?.42:.3;
    const p1=new THREE.Mesh(new THREE.PlaneGeometry(fs,fs),fmat);flash.add(p1);
    const p2=p1.clone();p2.rotation.z=Math.PI/4;flash.add(p2);
    flash.add(new THREE.Mesh(new THREE.SphereGeometry(.05,8,6),new THREE.MeshBasicMaterial({color:0xfff6c9})));
    flash.position.set(0,kind==='pistol'?.04:.05,tip);
    flash.visible=false;g.add(flash);
    g.userData.flash=flash;
    g.scale.setScalar(kind==='pistol'?1:kind==='biggame'?1.06:.92);
    return g;
  };
  GUN_DEFS.forEach(d=>{const m=mk(d.id);gunModels.push(m);gunFlashes.push(m.userData.flash);gunRoot.add(m);});
})();
function updateAmmoHud(){
  const d=GUN_DEFS[guns.weapon],pill=$('ammoPill');
  if(!pill)return;
  pill.hidden=!guns.armed;
  $('gunName').textContent=d.name;
  $('ammoN').textContent=guns.infAmmo?'∞':d.ammo;
  pill.classList.toggle('low',!guns.infAmmo&&d.ammo<=Math.max(1,Math.ceil(d.cap*.25)));
  const b=$('btnPunch');if(b)b.textContent=guns.armed?'FIRE':'PUNCH';
}
function grantGuns(silent){
  guns.armed=true;
  GUN_DEFS.forEach(d=>{d.owned=true;d.ammo=d.cap;});
  P.swords.clear();
  for(let i=0;i<SWORD_DEFS.length;i++)P.swords.add(i);
  giveSword(SWORD_DEFS.length-1,true);
  P.armorName='Pni\'s Skyguard';P.armorRed=.78;
  if(!GUN_DEFS[guns.weapon]||!GUN_DEFS[guns.weapon].owned)guns.weapon=0;
  guns.cool=0;guns.recoil=0;
  updateGearHud();
  if(!silent)toast('All weapons and armor equipped — 1-8 switch guns, Q cycles swords, E or right-click fires');
}
function giveGun(i,silent){
  const d=GUN_DEFS[i];if(!d)return;
  const had=!!d.owned;
  d.owned=true;d.ammo=d.cap;
  if(!guns.armed||!had){guns.armed=true;guns.weapon=i;}
  guns.cool=0;guns.recoil=0;
  updateAmmoHud();
  if(!silent){
    if(!had)toast('You found '+(i===3?'an ':'a ')+d.name+'! Press '+(i+1)+' to equip it');
    else toast('You found '+d.name+' ammo!');
  }
}
function holsterGuns(){
  guns.armed=false;guns.flash=0;gunRoot.visible=false;
  updateAmmoHud();
  toast('Guns holstered — your fists are back');
}
function selectGun(i){
  if(!guns.armed||i<0||i>=GUN_DEFS.length)return;
  if(!GUN_DEFS[i].owned){if(GUN_DEFS[i].rare)toast('You do not have the '+GUN_DEFS[i].name+' yet — find a chest!');return;}
  if(guns.weapon===i)return;
  guns.weapon=i;guns.cool=Math.max(guns.cool,.12);
  updateAmmoHud();
  toast(GUN_DEFS[i].name+' ready');
}
const GUN_HP=ANIMAL_HP;
function gunTargets(){
  const list=[];
  cows.forEach(a=>{if(!a.held)list.push({a,kind:'cow',rad:1.6,cy:1.25});});
  bulls.forEach(a=>{if(!a.held)list.push({a,kind:'bull',rad:2,cy:1.5});});
  pets.forEach(a=>{if(!a.held)list.push({a,kind:a.kind,rad:Math.max(.6,a.rad||.7),cy:a.cy||.8});});
  hoppers.forEach(a=>{if(!a.held)list.push({a,kind:'hopper',rad:.45,cy:.15});});
  persons.forEach(a=>{if(!a.dead)list.push({a,kind:a.kind,rad:.55,cy:1.05});});
  bosses.forEach(a=>{if(!a.dead&&a.g.visible)list.push({a,kind:'boss',rad:a.rad||2.6,cy:a.cy||3});});
  return list;
}
function gunRay(range,spread){
  if(P.baseY>0.2)return null;
  const f=fwdVec();
  const dir={x:f.x,y:f.y,z:f.z};
  if(spread>0){dir.x+=rnd(-spread,spread);dir.y+=rnd(-spread,spread);dir.z+=rnd(-spread,spread);}
  const dl=Math.hypot(dir.x,dir.y,dir.z)||1;dir.x/=dl;dir.y/=dl;dir.z/=dl;
  const ox=camera.position.x,oy=camera.position.y,oz=camera.position.z;
  let best=null,bestD=range;
  gunTargets().forEach(t=>{
    const p=t.a.g.position;
    const vx=p.x-ox,vy=p.y+t.cy-oy,vz=p.z-oz;
    const along=vx*dir.x+vy*dir.y+vz*dir.z;
    if(along<1||along>bestD)return;
    const px=vx-dir.x*along,py=vy-dir.y*along,pz=vz-dir.z*along;
    if(Math.hypot(px,py,pz)>t.rad)return;
    bestD=along;best=t;
  });
  return best;
}
const _mobV=new THREE.Vector3();
function updateMobBar(){
  const el=$('mobhp');if(!el)return;
  const t=gunRay(45,0);
  if(!t||t.a.held||t.kind==='boss'){el.hidden=true;return;}
  const p=t.a.g.position;
  camera.updateMatrixWorld();
  _mobV.set(p.x,p.y+(t.cy||1)+t.rad*.85+.45,p.z).project(camera);
  if(_mobV.z>1||_mobV.z<-1){el.hidden=true;return;}
  const sx=clamp((_mobV.x*.5+.5)*100,4,96),sy=clamp((-_mobV.y*.5+.5)*100,6,96);
  el.hidden=false;
  el.style.left=sx+'%';el.style.top=sy+'%';
  const max=ANIMAL_HP[t.kind]||3;
  const hp=t.a.hp==null?max:t.a.hp;
  const r=clamp(hp/max,0,1);
  const fill=$('mobfill');
  fill.style.width=(r*100)+'%';
  fill.style.background=r>.6?'#4f9a34':r>.3?'#e0913a':'#d0432f';
  /* villagers, farmers and travelers get no floating name/number label */
  const line=$('mobName').parentElement;
  line.hidden=!!t.a.person;
  $('mobName').textContent=t.kind.charAt(0).toUpperCase()+t.kind.slice(1);
  $('mobHpN').textContent=Math.max(0,Math.ceil(hp))+'/'+max;
}
function gunKill(a,kind){  const p=a.g.position;
  if(a.person){killPerson(a,kind);return;}
  burst(p.x,p.y+(a.cy||1),p.z,0xcf4436,24);
  burst(p.x,p.y+(a.cy||1),p.z,0xf4efe6,10);
  scene.remove(a.g);
  let i=cows.indexOf(a);if(i>=0)cows.splice(i,1);
  i=pets.indexOf(a);if(i>=0)pets.splice(i,1);
  i=bulls.indexOf(a);if(i>=0)bulls.splice(i,1);
  i=hoppers.indexOf(a);if(i>=0)hoppers.splice(i,1);
  const meatN=MEAT_N[kind]==null?1:MEAT_N[kind];
  for(let k=0;k<meatN;k++)dropMeat(p.x+rnd(-.7,.7),p.z+rnd(-.7,.7));
  toast('You shot the '+kind+(meatN?' — meat on the ground!':'!'));
}
function gunSfx(power){
  if(!AC||muted)return;
  try{
    const t0=AC.currentTime;
    const len=Math.floor(AC.sampleRate*.18);
    const buf=AC.createBuffer(1,len,AC.sampleRate),dat=buf.getChannelData(0);
    for(let i=0;i<len;i++){const e=1-i/len;dat[i]=(rand()*2-1)*e*e;}
    const src=AC.createBufferSource();src.buffer=buf;
    const lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1800;
    const ng=AC.createGain();ng.gain.value=.55*power;
    src.connect(lp);lp.connect(ng);ng.connect(master);src.start(t0);
    const o=AC.createOscillator();o.type='triangle';
    o.frequency.setValueAtTime(150,t0);o.frequency.exponentialRampToValueAtTime(38,t0+.14);
    const og=AC.createGain();og.gain.setValueAtTime(.45*power,t0);og.gain.exponentialRampToValueAtTime(.001,t0+.16);
    o.connect(og);og.connect(master);o.start(t0);o.stop(t0+.18);
  }catch(_){}
}
function shoot(){
  if(state!=='play'||P.ride||P.holding)return;
  if(!guns.armed){punch();return;}
  if(guns.cool>0)return;
  const d=GUN_DEFS[guns.weapon];
  if(!guns.infAmmo&&d.ammo<=0){guns.cool=.35;return;}
  initAudio();
  guns.cool=d.rate;guns.recoil=1;guns.flash=.07;
  if(!guns.infAmmo){d.ammo--;updateAmmoHud();}
  gunSfx(d.power);
  let hitKind=null,killed=false;
  for(let i=0;i<d.pellets;i++){
    const hit=gunRay(d.range,d.spread);
    if(!hit)continue;
    hitKind=hitKind||hit.kind;
    const a=hit.a;
    if(hit.kind==='boss'){
      damageBoss(a,adminOneShot?9999:d.dmg,d.explosive?'rpg':'gun');
      if(d.explosive)bossExplosion(a);
      killed=!!a.dead;
      break;
    }
    a.hp=(a.hp==null?GUN_HP[hit.kind]||3:a.hp)-(adminOneShot?9999:d.dmg);
    const p=a.g.position;
    burst(p.x,p.y+(hit.cy||1),p.z,0xcf4436,6);
    if(a.hp<=0){gunKill(a,hit.kind);killed=true;break;}
    const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
    p.x+=f.x/fl*.16;p.z+=f.z/fl*.16;
  }
  if(hitKind==='boss'){if(!killed)toast('Hit the boss!');}
  else if(hitKind&&!killed)toast('Hit the '+hitKind+'!');
  const c=$('cross');
  if(c){c.classList.add('on');setTimeout(()=>c.classList.remove('on'),90);}
}


/* ---------- streaming wildlife ----------
   Only a small herd lives near the player at any time. Old animals are
   removed once they fall well behind, and fresh ones appear near the player
   (or in the biome you just walked into), so distant places stay empty until
   you actually go there. */
const AMBIENT_TARGET=18,AMBIENT_DESPAWN=260;
const ambientAnchor={x:0,z:6};
const AMBIENT_CAPS={cow:6,bull:2,sheep:3,chicken:3,bunny:2,deer:2,horse:2,cat:2,dog:2,
  hopper:6,camel:4,cobra:3,snake:2,penguin:4,snowbear:2,lion:2,tiger:1,elephant:1,zebra:3,meerkat:3,locust:4,wolf:2,bear:1};
function ambientKindCount(k){
  if(k==='cow')return cows.length;
  if(k==='bull')return bulls.length;
  if(k==='hopper')return hoppers.length;
  let n=0;for(const p of pets)if(p.kind===k)n++;return n;
}
function ambientCount(){return cows.length+bulls.length+hoppers.length+pets.length;}
function ambientKind(){
  const b=biomeAt(P.x,P.z);
  let kinds;
  if(b==='desert')kinds=['camel','camel','cobra'];
  else if(b==='snow')kinds=['penguin','penguin','snowbear'];
  else if(b==='savanna')kinds=['zebra','zebra','meerkat','locust','lion','tiger','elephant'];
  else if(nearFarm(P.x,P.z,70))kinds=['cow','cow','chicken','chicken','hopper','sheep'];
  else kinds=['cow','cow','hopper','hopper','sheep','chicken','bunny','deer','horse','dog','cat'];
  if(!b&&nightFlag&&rand()<.18)kinds.push('wolf');
  if(!b&&nightFlag&&rand()<.10)kinds.push('bear');
  if(!b&&nearVillage(P.x,P.z,75)&&rand()<.14)kinds=['bull','cow','chicken'];
  const ok=kinds.filter(k=>ambientKindCount(k)<(AMBIENT_CAPS[k]||2));
  return ok.length?ok[Math.floor(rand()*ok.length)]:null;
}
function spawnAmbientAnimal(kind){
  if(!kind)return null;
  let a=null;
  if(kind==='cow'){spawnCow();a=cows[cows.length-1];}
  else if(kind==='bull'){spawnBull(false);a=bulls[bulls.length-1];}
  else if(kind==='hopper'){spawnHopper();a=hoppers[hoppers.length-1];}
  else{spawnPet(kind,biomeAt(P.x,P.z));a=pets[pets.length-1];}
  if(a)a.ambient=true;
  return a;
}
function topUpAmbient(){
  if(ambientCount()>=AMBIENT_TARGET)return null;
  return spawnAmbientAnimal(ambientKind());
}
function cullFarAmbient(){
  const px=P.x,pz=P.z,R2=AMBIENT_DESPAWN*AMBIENT_DESPAWN;
  const prune=list=>{
    for(let i=list.length-1;i>=0;i--){
      const a=list[i];
      if(!a||!a.ambient||a.held||a.ridden||a.adminSpawned||P.holding===a)continue;
      const q=a.g.position,dx=q.x-px,dz=q.z-pz;
      if(dx*dx+dz*dz>R2){if(a.id)entitiesById.delete(a.id);scene.remove(a.g);list.splice(i,1);}
    }
  };
  prune(cows);prune(bulls);prune(hoppers);prune(pets);
}
/* insects and birds are streamed too: a handful near the player, refreshed as you walk */
function cullFarSmall(){
  const px=P.x,pz=P.z;
  const prune=(list,R)=>{
    const R2=R*R;
    for(let i=list.length-1;i>=0;i--){
      const a=list[i];
      if(!a||a.held||a.adminSpawned||P.holding===a)continue;
      const q=a.g.position,dx=q.x-px,dz=q.z-pz;
      if(dx*dx+dz*dz>R2){scene.remove(a.g);list.splice(i,1);}
    }
  };
  prune(bees,AMBIENT_DESPAWN);prune(birds,AMBIENT_DESPAWN);prune(ants,230);prune(butterflies,AMBIENT_DESPAWN);
}
/* remove every wild animal the player has left far behind; this runs on a
   short timer so far-away places empty out even before the next spawn tick */
function despawnFarWildlife(){
  cullFarAmbient();
  cullFarSmall();
}
function topUpSmall(){
  cullFarSmall();
  if(bees.length<5&&biomeAt(P.x,P.z)!=='snow')spawnBee();
  if(butterflies.length<5&&biomeAt(P.x,P.z)!=='snow')spawnButterfly();
  if(birds.length<6)spawnBird();
  const hs=HILLS.concat(SAV_HILLS);
  for(let i=0;i<hs.length;i++){
    const h=hs[i];
    if(Math.hypot(h.x-P.x,h.z-P.z)>110)continue;
    let n=0;for(const a of ants)if(a.hill===h)n++;
    while(n<4){spawnAntOn(h);n++;}
  }
}
function spawnRandomAnimal(){
  despawnFarWildlife();
  if(Math.hypot(P.x-ambientAnchor.x,P.z-ambientAnchor.z)>70){
    ambientAnchor.x=P.x;ambientAnchor.z=P.z;
    for(let i=0;i<6;i++)topUpAmbient();
  }
  topUpAmbient();
}

/* ---------- humans wander in from the wild too ---------- */
const WILD_HUMAN_CAP=12;
function wildHumanCount(){let n=0;for(const p of persons)if(p.wild&&!p.dead)n++;return n;}
function spawnRandomHuman(){
  let sp=nearSpot(45,130,16,null,true);
  for(let i=0;i<8;i++){
    if(!LAKES.some(L=>Math.hypot(sp.x-L.x,sp.z-L.z)<L.r+3)&&!riverAt(sp.x,sp.z))break;
    sp=nearSpot(45,130,16,null,true);
  }
  const home={x:sp.x,z:sp.z,r:rnd(26,52),role:rand()<.2?'hunter':'villager',wild:true};
  spawnPerson(home);
  return persons[persons.length-1];
}

/* ---------- overcrowded herds thin themselves out ---------- */
const ANIMAL_SOFT_CAP=70;
function dieOff(a){
  const p=a.g.position;
  burst(p.x,.5,p.z,0xcdbb8a,7);
  if(a.id)entitiesById.delete(a.id);
  scene.remove(a.g);
  let i=cows.indexOf(a);if(i>=0)cows.splice(i,1);
  i=hoppers.indexOf(a);if(i>=0)hoppers.splice(i,1);
  i=pets.indexOf(a);if(i>=0)pets.splice(i,1);
  i=bulls.indexOf(a);if(i>=0)bulls.splice(i,1);
}
function overpopulationCull(){
  despawnFarWildlife();
  const total=cows.length+bulls.length+hoppers.length+pets.length;
  if(total<=ANIMAL_SOFT_CAP)return 0;
  const want=Math.min(12,Math.max(2,Math.round((total-ANIMAL_SOFT_CAP)*.4)));
  const pool=[];
  const add=a=>{if(a&&a.ambient&&!a.held&&!a.ridden&&!a.dead&&!a.adminSpawned)pool.push(a);};
  cows.forEach(add);hoppers.forEach(add);
  pets.forEach(a=>add(a));
  let src=pool.filter(a=>Math.hypot(a.g.position.x-P.x,a.g.position.z-P.z)>18);
  if(src.length<3)src=pool;
  let killed=0;
  for(let i=0;i<want&&src.length;i++){dieOff(src.splice(Math.floor(rand()*src.length),1)[0]);killed++;}
  return killed;
}

function clearWorld() {
  entitiesById.clear();nextEntityId=1;
  pets.forEach(c=>scene.remove(c.g));pets.length=0;bees.forEach(b=>scene.remove(b.g));bees.length=0;
  butterflies.forEach(b=>scene.remove(b.g));butterflies.length=0;
  birds.forEach(b=>scene.remove(b.g));birds.length=0;ants.forEach(a=>scene.remove(a.g));ants.length=0;props.forEach(o=>scene.remove(o.g));props.length=0;persons.forEach(c=>scene.remove(c.g));persons.length=0;
  cows.forEach(c=>scene.remove(c.g));bulls.forEach(b=>scene.remove(b.g));hoppers.forEach(h=>scene.remove(h.g));parts.forEach(p=>scene.remove(p.o));
  meats.forEach(m=>scene.remove(m.g));meats.length=0;
  fruits.forEach(f=>scene.remove(f.g));fruits.length=0;
  chests.forEach(c=>scene.remove(c.g));chests.length=0;
  bosses.forEach(b=>scene.remove(b.g));bosses.length=0;
  relicItems.forEach(r=>scene.remove(r.g));relicItems.length=0;
  clearBossHazards();
  bossArenaRoots.splice(0).forEach(r=>scene.remove(r));
  bossBeams.splice(0).forEach(b=>scene.remove(b));
  if(portalRoot){scene.remove(portalRoot);portalRoot=null;}
  if(portalBeam){scene.remove(portalBeam);portalBeam=null;}
  if(pniRealmRoot){scene.remove(pniRealmRoot);pniRealmRoot=null;}
  pniBarrier=null;pniNextMarker=null;pniReturnPortal=null;
  if(tornadoes.length){tornadoes.slice().forEach(removeTornado);setTornadoBtn(false);}
  swordRoot.visible=false;
  if(P.holding){detachHeld(P.holding);P.holding=null;hand.visible=false;}
  cows=[];bulls=[];hoppers=[];parts=[];
  ambientAnchor.x=0;ambientAnchor.z=6;
  found.clear();updateFound();updateHearts();updateHunger();
  Object.assign(P,{x:0,z:6,kx:0,kz:0,walkT:0,holding:null,ride:null,bump:0,sw:0,inW:false,jy:0,jv:0,fl:0,hp:10,hunger:10,punchT:0,starve:0,hungerWarn:false,sword:false,swordIdx:0,swordDmg:6,swords:new Set(),baseY:0,floor:0,tower:-1,lift:null,
    armorName:'Traveler Clothes',armorRed:0,relics:new Set(),realm:null,pniCp:0,pniCpAt:null,pniSupport:null,portalCool:0});
  TOWERS.length=0;
  yaw=0;pitch=-.08;
}

function initWorldAsync(callback) {
  clearWorld();
  $('loadingMenu').hidden = false;
  
  const steps = [
    () => { buildWorldGeometry(); buildWater(); buildBiomeProps(); },
    () => { buildMountains(); buildBuildings(); buildHills(); spawnFishes(); buildFlowers(); },
    () => { 
      /* a small starting herd right around the player, not a packed island */
      for(let i=0;i<3;i++)spawnCow();
      spawnBull(false);
      for(let i=0;i<4;i++)spawnHopper();
      spawnPet('horse');spawnPet('sheep');spawnPet('chicken');spawnPet('chicken');
      spawnPet('dog');spawnPet('cat');spawnPet('bunny');spawnPet('deer');
    },
    () => {
      for(let i=0;i<5;i++)spawnBee();
      for(let i=0;i<4;i++)spawnButterfly();
      for(let i=0;i<6;i++)spawnBird();
      topUpSmall();
      ['bale','rock','barrel'].forEach(k=>{for(let i=0;i<2;i++)spawnProp(k,true);for(let i=0;i<2;i++)spawnProp(k,false);});
      HOMES.forEach(h=>{for(let i=0;i<Math.min(2,h.count);i++)spawnPerson(h);});
      HOMES.filter(h=>h.role==='villager').forEach((h,i)=>{if(i%3===0)spawnPerson(Object.assign({},h,{role:'hunter'}));});
      for(let i=0;i<2;i++)spawnPerson({x:15*K,z:25*K,r:80,role:'traveler'});
      spawnPerson({x:24*K,z:34*K,r:80,role:'hunter'});
      for(let i=0;i<Math.round(rnd(6,9));i++)spawnRandomHuman();
      scatterChests();
      scatterFruits();
      buildBossWorld();
    }
  ];

  let currentStep = 0;
  function nextStep() {
    if(currentStep < steps.length) {
      steps[currentStep]();
      currentStep++;
      /* a timer, not rAF: loading still finishes when the tab is in the background */
      setTimeout(nextStep,0);
    } else {
      $('loadingMenu').hidden = true;
      if (callback) callback();
    }
  }
  setTimeout(nextStep,0);
}

/* ---------- actions ---------- */
function fwdVec(){const cp=Math.cos(pitch);return {x:-Math.sin(yaw)*cp,y:Math.sin(pitch),z:-Math.cos(yaw)*cp};}
function targetHopper(){
  if(P.baseY>0.2)return null;
  const f=fwdVec(),ex=P.x,ey=1.7+(P.baseY||0)+P.jy,ez=P.z;let best=null,bd=.86;
  const canAll=adminUnlocked&&adminLift;
  const list=canAll?hoppers.concat(fishes,pets,bees,birds,ants,props,chests,meats,cows,bulls,persons):hoppers.concat(fishes,pets,bees,birds,ants,props);
  list.forEach(h=>{
    if(h.held||h.dead)return;
    if(!canAll&&(h.kind==='bear'||h.kind==='deer'||h.kind==='horse'||h.kind==='wolf'||h.kind==='sheep'||h.kind==='camel'||h.kind==='snowbear'||h.kind==='lion'||h.kind==='tiger'||h.kind==='elephant'||h.kind==='zebra'))return;
    const p=h.g.position;
    const dx=p.x-ex,dy=p.y+(h.cy||(h.pet?.3:.12))-ey,dz=p.z-ez,d=Math.hypot(dx,dy,dz);
    if(h.rad){
      const proj=dx*f.x+dy*f.y+dz*f.z;if(proj<=0)return;
      const perp=Math.sqrt(Math.max(0,d*d-proj*proj));
      if(d-h.rad>3.4||perp>h.rad)return;
      const sc=.9+.1*(1-perp/h.rad);if(sc>bd){bd=sc;best=h;}return;
    }
    if(d>(h.fish?4.6:h.pet?3.6:3.2))return;const dot=(dx*f.x+dy*f.y+dz*f.z)/(d||1);
    if(dot>bd){bd=dot;best=h;}
  });
  return best;
}
function detachHeld(h){
  if(h&&h.g&&h.g.parent)h.g.parent.remove(h.g);
}
/* move the carried object between the first-person hand, the long carry rig and
   the avatar's hand. Small things sit in the palm; big animals hang further out. */
function syncHeldView(){
  const h=P.holding;
  if(!h||!h.carryCtr)return;
  detachHeld(h);
  if(thirdPerson&&state==='play'){
    avatarHold.add(h.g);
    h.g.position.set(-h.carryCtr.x,-h.carryCtr.y+.04,-h.carryCtr.z);
  }else if(h.handHeld){
    hand.add(h.g);
    h.g.position.copy(h.handPos);
  }else{
    carry.add(h.g);
    h.g.position.copy(h.carryPos);
  }
  h.g.rotation.set(0,-.5,0);
}
function lift(h){
  h.held=true;P.holding=h;
  scene.remove(h.g);
  /* measure the creature at its real size, then hang it in front of the camera */
  h.g.position.set(0,0,0);h.g.rotation.set(0,-.5,0);
  h.g.updateMatrixWorld(true);
  const bb=new THREE.Box3().setFromObject(h.g);
  const sz=bb.getSize(new THREE.Vector3()),ctr=bb.getCenter(new THREE.Vector3());
  const maxDim=Math.max(sz.x,sz.y,sz.z,.2);
  const dist=clamp(maxDim*1.2,1.2,7.5);
  h.carryCtr=ctr.clone();
  h.carryPos=new THREE.Vector3(.2-ctr.x,-maxDim*.08-ctr.y,-dist-ctr.z);
  /* compact pickups rest in the palm instead of hovering in front of the camera */
  h.handHeld=maxDim<=1.15;
  h.handPos=new THREE.Vector3(-ctr.x,.07-ctr.y,-.12-ctr.z);
  syncHeldView();
  shade(h.g,false);hand.visible=true;
  const sp=speciesOf(h);
  if(markFound(sp)){
    if(found.size>=FOUND_TOTAL){
      toast('Every creature found! Field notes complete!');
      for(let i=0;i<3;i++)burst(P.x+rnd(-1,1),1.4+rnd(0,1.2),P.z+rnd(-1,1),[0xf1c24b,0xff8a5c,0x7fd23a][i],12);
    }else toast('New find: '+sp[0].toUpperCase()+sp.slice(1)+'! ('+found.size+'/'+FOUND_TOTAL+')');
  }
  else toast(h.heavy?'Heavy! You move slower':h.person?'Got a human!':h.fish?'Got a fish!':h.pet?'Got a '+h.kind+'!':h.chest?'Lifted the chest!':h.meatItem?'Got the meat!':h.bee?'Got a bee!':h.bird?'Got a bird!':h.ant?'Got an ant!':'Got one!');
}
function releasePerson(c){
  const g=c.g;g.rotation.set(0,g.rotation.y,0);shade(g,true);
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
  g.position.set(P.x+f.x/fl*1.8,0,P.z+f.z/fl*1.8);g.rotation.y=Math.atan2(f.x,f.z);scene.add(g);
  c.knock=0;c.landed=false;c.y=0;c.st=0;c.moving=false;
  toast('Put the '+(c.kind==='human'?'human':c.role)+' down');
}
function releaseChest(c){
  const g=c.g;g.scale.setScalar(1);g.rotation.set(0,0,0);shade(g,true);
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
  g.position.set(P.x+f.x/fl*2.1,0,P.z+f.z/fl*2.1);g.rotation.y=Math.atan2(f.x,f.z);scene.add(g);
  c.held=false;toast('Put the chest down');
}
function releaseMeat(m){
  const g=m.g;g.scale.setScalar(1);g.rotation.set(0,0,0);shade(g,true);
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
  g.position.set(P.x+f.x/fl*1.4,0,P.z+f.z/fl*1.4);scene.add(g);
  m.held=false;toast('Put the meat down');
}
function release(){
  const h=P.holding;if(!h)return;P.holding=null;h.held=false;hand.visible=false;detachHeld(h);
  if(h.chest){releaseChest(h);return;}
  if(h.meatItem){releaseMeat(h);return;}
  if(h.fish){releaseFish(h);return;}
  if(h.pet){releasePet(h);return;}
  if(h.person){releasePerson(h);return;}
  if(h.cow||h.bull){releaseHeavy(h);return;}
  if(h.obj){releaseProp(h);return;}
  if(h.bee){releaseBee(h);return;}
  if(h.bird){releaseBird(h);return;}
  if(h.ant){releaseAnt(h);return;}
  const g=h.g;g.scale.setScalar(HS);g.rotation.set(0,0,0);shade(g,true);
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
  g.position.set(P.x+f.x/fl*1.0,0,P.z+f.z/fl*1.0);g.rotation.y=Math.atan2(f.x,f.z);scene.add(g);
  h.state='wait';h.wait=.4;toast('Let go');
}

const FEED={cat:['fish'],dog:['fish'],bird:['fish','grasshopper','ant'],chicken:['grasshopper','ant']};
function heldFood(h){return h.hopper?'grasshopper':h.fish?'fish':h.ant?'ant':null;}
function findFeedTarget(h){
  const food=heldFood(h);if(!food)return null;
  const f=fwdVec(),ex=P.x,ez=P.z;
  let best=null,bs=.15;
  const tryA=(a,type,r)=>{
    if(a.held)return;
    const p=a.g.position,dx=p.x-ex,dz=p.z-ez,d=Math.hypot(dx,dz);
    if(d>r)return;
    const dot=(dx*f.x+dz*f.z)/(d||1);
    if(dot>bs){bs=dot;best={a,type};}
  };
  pets.forEach(a=>{const ok=FEED[a.kind];if(ok&&ok.indexOf(food)>=0)tryA(a,a.kind,3.2);});
  birds.forEach(b=>{if(b.state==='ground'||b.g.position.y<3)tryA(b,'bird',4.4);});
  return best;
}
function feedHeld(t){
  const h=P.holding;if(!h)return false;
  const food=heldFood(h);if(!food)return false;
  P.holding=null;h.held=false;hand.visible=false;detachHeld(h);
  let i=hoppers.indexOf(h);if(i>=0)hoppers.splice(i,1);
  i=fishes.indexOf(h);if(i>=0)fishes.splice(i,1);
  i=ants.indexOf(h);if(i>=0)ants.splice(i,1);
  t.a.eat=t.type==='bird'?1.6:1.4;
  const p=t.a.g.position;
  burst(p.x,.8,p.z,0xffe08a,8);
  toast(t.type==='cat'?'The cat eats the '+food+'!':t.type==='dog'?'The dog wolfs down the '+food+'!':t.type==='chicken'?'The chicken pecks up the '+food+'!':'The bird snatches the '+food+'!');
  return true;
}

function targetRide(){
  if(P.baseY>0.2)return null;
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1,ex=P.x,ez=P.z;
  let best=null,bd=.8;
  const tryR=(a,r)=>{
    if(a.ridden||a.held)return;
    const p=a.g.position,dx=p.x-ex,dz=p.z-ez,d=Math.hypot(dx,dz);
    if(d>r)return;
    const dot=(dx*f.x+dz*f.z)/(d*fl||1);
    if(dot>bd){bd=dot;best=a;}
  };
  pets.forEach(a=>{if(a.kind==='horse'||a.kind==='camel')tryR(a,a.kind==='camel'?5.0:4.4);});
  bulls.forEach(b=>tryR(b,4.8));
  return best;
}
function mountRide(a){
  P.ride=a;a.ridden=true;a.riderT=0;a.boltT=0;a.warned=false;a.rideSpd=0;a.hitP=[];
  P.jy=0;P.jv=0;P.kx=0;P.kz=0;
  if(a.bull){a.state='ride';a.st=0;toast('You jump on the bull — hang on tight!');}
  else{
    a.state='walk';a.st=999;
    const nm=a.kind==='camel'?'camel':'horse',Nm=nm==='camel'?'Camel':'Horse';
    if(markFound(nm)){
      if(found.size>=FOUND_TOTAL){
        toast('Every creature found! Field notes complete!');
        for(let i=0;i<3;i++)burst(P.x+rnd(-1,1),1.4+rnd(0,1.2),P.z+rnd(-1,1),[0xf1c24b,0xff8a5c,0x7fd23a][i],12);
      }else toast('New find: '+Nm+'! ('+found.size+'/'+FOUND_TOTAL+')');
    }else toast('You climb on the '+nm);
  }
  burst(a.g.position.x,.6,a.g.position.z,0xffffff,6);
}
function stepOff(a){
  const ry=a.g.rotation.y;
  P.x=a.g.position.x-Math.cos(ry)*1.7;
  P.z=a.g.position.z+Math.sin(ry)*1.7;
  P.jy=0;P.jv=0;P.kx=0;P.kz=0;
}
function dismountRide(){
  const a=P.ride;if(!a)return;P.ride=null;a.ridden=false;a.rideSpd=0;
  a.g.position.y=0;a.g.userData.head.rotation.x=0;
  stepOff(a);
  if(a.bull){a.state='rest';a.st=2;a.cd=6;a.warned=false;}else{a.state='rest';a.st=rnd(2,5);}
  toast('You get off');
}
function buckOff(a){
  P.ride=null;a.ridden=false;a.rideSpd=0;a.warned=false;
  a.g.position.y=0;a.g.userData.head.rotation.x=0;
  const dx=Math.sin(a.g.rotation.y),dz=Math.cos(a.g.rotation.y);
  P.x=a.g.position.x+dx*1.9;P.z=a.g.position.z+dz*1.9;
  P.kx=dx*11+rnd(-4,4);P.kz=dz*11+rnd(-4,4);P.jy=.01;P.jv=14;P.fl=1.8;P.bump=1.2;
  a.state='rest';a.st=2;a.cd=6;
  const fl=$('flash');fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),130);
  burst(a.g.position.x,2,a.g.position.z,0xcdbb8a,16);
  toast('You are bucked off the bull!');
}
/* ---------- enterable skyscrapers ---------- */
function towerFloorY(T,i){return i?T.lh+(i-1)*T.fh:0;}
function towerAt(x,z,tol){
  tol=tol||0;
  for(let i=0;i<TOWERS.length;i++){
    const T=TOWERS[i],dx=x-T.x,dz=z-T.z,c=Math.cos(T.yaw),s=Math.sin(T.yaw);
    const lx=dx*c-dz*s,lz=dx*s+dz*c;
    if(Math.abs(lx)<=T.w/2+tol&&Math.abs(lz)<=T.d/2+tol)return T;
  }
  return null;
}
function liftHere(){
  if(P.lift||P.ride)return null;
  const T=towerAt(P.x,P.z,.1);
  if(!T)return null;
  if(P.baseY>0.2&&TOWERS.indexOf(T)!==P.tower)return null;
  return Math.hypot(P.x-T.pad.x,P.z-T.pad.z)<=2.0?T:null;
}
function liftDing(up){
  if(!AC||muted)return;
  try{
    const t0=AC.currentTime,o=AC.createOscillator(),g=AC.createGain();
    o.type='sine';
    o.frequency.setValueAtTime(up?620:480,t0);o.frequency.linearRampToValueAtTime(up?980:360,t0+.16);
    g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(.16,t0+.02);g.gain.linearRampToValueAtTime(0,t0+.24);
    o.connect(g);g.connect(master);o.start(t0);o.stop(t0+.28);
  }catch(_){}
}
function rideLift(dir){
  if(P.lift||P.holding)return;
  const T=liftHere();if(!T)return;
  const cur=P.floor||0;
  const next=(cur+dir+T.floors)%T.floors;
  if(next===cur)return;
  P.tower=TOWERS.indexOf(T);
  P.lift={t:0,dur:.9+Math.min(3,Math.abs(next-cur))*.18,fromY:P.baseY||0,toY:towerFloorY(T,next),next:next,T:T};
  P.floor=next;
  P.jy=0;P.jv=0;P.kx=0;P.kz=0;
  liftDing(next>cur);
}
/* on upper floors the doorway is closed, so keep the player inside the shell */
function towerClamp(){
  if(P.baseY<=0.2)return;
  const T=P.tower>=0?TOWERS[P.tower]:null;
  if(!T){P.baseY=0;P.floor=0;P.tower=-1;return;}
  const c=Math.cos(T.yaw),s=Math.sin(T.yaw),dx=P.x-T.x,dz=P.z-T.z;
  const lx=dx*c-dz*s,lz=dx*s+dz*c;
  const hx=T.w/2-.9,hz=T.d/2-.9;
  const nlx=clamp(lx,-hx,hx),nlz=clamp(lz,-hz,hz);
  if(nlx!==lx||nlz!==lz){P.x=T.x+nlx*c+nlz*s;P.z=T.z-nlx*s+nlz*c;}
}
function useGrab(){
  if(state!=='play')return;
  if(P.ride){dismountRide();return;}
  if(!P.holding&&liftHere()){rideLift(1);return;}
  if(P.holding){const t=findFeedTarget(P.holding);if(t&&feedHeld(t))return;release();}
  else{
    const canAll=adminUnlocked&&adminLift;
    /* endgame interactions come before snacks and chests */
    const rel=targetRelic();
    if(rel){pickupRelic(rel);return;}
    const portal=targetPortal();
    if(portal){usePortal(portal);return;}
    /* fruit is the quickest snack, even with a gun drawn */
    const fr=targetFruit();
    if(fr){eatFruit(fr);return;}
    /* a drawn gun does not stop you from eating meat off the ground */
    const mt=targetMeat();
    if(mt&&guns.armed){eatMeat(mt);return;}
    const ch=targetChest();
    if(ch){if(canAll)lift(ch);else openChest(ch);return;}
    const h0=canAll?targetHopper():null;
    if(h0){lift(h0);return;}
    const r=targetRide();if(r){mountRide(r);return;}
    if(mt){if(canAll)lift(mt);else eatMeat(mt);return;}
    const h=targetHopper();if(h)lift(h);else if(talkNear()){}else if(nearBig())toast('Too heavy to lift');
  }
}
function die(reason){
  if(state==='dead')return;
  state='dead';
  if(cheatOpen)closeCheatBox();
  if($('adminPanel'))$('adminPanel').hidden=true;
  if(P.ride)dismountRide();
  if(P.holding)release();
  P.hp=0;updateHearts();
  P.tornado=null;P.tornadoCool=2.5;
  for(const k in keys)keys[k]=false;
  try{document.exitPointerLock();}catch(_){}
  const msg=$('deathMsg');
  if(msg)msg.textContent=reason==='starve'?'You starved — your hunger ran out.':reason==='tornado'?'The tornado carried you to the top and let go.':reason==='hunter'?'A hunter shot you down.':'Your hearts ran out.';
  if($('hud'))$('hud').hidden=true;
  const menu=$('deathMenu');
  if(menu)menu.hidden=false;
  const rb=$('respawnBtn');if(rb){try{rb.focus();}catch(_){}}
  burst(P.x,(P.baseY||0)+(P.jy||0)+1.2,P.z,reason==='tornado'?0xb9c0c4:0xe0453c,22);
}
function hurt(n,reason){
  if(godMode)return;
  if(P.hp<=0||state==='dead')return;
  const dmg=Math.max(.05,n*(1-(P.armorRed||0)));
  P.hp=Math.max(0,P.hp-dmg);updateHearts();
  if(P.hp<=0)die(reason);
}
function respawn(){
  const menu=$('deathMenu');
  if(menu)menu.hidden=true;
  P.x=0;P.z=6;P.kx=0;P.kz=0;P.jy=0;P.jv=0;P.fl=0;P.bump=1.5;
  P.baseY=0;P.floor=0;P.tower=-1;P.lift=null;
  P.realm=null;P.pniSupport=null;P.pniCp=0;P.portalCool=1.2;
  P.pniFight=false;winOpen=false;
  if(pniBarrier)pniBarrier.visible=false;
  clearBossHazards();
  resetPniEncounter(true);
  P.tornado=null;P.tornadoCool=2;
  P.punchT=0;P.walkT=0;P.sw=0;P.inW=false;
  P.hp=HEART_MAX;P.hunger=HUNGER_MAX;P.starve=0;P.hungerWarn=false;
  updateHearts();updateHunger();updateGearHud();
  state='play';
  if($('hud'))$('hud').hidden=false;
  if($('adminPanel'))$('adminPanel').hidden=true;
  reqLock();
  burst(0,1.4,6,0x7fd23a,18);
  toast('Back on your feet — good luck!');
}
function bonk(fx,fz,k){
  if(P.bump>0)return;P.bump=1;
  if(P.ride)dismountRide();
  const dx=P.x-fx,dz=P.z-fz,d=Math.hypot(dx,dz)||1;P.kx=dx/d*k*2;P.kz=dz/d*k*2;P.jy=.01;P.jv=14;P.fl=1.2;if(P.holding)release();
  const fl=$('flash');fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),90);
  toast('Flung by a bull!');
  hurt(7);
}
function maul(fx,fz){
  if(P.bump>0)return;P.bump=1.2;
  if(P.ride)dismountRide();
  const dx=P.x-fx,dz=P.z-fz,d=Math.hypot(dx,dz)||1;
  P.kx=dx/d*13;P.kz=dz/d*13;P.jy=.01;P.jv=12;P.fl=1.4;if(P.holding)release();
  const fl=$('flash');fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),110);
  toast('Mauled by a bear!');
  hurt(5);
}
function bite(fx,fz){
  if(P.bump>0)return;P.bump=.9;
  if(P.ride)dismountRide();
  const dx=P.x-fx,dz=P.z-fz,d=Math.hypot(dx,dz)||1;
  P.kx=dx/d*7;P.kz=dz/d*7;P.jy=.01;P.jv=7;P.fl=.7;if(P.holding)release();
  const fl=$('flash');fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),110);
  toast('A wolf bites you!');
  hurt(3);
}
function venom(fx,fz,msg,dmg){
  if(P.bump>0)return;P.bump=.8;
  if(P.ride)dismountRide();
  const dx=P.x-fx,dz=P.z-fz,d=Math.hypot(dx,dz)||1;
  P.kx=dx/d*6;P.kz=dz/d*6;P.jy=.01;P.jv=6;P.fl=.6;if(P.holding)release();
  const fl=$('flash');fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),110);
  toast(msg||'A cobra strikes!');
  hurt(dmg||2);
}
function hitPerson(c,f,dmg,fling){
  if(!c||c.dead)return;
  if(dmg==null)dmg=6;
  c.hp=(c.hp==null?3:c.hp)-dmg;
  if(fling){
    c.knock=3.5;c.landed=false;
    c.y=0;c.vy=rnd(18,24);c.vx=f.cx*rnd(4,7);c.vz=f.cz*rnd(4,7);
    c.sx=rnd(-8,8);c.sz=rnd(-8,8);
  }else{
    c.knock=1.1;c.landed=false;c.y=0;
    c.vy=0;c.vx=0;c.vz=0;c.sx=0;c.sz=0;
  }
  c.talk=0;c.moving=false;
  burst(c.g.position.x,1.2,c.g.position.z,0xcdbb8a,10);
  if(c.hp<=0){
    killPerson(c,'human',!!fling);
    if(fling&&state==='play')toast('The bull gores a '+c.role+'!');
  }
}
function flingFrom(o,dx,dz,pow,name,showToast){
  const p=o.g.position,d=Math.hypot(dx,dz)||1;
  o.knock=rnd(2.2,3.0);
  o.kvx=dx/d*pow*rnd(.85,1.15);
  o.kvz=dz/d*pow*rnd(.85,1.15);
  o.kvy=rnd(15,21);
  o.krx=rnd(-9,9);o.krz=rnd(-9,9);
  o.g.rotation.x=0;o.g.rotation.z=0;
  burst(p.x,Math.max(.4,p.y+.3),p.z,0xcdbb8a,12);
}
function stepKnock(o,dt,t){
  if(!(o.knock>0))return false;
  o.knock-=dt;
  const g=o.g,p=g.position,u=g.userData;
  p.x+=o.kvx*dt;p.z+=o.kvz*dt;
  o.kvy-=24*dt;p.y+=o.kvy*dt;
  if(p.y<=0){
    p.y=0;
    if(o.kvy<-3){o.kvy=-o.kvy*.32;burst(p.x,.2,p.z,0xcdbb8a,4);}
    else o.kvy=0;
  }
  if(p.y>.02){g.rotation.x+=o.krx*dt;g.rotation.z+=o.krz*dt;}
  const kd=Math.pow(.22,dt);o.kvx*=kd;o.kvz*=kd;
  pushOut(p,.3);if(!o.adminRoam)bound(p,53*S);
  if(u&&u.legs&&u.legs.length){
    if(u.legs[0].l)u.legs.forEach(L=>{L.l.rotation.y=Math.sin((t||0)*26+L.k*Math.PI)*.6;});
    else u.legs.forEach((l,i)=>{l.rotation.x=Math.sin((t||0)*15+i*1.7)*.9;});
  }
  if(u&&u.tail)u.tail.rotation.z=Math.sin((t||0)*12)*.6;
  if(o.knock<=0){
    o.knock=0;o.kvx=o.kvz=o.kvy=0;
    g.rotation.x=0;g.rotation.z=0;
    if(p.y>0)p.y=0;
  }
  return true;
}
function bullSweep(f){
  const p=f.g.position,R=f.r+1.6;
  let said=false;
  const hit=(o,name)=>{
    if(!o||o.held||!o.g.visible||o.knock>0||f.hitP.indexOf(o)>=0)return;
    const q=o.g.position,dx=q.x-p.x,dz=q.z-p.z;
    if(Math.hypot(dx,dz)>R)return;
    f.hitP.push(o);
    const tiny=name==='ant'||name==='bee'||name==='grasshopper';
    flingFrom(o,dx,dz,tiny?16:12,name,!said);
    said=true;
  };
  ants.forEach(a=>hit(a,'ant'));
  bees.forEach(b=>hit(b,'bee'));
  butterflies.forEach(b=>hit(b,'butterfly'));
  hoppers.forEach(h=>hit(h,'grasshopper'));
  birds.forEach(b=>hit(b,'bird'));
  pets.forEach(c=>hit(c,c.kind));
  persons.forEach(c=>{
    if(c.knock>0||f.hitP.indexOf(c)>=0)return;
    const q=c.g.position,dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz)||1;
    if(d>R)return;
    f.hitP.push(c);
    hitPerson(c,{cx:dx/d,cz:dz/d},20,true);
    said=true;
  });
}

/* ---------- audio: chirps ---------- */
let AC=null,master=null,muted=false;
function initAudio(){
  if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)();master=AC.createGain();master.gain.value=muted?0:.6;master.connect(AC.destination);}catch(_){AC=null;return;}}
  if(AC.state==='suspended'){try{AC.resume();}catch(_){}}
}
function chirp(vol,pan,pitch,n){
  if(!AC||muted||vol<.008)return;
  try{
    const t0=AC.currentTime,gap=.062;
    const o=AC.createOscillator(),g=AC.createGain();o.type='triangle';
    o.frequency.setValueAtTime(pitch,t0);o.frequency.linearRampToValueAtTime(pitch*1.06,t0+n*gap);
    g.gain.setValueAtTime(0,t0);
    for(let i=0;i<n;i++){const a=t0+i*gap;g.gain.setValueAtTime(0,a);g.gain.linearRampToValueAtTime(vol,a+.01);g.gain.linearRampToValueAtTime(0,a+.045);}
    o.connect(g);
    if(AC.createStereoPanner){const sp=AC.createStereoPanner();sp.pan.value=clamp(pan,-1,1);g.connect(sp);sp.connect(master);}else g.connect(master);
    o.start(t0);o.stop(t0+n*gap+.06);
  }catch(_){}
}
function hopperChirp(h){
  if(state!=='play')return;
  const pitch=rnd(3600,5000),n=2+Math.floor(rand()*4);
  h.rub=n*.062+.15;
  if(h.held){chirp(.28,0,pitch,n);return;}
  const dx=h.g.position.x-P.x,dz=h.g.position.z-P.z,d=Math.hypot(dx,dz)||1;
  const v=Math.pow(clamp(1-d/20,0,1),2)*.3;
  chirp(v,(dx*Math.cos(yaw)-dz*Math.sin(yaw))/d,pitch,n);
}

/* ---------- AI ---------- */
function updateCow(c,dt){
  const g=c.g,u=g.userData,p=g.position;c.t+=dt;
  if(c.held){u.legs.forEach((l,i)=>{l.rotation.x=Math.sin(c.t*10+i*1.7)*.5;});u.tail.rotation.z=Math.sin(c.t*8)*.4;g.rotation.y=-1.1;return;}
  let headT=0,walk=0;
  c.st-=dt;
  if(c.state==='graze'){headT=.95;if(c.st<=0){c.state='walk';c.st=rnd(2.5,6);c.dir=rnd(0,TAU);}}
  else{
    walk=1;p.x+=Math.sin(c.dir)*1.0*dt;p.z+=Math.cos(c.dir)*1.0*dt;
    if(c.st<=0){c.state='graze';c.st=rnd(3,8);}
  }
  if(c.home&&Math.hypot(c.home.x-p.x,c.home.z-p.z)>c.home.r)c.dir=Math.atan2(c.home.x-p.x,c.home.z-p.z);
  const hit=pushOut(p,1.0);if((!c.adminRoam&&bound(p,52*S))||hit){c.dir+=Math.PI*rnd(.6,1.4);}
  g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*2.5);
  u.head.rotation.x+=(headT-u.head.rotation.x)*Math.min(1,dt*3);
  u.tail.rotation.z=Math.sin(c.t*2.2)*.25;
  const w=c.t*5;u.legs.forEach((l,i)=>{l.rotation.x=walk?Math.sin(w+(i===0||i===3?0:Math.PI))*.4:0;});
}
function updateBull(f,dt){
  const g=f.g,p=g.position,u=g.userData;f.cd-=dt;f.t+=dt;
  if(f.held){u.legs.forEach((l,i)=>{l.rotation.x=Math.sin(f.t*10+i*1.7)*.5;});u.eyeMat.emissiveIntensity=0;g.rotation.y=-1.1;return;}
  if(f.ridden){
    f.riderT+=dt;
    if(f.riderT>=10){buckOff(f);return;}
    if(!f.warned&&f.riderT>=8){f.warned=true;toast('The bull is getting angry...');}
    f.boltT-=dt;
    if(f.boltT<=0){f.boltT=rnd(.35,1.0);f.dir+=(rand()<.5?-1:1)*rnd(.8,2.2);}
    const sp=11.5;
    p.x+=Math.sin(f.dir)*sp*dt;p.z+=Math.cos(f.dir)*sp*dt;
    if(pushOut(p,f.r)){f.dir+=rnd(1.8,3.6);f.boltT=.35;}
    if(!f.adminRoam)bound(p,53*S);
    g.rotation.y+=angDiff(g.rotation.y,f.dir)*Math.min(1,dt*8);
    const w=f.t*18;
    u.legs.forEach((l,i)=>{l.rotation.x=Math.sin(w+(i%2)*Math.PI)*.8;});
    g.position.y=Math.abs(Math.sin(f.t*11))*.2;
    u.head.rotation.x=.25;
    u.eyeMat.emissiveIntensity=1.6;
    bullSweep(f);
    return;
  }
  const dx=P.x-p.x,dz=P.z-p.z,d=Math.hypot(dx,dz)||1;
  let mx=0,mz=0,sp=0,faceTo=null;
  if(f.state==='wander'){
    f.wt-=dt;
    if(f.wt<=0){
      f.wt=rnd(2,4);
      const who=nearestPerson(p,55);
      f.dir=who&&rand()<.65?Math.atan2(who.g.position.x-p.x,who.g.position.z-p.z):(rand()<.35?null:rnd(0,TAU));
    }
    if(f.dir!==null){mx=Math.sin(f.dir);mz=Math.cos(f.dir);sp=1.6;faceTo=f.dir;}
    if(f.cd<=0&&state==='play'){
      if(d<15){f.target=null;f.state='wind';f.st=1.3;toast('A bull is winding up, step aside');}
      else{
        const who=nearestPerson(p,16);
        if(who){f.target=who;f.state='wind';f.st=1.3;}
      }
    }
  }else if(f.state==='wind'){
    f.st-=dt;
    const tx=f.target?f.target.g.position.x:P.x,tz=f.target?f.target.g.position.z:P.z;
    faceTo=Math.atan2(tx-p.x,tz-p.z);u.legs[0].rotation.x=Math.sin(f.t*18)*.6;
    if(f.st<=0){
      const ax=tx-p.x,az=tz-p.z,ad=Math.hypot(ax,az)||1;
      f.state='charge';f.st=2.6;f.cx=ax/ad;f.cz=az/ad;f.hit=false;f.hitP=[];
    }
  }else if(f.state==='charge'){
    f.st-=dt;mx=f.cx;mz=f.cz;sp=14;faceTo=Math.atan2(mx,mz);
    if(!f.hit&&d<f.r+.8){f.hit=true;bonk(p.x,p.z,16);}
    bullSweep(f);
    if(f.st<=0){f.state='rest';f.st=2;f.cd=6;}
  }else{f.st-=dt;if(f.st<=0){f.state='wander';f.target=null;}}
  u.eyeMat.emissiveIntensity=f.state==='wind'||f.state==='charge'?1.6:0;
  p.x+=mx*sp*dt;p.z+=mz*sp*dt;
  if(pushOut(p,f.r)&&f.state==='charge'){f.state='rest';f.st=2.6;f.cd=6;burst(p.x+mx*1.5,2,p.z+mz*1.5,0xcdbb8a,10);}
  if(!f.adminRoam)bound(p,53*S);
  if(faceTo!==null)g.rotation.y+=angDiff(g.rotation.y,faceTo)*Math.min(1,dt*(f.state==='charge'?20:6));
  if(sp>.1){const w=f.t*(sp>5?16:7);u.legs.forEach((l,i)=>l.rotation.x=Math.sin(w+(i%2)*Math.PI)*.55);}
  u.head.rotation.x=f.state==='wind'?.35+Math.sin(f.t*20)*.1:f.state==='charge'?.25:0;
}
function updateHopper(h,dt,t){
  h.ct-=dt;if(h.ct<=0){h.ct=h.held?rnd(.9,2.2):rnd(1.6,5.5);hopperChirp(h);}
  if(h.held){
    const u=h.g.userData;
    if(h.rub>0){h.rub-=dt;
      u.hl.forEach((l,i)=>{l.t.rotation.x=.75+Math.sin(t*50+i*Math.PI)*.22;l.sh.rotation.x=-.5+Math.sin(t*50+i*Math.PI+1)*.18;});
      u.wings.forEach((w,i)=>{w.rotation.x=Math.sin(t*50+i)*.07;});
    }else{
      u.hl.forEach((l,i)=>{l.t.rotation.x=1.1+Math.sin(t*5+i*2)*.12;l.sh.rotation.x=-.85+Math.sin(t*5+i*2+1)*.1;});
      u.wings.forEach(w=>{w.rotation.x=0;});
    }
    h.g.rotation.y=-1.1+Math.sin(t*3)*.15;return;
  }
  if(stepKnock(h,dt,t))return;
  const g=h.g,u=g.userData;let crouch=0,air=0;
  if(h.state==='wait'){
    h.wait-=dt;
    const dp=Math.hypot(g.position.x-P.x,g.position.z-P.z);
    if(dp<1.7&&h.wait>.25)h.wait=.25;
    if(h.wait<.2)crouch=1-h.wait/.2;
    if(h.wait<=0){
      let ex=g.position.x,ez=g.position.z,ok=false;
      for(let i=0;i<8&&!ok;i++){
        let a=rnd(0,TAU),dist=rnd(.9,2.0);
        if(dp<2.4){a=Math.atan2(g.position.x-P.x,g.position.z-P.z)+rnd(-.9,.9);dist=rnd(1.4,2.4);}
        ex=g.position.x+Math.sin(a)*dist;ez=g.position.z+Math.cos(a)*dist;
        ok=(h.adminRoam||Math.hypot(ex,ez)<55*S)&&!solids.some(s=>Math.hypot(s.x-ex,s.z-ez)<s.r+.3);
      }
      if(!ok){ex=g.position.x;ez=g.position.z;}
      h.sx=g.position.x;h.sz=g.position.z;h.ex=ex;h.ez=ez;h.t=0;h.dur=rnd(.35,.5);
      g.rotation.y=Math.atan2(ex-h.sx,ez-h.sz);h.state='hop';
    }
  }else{
    h.t+=dt/h.dur;const k=Math.min(h.t,1);
    g.position.x=h.sx+(h.ex-h.sx)*k;g.position.z=h.sz+(h.ez-h.sz)*k;
    air=Math.sin(Math.PI*k);g.position.y=air*.55;
    if(k>=1){h.state='wait';h.wait=rnd(.7,2.4);g.position.y=0;}
  }
  const rubbing=h.state==='wait'&&h.rub>0;if(h.rub>0)h.rub-=dt;
  u.hl.forEach((l,i)=>{
    if(rubbing){l.t.rotation.x=.75+Math.sin(t*50+i*Math.PI)*.22;l.sh.rotation.x=-1.0+Math.sin(t*50+i*Math.PI+1)*.18;}
    else{l.t.rotation.x=1.1+.3*crouch-.6*air;l.sh.rotation.x=-.85+.55*air-.2*crouch;}
  });
  u.wings.forEach((w,i)=>{w.rotation.x=rubbing?Math.sin(t*50+i)*.07:0;});
  g.scale.set(HS,HS*(1-.15*crouch),HS);
}

function updateCompass() {
  if (state !== 'play') return;
  const deg = (yaw * 180 / Math.PI) % 360;
  const normalizedYaw = (deg + 360) % 360;
  const heading = (360 - normalizedYaw) % 360;
  $('compassNeedle').style.transform = `rotate(${-normalizedYaw}deg)`;
  const directions = ['N','NE','E','SE','S','SW','W','NW'];
  const dir = directions[Math.round(heading / 45) % directions.length];
  $('compassDir').textContent = dir;
  const md=$('mapDir');if(md)md.textContent=dir;
}

/* ---------- AI sleep gate: skip far entities (hidden & out of reach) ---------- */
const GATE_R2=220*220;
function awake(e){
  if(e.held||e.ridden)return true;
  const p=e.g.position;
  const dx=p.x-P.x,dz=p.z-P.z;
  return dx*dx+dz*dz<GATE_R2;
}

/* ---------- main update ---------- */
function update(dt,t){
  updateSky(dt);
  if(state==='play'){
    /* hunger drains all day; an empty belly starts eating your hearts */
    if(godMode){P.hunger=HUNGER_MAX;P.starve=0;P.hungerWarn=false;}
    else{
      P.hunger=Math.max(0,(P.hunger==null?HUNGER_MAX:P.hunger)-dt/HUNGER_DRAIN);
      P.hungerT=(P.hungerT||0)+dt;
      if(P.hungerT>=.3){P.hungerT=0;updateHunger();}
      if(P.hunger<=3&&!P.hungerWarn){P.hungerWarn=true;toast('You are getting hungry — hunt something to eat');}
      else if(P.hunger>3)P.hungerWarn=false;
      if(P.hunger<=0){P.starve=(P.starve||0)+dt;if(P.starve>=STARVE_TICK){P.starve=0;starve(1);}}
      else P.starve=0;
    }
    if(netRole!=='client'){
      /* only a few new animals appear at a time, always near the player */
      P.spawnT=(P.spawnT==null?4:P.spawnT)-dt;
      if(P.spawnT<=0){P.spawnT=rnd(4,8);spawnRandomAnimal();}
      /* random humans wander the world too, and huge herds thin themselves out */
      P.humanT=(P.humanT==null?10:P.humanT)-dt;
      if(P.humanT<=0){P.humanT=rnd(12,24);if(wildHumanCount()<WILD_HUMAN_CAP)spawnRandomHuman();}
      P.smallT=(P.smallT==null?5:P.smallT)-dt;
      if(P.smallT<=0){P.smallT=rnd(5,9);topUpSmall();}
      /* far-away wildlife despawns quickly so distant places stay empty */
      P.farT=(P.farT==null?2:P.farT)-dt;
      if(P.farT<=0){P.farT=2;despawnFarWildlife();}
      /* rare weather: one tornado usually, very rarely two at once */
      P.tornadoT=(P.tornadoT==null?rnd(45,85):P.tornadoT)-dt;
      if(P.tornadoT<=0){P.tornadoT=rnd(90,170);if(!tornadoes.length)startTornadoEvent();}
      P.cullT=(P.cullT==null?9:P.cullT)-dt;
      if(P.cullT<=0){P.cullT=8;overpopulationCull();}
      P.tornadoCool=Math.max(0,(P.tornadoCool||0)-dt);
    }
    const bNow=biomeAt(P.x,P.z);
    if(bNow!==P.biome){P.biome=bNow;if(bNow)toast(bNow==='desert'?'You enter the sun-baked desert':bNow==='snow'?'You enter the frozen snowfield':'You enter the golden savanna');}
    P.punchT=Math.max(0,(P.punchT||0)-dt);
    let ix=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0)+joy.x;
    let iy=(keys.w||keys.arrowup?1:0)-(keys.s||keys.arrowdown?1:0)-joy.y;
    const il=Math.hypot(ix,iy);if(il>1){ix/=il;iy/=il;}
    const fx=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw);
    const mx=fx*iy+rx*ix,mz=fz*iy+rz*ix,ml=Math.hypot(mx,mz);
    const flying=adminUnlocked&&adminFly&&!P.ride;
    const px=P.x,pz=P.z;let inLake=false;
    for(let i=0;i<LAKES.length;i++){const L=LAKES[i];const dx=px-L.x,dz=pz-L.z;if(dx*dx+dz*dz<L.r*L.r){inLake=true;break;}}
    const inW=!flying&&(inLake||riverAt(px,pz))&&!bridgeAt(px,pz);
    if(!flying&&inW!==P.inW){P.inW=inW;burst(P.x,.2,P.z,0xbfe6ff,14);toast(inW?'Splash! You are swimming':'Out of the water');}
    P.sw+=((inW?1:0)-P.sw)*Math.min(1,dt*6);
    if(P.tornado){
      /* the tornado owns movement until it finishes carrying the player */
      P.bump-=dt;P.fl=Math.max(0,P.fl-dt);P.kx=0;P.kz=0;
    }else if(P.lift){
      /* riding the tower lift: glide up or down to the selected floor */
      const L=P.lift;
      L.t+=dt;
      const k=Math.min(1,L.t/L.dur),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
      P.baseY=L.fromY+(L.toY-L.fromY)*e;
      P.x+=(L.T.pad.x-P.x)*Math.min(1,dt*9);
      P.z+=(L.T.pad.z-P.z)*Math.min(1,dt*9);
      P.jy=0;P.jv=0;P.kx=0;P.kz=0;
      P.fl=Math.max(0,P.fl-dt);P.bump-=dt;
      if(k>=1){
        P.baseY=L.toY;P.lift=null;
        liftDing(false);
        toast(L.next===0?'Ground floor — the lobby':('Floor '+L.next+' of '+(L.T.floors-1)));
      }
    }else if(P.ride){
      const a=P.ride,g=a.g;
      if(!a.bull){
        const turn=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0)+joy.x;
        const thr=(keys.w||keys.arrowup?1:0)-(keys.s||keys.arrowdown?1:0)-joy.y;
        if(Math.abs(turn)>.05)g.rotation.y-=turn*2.1*dt;
        let sp=0;
        if(thr>.05)sp=11*Math.min(1,thr);
        else if(thr<-.05)sp=-4.5*Math.min(1,-thr);
        a.rideSpd=sp;
        g.position.x+=Math.sin(g.rotation.y)*sp*dt;
        g.position.z+=Math.cos(g.rotation.y)*sp*dt;
        pushOut(g.position,1.1);boundPet(g.position,a.kind||'horse',a);
        a.dir=g.rotation.y;
      }else a.rideSpd=11.5;
      P.x=g.position.x;P.z=g.position.z;P.jy=0;P.jv=0;P.kx=0;P.kz=0;
      P.walkT+=dt*4;P.bump-=dt;P.fl=Math.max(0,P.fl-dt);
    }else if(flying){
      const f=fwdVec(),flySpd=keys.shift?20:11;
      P.x+=(f.x*iy+rx*ix)*flySpd*dt;
      P.z+=(f.z*iy+rz*ix)*flySpd*dt;
      let climb=f.y*iy*flySpd*dt;
      if(keys[' '])climb+=flySpd*.95*dt;
      if(keys.control||keys.c)climb-=flySpd*.95*dt;
      P.jy=clamp(P.jy+climb,0,220);
      P.jv=0;P.kx=0;P.kz=0;
      P.fl=Math.max(0,P.fl-dt);P.bump-=dt;
      boundPlayer(P);
      P.walkT+=dt*ml*6;if(ml<.1)P.walkT*=.92;
    }else if(P.realm==='pni'){
      updatePniPlayer(dt,mx,mz);
    }else{
      const hv=(P.holding&&P.holding.heavy)||1;
      const spd=(keys.shift&&hv===1?9.5:5.8)*(inW?.55:1)*hv;
      if(keys[' ']&&P.jy<=0&&P.jv<=0)P.jv=(P.baseY>0.2?4.2:(inW?4:7))*(hv===1?1:.7);
      P.jv-=20*dt;P.jy+=P.jv*dt;if(P.jy<=0){P.jy=0;P.jv=0;}
      if(P.baseY>0.2&&P.jy>1.0){P.jy=1.0;if(P.jv>0)P.jv=0;}
      const ctl=P.fl>0?.25:1;
      P.x+=(mx*spd*ctl+P.kx)*dt;P.z+=(mz*spd*ctl+P.kz)*dt;P.fl=Math.max(0,P.fl-dt);
      const kd=Math.pow(P.jy>0?.35:.01,dt);P.kx*=kd;P.kz*=kd;P.bump-=dt;
      
      if (ml > 0.1 && P.jy === 0 && !inW) {
          P.walkStep = (P.walkStep || 0) + dt * spd;
          if (P.walkStep > 1.5) {
              P.walkStep = 0;
              if (rand() < 0.4) burst(P.x, 0.1, P.z, 0xc9b58a, 1);
          }
      }

      pushOut(P,.5,true);pushFrom(P,.5,cows,1.15);pushFrom(P,.5,bulls,1.6);pushFrom(P,.5,props,.9);pushFrom(P,.5,persons,.55);boundPlayer(P);
      P.walkT+=dt*ml*(keys.shift?12:9);if(ml<.1)P.walkT*=.9;
    }
    if(netRole==='host')stepRemoteActors(dt);
    if(P.realm!=='pni')towerClamp();
  }
  if(netRole!=='client'){
    cows.forEach(c=>{if(!c.tornadoed&&awake(c))updateCow(c,dt)});
    bulls.forEach(b=>{if(!b.tornadoed&&awake(b))updateBull(b,dt)});
    hoppers.forEach(h=>{if(!h.tornadoed&&awake(h))updateHopper(h,dt,t)});
    for(let i=parts.length-1;i>=0;i--){const p=parts[i];p.life-=dt;p.vy-=18*dt;p.o.position.x+=p.vx*dt;p.o.position.y+=p.vy*dt;p.o.position.z+=p.vz*dt;
    p.o.scale.setScalar(Math.max(p.life/p.max,0));if(p.life<=0||p.o.position.y<-1){scene.remove(p.o);parts.splice(i,1);}}
    clouds.forEach(c=>{c.position.x+=c.userData.v*dt;if(c.position.x>1500)c.position.x=-1500;});
    turbines.forEach(w=>{w.rotor.rotation.z+=w.sp*dt;});
    if(Math.floor(t*30)%2===0&&t-seaAnimAt>.12){seaAnimAt=t;animateSea(t);}
    updateFish(dt,t);
    pets.forEach(c=>{if(!c.tornadoed&&awake(c))updatePet(c,dt,t)});
    meats.forEach(m=>{if(!m.held)m.g.rotation.y+=dt*.9;});
    updateFruits(t);
    updateChests(dt,t);
    bees.forEach(b=>{if(awake(b))updateBee(b,dt,t)});
    butterflies.forEach(b=>{if(awake(b))updateButterfly(b,dt,t)});
    birds.forEach(b=>{if(awake(b))updateBird(b,dt,t)});
    ants.forEach(a=>{if(awake(a))updateAnt(a,dt,t)});
    persons.forEach(c=>{if(awake(c))updatePerson(c,dt,t)});
    updateTornado(dt);
  }
  updateBosses(dt,t);
  
  if(state==='play'){
    updateCompass();
    const riding=!!P.ride;
    const canAll=adminUnlocked&&adminLift;
    const want=(!P.holding&&!riding);
    const rt=want?targetRide():null;
    const tgt=want?targetHopper():null;
    const mt=want?targetMeat():null;
    const fr=want?targetFruit():null;
    const rel=want?targetRelic():null;
    const portal=want?targetPortal():null;
    const ch=want?targetChest():null;
    const ed=want?edibleNear():null;
    const gt=(guns.armed&&want)?gunRay(90,0):null;
    const ft=P.holding?findFeedTarget(P.holding):null;
    $('cross').classList.toggle('on',!!tgt||!!ft||!!rt||riding||!!mt||!!fr||!!rel||!!portal||!!ed||!!gt||!!ch);
    const out=[];
    if(riding){
      out.push(P.ride.bull?'F Dismount ('+Math.max(0,10-P.ride.riderT).toFixed(1)+'s)':'F Dismount');
    }
    else if(P.holding){
      out.push(ft?'F Feed '+ft.type:'F Let go');
    }
    else if(liftHere()){
      out.push('F Lift up');
      if(P.floor>0)out.push('G Lift down');
      out.push(P.floor>0?'Floor '+P.floor:'Ground floor');
    }
    else if(rel)out.push('F Take gold relic');
    else if(portal==='return')out.push('F Return to pasture');
    else if(portal&&!hasBothRelics())out.push('F Inspect sealed portal');
    else if(portal&&!portalOpen)out.push('F Open portal');
    else if(portal)out.push("F Enter Pni's realm");
    else if(fr)out.push('F Eat '+(FRUIT_DEFS[fr.kind]||FRUIT_DEFS.berry).name.toLowerCase());
    else if(guns.armed&&mt)out.push('F Eat meat');
    else if(ch)out.push(canAll?'F Lift chest':'F Open chest');
    else if(canAll&&tgt){
      const nm=tgt.fish?'fish':tgt.pet?tgt.kind:tgt.obj?tgt.kind:tgt.chest?'chest':tgt.meatItem?'meat':tgt.cow?'cow':tgt.bull?'bull':tgt.person?(tgt.kind==='human'?'human':tgt.role):tgt.bee?'bee':tgt.bird?'bird':tgt.ant?'ant':'grasshopper';
      out.push('F Lift '+nm);
      if(rt)out.push('G Ride '+(rt.bull?'bull':rt.kind==='camel'?'camel':'horse'));
    }
    else if(rt)out.push(rt.bull?'F Ride bull':rt.kind==='camel'?'F Ride camel':'F Ride horse');
    else if(mt)out.push(canAll?'F Lift meat':'F Eat meat');
    else if(!tgt&&personNear())out.push('F Talk');
    else if(tgt){
      const nm=tgt.fish?'fish':tgt.pet?tgt.kind:tgt.obj?tgt.kind:tgt.chest?'chest':tgt.meatItem?'meat':tgt.cow?'cow':tgt.bull?'bull':tgt.person?(tgt.kind==='human'?'human':tgt.role):tgt.bee?'bee':tgt.bird?'bird':tgt.ant?'ant':'grasshopper';
      const heavy=(tgt.obj||tgt.cow||tgt.bull||tgt.chest)&&!canAll;
      out.push('F Lift '+nm+(heavy?' (heavy)':''));
    }
    if(guns.armed&&!P.holding&&!riding)out.push(gt?'E Shoot '+gt.kind:'E Shoot');
    else if(ed&&!P.holding&&!riding)out.push((P.sword?'E Slash ':'E Punch ')+(ed.cow?'cow':ed.bull?'bull':ed.hopper?'grasshopper':ed.kind));
    const key=out.join('|');
    if($('prompt').dataset.k!==key){$('prompt').dataset.k=key;$('prompt').innerHTML=out.map(s=>{
      if(s.startsWith('F Feed '))return '<span data-a="feed">'+s+'</span>';
      if(s.startsWith('F Open chest')||s.startsWith('F Lift chest'))return '<span data-a="lift">'+s+'</span>';
      if(s.startsWith('G Ride '))return '<span data-a="rideg">'+s+'</span>';
      if(s.startsWith('F Lift '))return '<span data-a="lift">'+s+'</span>';
      if(s.startsWith('G Lift '))return '<span data-a="liftdown">'+s+'</span>';
      if(s.startsWith('F Ride ')||s.startsWith('F Dismount'))return '<span data-a="ride">'+s+'</span>';
      if(s.startsWith('F Take gold relic')||s.startsWith('F Inspect sealed portal')||s.startsWith('F Open portal')||s.startsWith("F Enter Pni's realm")||s.startsWith('F Return to pasture'))return '<span data-a="use">'+s+'</span>';
      if(s.startsWith('E Shoot'))return '<span data-a="shoot">'+s+'</span>';
      if(s.startsWith('E Punch ')||s.startsWith('E Slash '))return '<span data-a="punch">'+s+'</span>';
      return '<span>'+s+'</span>';
    }).join('');}
    updateEndgame(dt,t);
  }
}
function updateThirdPersonCamera(){
  const base=avatar.position.y;
  const targetY=base+1.28+(P.ride?.15:0);
  const dist=P.ride?(P.ride.bull?7.4:6.3):4.6;
  const lp=clamp(pitch,-1.15,.85);
  const cp=Math.cos(lp),sp=Math.sin(lp);
  const cx=P.x+Math.sin(yaw)*cp*dist;
  const cz=P.z+Math.cos(yaw)*cp*dist;
  let cy=targetY-sp*dist;
  const floor=P.baseY+.4;
  if(cy<floor)cy=floor;
  camera.position.set(cx,cy,cz);
  camera.lookAt(P.x,targetY,P.z);
}
function updateCamera(dt){
  if(state==='play'){
    updateAvatar(dt);
    const fp=!thirdPerson;
    let cy=P.baseY+P.jy+1.7-.95*P.sw+(P.sw>.5?Math.sin(clock*2.2)*.05:Math.abs(Math.sin(P.walkT))*.07);
    let roll=P.fl>0?Math.sin((1.2-P.fl)*10)*.6*(P.fl/1.2):0;
    if(P.ride){
      cy+=P.ride.bull?2.5:P.ride.kind==='camel'?2.05:1.5;
      if(P.ride.bull){cy+=Math.sin(clock*17)*.08;roll+=Math.sin(clock*23)*.06;}
      else cy+=Math.sin(clock*7)*.03;
    }
    camera.position.set(P.x,cy,P.z);
    camera.rotation.set(pitch,yaw,roll);
    hand.visible=!!P.holding&&fp;
    carry.visible=fp;
    /* Both fists stay in view when empty; the left backs up the held-item hand. */
    const pt=P.punchT||0,pk=pt>0?Math.sin((1-pt/.32)*Math.PI):0;
    fist.visible=!P.holding&&!P.ride&&!guns.armed&&!P.sword&&fp;
    fist.position.set(.30-pk*.06,-.34+pk*.13+Math.sin(P.walkT*1.1)*.012,-.62-pk*.36);
    fist.rotation.set(-.12+pk*.42,.24-pk*.22,.06-pk*.12);
    fistLeft.visible=!P.ride&&!guns.armed&&fp;
    fistLeft.position.set(-.30+pk*.06,-.34+pk*.13+Math.sin(P.walkT*1.1)*.012,-.62-pk*.36);
    fistLeft.rotation.set(-.12+pk*.42,-(.24-pk*.22),-(.06-pk*.12));
    swordRoot.visible=!!P.sword&&!P.holding&&!P.ride&&!guns.armed&&fp;
    if(swordRoot.visible){
      swordRoot.position.set(.30-pk*.05,-.36+pk*.16+Math.sin(P.walkT*1.1)*.012,-.55-pk*.3);
      swordRoot.rotation.set(-.18+pk*.55,.22-pk*.75,.1-pk*.25);
    }
    /* the gun viewmodel bobs, recoils and flashes when armed */
    guns.cool=Math.max(0,guns.cool-dt);
    if(netRole!=='client'&&guns.armed&&GUN_DEFS[guns.weapon].auto&&(keys['e']||fireHeld))shoot();
    guns.recoil=Math.max(0,guns.recoil-dt*7);
    guns.flash=Math.max(0,guns.flash-dt);
    const armedView=guns.armed&&!P.holding&&!P.ride&&fp;
    gunRoot.visible=armedView;
    if(armedView){
      const bob=Math.sin(P.walkT*1.1)*.008;
      gunRoot.position.set(.25-guns.recoil*.02,-.29+bob+guns.recoil*.055,-.55+guns.recoil*.16);
      gunRoot.rotation.set(guns.recoil*.34,.28,.03);
      for(let i=0;i<gunModels.length;i++)gunModels[i].visible=i===guns.weapon;
      gunFlashes.forEach((f,i)=>{
        f.visible=guns.flash>0&&i===guns.weapon;
        if(f.visible){f.rotation.z+=dt*22;f.scale.setScalar(.7+(guns.flash/.07)*.8);}
      });
    }
    if(thirdPerson)updateThirdPersonCamera();
    updateMobBar();
  }else{
    yaw+=dt*.12;
    camera.position.set(Math.sin(yaw)*220,110,-4+Math.cos(yaw)*220);camera.lookAt(0,2,-4);
    hand.visible=false;fist.visible=false;fistLeft.visible=false;gunRoot.visible=false;swordRoot.visible=false;
    carry.visible=false;avatar.visible=false;
  }
}

/* ---------- admin panel ---------- */
let adminMsgT=0;
function adminMsg(t){
  const el=$('adminMsg');
  if(el){el.textContent=t;el.classList.add('on');clearTimeout(adminMsgT);adminMsgT=setTimeout(()=>el.classList.remove('on'),2600);}
  toast(t);
}
function adminUnlock(){
  if(adminUnlocked){grantGuns();return;}
  adminUnlocked=true;
  $('adminBtn').hidden=false;
  if(master&&muted){muted=false;master.gain.value=.6;}
  grantGuns(true);
  setLiftAll(true);
  setOneShot(true);
  toast('ADMIN unlocked — all weapons, lift everything and one-shot are ON!');
}
function setFly(on){
  if(on&&!adminUnlocked)return;
  adminFly=!!on;
  if(adminFly){P.baseY=0;P.floor=0;P.tower=-1;P.lift=null;}
  const b=$('abFly');
  if(b){b.textContent='Fly: '+(adminFly?'ON':'OFF');b.classList.toggle('on',adminFly);}
  const p=$('flyPill');if(p)p.hidden=!adminFly;
  if(adminFly){P.jv=0;P.kx=0;P.kz=0;adminMsg('Flight ON — look up and hold W to climb');}
  else adminMsg('Flight OFF — gravity takes over');
}
function setLiftAll(on){
  adminLift=!!on;
  const b=$('abLift');
  if(b){b.textContent='Lift Everything: '+(adminLift?'ON':'OFF');b.classList.toggle('on',adminLift);}
}
function setOneShot(on){
  adminOneShot=!!on;
  const b=$('abOneShot');
  if(b){b.textContent='One-Shot Kill: '+(adminOneShot?'ON':'OFF');b.classList.toggle('on',adminOneShot);}
}
/* F2 opens the code box until admin is unlocked. */
let cheatOpen=false;
function openCheatBox(){
  if(cheatOpen)return;
  cheatOpen=true;
  for(const k in keys)keys[k]=false;
  try{document.exitPointerLock();}catch(_){}
  $('cheatBox').hidden=false;
  $('cheatInput').value='';
  $('cheatMsg').textContent='';$('cheatMsg').classList.remove('on');
  setTimeout(()=>{try{$('cheatInput').focus();}catch(_){}},40);
}
function closeCheatBox(){
  if(!cheatOpen)return;
  cheatOpen=false;
  $('cheatBox').hidden=true;
  $('cheatInput').value='';
  try{$('cheatInput').blur();}catch(_){}
  if(state==='play')reqLock();
}
const CODE_HASHES=['dbe87b4c1b780299'];
function codeHash(s){
  let a=0x811c9dc5,b=0x9e3779b9;
  const t=s+'q7Lm2Xr9Tz4Kp8Vw';
  for(let r=0;r<8192;r++){
    for(let i=0;i<t.length;i++){
      const c=t.charCodeAt(i)^(r&255);
      a=Math.imul(a^c,0x01000193)>>>0;
      b=Math.imul(b^c,0x85ebca6b)>>>0;
    }
    b=(b^(b>>>13))>>>0;a=(a+(b>>>7))>>>0;
  }
  return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
}
function submitCheat(){
  const v=($('cheatInput').value||'').trim().toLowerCase();
  if(CODE_HASHES.includes(codeHash(v))){
    adminUnlock();
    closeCheatBox();
    openAdmin();
  }else{
    const m=$('cheatMsg');
    m.textContent=v?'That code is not right.':'Type the code first.';
    m.classList.add('on');
    $('cheatInput').select();
  }
}

(function wireCheatBox(){
  const inp=$('cheatInput');
  if(inp)inp.addEventListener('keydown',e=>{
    e.stopPropagation();
    if(e.key==='Enter'){e.preventDefault();submitCheat();}
    else if(e.key==='Escape'){e.preventDefault();closeCheatBox();}
  });
  const go=$('cheatGo');if(go)go.addEventListener('click',submitCheat);
  const cancel=$('cheatCancel');if(cancel)cancel.addEventListener('click',closeCheatBox);
})();
function openAdmin(){
  if(!adminUnlocked)return;
  if(state==='play')state='admin';
  $('adminPanel').hidden=false;
  $('mobhp').hidden=true;
  try{document.exitPointerLock();}catch(_){}
  for(const k in keys)keys[k]=false;
}
function closeAdmin(){
  $('adminPanel').hidden=true;
  if(state==='admin'){state='play';reqLock();}
}
function adminTeleport(x,z,label){
  if(P.ride)dismountRide();
  P.x=x;P.z=z;P.jy=0;P.jv=0;P.kx=0;P.kz=0;P.fl=0;
  P.baseY=0;P.floor=0;P.tower=-1;P.lift=null;
  P.biome=biomeAt(x,z);
  burst(x,.9,z,0xffe08a,18);
  adminMsg('Teleported to '+label);
  closeAdmin();
}
/* where the crosshair meets the ground — used to place spawns and the tornado */
function aimSpawnPoint(maxD){
  maxD=maxD||200;
  const f=fwdVec(),eye=1.7+(P.baseY||0)+(P.jy||0);
  let x,z;
  if(f.y<-.006){
    const t=Math.min(maxD,eye/Math.max(.006,-f.y));
    x=P.x+f.x*t;z=P.z+f.z*t;
  }else{
    const fl=Math.hypot(f.x,f.z)||1;
    x=P.x+f.x/fl*Math.min(18,maxD);z=P.z+f.z/fl*Math.min(18,maxD);
  }
  const d=Math.hypot(x,z);
  if(d>2520){x*=2520/d;z*=2520/d;}
  return {x,z};
}
function adminAllFood(){
  P.hunger=HUNGER_MAX;P.hungerWarn=false;P.starve=0;updateHunger();
  const base=aimSpawnPoint(80);
  for(let i=0;i<10;i++){
    const a=i*2.399963,r=.8+Math.sqrt(i)*1.05;
    dropMeat(base.x+Math.cos(a)*r,base.z+Math.sin(a)*r);
  }
  adminMsg('All food granted — hunger full and 10 meat dropped at your crosshair');
}
function adminKillAllAnimals(){
  if(P.ride)dismountRide();
  if(P.holding)release();
  let n=0;
  const wipe=(arr,color)=>{
    arr.slice().forEach(a=>{
      const p=a.g.position;
      burst(p.x,Math.max(.15,p.y),p.z,color,6);
      scene.remove(a.g);
      const i=arr.indexOf(a);if(i>=0)arr.splice(i,1);
      n++;
    });
  };
  cows.slice().forEach(a=>{killEdible(a,'cow',true);n++;});
  bulls.slice().forEach(a=>{killEdible(a,'bull',true);n++;});
  pets.slice().forEach(a=>{killEdible(a,a.kind,true);n++;});
  hoppers.slice().forEach(a=>{killEdible(a,'hopper',true);n++;});
  wipe(fishes,0xbfe6ff);wipe(bees,0xf2c230);wipe(butterflies,0xffb050);wipe(birds,0xf4efe6);wipe(ants,0x8a2a1a);
  tornadoes.forEach(T=>T.dropped.clear());
  adminMsg('Killed '+n+' animals — the pasture is clear');
}
function adminSpawnEverything(at){
  const base=at||aimSpawnPoint(200);
  const kinds=['cow','bull','hopper','fish','bee','butterfly','bird','ant','cat','dog','horse','bear','deer','bunny','wolf','sheep','chicken','camel','cobra','snake','penguin','snowbear','lion','tiger','elephant','zebra','meerkat','locust','human','farmer','traveler','hunter','bale','rock','barrel','chest','meat','biggame'];
  kinds.forEach((kind,i)=>{
    const a=i*2.39996323,r=1.2+Math.sqrt(i)*1.6;
    adminSpawn(kind,{x:base.x+Math.cos(a)*r,z:base.z+Math.sin(a)*r},true);
  });
  adminMsg('Spawned everything — '+kinds.length+' creatures and things around your crosshair');
}
function adminSpawn(kind,at,quiet){
  if(kind==='everything'){adminSpawnEverything(at);return;}
  /* the spawn lands under the crosshair */
  const base=at||aimSpawnPoint(200);
  const x=base.x,z=base.z;
  let a=null;
  if(kind==='cow'){spawnCow({x,z});a=cows[cows.length-1];}
  else if(kind==='bull'){spawnBull(false,{x,z});a=bulls[bulls.length-1];}
  else if(kind==='hopper'){spawnHopper({x,z});a=hoppers[hoppers.length-1];}
  else if(kind==='fish'){a=spawnFishAt(x,z);}
  else if(kind==='bee'){spawnBee();a=bees[bees.length-1];}
  else if(kind==='butterfly'){spawnButterfly();a=butterflies[butterflies.length-1];}
  else if(kind==='bird'){spawnBird();a=birds[birds.length-1];}
  else if(kind==='ant'){spawnAnt(0);a=ants[ants.length-1];}
  else if(kind==='human'||kind==='farmer'||kind==='traveler'||kind==='hunter'){spawnPerson({x,z,r:6,role:kind==='human'?'villager':kind});a=persons[persons.length-1];}
  else if(kind==='bale'||kind==='rock'||kind==='barrel'){spawnProp(kind,true);a=props[props.length-1];}
  else if(kind==='chest'){a=spawnChest(x,z);}
  else if(kind==='meat'){a=dropMeat(x,z);}
  else if(kind==='sword'){P.sword=true;if(!quiet)adminMsg('Sword granted — holster your guns to swing it');return;}
  else if(kind==='pistol'||kind==='shotgun'||kind==='rifle'||kind==='ak47'||kind==='biggame'){
    const ids=['pistol','shotgun','rifle','ak47','biggame'];
    const gi=ids.indexOf(kind);
    giveGun(gi,true);
    if(!quiet)adminMsg('Granted '+GUN_DEFS[gi].name+' and full ammo');
    return;
  }
  else{spawnPet(kind,undefined,{x,z});a=pets[pets.length-1];}
  if(a){
    a.adminRoam=true;
    if(a.pet)a.biome=null;
    a.adminSpawned=true;
    a.g.position.set(x,a.bee?rnd(1.2,2.4):a.butterfly?rnd(.8,2.2):a.fish?.15:0,z);
    a.g.rotation.y=Math.atan2(P.x-x,P.z-z);
    if(a.fish){a.land=true;a.L=null;a.jump=-1;}
    if(a.bird){a.state='ground';a.land=false;a.tx=x;a.tz=z;a.ty=0;a.eat=0;}
    if(a.ant){a.hill={x,z,fx:x+1,fz:z+1};a.out=false;a.carry=false;a.g.userData.crumb.visible=false;}
    if(a.person){a.knock=0;a.landed=false;a.y=0;a.st=0;a.moving=false;}
  }
  if(!quiet)adminMsg('Spawned '+kind+' at your crosshair');
}

/* ---------- weather tornado ---------- */
const tornadoes=[];
const TORNADO_LIFE=28,TORNADO_R=24,TORNADO_H=22;
function tornadoTex(){
  const cv=document.createElement('canvas');cv.width=64;cv.height=256;
  const ctx=cv.getContext('2d');
  for(let i=0;i<90;i++){
    const x=rnd(0,64),w=rnd(1,4),y=rnd(-40,256),h=rnd(30,150);
    const gr=ctx.createLinearGradient(0,y,0,y+h);
    const tone=Math.round(rnd(132,188));
    const gray='rgba('+tone+','+(tone+2)+','+(tone+4)+',';
    gr.addColorStop(0,gray+'0)');
    gr.addColorStop(.45,gray+rnd(.22,.7).toFixed(2)+')');
    gr.addColorStop(1,gray+'0)');
    ctx.fillStyle=gr;ctx.fillRect(x,y,w,h);
  }
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(2,2);
  return tex;
}
function buildTornado(){
  const g=new THREE.Group(),segs=[],H=TORNADO_H,SEGS=9;
  const tex=tornadoTex();
  for(let i=0;i<SEGS;i++){
    const r0=1.25+Math.pow(i/SEGS,1.35)*8.6;
    const r1=1.25+Math.pow((i+1)/SEGS,1.35)*8.6;
    const h=H/SEGS;
    const geo=new THREE.CylinderGeometry(r1,r0,h,16,3,true);
    const pa=geo.attributes.position;
    for(let v=0;v<pa.count;v++){
      const y=pa.getY(v),k=1+Math.sin(y*2.6+v*.7)*.055;
      pa.setX(v,pa.getX(v)*k);pa.setZ(v,pa.getZ(v)*k);
    }
    geo.computeVertexNormals();
    const mat=new THREE.MeshBasicMaterial({map:tex,color:i%2?0x9aa0a2:0x5d6365,transparent:true,opacity:i%2?.38:.64,side:THREE.DoubleSide,depthWrite:false});
    const m=new THREE.Mesh(geo,mat);
    m.position.y=h*i+h/2;
    m.userData={spin:(i%2?-1:1)*(1.6+i*.16),op:i%2?.38:.64};
    g.add(m);segs.push(m);
  }
  /* puffy storm cloud riding on top of the funnel */
  const cloud=new THREE.Group(),cloudMats=[];
  const mkCloudMat=color=>{const m=new THREE.MeshLambertMaterial({color,transparent:true,opacity:1});m.userData.op=1;cloudMats.push(m);return m;};
  const cloudLight=mkCloudMat(0xa8adaf),cloudDark=mkCloudMat(0x6f7577);
  const cloudBase=new THREE.Mesh(new THREE.CylinderGeometry(16.5,12.5,3.2,24),cloudDark);
  cloudBase.position.y=-1.5;cloud.add(cloudBase);
  for(let i=0;i<20;i++){
    const r=rnd(2.6,5.2),a=rnd(0,TAU),rad=Math.sqrt(rand())*11;
    const puff=new THREE.Mesh(new THREE.SphereGeometry(r,9,6),i%4?cloudLight:cloudDark);
    puff.position.set(Math.cos(a)*rad,rnd(-.9,2.4),Math.sin(a)*rad);
    puff.rotation.y=rnd(0,TAU);
    cloud.add(puff);
  }
  const cloudY=H+2.6;
  cloud.position.y=cloudY;g.add(cloud);
  const base=new THREE.Mesh(new THREE.TorusGeometry(3.7,.85,6,24),new THREE.MeshBasicMaterial({color:0x7f8587,transparent:true,opacity:.52,depthWrite:false}));
  base.rotation.x=Math.PI/2;base.position.y=.35;g.add(base);
  const dust=new THREE.Mesh(new THREE.TorusGeometry(5.5,.45,5,26),new THREE.MeshBasicMaterial({color:0x9ba0a2,transparent:true,opacity:.36,depthWrite:false}));
  dust.rotation.x=Math.PI/2;dust.position.y=.55;g.add(dust);
  const debris=[],dmat=new THREE.MeshBasicMaterial({color:0x60676a});
  for(let i=0;i<26;i++){
    const s=rnd(.12,.42);
    const m=new THREE.Mesh(new THREE.BoxGeometry(s,s*rnd(.5,1.7),s),dmat);
    const a=rnd(0,TAU),r=rnd(1.8,4.8),y=rnd(.2,H*.85);
    m.position.set(Math.cos(a)*r, y, Math.sin(a)*r);
    m.rotation.set(rnd(0,3),rnd(0,3),rnd(0,3));
    g.add(m);
    debris.push({m,a,r,y,sp:rnd(1.4,3.6),vy:rnd(2.2,4.5),rs:rnd(1,4)});
  }
  return {g,segs,cloud,cloudMats,base,dust,debris,H,cloudY,killY:H-1};
}
function setTornadoBtn(on){
  const b=$('abTornado');
  if(b){b.textContent=on?'Stop Tornado':'Start Tornado';b.classList.toggle('on',on);}
}
function spawnTornadoAt(x,z){
  const parts=buildTornado();
  parts.g.position.set(x,0,z);
  scene.add(parts.g);
  const T={...parts,x,z,vx:0,vz:0,age:0,t:0,hold:0,life:TORNADO_LIFE,dropped:new Set()};
  tornadoes.push(T);
  setTornadoBtn(true);
  return T;
}
function startTornado(){
  if(tornadoes.length){stopTornado();return;}
  const aim=aimSpawnPoint(900);
  spawnTornadoAt(aim.x,aim.z);
  let two=false;
  if(rand()<.16){
    const a=rnd(0,TAU),d=rnd(70,130);
    spawnTornadoAt(aim.x+Math.cos(a)*d,aim.z+Math.sin(a)*d);
    two=true;
  }
  toast(two?'Two tornadoes touch down!':'A tornado touches down!');
  adminMsg(two?'Two tornadoes started — they lift animals and you':'A tornado started where you aimed — it will lift animals and you');
  closeAdmin();
}
/* natural weather: one twister, rarely a pair */
function startTornadoEvent(){
  if(tornadoes.length)return;
  const n=rand()<.16?2:1;
  for(let i=0;i<n;i++){const sp=nearSpot(80,155,24,null,true);spawnTornadoAt(sp.x,sp.z);}
  toast(n>1?'Two tornadoes touch down!':'A tornado touches down!');
}
function moveTornadoHere(){
  const aim=aimSpawnPoint(900);
  if(!tornadoes.length){
    spawnTornadoAt(aim.x,aim.z);
    toast('A tornado touches down!');
  }else{
    const T=tornadoes[0];
    T.x=aim.x;T.z=aim.z;T.hold=6;
    T.g.position.set(aim.x,0,aim.z);
    adminMsg('Tornado moved to your crosshair');
  }
  closeAdmin();
}
function stopTornado(){
  if(!tornadoes.length)return;
  tornadoes.forEach(T=>{T.age=Math.max(T.age,T.life);});
  setTornadoBtn(false);
  toast(tornadoes.length>1?'The tornadoes break apart':'The tornado breaks apart');
}
function removeTornado(T){
  if(!T)return;
  if(P.tornado===T)releasePlayerTornado();
  scene.remove(T.g);
  T.g.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(o.material.map)o.material.map.dispose();o.material.dispose();}});
  T.dropped.forEach(a=>{if(a&&a.g){a.g.position.y=0;a.tornadoed=false;}});
  T.dropped.clear();
  const i=tornadoes.indexOf(T);if(i>=0)tornadoes.splice(i,1);
  setTornadoBtn(tornadoes.length>0);
}
/* carried all the way into the storm cloud: the animal dies there */
function tornadoKill(T,a){
  const p=a.g.position;
  burst(p.x,p.y+.2,p.z,0xe8f1f4,10);
  scene.remove(a.g);
  let i=cows.indexOf(a);if(i>=0)cows.splice(i,1);
  i=pets.indexOf(a);if(i>=0)pets.splice(i,1);
  i=bulls.indexOf(a);if(i>=0)bulls.splice(i,1);
  i=hoppers.indexOf(a);if(i>=0)hoppers.splice(i,1);
  T.dropped.delete(a);
}
/* the player gets the same ride as the animals, but it ends at the top */
function startPlayerTornado(T){
  if(P.tornado||state!=='play')return;
  if(P.ride)dismountRide();
  if(P.holding)release();
  P.tornado=T;P.tornadoCool=0;
  P.lift=null;P.baseY=0;P.floor=0;P.tower=-1;
  P.jy=0;P.jv=0;P.kx=0;P.kz=0;P.fl=0;P.bump=0;
  const fl=$('flash');
  if(fl){fl.classList.add('on');setTimeout(()=>fl.classList.remove('on'),140);}
  toast('The tornado snatches you off the ground!');
}
function releasePlayerTornado(){
  if(!P.tornado)return;
  P.tornado=null;P.tornadoCool=4;
  P.jv=0;
}
function suckPlayer(T,dt){
  if(state!=='play'||P.hp<=0)return;
  if(!P.tornado){
    if((P.tornadoCool||0)>0)return;
    const dx0=P.x-T.x,dz0=P.z-T.z;
    if(Math.hypot(dx0,dz0)>TORNADO_R)return;
    startPlayerTornado(T);
    if(!P.tornado)return;
  }
  if(P.tornado!==T)return;
  const dx=P.x-T.x,dz=P.z-T.z,d=Math.hypot(dx,dz);
  const q=1-Math.min(d,TORNADO_R)/TORNADO_R;
  const nx=d>.001?dx/d:1,nz=d>.001?dz/d:0;
  const swirl=6+q*9,inward=2.5+q*4.5;
  P.x+=(-nz*swirl-nx*inward)*dt;
  P.z+=(nx*swirl-nz*inward)*dt;
  P.jy=Math.min(T.killY,P.jy+dt*(5+q*12));
  /* keep the ride inside the widening funnel instead of flinging off sideways */
  const rMax=4+P.jy*.32,rx=P.x-T.x,rz=P.z-T.z,rd=Math.hypot(rx,rz);
  if(rd>rMax){P.x=T.x+rx/rd*rMax;P.z=T.z+rz/rd*rMax;}
  yaw+=dt*(1.2+q*2.6);
  P.kx=0;P.kz=0;P.jv=0;P.fl=0;P.bump=0;
  if(P.jy>=T.killY-.001){
    P.jy=T.killY;
    if(godMode){releasePlayerTornado();toast('Never Die shrugs off the tornado');}
    else die('tornado');
  }
}
function suckAnimals(T,dt){
  const tx=T.x,tz=T.z,R=TORNADO_R,caught=[];
  for(const arr of [cows,bulls,pets,hoppers])for(const a of arr){
    if(!a||!a.g||a.held||a.ridden)continue;
    const p=a.g.position,dx=p.x-tx,dz=p.z-tz;
    if(Math.hypot(dx,dz)<=R)caught.push(a);
  }
  for(const a of caught){
    const p=a.g.position,dx=p.x-tx,dz=p.z-tz,d=Math.hypot(dx,dz);
    const q=1-Math.min(d,R)/R,nx=d>.001?dx/d:1,nz=d>.001?dz/d:0;
    const swirl=7+q*11,inward=2.5+q*5;
    p.x+=(-nz*swirl-nx*inward)*dt;
    p.z+=(nx*swirl-nz*inward)*dt;
    p.y=Math.min(T.killY,p.y+dt*(4.5+q*16));
    a.g.rotation.y+=dt*swirl*.8;
    a.tornadoed=true;T.dropped.add(a);
    if(p.y>=T.killY)tornadoKill(T,a);
  }
}
function updateTornado(dt){
  for(let ti=tornadoes.length-1;ti>=0;ti--){
    const T=tornadoes[ti];
    T.age+=dt;T.t+=dt;
    const dying=T.age>T.life;
    const k=dying?clamp(1-(T.age-T.life)/1.8,0,1):1;
    T.x+=T.vx*dt;T.z+=T.vz*dt;
    const edge=Math.hypot(T.x,T.z);
    if(edge>2520){T.vx=-T.x/edge*5.5;T.vz=-T.z/edge*5.5;}
    const turn=Math.atan2(T.vx,T.vz)+Math.sin(T.age*.5)*.4*dt;
    T.hold=(T.hold||0)-dt;
    const spd=dying?2.2:(T.hold>0?0:5.5);
    T.vx=Math.sin(turn)*spd;T.vz=Math.cos(turn)*spd;
    T.g.position.set(T.x+Math.sin(T.age*1.7)*1.1,0,T.z+Math.cos(T.age*1.3)*1.1);
    T.segs.forEach((m,i)=>{
      m.rotation.y+=dt*m.userData.spin*(1+Math.sin(T.age*.8+i)*.15);
      m.scale.set(1+Math.sin(T.age*2+i)*.03,1,1+Math.sin(T.age*2+i)*.03);
      m.material.opacity=m.userData.op*k;
    });
    T.cloud.rotation.y+=dt*.28;
    T.cloud.position.y=T.cloudY+Math.sin(T.age*.8)*.55;
    T.cloudMats.forEach(m=>{m.opacity=m.userData.op*k;});
    T.base.material.opacity=.52*k;T.base.rotation.z+=dt*2.2;
    T.dust.material.opacity=.36*k;T.dust.rotation.z-=dt*3.4;T.dust.scale.setScalar(1+Math.sin(T.age*2.6)*.06);
    T.debris.forEach(d=>{
      d.a+=d.sp*dt;d.y+=d.vy*dt;
      if(d.y>20){d.y=.2;d.a=rnd(0,TAU);}
      d.r=1.4+d.y*.24;
      d.m.position.set(Math.cos(d.a)*d.r,d.y,Math.sin(d.a)*d.r);
      d.m.rotation.x+=d.rs*dt;d.m.rotation.z+=d.rs*.7*dt;
      d.m.visible=k>.25;
    });
    if(!dying){
      suckAnimals(T,dt);
      suckPlayer(T,dt);
      T.dropped.forEach(a=>{
        if(!a||!a.g){T.dropped.delete(a);return;}
        if(a.held){a.tornadoed=false;T.dropped.delete(a);return;}
        const dx=a.g.position.x-T.g.position.x,dz=a.g.position.z-T.g.position.z;
        if(Math.hypot(dx,dz)>TORNADO_R*1.15){
          a.g.position.y=Math.max(0,a.g.position.y-dt*6);
          if(a.g.position.y<=.001){a.tornadoed=false;T.dropped.delete(a);}
        }
      });
    }else{
      if(P.tornado===T)releasePlayerTornado();
      T.dropped.forEach(a=>{
        if(!a||!a.g){T.dropped.delete(a);return;}
        if(a.held){a.tornadoed=false;T.dropped.delete(a);return;}
        a.g.position.y=Math.max(0,a.g.position.y-(8*k+1.6)*dt);
        if(a.g.position.y<=.001){a.tornadoed=false;T.dropped.delete(a);}
      });
    }
    if(T.age>T.life+1.9)removeTornado(T);
  }
}
(function wireAdmin(){
  const on=(id,fn)=>{const el=$(id);if(el)el.addEventListener('click',fn);};
  on('adminBtn',openAdmin);
  on('abClose',closeAdmin);
  on('abGuns',()=>{grantGuns();adminMsg('All weapons and ammo granted — sword included');});
  on('abAllFood',()=>adminAllFood());
  on('abHolster',()=>{if(guns.armed)holsterGuns();else grantGuns();adminMsg(guns.armed?'Guns drawn':'Guns holstered');});
  on('abHeal',()=>{P.hp=HEART_MAX;updateHearts();adminMsg('Hearts refilled');});
  on('abFeed',()=>{P.hunger=HUNGER_MAX;P.starve=0;P.hungerWarn=false;updateHunger();adminMsg('Hunger refilled');});
  on('abGod',()=>{
    godMode=!godMode;
    if(godMode){P.hp=HEART_MAX;P.hunger=HUNGER_MAX;P.starve=0;P.hungerWarn=false;updateHearts();updateHunger();}
    const b=$('abGod');
    b.textContent='Never Die: '+(godMode?'ON':'OFF');b.classList.toggle('on',godMode);
    adminMsg('Never Die '+(godMode?'ON':'OFF'));
  });
  on('abOneShot',()=>{setOneShot(!adminOneShot);adminMsg('One-shot kill '+(adminOneShot?'ON':'OFF'));});
  on('abKillAll',()=>adminKillAllAnimals());
  on('abInf',()=>{
    guns.infAmmo=!guns.infAmmo;const b=$('abInf');
    b.textContent='Infinite Ammo: '+(guns.infAmmo?'ON':'OFF');b.classList.toggle('on',guns.infAmmo);
    updateAmmoHud();adminMsg('Infinite ammo '+(guns.infAmmo?'ON':'OFF'));
  });
  on('abFly',()=>setFly(!adminFly));
  on('abLift',()=>{setLiftAll(!adminLift);adminMsg('Lift everything '+(adminLift?'ON':'OFF'));});
  on('abDay',()=>{dayT=.24;adminMsg('Morning light');});
  on('abNight',()=>{dayT=.62;adminMsg('Night falls');});
  on('abDesert',()=>adminTeleport(DESERT.x,DESERT.z,'the desert'));
  on('abSnow',()=>adminTeleport(SNOWZ.x,SNOWZ.z,'the snowfield'));
  on('abSavanna',()=>adminTeleport(SAVAN.x,SAVAN.z,'the savanna'));
  on('abHome',()=>adminTeleport(0,6,'home'));
  on('abSpawn',()=>adminSpawn($('abKind').value));
  on('abSpawnAll',()=>adminSpawnEverything());
  on('abChest',()=>{spawnChestInFront();closeAdmin();});
  on('abTornado',()=>{if(tornadoes.length)stopTornado();else startTornado();});
  on('abTornadoHere',moveTornadoHere);
})();

/* ---------- invite panel ---------- */
(function wireInvite(){
  const on=(id,fn)=>{const el=$(id);if(el)el.addEventListener('click',fn);};
  on('inviteBtn',openInvite);
  on('inviteClose',closeInvite);
  on('inviteCopy',copyInvite);
  on('inviteShare',shareInvite);
  on('inviteCloseRoom',leaveCurrentRoom);
  const panel=$('invitePanel');
  if(panel)panel.addEventListener('click',e=>{if(e.target===panel)closeInvite();});
  const link=$('inviteLink');
  if(link)link.addEventListener('focus',()=>link.select());
})();

/* ---------- connection-lost overlay ---------- */
(function wireNetLost(){
  const retry=$('netRetryBtn'),leave=$('netLeaveBtn');
  if(retry)retry.addEventListener('click',()=>{
    if(netRole!=='client')return;
    netFatal=false;
    netReconnectAttempts=0;
    hideNetLost();
    void reconnectClient();
  });
  if(leave)leave.addEventListener('click',()=>{void leaveCurrentRoom();});
})();

/* ---------- input ---------- */
window.addEventListener('keydown',e=>{
  const k=e.key.toLowerCase();
  if(inviteOpen){
    if(k==='escape'){e.preventDefault();closeInvite();}
    return;
  }
  if(winOpen)return;
  if(k==='f2'){
    if(e.repeat||state==='dead')return;
    e.preventDefault();
    if(netRole==='client'){toast('Admin is disabled in multiplayer');return;}
    if(adminUnlocked){openAdmin();return;}
    if(cheatOpen)closeCheatBox();else openCheatBox();
    return;
  }
  if(cheatOpen)return;
  if(k==='f3'){
    if(e.repeat)return;
    e.preventDefault();
    toggleThirdPerson();
    return;
  }
  if(state==='dead'){
    if(k==='enter'||k===' '){e.preventDefault();if(!e.repeat)respawn();}
    return;
  }
  if(k===' '||k.startsWith('arrow'))e.preventDefault();
  if(e.repeat)return;
  keys[k]=true;
  if(state!=='play')return;
  if(k==='i'){openInvite();return;}
  if(netRole==='client'){
    if(k==='f'){sendUseCommand();return;}
    if(k==='e'){
      if(guns.armed){const t=gunRay(90,0);sendCmd('shoot',{target:t&&t.a&&t.a.id,dmg:guns.armed&&GUN_DEFS[guns.weapon]?GUN_DEFS[guns.weapon].dmg:1});}
      else{const t=edibleNear();sendCmd('punch',{target:t&&t.id});}
      return;
    }
    if(k==='g'){sendCmd('lift');return;}
    if(k==='p'||k==='v')return;
  }
  if(k==='f')useGrab();
  if(k==='e'){if(guns.armed)shoot();else punch();}
  if(k==='g'){if(liftHere())rideLift(-1);else if(adminUnlocked&&adminLift){const r=targetRide();if(r)mountRide(r);}}
  if(k==='1')selectGun(0);
  if(k==='2')selectGun(1);
  if(k==='3')selectGun(2);
  if(k==='4')selectGun(3);
  if(k==='5')selectGun(4);
  if(k==='6')selectGun(5);
  if(k==='7')selectGun(6);
  if(k==='8')selectGun(7);
  if(k==='q')cycleSword();
  if(k==='p')openAdmin();
  if(k==='v')setFly(!adminFly);
  if(k==='m'){muted=!muted;if(master)master.gain.value=muted?0:.6;toast(muted?'Sound off':'Sound on');}
});
window.addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});
window.addEventListener('blur',()=>{for(const k in keys)keys[k]=false;});

let isPointerLocked=false;
document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === canvas;
});

function reqLock(){
  try{
      if(!isPointerLocked) {
        const r=canvas.requestPointerLock();
        if(r&&r.catch)r.catch(()=>{});
      }
  }catch(_){}
}
document.addEventListener('mousemove',e=>{
  if(isPointerLocked&&state==='play'){yaw-=e.movementX*.0023;pitch=clamp(pitch-e.movementY*.0023,-1.45,1.45);}
});
let drag=null;
canvas.addEventListener('pointerdown',e=>{
  if(state!=='play')return;
  if(e.pointerType==='mouse'){
    if(isPointerLocked){
      if(e.button===2){
        fireHeld=true;
        if(netRole==='client'){
          if(guns.armed){const t=gunRay(90,0);sendCmd('shoot',{target:t&&t.a&&t.a.id,dmg:guns.armed&&GUN_DEFS[guns.weapon]?GUN_DEFS[guns.weapon].dmg:1});}
          else{const t=edibleNear();sendCmd('punch',{target:t&&t.id});}
        }else if(guns.armed)shoot();else punch();
      }
      else if(netRole==='client')sendUseCommand();else useGrab();
      return;
    }
    reqLock();
    return;
  }
  if(drag)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,moved:0,t:performance.now(),mouse:e.pointerType==='mouse'};
  try{canvas.setPointerCapture(e.pointerId);}catch(_){}
});
canvas.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId||state!=='play')return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;drag.moved+=Math.abs(dx)+Math.abs(dy);
  yaw-=dx*.005;pitch=clamp(pitch-dy*.004,-1.45,1.45);
});
canvas.addEventListener('pointerup',e=>{
  if(!drag||drag.id!==e.pointerId)return;
  if(drag.mouse&&drag.moved<8&&performance.now()-drag.t<300){if(netRole==='client')sendUseCommand();else useGrab();}
  drag=null;
});
canvas.addEventListener('pointercancel',()=>{drag=null;});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('mouseup',()=>{fireHeld=false;});
window.addEventListener('blur',()=>{fireHeld=false;});

if(window.matchMedia&&matchMedia('(pointer:coarse)').matches)document.body.classList.add('touch');
window.addEventListener('touchstart',()=>document.body.classList.add('touch'),{passive:true,once:true});
const stick=$('stick'),knob=$('knob');let stickId=null;
function stickMove(e){
  const r=stick.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  let dx=e.clientX-cx,dy=e.clientY-cy;const m=Math.hypot(dx,dy),R=50;if(m>R){dx=dx/m*R;dy=dy/m*R;}
  joy.x=dx/R;joy.y=dy/R;knob.style.transform='translate('+dx+'px,'+dy+'px)';
}
stick.addEventListener('pointerdown',e=>{e.preventDefault(); stickId=e.pointerId;try{stick.setPointerCapture(e.pointerId);}catch(_){}stickMove(e);});
stick.addEventListener('pointermove',e=>{if(e.pointerId===stickId)stickMove(e);});
function stickEnd(e){if(e.pointerId!==stickId)return;stickId=null;joy.x=joy.y=0;knob.style.transform='';}
stick.addEventListener('pointerup',stickEnd);stick.addEventListener('pointercancel',stickEnd);
$('btnGrab').addEventListener('pointerdown',e=>{e.preventDefault();if(netRole==='client')sendUseCommand();else useGrab();});
$('prompt').addEventListener('pointerdown',e=>{
  e.preventDefault();
  const a=e.target.dataset&&e.target.dataset.a;
  if(netRole==='client'){
    if(a==='shoot'){const t=gunRay(90,0);sendCmd('shoot',{target:t&&t.a&&t.a.id,dmg:guns.armed&&GUN_DEFS[guns.weapon]?GUN_DEFS[guns.weapon].dmg:1});}
    else if(a==='punch'){const t=edibleNear();sendCmd('punch',{target:t&&t.id});}
    else sendUseCommand();
    return;
  }
  if(a==='ride')useGrab();
  else if(a==='rideg'){const r=targetRide();if(r)mountRide(r);}
  else if(a==='lift')useGrab();
  else if(a==='liftdown')rideLift(-1);
  else if(a==='chest')useGrab();
  else if(a==='use')useGrab();
  else if(a==='shoot')shoot();
  else if(a==='punch')punch();
  else if(a==='feed'&&P.holding){const t=findFeedTarget(P.holding);if(t)feedHeld(t);}
});
const bp=$('btnPunch');
if(bp)bp.addEventListener('pointerdown',e=>{
  e.preventDefault();fireHeld=true;
  if(netRole==='client'){
    if(guns.armed){const t=gunRay(90,0);sendCmd('shoot',{target:t&&t.a&&t.a.id,dmg:guns.armed&&GUN_DEFS[guns.weapon]?GUN_DEFS[guns.weapon].dmg:1});}
    else{const t=edibleNear();sendCmd('punch',{target:t&&t.id});}
  }else if(guns.armed)shoot();else punch();
});
if(bp)['pointerup','pointercancel','pointerleave'].forEach(ev=>bp.addEventListener(ev,()=>{fireHeld=false;}));
const bj=$('btnJump');
bj.addEventListener('pointerdown',e=>{e.preventDefault();keys[' ']=true;});
['pointerup','pointercancel','pointerleave'].forEach(ev=>bj.addEventListener(ev,()=>{keys[' ']=false;}));

function beginPlay(){
  if(playStarted)return;
  playStarted=true;
  initAudio();
  $('menu').hidden=true;
  state='play';
  $('hud').hidden=false;
  const np=$('netPill'),nr=$('netRoom'),ib=$('inviteBtn');
  if(np)np.hidden=!boot;
  if(ib)ib.hidden=!boot;
  if(nr&&boot)nr.textContent=boot.room||'—';
  const g=$('btnGrab');if(g)g.textContent='LIFT';
  reqLock();
  if(netRole!=='solo')toast('Connected as '+(netSelfName||'player'));
}
$('play').addEventListener('click',beginPlay);
const respawnBtn=$('respawnBtn');
if(respawnBtn)respawnBtn.addEventListener('click',respawn);
const winContinue=$('winContinue');
if(winContinue)winContinue.addEventListener('click',continueAfterWin);
const winAgain=$('winAgain');
if(winAgain)winAgain.addEventListener('click',()=>window.location.reload());

/* ---------- distance culling ----------
   Only world assets inside CULL_R of the player are rendered; the rest are
   hidden (their logic keeps running). A hysteresis band of ±radius + CULL_M
   around the boundary stops flicker when walking near it. The menu orbit
   view never culls, so the whole island stays visible there. */
const KEEP=new Set([camera,hemiLight,sun,sun.target,sunVis,moonVis,starVis,
  grass,sand,foam,seabed,sea,avatar]);
const CULL_R=330,CULL_M=40;
const _cullBox=new THREE.Box3(),_cullSp=new THREE.Sphere();
let cullActive=false,cullAt=-9;
function cullPass(){
  if(state!=='play'&&state!=='admin')return;
  if(!cullActive){
    cullActive=true;
    const kids=scene.children;
    for(let i=0;i<kids.length;i++)delete kids[i].userData._cv;
  }
  const px=P.x,pz=P.z;
  const kids=scene.children;
  for(let i=0;i<kids.length;i++){
    const o=kids[i];
    if(KEEP.has(o)||o.isInstancedMesh||o.userData.noCull)continue;
    const dx=o.position.x-px,dz=o.position.z-pz;
    const d2=dx*dx+dz*dz;
    if(o.userData._cv===undefined){
      let r=8;
      if(o.geometry||o.children.length){
        _cullBox.setFromObject(o);
        if(!_cullBox.isEmpty()){_cullBox.getBoundingSphere(_cullSp);r=_cullSp.radius;}
      }
      o.userData._cr=r;
      o.userData._cv=d2<(CULL_R-r)*(CULL_R-r);
      o.visible=o.userData._cv;
    }else if(o.userData._cv){
      if(d2>(CULL_R+o.userData._cr+CULL_M)*(CULL_R+o.userData._cr+CULL_M)){o.userData._cv=false;o.visible=false;}
    }else if(d2<(CULL_R-o.userData._cr)*(CULL_R-o.userData._cr)){
      o.userData._cv=true;o.visible=true;
    }
  }
}

/* ---------- loop ---------- */
let last=performance.now();
function loop(now){
  requestAnimationFrame(loop);
  const dt=Math.min((now-last)/1000,.05);last=now;clock+=dt;
  
  if (state === 'menu') {
      yaw+=dt*.12;
      camera.position.set(Math.sin(yaw)*220,110,-4+Math.cos(yaw)*220);camera.lookAt(0,2,-4);
  }
  
  if(net&&netConnected)net.ping();
  if (state === 'play') {
      if(!winOpen){
        update(dt,clock);
        updateCamera(dt);
        sendLocalInput(dt);
      }
      if(netRole==='host'){
        netSnapT-=dt;
        if(netSnapT<=0){netSnapT=.066;sendSnapshot();}
      }
      updateRemoteAvatars(dt);
      updateNetStatus();
      const b=$('btnGrab');const want=P.ride?'OFF':P.holding?'LET GO':'LIFT';if(b.textContent!==want)b.textContent=want;
  }
  
  renderer.render(scene,camera);
  if(state==='menu'){
    if(cullActive){
      cullActive=false;
      const kids=scene.children;
      for(let i=0;i<kids.length;i++){
        const o=kids[i];
        if(KEEP.has(o)||o.isInstancedMesh)continue;
        o.visible=true;delete o.userData._cv;
      }
    }
  }else{
    if(clock-cullAt>.2){cullAt=clock;cullPass();}
  }
}

$('menu').hidden = true;
$('loadingMenu').hidden = false;
initWorldAsync(() => {
    netWorldChecksum = worldChecksum(solids, chests, HOMES);
    if (typeof window !== 'undefined') {
      window.__GH_WORLD__ = {
        seed: worldSeed,
        checksum: netWorldChecksum,
        role: boot ? boot.role : 'solo',
        bridges: BRIDGES.length,
        biomeCities: BIOME_CITIES.length,
        cities: HOMES.filter((h) => h.role === 'villager').length,
      };
      console.info('[world] seed=' + worldSeed + ' checksum=' + netWorldChecksum);
    }
    $('loadingMenu').hidden = true;
    $('menu').hidden = false;
    requestAnimationFrame(loop);
    if (boot) {
      const st = $('mpStatus');
      if (st) st.textContent = boot.role === 'host' ? 'Starting host room ' + boot.room + '…' : 'Connecting to room ' + boot.room + '…';
      beginMultiplayer(boot);
    }
});
}
