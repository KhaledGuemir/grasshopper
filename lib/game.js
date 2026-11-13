import * as THREE from 'three';

export function start(){
'use strict';
const $=id=>document.getElementById(id);
const TAU=Math.PI*2, rnd=(a,b)=>a+Math.random()*(b-a), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angDiff=(a,b)=>{let d=(b-a)%TAU;if(d>Math.PI)d-=TAU;if(d<-Math.PI)d+=TAU;return d;};

/* ---------- renderer / scene ---------- */
const canvas=$('c');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
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
  const disc=new THREE.Mesh(new THREE.SphereGeometry(80,24,16),new THREE.MeshBasicMaterial({color:0xfff4b8,fog:false}));
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
  const m=new THREE.Mesh(new THREE.SphereGeometry(55,24,16),new THREE.MeshBasicMaterial({color:0xe8eeff,fog:false}));
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

/* ---------- world: grass, beach, ocean, sky ---------- */
const S=14;
const K=1.5;
function grassTex(){
  const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');
  g.fillStyle='#5fae3d';g.fillRect(0,0,256,256);
  for(let i=0;i<1500;i++){g.fillStyle=Math.random()<.5?'#6bba48':'#53a034';const s=2+Math.random()*3;g.fillRect(Math.random()*256,Math.random()*256,s,s*1.7);}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(40*S,40*S);t.anisotropy=4;return t;
}
const grass=new THREE.Mesh(new THREE.CircleGeometry(58*S,96),new THREE.MeshStandardMaterial({map:grassTex(),roughness:1}));
grass.rotation.x=-Math.PI/2;grass.receiveShadow=true;scene.add(grass);
const sand=new THREE.Mesh(new THREE.RingGeometry(57.8*S,67*S,96),new THREE.MeshStandardMaterial({color:0xe9d9a0,roughness:1,polygonOffset:true,polygonOffsetFactor:2,polygonOffsetUnits:4}));
sand.rotation.x=-Math.PI/2;sand.position.y=-0.03;sand.receiveShadow=true;scene.add(sand);
const foam=new THREE.Mesh(new THREE.RingGeometry(66.6*S,68.2*S,96),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.55}));
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
const SAV_KINDS=['lion','tiger','elephant','zebra','meerkat','locust'];
function biomeAt(x,z){
  if(Math.hypot(x-DESERT.x,z-DESERT.z)<DESERT.r)return 'desert';
  if(Math.hypot(x-SAVAN.x,z-SAVAN.z)<SAVAN.r)return 'savanna';
  if(Math.hypot(x-SNOWZ.x,z-SNOWZ.z)<SNOWZ.r)return 'snow';
  return null;
}
function biomeTex(base,spots,rep){
  const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');
  g.fillStyle=base;g.fillRect(0,0,256,256);
  spots.forEach(s=>{g.fillStyle=s[0];for(let i=0;i<s[1];i++){
    const r=s[2]+Math.random()*(s[3]-s[2]);
    g.beginPath();g.arc(Math.random()*256,Math.random()*256,r,0,TAU);g.fill();}});
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rep,rep);t.anisotropy=4;return t;
}
function buildBiomeGround(B,base,spots,rimHex,tint){
  const g=new THREE.Group();
  /* keep the blotch size the same as before, however big the island gets */
  const rep=Math.max(4,Math.round(B.r/41));
  /* blotches live in the texture, so there are no hovering decal planes to z-fight */
  const ground=new THREE.Mesh(new THREE.CircleGeometry(B.r,88),
    new THREE.MeshStandardMaterial({map:biomeTex(base,spots,rep),color:tint||0xffffff,roughness:1,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4}));
  ground.rotation.x=-Math.PI/2;ground.position.y=.06;ground.receiveShadow=true;g.add(ground);
  /* island cliff: hides the drop to the sea and gives the shore a lip */
  const rim=new THREE.Mesh(new THREE.CylinderGeometry(B.r*1.004,B.r*1.05,1.5,88,1,true),std(rimHex,{roughness:1,side:THREE.DoubleSide}));
  rim.position.y=-.69;g.add(rim);
  g.position.set(B.x,0,B.z);scene.add(g);return ground;
}
const desertGround=buildBiomeGround(DESERT,'#92702f',
  [['#a1803a',150,2,7],['#7e612a',130,2,6],['#b08c46',60,1,4]],0x6e5323);
const snowGround=buildBiomeGround(SNOWZ,'#eaf3fb',
  [['#d5e4f2',150,3,9],['#ffffff',90,2,6],['#c8dcee',70,2,5]],0x9db4c6,0x69819a);
const savanGround=buildBiomeGround(SAVAN,'#5b5326',
  [['#6a6130',150,2,7],['#48521f',130,2,6],['#6f6531',60,1,5]],0x3e3818);
const seabed=new THREE.Mesh(new THREE.PlaneGeometry(8200,8200),new THREE.MeshBasicMaterial({color:0x1d6a8c}));
seabed.rotation.x=-Math.PI/2;seabed.position.y=-3;scene.add(seabed);
const seaGeo=new THREE.PlaneGeometry(7200,7200,80,80);seaGeo.rotateX(-Math.PI/2);
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
  for(let i=0;i<13;i++){const g=new THREE.Group();const n=3+Math.floor(Math.random()*3);
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
const SITES=[{x:-165,z:180,r:85},{x:225,z:172,r:85},{x:-150,z:-165,r:90},{x:262,z:-135,r:90},
  {x:-40,z:430,r:85},{x:0,z:-400,r:85},{x:450,z:-40,r:85},{x:-450,z:60,r:85}];
const MOUNTS=[];
[[-230,-330,6],[340,250,5],[-380,260,4],[100,-430,4]].forEach(c=>{for(let i=0;i<c[2];i++){const a=rnd(0,TAU),d=rnd(0,70),r=rnd(55,105);MOUNTS.push({x:c[0]*K+Math.cos(a)*d,z:c[1]*K+Math.sin(a)*d,r,h:r*rnd(1.7,2.3)});}});
MOUNTS.forEach(m=>solids.push({x:m.x,z:m.z,r:m.r*.78}));

function buildWorldGeometry() {
  const spots=[];let tries=0;
  while(spots.length<480&&tries<7000){tries++;
    const a=rnd(0,TAU),d=Math.sqrt(Math.random())*55*S,x=Math.cos(a)*d,z=Math.sin(a)*d;
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
  const f1=new THREE.ConeGeometry(2.3,3.4,7);f1.translate(0,3.9,0);
  const f2=new THREE.ConeGeometry(1.7,2.8,7);f2.translate(0,5.8,0);
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
    const shore=new THREE.Mesh(new THREE.RingGeometry(L.r-2,L.r+2.6,64),new THREE.MeshStandardMaterial({color:0xe9d9a0,roughness:1}));
    shore.rotation.x=-Math.PI/2;shore.position.set(L.x,.02,L.z);shore.receiveShadow=true;shore.userData.noCull=true;scene.add(shore);
    /* opaque water: transparent planes over the ground caused shimmer/sorting flicker */
    const w=new THREE.Mesh(new THREE.CircleGeometry(L.r,64),new THREE.MeshStandardMaterial({color:0x2b94d6,roughness:.1,metalness:.3}));
    w.rotation.x=-Math.PI/2;w.position.set(L.x,.05,L.z);w.userData.noCull=true;scene.add(w);lakeWaters.push(w);
    const pad=std(0x3f9a3a);
    for(let i=0;i<9;i++){const a=rnd(0,TAU),d=rnd(2,L.r-2),p=cyl(.55,.55,.04,pad,L.x+Math.cos(a)*d,.08,L.z+Math.sin(a)*d,10);p.userData.noCull=true;scene.add(p);}
  });

  RIVERS.forEach(R=>{
    const bankM=new THREE.MeshStandardMaterial({color:0xe9d9a0,roughness:1});
    const waterM=new THREE.MeshStandardMaterial({color:0x2b94d6,roughness:.1,metalness:.3});
    const bw=R.w+5;
    for(let i=0;i<R.pts.length-1;i++){
      const [ax,az]=R.pts[i],[bx,bz]=R.pts[i+1];
      const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz);
      const mx=(ax+bx)/2,mz=(az+bz)/2;
      const bank=new THREE.Mesh(new THREE.PlaneGeometry(bw,len+bw*.7),bankM);
      bank.rotation.x=-Math.PI/2;bank.rotation.z=yaw;bank.position.set(mx,.02,mz);bank.receiveShadow=true;bank.userData.noCull=true;scene.add(bank);
      const w=new THREE.Mesh(new THREE.PlaneGeometry(R.w,len+bw*.7),waterM);
      w.rotation.x=-Math.PI/2;w.rotation.z=yaw;w.position.set(mx,.05,mz);w.userData.noCull=true;scene.add(w);lakeWaters.push(w);
    }
    R.pts.forEach(([px,pz])=>{
      const b=new THREE.Mesh(new THREE.CircleGeometry(bw/2,20),bankM);
      b.rotation.x=-Math.PI/2;b.position.set(px,.02,pz);b.userData.noCull=true;scene.add(b);
      const w=new THREE.Mesh(new THREE.CircleGeometry(R.w/2,20),waterM);
      w.rotation.x=-Math.PI/2;w.position.set(px,.05,pz);w.userData.noCull=true;scene.add(w);lakeWaters.push(w);
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
    fishes.push({g,L,tail,a:rnd(0,TAU),fish:true,land:false,held:false,rr:rnd(9,L.r-1.5),sp:rnd(.15,.45)*(Math.random()<.5?-1:1),ph:rnd(0,TAU),jt:rnd(3,12),jump:-1});
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
  const g=new THREE.Group(),c=std(cols[Math.floor(Math.random()*cols.length)]),dk=std(0x2a3b44);
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
  const c=std(cols[Math.floor(Math.random()*cols.length)]),pink=std(0xf2a6b5),eye=std(0x6fd04a),blk=std(0x111111);
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
  const c=std(cols[Math.floor(Math.random()*cols.length)]),ear=std(0x3a2a1c),snout=std(0xe6d3b3),blk=std(0x111111);
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
  const bodyC=std(Math.random()<.5?0xffffff:0x8a5a2b), red=std(0xd83a2a), beak=std(0xf0c030), blk=std(0x111111);
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
  const c=std(cols[Math.floor(Math.random()*cols.length)]),tan=std(0xc9a27e),blk=std(0x111111);
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
  const c=std(cols[Math.floor(Math.random()*cols.length)]),mane=std(0x241812),hoof=std(0x1a1410),blk=std(0x111111);
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
  const g=new THREE.Group(),cols=[0xc9a165,0xb98e52,0xd7b57c],c=std(cols[Math.floor(Math.random()*cols.length)]),dk=std(0x8e6c3e),blk=std(0x14100c),hoof=std(0x5a4630);
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
  const g=new THREE.Group();
  const c=std(0x9aa63a),dk=std(0x5f6a22),eyeM=std(0x201c10),
        wm=std(0xd8e6b0,{transparent:true,opacity:.55,side:THREE.DoubleSide,depthWrite:false});
  const body=sph(.11,c,0,.13,.02,8);body.scale.set(.85,.8,2.2);g.add(body);
  const head=pivot(g,0,.16,.22);
  head.add(sph(.085,c,0,0,.03,8));
  [-1,1].forEach(s=>{
    head.add(sph(.045,eyeM,s*.05,.02,.05,6));
    const an=box(.012,.012,.25,dk,s*.03,.09,.05);an.rotation.x=-.7;an.rotation.z=s*.2;head.add(an);
  });
  [-1,1].forEach(s=>{const l=pivot(g,s*.07,.12,.14);l.add(box(.02,.16,.02,dk,0,-.07,0));l.rotation.x=.5;});
  const hind=[];
  [-1,1].forEach(s=>{
    const hip=pivot(g,s*.09,.14,-.06);
    const thigh=box(.035,.28,.035,dk,0,-.08,-.05);thigh.rotation.x=-.85;hip.add(thigh);
    const shin=pivot(hip,0,-.16,-.12);shin.add(box(.025,.3,.025,dk,0,-.13,.02));shin.rotation.x=1.5;hip.add(shin);
    hind.push({hip,shin});
  });
  const wings=[];
  [-1,1].forEach(s=>{
    const wp=pivot(g,s*.03,.2,-.02);wp.rotation.z=s*.14;
    wp.add(box(.16,.01,.4,wm,s*.06,0,-.1));wings.push(wp);
  });
  g.userData={head,wings,hind,legs:[],tail:null};return shade(g);
}

const bees=[];
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
    const near=state==='play'&&Math.hypot(P.x-p.x,P.z-p.z)<20&&Math.random()<.5;
    if(near){b.tx=P.x+rnd(-3,3);b.tz=P.z+rnd(-3,3);b.ty=rnd(1,2.4);}
    else{b.tx=p.x+rnd(-8,8);b.tz=p.z+rnd(-8,8);b.ty=rnd(1,3);}
    const r=Math.hypot(b.tx,b.tz);if(!b.adminRoam&&r>52*S){b.tx*=52*S/r;b.tz*=52*S/r;}
    b.bt=rnd(2,5);b.sp=rnd(2.5,4);
  }else{const k=Math.min(1,b.sp*dt/d);p.x+=dx*k;p.y+=dy*k+Math.sin(t*9+b.ph)*.01;p.z+=dz*k;}
  g.rotation.y+=angDiff(g.rotation.y,Math.atan2(dx,dz))*Math.min(1,dt*5);
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
  const sp=near?freeSpot(12,40,0):freeSpot(15,Math.random()<.5?130:50*S,0);
  g.position.set(sp.x,0,sp.z);g.rotation.y=rnd(0,TAU);scene.add(g);
  const D={bale:{h:.6,rad:.9,cy:.6,s:.28},rock:{h:.45,rad:.85,cy:.55,s:.3},barrel:{h:.65,rad:.7,cy:.55,s:.35}}[kind];
  props.push({g,obj:true,kind,heavy:D.h,rad:D.rad,cy:D.cy,hs:D.s,held:false});
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
  pets.push({
      g,pet:true,ambient:true,kind,biome:wantDesert?'desert':wantSnow?'snow':wantSavan?'savanna':null,
      heavy:({horse:.8,bear:.6,sheep:.6,camel:.9,lion:.7,tiger:.7,elephant:1,zebra:.5})[kind]||0,
      rad:({horse:1.2,bear:1.2,deer:.9,bunny:.45,wolf:.7,sheep:1.3,chicken:.3,camel:1.5,cobra:.55,snake:.45,penguin:.45,snowbear:1.3,lion:1.1,tiger:1.1,elephant:2.6,zebra:1.2,meerkat:.32,locust:.3})[kind]||0,
      cy:({horse:1.3,bear:1,deer:1.3,bunny:.4,wolf:.7,sheep:1.3,chicken:.2,camel:2.3,cobra:.8,snake:.25,penguin:.6,snowbear:1.15,lion:1.0,tiger:1.0,elephant:2.0,zebra:1.4,meerkat:.5,locust:.25})[kind]||0,
      scale:({cat:.4,horse:.13,bear:.12,deer:.16,bunny:.55,sheep:.15,chicken:.8,camel:.09,cobra:.35,snake:.5,penguin:.45,snowbear:.085,lion:.1,tiger:.1,elephant:.08,zebra:.12,meerkat:.5,locust:.7})[kind]||.3,
      held:false,state:'rest',st:rnd(1,4),dir:g.rotation.y,t:rnd(0,9),eat:0,bmode:null,bcd:rnd(0,3),bt:null,ridden:false,rideSpd:0,strike:0,scd:rnd(0,2)
  });
}
function releasePet(c){
  const g=c.g;g.scale.setScalar(1);g.rotation.set(0,0,0);shade(g,true);
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
  g.position.set(P.x+f.x/fl*1.2,0,P.z+f.z/fl*1.2);g.rotation.y=Math.atan2(f.x,f.z);scene.add(g);
  c.held=false;c.dir=g.rotation.y;c.state='rest';c.st=1;c.bmode=null;c.bt=null;c.bcd=2;toast('Let go');
}
function updatePet(c,dt,t){
  const g=c.g,u=g.userData,pos=g.position;c.t+=dt;
  if(c.held){
    u.legs.forEach((l,i)=>{l.rotation.x=Math.sin(t*12+i*1.7)*.5;});
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
         c.state = Math.random() < 0.3 ? 'peck' : (Math.random() < 0.5 ? 'walk' : 'rest');
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
      u.hind.forEach(h=>{h.hip.rotation.x=0;h.shin.rotation.x=0;});
      if(c.lt<=0)hop();
    }else if(c.lstate==='hop'){
      c.hk+=dt/c.hd;
      const k=Math.min(1,c.hk);
      pos.x=c.hx0+(c.hx1-c.hx0)*k;
      pos.z=c.hz0+(c.hz1-c.hz0)*k;
      pos.y=Math.sin(Math.PI*k)*c.hh;
      u.hind.forEach(h=>{h.hip.rotation.x=-1.0;h.shin.rotation.x=1.4;});
      if(c.hk>=1){
        pos.y=0;
        if(Math.random()<.35){
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
      u.wings.forEach((wp,i)=>{wp.rotation.z=(i?-1:1)*(.15+Math.abs(Math.sin(t*46))*.95);});
      u.hind.forEach(h=>{h.hip.rotation.x=.15;h.shin.rotation.x=.4;});
      if(c.flyT<=0){c.lstate='fall';c.lvy=0;}
    }else{
      c.lvy-=16*dt;pos.y+=c.lvy*dt;
      u.wings.forEach((wp,i)=>{wp.rotation.z=(i?-1:1)*.45;});
      if(pos.y<=0){
        pos.y=0;c.lstate='wait';c.lt=rnd(.5,1.6);
        burst(pos.x,.15,pos.z,0xcdbb8a,3);
      }
    }
    g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*7);
    g.rotation.x=c.lstate==='fly'?.22:c.lstate==='hop'?-.1:0;
    u.head.rotation.x=c.lstate==='fly'?-.15:0;
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
  traveler:['Which way to the plaza?','Those mountains are tall!','Just passing through.']
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
function windTurbine(x,z,sc,yaw,faceX,faceZ){
  sc=(sc||1) * 3.2;
  const g=new THREE.Group();g.position.set(x,0,z);g.scale.setScalar(sc);
  const wh=std(0xfafcff,{emissive:0x4a5056,emissiveIntensity:.22,side:THREE.DoubleSide}),
        gr=std(0xa0a5a8),dk=std(0x3a4046),
        lampM=std(0xffe6a0,{emissive:0xffd27a,emissiveIntensity:1});
  /* the tower is hollow: a doorway is cut into the base and the walls are a
     ring of collision boxes, so you can walk in and stand under the nacelle */
  const H=22,baseR=1.4,topR=.6,doorH=1.1,doorA=TAU/12;
  const doorYaw=Math.atan2((faceX==null?0:faceX)-x,(faceZ==null?0:faceZ)-z);
  const rDoor=baseR+(topR-baseR)*doorH/H;
  const lower=new THREE.Mesh(new THREE.CylinderGeometry(rDoor,baseR,doorH,20,1,true,doorYaw+doorA/2,TAU-doorA),wh);
  lower.position.y=doorH/2;g.add(lower);
  const upper=new THREE.Mesh(new THREE.CylinderGeometry(topR,rDoor,H-doorH,20,1,true),wh);
  upper.position.y=(H+doorH)/2;g.add(upper);
  const cap=new THREE.Mesh(new THREE.CircleGeometry(topR*.98,18),std(0x8f979d));
  cap.rotation.x=Math.PI/2;cap.position.y=H-.02;g.add(cap);
  /* concrete apron and interior floor */
  const apron=new THREE.Mesh(new THREE.RingGeometry(baseR*1.01,baseR*1.22,24),gr);
  apron.rotation.x=-Math.PI/2;apron.position.y=.035;g.add(apron);
  const flr=new THREE.Mesh(new THREE.CircleGeometry(baseR*1.04,20),std(0x8d969c,{emissive:0x2a2e32,emissiveIntensity:.55}));
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
  const pick=a=>a[Math.floor(Math.random()*a.length)];
  function house(x,z,yaw,sc){
    sc=sc||1;
    const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=yaw;g.scale.setScalar(sc);
    const wall=std(pick(walls)),roof=std(pick(roofs)),flr=std(0xc9a06a);
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
  function village(cx,cz,kind){
    const plaza=new THREE.Mesh(new THREE.CircleGeometry(16,40),dirt);plaza.rotation.x=-Math.PI/2;plaza.position.set(cx,.022,cz);plaza.receiveShadow=true;scene.add(plaza);
    const w=new THREE.Group();w.position.set(cx,0,cz);
    w.add(cyl(1.4,1.4,.9,stone,0,.45,0,12));w.add(cyl(1.1,1.1,.05,std(0x1d4a6a),0,.88,0,12));
    [-1,1].forEach(s=>w.add(box(.12,2,.12,wood,s*1.2,1.5,0)));
    w.add(box(3.0,.12,1.8,std(0x8a3a2c),0,2.55,0));
    shade(w);scene.add(w);solids.push({x:cx,z:cz,r:1.6});
    const n=28,R=62; // Sprawling cities
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
      if(L>1){const pth=box(2.0,.03,L,dirt,cx+Math.cos(a)*mid,.026,cz+Math.sin(a)*mid);pth.rotation.y=yaw;pth.receiveShadow=true;scene.add(pth);}
    }
    for(let k=0;k<4;k++){
      const sa=k/4*TAU+.5,sx=cx+Math.cos(sa)*6.8,sz=cz+Math.sin(sa)*6.8;
      const st=new THREE.Group();st.position.set(sx,0,sz);st.rotation.y=Math.atan2(-Math.cos(sa),-Math.sin(sa));
      st.add(box(2.6,.9,1.3,wood,0,.45,0));
      [-1.2,1.2].forEach(px=>[-.5,.5].forEach(pz=>st.add(box(.1,2.2,.1,wood,px,1.1,pz))));
      st.add(box(3.0,.1,1.8,std(k%2?0xc84a3a:0x3a7ac8),0,2.25,0));
      const gc=[0xd8402a,0xf0b030,0x6fb040,0xe0762a];
      for(let j=0;j<6;j++)st.add(sph(.18,std(gc[j%4]),-1.1+j*.45,1.08,0,6));
      shade(st);scene.add(st);solids.push({x:sx,z:sz,r:1.5});
    }
    [0.2,0.8,2.1,3.7].forEach(a3=>{
      const tx=cx+Math.cos(a3)*(R+65),tz=cz+Math.sin(a3)*(R+65);
      windTurbine(tx,tz,rnd(1.0,1.3),Math.PI/2-a3,cx,cz);
    });
    const towerPlan = kind==='v1' ? [[.35,31,36],[2.2,37,29],[4.1,33,25],[5.5,38,20]]
                    : kind==='v2' ? [[.8,32,31],[3.4,35,25],[5.3,30,21]]
                    : [[1.6,33,27],[4.2,36,22]];
    towerPlan.forEach(t=>{
      const tx=cx+Math.cos(t[0])*t[1],tz=cz+Math.sin(t[0])*t[1];
      /* doors face the plaza at the middle of the village */
      skyscraper(tx,tz,Math.atan2(-Math.cos(t[0]),-Math.sin(t[0])),t[2]);
    });
    HOMES.push({x:cx,z:cz,r:75,role:'villager',count:25});
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
  village(-130*K,140*K,'v1'); village(170*K,135*K,'v2');
  village(-50,480,'v3'); village(0,-450,'v4'); 
  village(500,-60,'v5'); village(-500,80,'v6');
  farm(-120*K,-130*K,'wheat'); farm(195*K,-110*K,'pumpkin');
}

function buildPerson(farmer){
  const g=new THREE.Group();
  const skin=std([0xf0c49a,0xd9a577,0xa86f45,0x7a4a2a][Math.floor(Math.random()*4)]);
  const shirt=std(new THREE.Color().setHSL(Math.random(),.5,.5)),pants=std(Math.random()<.5?0x2f3f66:0x4a3a2a);
  const hair=std([0x2a1a10,0x6a4a2a,0xd8b060,0x888888][Math.floor(Math.random()*4)]),blk=std(0x111111);
  g.add(box(.5,.7,.28,shirt,0,1.15,0));
  g.add(sph(.17,skin,0,1.68,0,8));g.add(box(.3,.1,.3,hair,0,1.8,-.02));
  [-1,1].forEach(s=>g.add(sph(.02,blk,s*.06,1.7,.15,5)));
  const arms=[],legs=[];
  [-1,1].forEach(s=>{
    const a=pivot(g,s*.33,1.45,0);a.add(box(.12,.6,.12,shirt,0,-.3,0));a.add(box(.11,.12,.11,skin,0,-.62,0));arms.push(a);
    const l=pivot(g,s*.13,.8,0);l.add(box(.16,.8,.16,pants,0,-.4,0));legs.push(l);
  });
  if(farmer){const straw=std(0xe0c068);g.add(cyl(.32,.32,.04,straw,0,1.86,0,10));g.add(cyl(.18,.18,.14,straw,0,1.93,0,10));}
  g.userData={arms,legs};return shade(g);
}
function spawnPerson(home){
  const g=buildPerson(home.role==='farmer'),a=rnd(0,TAU),r=Math.sqrt(Math.random())*home.r*.6;
  const x=home.x+Math.cos(a)*r,z=home.z+Math.sin(a)*r;
  g.position.set(x,0,z);g.rotation.y=rnd(0,TAU);scene.add(g);
  persons.push({g,home,wild:!!home.wild,kind:home.role==='villager'?'human':home.role,person:true,hp:home.role==='farmer'?4:3,role:home.role,st:rnd(0,4),moving:false,sp:rnd(1.1,1.6),run:rnd(3.2,4.0),fleeSide:Math.random()<.5?-1:1,fleeing:false,ph:rnd(0,TAU),tx:x,tz:z,line:Math.floor(Math.random()*6),talk:0,knock:0,landed:false,y:0,vx:0,vz:0,vy:0,sx:0,sz:0,dead:false,deadT:0});
}
function updatePerson(c,dt,t){
  const g=c.g,p=g.position,u=g.userData;
  if(c.dead){
    c.deadT-=dt;
    if(c.deadT<=0){
      burst(p.x,.35,p.z,0xcdbb8a,8);
      scene.remove(g);
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
    p.y=c.y;
    pushOut(p,.4);if(!c.adminRoam)bound(p,52*S);
    if(c.knock<=0&&c.landed){
      if(c.dead){c.knock=0;p.y=0;c.y=0;return;}
      c.knock=0;c.landed=false;p.y=0;c.y=0;
      g.rotation.set(0,g.rotation.y,0);
      u.arms.forEach(a=>{a.rotation.x=0;});u.legs.forEach(l=>{l.rotation.x=0;});
      c.st=0;c.moving=false;
    }
    return;
  }
  if(c.dead){p.y=0;return;}
  if(c.held){
    u.arms.forEach((a,i)=>{a.rotation.x=Math.sin(t*9+i*2.2)*1.1;});
    u.legs.forEach((l,i)=>{l.rotation.x=Math.sin(t*8+i*1.9)*.9;});
    g.rotation.y=-1.1+Math.sin(t*3)*.12;g.rotation.x=0;g.rotation.z=0;
    return;
  }
  let threat=null,td=99;
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
  if(threat&&td>1.2){
    const bx=threat.g.position.x,bz=threat.g.position.z;
    let ax=p.x-bx,az=p.z-bz;
    const ad=Math.hypot(ax,az)||1;
    c.dir=Math.atan2(ax/ad,az/ad)+Math.sin(t*3+c.ph)*.16*c.fleeSide;
    const spd=c.run;
    p.x+=Math.sin(c.dir)*spd*dt;p.z+=Math.cos(c.dir)*spd*dt;
    if(pushOut(p,.4))c.fleeSide*=-1;
    if(!c.adminRoam)bound(p,52*S);
    g.rotation.y+=angDiff(g.rotation.y,c.dir)*Math.min(1,dt*9);
    c.talk=0;c.moving=false;c.st=0;c.fleeing=true;
    const s=Math.sin(t*13+c.ph);
    u.legs[0].rotation.x=s*.95;u.legs[1].rotation.x=-s*.95;
    u.arms[0].rotation.x=-s*.85;u.arms[1].rotation.x=s*.85;
    return;
  }
  c.fleeing=false;
  if(c.talk<=0&&updateFarmHunt(c,dt,t))return;
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
        const a=rnd(0,TAU),r=Math.sqrt(Math.random())*c.home.r,x=c.home.x+Math.cos(a)*r,z=c.home.z+Math.sin(a)*r;
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
/* farmers protect their farm: they chase cows, chickens and grasshoppers
   around the pens and swat them down */
function farmPreyNear(c){
  const p=c.g.position;
  if(!nearFarm(p.x,p.z,60))return null;
  let best=null,bd=16;
  const consider=(a,kind)=>{
    if(!a||a.held||a.ridden||a.dead||!a.g.parent)return;
    const q=a.g.position;
    if(!nearFarm(q.x,q.z,46))return;
    const d=Math.hypot(q.x-p.x,q.z-p.z);
    if(d<bd){bd=d;best={a,kind};}
  };
  cows.forEach(a=>consider(a,'cow'));
  pets.forEach(a=>{if(a.kind==='chicken')consider(a,'chicken');});
  hoppers.forEach(a=>consider(a,'hopper'));
  return best;
}
function updateFarmHunt(c,dt,t){
  if(c.role!=='farmer')return false;
  if(c.hunt&&(c.hunt.a.held||c.hunt.a.dead||!c.hunt.a.g.parent))c.hunt=null;
  if(!c.hunt){
    c.huntCd=Math.max(0,(c.huntCd||0)-dt);
    if(c.huntCd>0)return false;
    c.hunt=farmPreyNear(c);
    c.hitT=.45;
    if(!c.hunt)return false;
  }
  const p=c.g.position,u=c.g.userData,a=c.hunt.a,q=a.g.position;
  const dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz)||1;
  c.dir=Math.atan2(dx,dz);c.moving=false;c.st=0;
  c.g.rotation.y+=angDiff(c.g.rotation.y,c.dir)*Math.min(1,dt*7);
  if(d>1.9){
    const sp=2.9;
    p.x+=Math.sin(c.dir)*sp*dt;p.z+=Math.cos(c.dir)*sp*dt;
    if(pushOut(p,.4)){c.dir+=Math.PI*rnd(.5,1.2);}
    if(!c.adminRoam)bound(p,52*S);
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
    const kind=c.hunt.kind;
    a.hp=(a.hp==null?ANIMAL_HP[kind]||2:a.hp)-1;
    burst(q.x,.8,q.z,0xefe8da,6);
    if(a.hp<=0){
      killEdible(a,kind,true);
      c.hunt=null;c.huntCd=rnd(4,8);
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
  const L=LINES[c.role];toast('“'+L[c.line%L.length]+'”');c.line++;c.talk=3;return true;
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
    for(let i=0;i<placed.length;i++){const p=placed[i];if(Math.hypot(p.x-x,p.z-z)<p.r+r+1.4)return false;}
    placed.push({x,z,r});return true;
  };
  const mat4=(x,y,z,rz)=>{const o=new THREE.Object3D();o.position.set(x,y,z);if(rz)o.rotation.z=rz;o.updateMatrix();return o.matrix.clone();};
  const matS=(x,y,z,sx,sy,sz)=>{const o=new THREE.Object3D();o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.updateMatrix();return o.matrix.clone();};
  const mul=(a,b)=>new THREE.Matrix4().multiplyMatrices(a,b);
  const instanced=(parts,items)=>{
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
  };

  /* desert cacti */
  const cactusM=std(0x4f8a3c),cactusD=std(0x3c6d2c),cacti=[];
  for(let i=0;i<300;i++){
    const a=rnd(0,TAU),d=Math.sqrt(Math.random())*DESERT.r*.94;
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
    const a=rnd(0,TAU),d=Math.sqrt(Math.random())*DESERT.r*.94;
    const x=DESERT.x+Math.cos(a)*d,z=DESERT.z+Math.sin(a)*d,r=rnd(.6,1.8);
    if(!spot(x,z,r*.9))continue;
    rocks.push({x,y:r*.42,z,rx:rnd(0,TAU),ry:rnd(0,TAU),rz:rnd(0,TAU),sx:r,sy:r*.7,sz:r});
    solids.push({x,z,r:r*.8});
  }
  instanced([{geo:new THREE.IcosahedronGeometry(1,0),mat:std(0xa9835a)}],rocks);

  /* snowy pines */
  const pineM=std(0x2f5a44),snowM=std(0xeef6ff),snowD=std(0xd8e6f2),pines=[];
  for(let i=0;i<340;i++){
    const a=rnd(0,TAU),d=Math.sqrt(Math.random())*SNOWZ.r*.94;
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
    const a=rnd(0,TAU),d=Math.sqrt(Math.random())*SNOWZ.r*.94;
    const x=SNOWZ.x+Math.cos(a)*d,z=SNOWZ.z+Math.sin(a)*d,r=rnd(.8,2.1);
    if(!spot(x,z,r*.9))continue;
    drifts.push({x,y:rnd(.05,.2),z,sx:r,sy:r*rnd(.25,.45),sz:r});
  }
  instanced([{geo:new THREE.SphereGeometry(1,8,6),mat:std(0xc9d9e7)}],drifts);

  /* savanna: umbrella-thorn acacias, dry grass tufts and termite mounds */
  const acacias=[];
  for(let i=0;i<1150;i++){
    const a=rnd(0,TAU),d=Math.sqrt(Math.random())*SAVAN.r*.95;
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
    const a=rnd(0,TAU),d=Math.sqrt(Math.random())*SAVAN.r*.97;
    const it={x:SAVAN.x+Math.cos(a)*d,y:0,z:SAVAN.z+Math.sin(a)*d,ry:rnd(0,TAU),
      sx:rnd(.8,1.5),sy:rnd(.75,1.45),sz:rnd(.8,1.5)};
    (Math.random()<.62?tuftsDry:tufts).push(it);
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
    const a=rnd(0,TAU),d=Math.sqrt(Math.random())*SAVAN.r*.9;
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
function buildAnt(){
  const g=new THREE.Group(),c=std(Math.random()<.5?0x2a1a14:0x8a2a1a),dk=std(0x111111),crumb=std(0xf6ecd2);
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
  const g=buildAnt(),k=Math.random();
  g.position.set(h.x+(h.fx-h.x)*k,0,h.z+(h.fz-h.z)*k);scene.add(g);
  ants.push({g,ant:true,held:false,hill:h,out:Math.random()<.5,carry:false,sp:rnd(.9,1.5),ph:rnd(0,TAU)});
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
  const col=cols[Math.floor(Math.random()*cols.length)],c=std(col),wc=std(col,{roughness:.8}),dk=std(0x222222),org=std(0xf29a2e);
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
  const g=buildBird(),sp=nearSpot(30,100,6,null,true),fly=Math.random()<.4;
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
/* birds hunt the little things: grasshoppers first, then ants and bees */
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
  return best;
}
function eatBirdPrey(b,pr){
  const list=pr.kind==='grasshopper'?hoppers:pr.kind==='ant'?ants:bees;
  const i=list.indexOf(pr.a);if(i>=0)list.splice(i,1);
  const q=pr.a.g.position;
  scene.remove(pr.a.g);
  burst(q.x,Math.max(.2,q.y+.1),q.z,pr.kind==='bee'?0xf2c230:pr.kind==='ant'?0x8a2a1a:0x6ec228,5);
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
    birdTarget(b,Math.random()<.45);
  }else{const k=Math.min(1,b.sp*dt/d);p.x+=dx*k;p.y+=dy*k;p.z+=dz*k;}
  g.rotation.y+=angDiff(g.rotation.y,Math.atan2(dx,dz))*Math.min(1,dt*4);
  g.rotation.x=-Math.asin(clamp(dy/d,-.7,.7));
}

function buildCow(){
  const g=new THREE.Group();
  const white=std(0xf4f1ea),pink=std(0xf2a6b5),dkPatch=Math.random()<.75?std(0x1c1c1c):std(0x6b3f24),horn=std(0xefe6c8),hoof=std(0x2a2118),eye=std(0x111111);
  g.add(box(1.15,1.1,2.5,white,0,1.45,0));
  for(let i=0;i<4;i++){
    const sd=Math.random()<.5?-1:1;
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
function buildHopper(){
  const g=new THREE.Group(),b=new THREE.Group();g.add(b);const wings=[];
  const green=std(0x6ec228),dk=std(0x276a1a),lt=std(0xb6ea62),eyeM=std(0x111111),blk=std(0x111111),leg=std(0x529a22),jointC=std(0x1a450e),transWing=std(0xe2fbc0,{transparent:true,opacity:.85});
  
  b.add(box(1.3,1.2,2.8,green,0,1.9,0));
  for(let i=0;i<6;i++)b.add(box(1.38,.1,.1,dk,0,2.45,-1.1+i*.42));
  b.add(box(.95,.9,1.4,lt,0,2.15,1.6));
  
  const headGrp=pivot(b,0,2.2,2.1);
  headGrp.add(box(.9,.9,.9,green,0,0,0));
  [-1,1].forEach(s=>{
    const eye=sph(.28,eyeM,s*.45,.15,.2,8);
    eye.scale.set(.7,1,1.2);
    headGrp.add(eye);
    const ant=cyl(.03,.03,2.4,blk,s*.25,0.7,0.5,5);
    ant.rotation.x=-.5; ant.rotation.z=-s*.2;
    headGrp.add(ant);
  });
  
  [-1,1].forEach(s=>{
    const wing=box(.45,.04,2.8,transWing,s*.4,2.5,-.2);
    wing.rotation.y=s*.06; wing.rotation.x=-.08;
    b.add(wing); wings.push(wing);
  });

  const hl=[];
  [-1,1].forEach(s => {
    const fLeg = pivot(b, s*.6, 1.6, 1.2);
    fLeg.rotation.x = .3;
    fLeg.add(box(.16, .9, .16, leg, 0, -.4, 0));
    const fJoint = pivot(fLeg, 0, -.8, 0);
    fJoint.rotation.x = -.6;
    fJoint.add(box(.12, .8, .12, jointC, 0, -.4, 0));
    b.add(fLeg);

    const mLeg = pivot(b, s*.7, 1.7, 0.2);
    mLeg.rotation.x = -.2;
    mLeg.add(box(.18, 1.1, .18, leg, 0, -.5, 0));
    const mJoint = pivot(mLeg, 0, -1.0, 0);
    mJoint.rotation.x = .8;
    mJoint.add(box(.14, .9, .14, jointC, 0, -.45, 0));
    b.add(mLeg);
  });

  [-1,1].forEach(s=>{
    const t=pivot(b,s*.85,1.8,-.7);t.rotation.x=1.1;
    t.add(box(.42,.48,1.4,green,0,0,-.7));
    t.add(sph(.28,jointC,0,0,-1.3,6));
    
    const sh=pivot(t,0,0,-1.3);sh.rotation.x=-1.4;
    sh.add(box(.2,3.2,.2,leg,0,-1.6,0));
    sh.add(box(.38,.14,.6,dk,0,-3.1,.12));
    hl.push({t,sh});
  });
  
  g.scale.setScalar(HS);
  g.userData={b,hl,wings};
  return shade(g);
}

/* ---------- state ---------- */
let state='menu';
let godMode=false,adminUnlocked=false,adminFly=false,adminLift=false,adminOneShot=false;
const P={x:0,z:6,kx:0,kz:0,walkT:0,holding:null,ride:null,bump:0,sw:0,inW:false,jy:0,jv:0,fl:0,hp:10,hunger:10,punchT:0,starve:0,hungerWarn:false,sword:false,baseY:0,floor:0,tower:-1,lift:null,tornado:null,tornadoCool:0};
const keys={};let fireHeld=false;const joy={x:0,y:0};
let yaw=0,pitch=-0.08;
let cows=[],bulls=[],hoppers=[],parts=[];
let toastT=0,clock=0;

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
/* avatar-only materials so the male's emoji head does not turn the fists yellow */
const aHeadM=std(0xb9b6c4),aSkinM=std(0xb9b6c4),aShirtM=std(0x5a4b7a),aPantsM=std(0x463a61);
const aHairM=std(0x35251a),aHatM=std(0x8a5a2b),aHatBandM=std(0x4a2f18),aCheekM=std(0xe88a8a),aShoeM=std(0x241c16);

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
const avatar=new THREE.Group();
avatar.visible=false;
avatar.scale.setScalar(.94);
scene.add(avatar);
(function buildAvatar(){
  const eyeM=std(0x16120e),mouthM=std(0x9a5a4a);
  avatar.add(box(.58,.74,.32,aShirtM,0,1.44,0));
  avatar.add(box(.62,.1,.34,aPantsM,0,1.08,0));
  const head=pivot(avatar,0,2.02,0);
  head.add(sph(.23,aHeadM,0,0,.02,12));
  const nose=sph(.04,aHeadM,0,-.03,.23,5);head.add(nose);
  /* a hair cap that reaches the forehead, leaving the face open */
  const hairTop=new THREE.Mesh(new THREE.SphereGeometry(.245,14,10,0,Math.PI*2,0,Math.acos(.13/.245)),aHairM);
  hairTop.position.set(0,0,.02);head.add(hairTop);
  const hairBack=box(.36,.68,.14,aHairM,0,-.2,-.16);head.add(hairBack);
  const sideHairL=box(.08,.5,.12,aHairM,-.21,-.14,-.01);head.add(sideHairL);
  const sideHairR=box(.08,.5,.12,aHairM,.21,-.14,-.01);head.add(sideHairR);
  /* the male's hat: no hair, just a brimmed straw hat */
  const hat=new THREE.Group();
  hat.add(cyl(.34,.34,.05,aHatM,0,.22,0,12));
  hat.add(cyl(.17,.2,.18,aHatM,0,.32,0,12));
  hat.add(cyl(.205,.205,.05,aHatBandM,0,.25,0,12));
  head.add(hat);
  const eyes=[],brows=[],ears=[];
  [-1,1].forEach(s=>{
    const eye=sph(.028,eyeM,s*.085,.05,.205,6);head.add(eye);eyes.push(eye);
    const brow=box(.1,.022,.02,aHairM,s*.085,.115,.19);head.add(brow);brows.push(brow);
    const e=sph(.045,aHeadM,s*.225,-.01,0,6);e.scale.set(.5,1,.7);head.add(e);ears.push(e);
  });
  const mouth=box(.08,.02,.02,mouthM,0,-.12,.208);head.add(mouth);
  /* the male's emoji smile and rosy cheeks */
  const smile=new THREE.Mesh(new THREE.TorusGeometry(.075,.012,6,14,Math.PI),mouthM);
  smile.position.set(0,-.055,.216);smile.rotation.z=Math.PI;head.add(smile);
  const cheeks=[];
  [-1,1].forEach(s=>{
    const ch=sph(.055,aCheekM,s*.135,-.04,.198,8);ch.scale.set(1,.6,.35);head.add(ch);cheeks.push(ch);
  });
  /* the unknown's face is one big question mark */
  const faceBadge=new THREE.Mesh(new THREE.PlaneGeometry(.3,.3),qBadgeMat);
  faceBadge.position.set(0,.02,.255);head.add(faceBadge);
  const arms=[];
  [-1,1].forEach(s=>{
    const sh=pivot(avatar,s*.38,1.72,0);
    sh.add(box(.15,.44,.17,aShirtM,0,-.22,0));
    const el=pivot(sh,0,-.44,0);
    el.add(box(.13,.36,.14,aShirtM,0,-.18,0));
    el.add(box(.145,.14,.15,aSkinM,0,-.4,0));
    arms.push({sh,el});
  });
  const legs=[];
  [-1,1].forEach(s=>{
    const hip=pivot(avatar,s*.16,1.06,0);
    hip.add(box(.18,.5,.19,aPantsM,0,-.25,0));
    const knee=pivot(hip,0,-.5,0);
    knee.add(box(.155,.44,.16,aPantsM,0,-.22,0));
    knee.add(box(.2,.11,.31,aShoeM,0,-.465,.06));
    legs.push({hip,knee});
  });
  const chestBadge=new THREE.Mesh(new THREE.PlaneGeometry(.21,.21),qBadgeMat);
  chestBadge.position.set(0,1.5,.171);
  chestBadge.visible=false;
  avatar.add(chestBadge);
  avatar.userData={head,hairTop,hairBack,sideHairL,sideHairR,hat,eyes,brows,ears,nose,mouth,smile,cheeks,faceBadge,arms,legs,chestBadge};
})();
shade(avatar);
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
function updateAvatar(dt){
  if(!thirdPerson||state!=='play'){avatar.visible=false;return;}
  avatar.visible=true;
  const u=avatar.userData;
  avatar.position.set(P.x,avatarStandY(),P.z);
  avatar.rotation.y=P.ride?P.ride.g.rotation.y:yaw+Math.PI;
  const mv=Math.min(1,Math.hypot(P.x-(u.px??P.x),P.z-(u.pz??P.z))/Math.max(dt,.001)/4.5);
  u.px=P.x;u.pz=P.z;
  const w=P.walkT;
  const punch=P.punchT>0?Math.sin((1-P.punchT/.32)*Math.PI):0;
  if(P.ride){
    u.legs.forEach((l,i)=>{l.hip.rotation.x=-1.15;l.knee.rotation.x=1.15;l.hip.rotation.z=i?-.12:.12;});
    u.arms.forEach((a,i)=>{a.sh.rotation.x=-.45;a.el.rotation.x=-.35;a.sh.rotation.z=i?.16:-.16;});
    u.head.rotation.x=.08;
  }else if(P.jy>.05||P.sw>.15){
    u.legs.forEach((l,i)=>{l.hip.rotation.x=i?.35:-.35;l.knee.rotation.x=.6;l.hip.rotation.z=0;});
    u.arms.forEach((a,i)=>{a.sh.rotation.x=-.9;a.el.rotation.x=-.45;a.sh.rotation.z=i?.2:-.2;});
    u.head.rotation.x=0;
  }else{
    const amp=mv*.62;
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
  if(punch>0&&!P.ride){
    u.arms[1].sh.rotation.x=-1.3*punch;
    u.arms[1].el.rotation.x=-.5*punch;
  }
  if(P.holding&&!P.ride){
    u.arms.forEach(a=>{a.sh.rotation.x=-1.15;a.el.rotation.x=-.25;});
  }
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
  if(avatar&&avatar.userData){
    const u=avatar.userData;
    const unknown=key==='unknown',female=key==='female',male=key==='male';
    /* the girl is the same height as the villagers */
    avatar.scale.setScalar(female?.82:.94);
    const headHex=male?0xffcc4d:c.skin;
    [[aSkinM,c.skin],[aHeadM,headHex],[aShirtM,c.sleeve],[aPantsM,c.cuff],[aShoeM,0x241c16]].forEach(pair=>{
      const m=pair[0];
      m.map=unknown?qPatternTex:null;
      m.color.setHex(unknown?0xffffff:pair[1]);
      m.needsUpdate=true;
    });
    u.hairTop.visible=female;
    u.hairBack.visible=female;
    u.sideHairL.visible=female;
    u.sideHairR.visible=female;
    u.hat.visible=male;
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
  document.querySelectorAll('.genderBtn').forEach(b=>{
    const on=b.getAttribute('data-gender')===key;
    b.classList.toggle('on',on);
    b.setAttribute('aria-pressed',on?'true':'false');
  });
  try{localStorage.setItem('grasshopperGender',key);}catch(_){}
}
(function wirePlayerGender(){
  document.querySelectorAll('.genderBtn').forEach(b=>b.addEventListener('click',()=>applyPlayerGender(b.getAttribute('data-gender'))));
  let saved='unknown';
  try{saved=localStorage.getItem('grasshopperGender')||'unknown';}catch(_){}
  applyPlayerGender(saved);
})();

/* ---------- loot sword: replaces the right fist once found in a chest ---------- */
const swordRoot=new THREE.Group();
swordRoot.position.set(.30,-.36,-.55);swordRoot.visible=false;camera.add(swordRoot);
(function(){
  const steel=std(0xcdd8dd),edge=std(0xeef4f6),gold=std(0xc9a24a),grip=std(0x5a3a24),skin=pSkinM,sleeve=pSleeveM,cuff=pCuffM;
  swordRoot.add(box(.17,.17,.36,skin,0,0,.30));
  swordRoot.add(box(.22,.22,.1,cuff,0,0,.49));
  swordRoot.add(box(.24,.24,.08,sleeve,0,0,.55));
  swordRoot.add(box(.16,.15,.16,skin,0,0,.15));
  swordRoot.add(box(.06,.06,.26,grip,0,0,.06));
  swordRoot.add(box(.09,.09,.09,gold,0,0,.21));
  swordRoot.add(box(.28,.05,.07,gold,0,0,-.1));
  swordRoot.add(box(.08,.025,.82,steel,0,0,-.52));
  swordRoot.add(box(.028,.03,.78,edge,0,.022,-.52));
  const tip=cone(.075,.18,steel,0,0,-.99,4);tip.rotation.x=-Math.PI/2;swordRoot.add(tip);
})();

function toast(t){const el=$('toast');el.textContent=t;el.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('on'),1900);}

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
  cows.push(c);
}
function spawnBull(edge,pos){
  const g=buildBull();g.userData.eyeMat=g.userData.eyeMat.clone();
  g.userData.head.children.forEach(ch=>{if(ch.userData&&ch.userData.eye)ch.material=g.userData.eyeMat;});
  const sp=pos||nearSpot(45,150,18);
  g.position.set(sp.x,0,sp.z);g.rotation.y=rnd(0,TAU);scene.add(g);
  bulls.push({g,bull:true,ambient:true,rad:1.9,cy:2,heavy:.5,base:1,held:false,r:1.6,state:'wander',wt:rnd(0,2),dir:rnd(0,TAU),st:0,cd:rnd(4,8),cx:0,cz:1,hit:false,hitP:[],t:0,target:null,ridden:false,riderT:0,boltT:0,warned:false});
}
function spawnHopper(pos){
  const sp=pos||nearSpot(25,120,5);
  const g=buildHopper();g.position.set(sp.x,0,sp.z);g.rotation.y=rnd(0,TAU);scene.add(g);
  hoppers.push({hopper:true,ambient:true,rub:0,ct:rnd(.3,4),g,state:'wait',wait:rnd(.2,2),t:0,dur:.45,sx:0,sz:0,ex:0,ez:0,held:false});
}

/* ---------- hunting: punch an edible animal, eat the meat ---------- */
const meats=[];
const ANIMAL_HP={cow:3,sheep:3,chicken:2,bull:100,bear:7,snowbear:9,wolf:4,deer:4,camel:6,cobra:3,snake:2,penguin:2,bunny:2,horse:5,cat:2,dog:2,hopper:1,human:3,villager:3,farmer:4,traveler:3,lion:14,tiger:16,elephant:34,zebra:7,meerkat:2,locust:1};
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
  meats.push(item);return item;
}
function killEdible(a,kind,quiet){
  const px=a.g.position.x,py=a.g.position.y,pz=a.g.position.z;
  burst(px,py+.8,pz,0xcf4436,20);
  burst(px,py+1.0,pz,0xf4efe6,10);
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
  const kind=a.cow?'cow':a.bull?'bull':a.hopper?'hopper':a.kind;
  const dmg=adminOneShot?9999:P.sword?3:1;
  a.hp=(a.hp==null?EDIBLE_HP[kind]||2:a.hp)-dmg;
  const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1,p=a.g.position;
  burst(p.x,1.0,p.z,kind==='chicken'?0xf6f2e6:0xefe8da,8);
  if(a.hp<=0){if(a.person)killPerson(a,kind);else killEdible(a,kind);return;}
  p.x+=f.x/fl*.3;p.z+=f.z/fl*.3;
  toast((P.sword?'You slash the ':'You punch the ')+kind+'! ('+a.hp+' more)');
}
function targetMeat(){
  if(P.baseY>0.2)return null;
  const f=fwdVec(),ex=P.x,ez=P.z;
  let best=null,bd=.55;
  meats.forEach(m=>{
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
  const roll=Math.random();
  return roll<.26?'ammo':roll<.5?'food':roll<.64?'sword':roll<.9?'gun':'ak47';
}
function spawnChest(x,z){
  const c=buildChest();
  c.g.position.set(x,0,z);c.g.rotation.y=rnd(0,TAU);
  scene.add(c.g);
  const ch={g:c.g,lid:c.lid,glow:c.glow,opened:false,loot:rollChestLoot(),chest:true,rad:.85,cy:.6,held:false};
  chests.push(ch);return ch;
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
    for(let i=0;i<5;i++){const sp=villageChestSpot(h);if(sp)spawnChest(sp.x,sp.z);}
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
  c.opened=true;
  const px=c.g.position.x,pz=c.g.position.z;
  burst(px,.9,pz,0xffd76a,18);
  let loot=c.loot||rollChestLoot();
  if(loot==='sword'&&P.sword)loot='ammo';
  if(loot==='food'){
    for(let i=0;i<3;i++)dropMeat(px+rnd(-1.2,1.2),pz+rnd(-1.2,1.2));
    P.hunger=Math.min(HUNGER_MAX,(P.hunger==null?HUNGER_MAX:P.hunger)+1.5);updateHunger();
    toast('Chest: food! 3 meat dropped — press F to eat');
  }else if(loot==='ammo'){
    burst(px,1.1,pz,0xffd75e,12);
    giveChestAmmo();
  }else if(loot==='sword'){
    P.sword=true;swordRoot.visible=true;
    burst(px,1.1,pz,0xd7e6ea,12);
    toast(guns.armed?'Chest: a sword! Holster your guns to swing it':'Chest: a sword! E now slashes for 3 damage');
  }else if(loot==='ak47'){
    burst(px,1.2,pz,0xff8a5c,14);
    giveGun(3);
  }else{
    giveGun([0,1,2][Math.floor(Math.random()*3)]);
  }
}
/* Every 7 seconds the villagers reroll what sits inside the chests and re-close looted ones. */
const CHEST_RESTOCK=7;
let chestRestockT=CHEST_RESTOCK;
function restockChests(){
  let nearRestock=false;
  chests.forEach(c=>{
    if(c.held)return;
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

/* ---------- guns ---------- */
const GUN_DEFS=[
  {id:'pistol', name:'Pistol',  dmg:2, rate:.30, range:80,  spread:.004,  pellets:1, cap:12, ammo:12, power:.55, owned:false},
  {id:'shotgun',name:'Shotgun', dmg:4, rate:.80, range:36,  spread:.052,  pellets:7, cap:6,  ammo:6,  power:1, owned:false},
  {id:'rifle',  name:'Rifle',   dmg:5, rate:.14, range:150, spread:.0018, pellets:1, cap:24, ammo:24, power:.8, owned:false},
  {id:'ak47',   name:'AK-47',   dmg:4, rate:.055, range:130, spread:.006, pellets:1, cap:30, ammo:30, power:.86, owned:false, rare:true, auto:true}
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
    const tip=kind==='pistol'?-.4:kind==='shotgun'?-.66:-.7;
    const p1=new THREE.Mesh(new THREE.PlaneGeometry(.3,.3),fmat);flash.add(p1);
    const p2=p1.clone();p2.rotation.z=Math.PI/4;flash.add(p2);
    flash.add(new THREE.Mesh(new THREE.SphereGeometry(.05,8,6),new THREE.MeshBasicMaterial({color:0xfff6c9})));
    flash.position.set(0,kind==='pistol'?.04:.05,tip);
    flash.visible=false;g.add(flash);
    g.userData.flash=flash;
    g.scale.setScalar(kind==='pistol'?1:.92);
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
  P.sword=true;
  if(!GUN_DEFS[guns.weapon]||!GUN_DEFS[guns.weapon].owned)guns.weapon=0;
  guns.cool=0;guns.recoil=0;
  updateAmmoHud();
  if(!silent)toast('All weapons equipped — 1/2/3/4 switch, E or right-click fires, sword when holstered!');
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
  if(!GUN_DEFS[i].owned){if(GUN_DEFS[i].rare)toast('You do not have the AK-47 yet — find a chest!');return;}
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
  if(!t||t.a.held){el.hidden=true;return;}
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
    for(let i=0;i<len;i++){const e=1-i/len;dat[i]=(Math.random()*2-1)*e*e;}
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
    a.hp=(a.hp==null?GUN_HP[hit.kind]||3:a.hp)-(adminOneShot?9999:d.dmg);
    const p=a.g.position;
    burst(p.x,p.y+(hit.cy||1),p.z,0xcf4436,6);
    if(a.hp<=0){gunKill(a,hit.kind);killed=true;break;}
    const f=fwdVec(),fl=Math.hypot(f.x,f.z)||1;
    p.x+=f.x/fl*.16;p.z+=f.z/fl*.16;
  }
  if(hitKind&&!killed)toast('Hit the '+hitKind+'!');
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
  if(!b&&nightFlag&&Math.random()<.18)kinds.push('wolf');
  if(!b&&nightFlag&&Math.random()<.10)kinds.push('bear');
  if(!b&&nearVillage(P.x,P.z,75)&&Math.random()<.14)kinds=['bull','cow','chicken'];
  const ok=kinds.filter(k=>ambientKindCount(k)<(AMBIENT_CAPS[k]||2));
  return ok.length?ok[Math.floor(Math.random()*ok.length)]:null;
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
      if(dx*dx+dz*dz>R2){scene.remove(a.g);list.splice(i,1);}
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
  prune(bees,AMBIENT_DESPAWN);prune(birds,AMBIENT_DESPAWN);prune(ants,230);
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
  const home={x:sp.x,z:sp.z,r:rnd(26,52),role:'villager',wild:true};
  spawnPerson(home);
  return persons[persons.length-1];
}

/* ---------- overcrowded herds thin themselves out ---------- */
const ANIMAL_SOFT_CAP=70;
function dieOff(a){
  const p=a.g.position;
  burst(p.x,.5,p.z,0xcdbb8a,7);
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
  for(let i=0;i<want&&src.length;i++){dieOff(src.splice(Math.floor(Math.random()*src.length),1)[0]);killed++;}
  return killed;
}

function clearWorld() {
  pets.forEach(c=>scene.remove(c.g));pets.length=0;bees.forEach(b=>scene.remove(b.g));bees.length=0;
  birds.forEach(b=>scene.remove(b.g));birds.length=0;ants.forEach(a=>scene.remove(a.g));ants.length=0;props.forEach(o=>scene.remove(o.g));props.length=0;persons.forEach(c=>scene.remove(c.g));persons.length=0;
  cows.forEach(c=>scene.remove(c.g));bulls.forEach(b=>scene.remove(b.g));hoppers.forEach(h=>scene.remove(h.g));parts.forEach(p=>scene.remove(p.o));
  meats.forEach(m=>scene.remove(m.g));meats.length=0;
  chests.forEach(c=>scene.remove(c.g));chests.length=0;
  if(tornadoes.length){tornadoes.slice().forEach(removeTornado);setTornadoBtn(false);}
  swordRoot.visible=false;
  if(P.holding){detachHeld(P.holding);P.holding=null;hand.visible=false;}
  cows=[];bulls=[];hoppers=[];parts=[];
  ambientAnchor.x=0;ambientAnchor.z=6;
  found.clear();updateFound();updateHearts();updateHunger();
  Object.assign(P,{x:0,z:6,kx:0,kz:0,walkT:0,holding:null,ride:null,bump:0,sw:0,inW:false,jy:0,jv:0,fl:0,hp:10,hunger:10,punchT:0,starve:0,hungerWarn:false,sword:false,baseY:0,floor:0,tower:-1,lift:null});
  TOWERS.length=0;
  yaw=0;pitch=-.08;
}

function initWorldAsync(callback) {
  clearWorld();
  $('loadingMenu').hidden = false;
  
  const steps = [
    () => { buildWorldGeometry(); buildWater(); buildBiomeProps(); },
    () => { buildMountains(); buildBuildings(); buildHills(); spawnFishes(); },
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
      for(let i=0;i<6;i++)spawnBird();
      topUpSmall();
      ['bale','rock','barrel'].forEach(k=>{for(let i=0;i<2;i++)spawnProp(k,true);for(let i=0;i<2;i++)spawnProp(k,false);});
      HOMES.forEach(h=>{for(let i=0;i<Math.min(2,h.count);i++)spawnPerson(h);});
      for(let i=0;i<2;i++)spawnPerson({x:15*K,z:25*K,r:80,role:'traveler'});
      for(let i=0;i<Math.round(rnd(6,9));i++)spawnRandomHuman();
      scatterChests();
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
/* move the carried object between the first-person carry rig and the avatar's hand */
function syncHeldView(){
  const h=P.holding;
  if(!h||!h.carryCtr)return;
  detachHeld(h);
  if(thirdPerson&&state==='play'){
    avatarHold.add(h.g);
    h.g.position.set(-h.carryCtr.x,-h.carryCtr.y+.04,-h.carryCtr.z);
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
    const ch=targetChest();
    if(ch){if(canAll)lift(ch);else openChest(ch);return;}
    const h0=canAll?targetHopper():null;
    if(h0){lift(h0);return;}
    const r=targetRide();if(r){mountRide(r);return;}
    const mt=targetMeat();if(mt){if(canAll)lift(mt);else eatMeat(mt);return;}
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
  if(msg)msg.textContent=reason==='starve'?'You starved — your hunger ran out.':reason==='tornado'?'The tornado carried you to the top and let go.':'Your hearts ran out.';
  if($('hud'))$('hud').hidden=true;
  const menu=$('deathMenu');
  if(menu)menu.hidden=false;
  const rb=$('respawnBtn');if(rb){try{rb.focus();}catch(_){}}
  burst(P.x,(P.baseY||0)+(P.jy||0)+1.2,P.z,reason==='tornado'?0xb9c0c4:0xe0453c,22);
}
function hurt(n,reason){
  if(godMode)return;
  if(P.hp<=0||state==='dead')return;
  P.hp=Math.max(0,P.hp-n);updateHearts();
  if(P.hp<=0)die(reason);
}
function respawn(){
  const menu=$('deathMenu');
  if(menu)menu.hidden=true;
  P.x=0;P.z=6;P.kx=0;P.kz=0;P.jy=0;P.jv=0;P.fl=0;P.bump=1.5;
  P.baseY=0;P.floor=0;P.tower=-1;P.lift=null;
  P.tornado=null;P.tornadoCool=2;
  P.punchT=0;P.walkT=0;P.sw=0;P.inW=false;
  P.hp=HEART_MAX;P.hunger=HUNGER_MAX;P.starve=0;P.hungerWarn=false;
  updateHearts();updateHunger();
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
  const pitch=rnd(3600,5000),n=2+Math.floor(Math.random()*4);
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
    if(f.boltT<=0){f.boltT=rnd(.35,1.0);f.dir+=(Math.random()<.5?-1:1)*rnd(.8,2.2);}
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
      f.dir=who&&Math.random()<.65?Math.atan2(who.g.position.x-p.x,who.g.position.z-p.z):(Math.random()<.35?null:rnd(0,TAU));
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
      u.hl.forEach((l,i)=>{l.t.rotation.x=.75+Math.sin(t*50+i*Math.PI)*.22;l.sh.rotation.x=-1.0+Math.sin(t*50+i*Math.PI+1)*.18;});
      u.wings.forEach((w,i)=>{w.rotation.x=Math.sin(t*50+i)*.07;});
    }else{
      u.hl.forEach((l,i)=>{l.t.rotation.x=1.1+Math.sin(t*5+i*2)*.12;l.sh.rotation.x=-1.4+Math.sin(t*5+i*2+1)*.1;});
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
    else{l.t.rotation.x=1.1+.3*crouch-.6*air;l.sh.rotation.x=-1.4+.55*air-.2*crouch;}
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
  $('compassDir').textContent = directions[Math.round(heading / 45) % directions.length];
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
    const inW=!flying&&(inLake||riverAt(px,pz));
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
              if (Math.random() < 0.4) burst(P.x, 0.1, P.z, 0xc9b58a, 1);
          }
      }

      pushOut(P,.5,true);pushFrom(P,.5,cows,1.15);pushFrom(P,.5,bulls,1.6);pushFrom(P,.5,props,.9);pushFrom(P,.5,persons,.55);boundPlayer(P);
      P.walkT+=dt*ml*(keys.shift?12:9);if(ml<.1)P.walkT*=.9;
    }
    towerClamp();
  }
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
  updateChests(dt,t);
  bees.forEach(b=>{if(awake(b))updateBee(b,dt,t)});
  birds.forEach(b=>{if(awake(b))updateBird(b,dt,t)});
  ants.forEach(a=>{if(awake(a))updateAnt(a,dt,t)});
  persons.forEach(c=>{if(awake(c))updatePerson(c,dt,t)});
  updateTornado(dt);
  
  if(state==='play'){
    updateCompass();
    const riding=!!P.ride;
    const canAll=adminUnlocked&&adminLift;
    const want=(!P.holding&&!riding);
    const rt=want?targetRide():null;
    const tgt=want?targetHopper():null;
    const mt=want?targetMeat():null;
    const ch=want?targetChest():null;
    const ed=want?edibleNear():null;
    const gt=(guns.armed&&want)?gunRay(90,0):null;
    const ft=P.holding?findFeedTarget(P.holding):null;
    $('cross').classList.toggle('on',!!tgt||!!ft||!!rt||riding||!!mt||!!ed||!!gt||!!ch);
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
      if(s.startsWith('E Shoot'))return '<span data-a="shoot">'+s+'</span>';
      if(s.startsWith('E Punch '))return '<span data-a="punch">'+s+'</span>';
      return '<span>'+s+'</span>';
    }).join('');}
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
    if(guns.armed&&GUN_DEFS[guns.weapon].auto&&(keys['e']||fireHeld))shoot();
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
  wipe(fishes,0xbfe6ff);wipe(bees,0xf2c230);wipe(birds,0xf4efe6);wipe(ants,0x8a2a1a);
  tornadoes.forEach(T=>T.dropped.clear());
  adminMsg('Killed '+n+' animals — the pasture is clear');
}
function adminSpawnEverything(at){
  const base=at||aimSpawnPoint(200);
  const kinds=['cow','bull','hopper','fish','bee','bird','ant','cat','dog','horse','bear','deer','bunny','wolf','sheep','chicken','camel','cobra','snake','penguin','snowbear','lion','tiger','elephant','zebra','meerkat','locust','human','farmer','traveler','bale','rock','barrel','chest','meat'];
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
  else if(kind==='bird'){spawnBird();a=birds[birds.length-1];}
  else if(kind==='ant'){spawnAnt(0);a=ants[ants.length-1];}
  else if(kind==='human'||kind==='farmer'||kind==='traveler'){spawnPerson({x,z,r:6,role:kind==='human'?'villager':kind});a=persons[persons.length-1];}
  else if(kind==='bale'||kind==='rock'||kind==='barrel'){spawnProp(kind,true);a=props[props.length-1];}
  else if(kind==='chest'){a=spawnChest(x,z);}
  else if(kind==='meat'){a=dropMeat(x,z);}
  else if(kind==='sword'){P.sword=true;if(!quiet)adminMsg('Sword granted — holster your guns to swing it');return;}
  else if(kind==='pistol'||kind==='shotgun'||kind==='rifle'||kind==='ak47'){
    const gi=['pistol','shotgun','rifle','ak47'].indexOf(kind);
    giveGun(gi,true);
    if(!quiet)adminMsg('Granted '+GUN_DEFS[gi].name+' and full ammo');
    return;
  }
  else{spawnPet(kind,undefined,{x,z});a=pets[pets.length-1];}
  if(a){
    a.adminRoam=true;
    if(a.pet)a.biome=null;
    a.adminSpawned=true;
    a.g.position.set(x,a.bee?rnd(1.2,2.4):a.fish?.15:0,z);
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
    const r=rnd(2.6,5.2),a=rnd(0,TAU),rad=Math.sqrt(Math.random())*11;
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
  if(Math.random()<.16){
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
  const n=Math.random()<.16?2:1;
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
    if(godMode){releasePlayerTornado();toast('God mode shrugs off the tornado');}
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
    b.textContent='God Mode: '+(godMode?'ON':'OFF');b.classList.toggle('on',godMode);
    adminMsg('God mode '+(godMode?'ON':'OFF'));
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

/* ---------- input ---------- */
window.addEventListener('keydown',e=>{
  const k=e.key.toLowerCase();
  if(k==='f2'){
    if(e.repeat||state==='dead')return;
    e.preventDefault();
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
  if(k==='f')useGrab();
  if(k==='e'){if(guns.armed)shoot();else punch();}
  if(k==='g'){if(liftHere())rideLift(-1);else if(adminUnlocked&&adminLift){const r=targetRide();if(r)mountRide(r);}}
  if(k==='1')selectGun(0);
  if(k==='2')selectGun(1);
  if(k==='3')selectGun(2);
  if(k==='4')selectGun(3);
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
    if(isPointerLocked){if(e.button===2){fireHeld=true;if(guns.armed)shoot();else punch();}else useGrab();return;}
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
  if(drag.mouse&&drag.moved<8&&performance.now()-drag.t<300)useGrab();
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
$('btnGrab').addEventListener('pointerdown',e=>{e.preventDefault();useGrab();});
$('prompt').addEventListener('pointerdown',e=>{
  e.preventDefault();
  const a=e.target.dataset&&e.target.dataset.a;
  if(a==='ride')useGrab();
  else if(a==='rideg'){const r=targetRide();if(r)mountRide(r);}
  else if(a==='lift')useGrab();
  else if(a==='liftdown')rideLift(-1);
  else if(a==='chest')useGrab();
  else if(a==='shoot')shoot();
  else if(a==='punch')punch();
  else if(a==='feed'&&P.holding){const t=findFeedTarget(P.holding);if(t)feedHeld(t);}
});
const bp=$('btnPunch');
if(bp)bp.addEventListener('pointerdown',e=>{e.preventDefault();fireHeld=true;if(guns.armed)shoot();else punch();});
if(bp)['pointerup','pointercancel','pointerleave'].forEach(ev=>bp.addEventListener(ev,()=>{fireHeld=false;}));
const bj=$('btnJump');
bj.addEventListener('pointerdown',e=>{e.preventDefault();keys[' ']=true;});
['pointerup','pointercancel','pointerleave'].forEach(ev=>bj.addEventListener(ev,()=>{keys[' ']=false;}));

function start(){
  initAudio();
  $('menu').hidden=true;
  state='play';
  $('hud').hidden=false;
  const g=$('btnGrab');if(g)g.textContent='LIFT';
  reqLock();
  toast('Punch with E, eat meat with F — desert west, snowfield north!');
}
$('play').addEventListener('click',start);
const respawnBtn=$('respawnBtn');
if(respawnBtn)respawnBtn.addEventListener('click',respawn);

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
  
  if (state === 'play') {
      update(dt,clock);
      updateCamera(dt);
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
    $('loadingMenu').hidden = true;
    $('menu').hidden = false;
    requestAnimationFrame(loop);
});
}
