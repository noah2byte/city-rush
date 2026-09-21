import * as THREE from 'three';
import { CONFIG } from './config.js';
import { CHUNK } from './course.js';
import { rng } from './rng.js';
import { bent, noCull } from './bend.js';
import {
  facadeTextures, storefrontTexture, containerStackTexture, stoneWallTexture,
  hanokWallTextures, crosswalkTexture, signTexture, billboardTexture,
} from './textures.js';

const R = CONFIG.roadHalf;
// 배치용 난수는 시드 고정 rng를 쓴다(world.js가 청크 위치로 시드를 정한다)
const rand = (a, b) => a + rng() * (b - a);
const pick = arr => arr[(rng() * arr.length) | 0];

// 오브젝트 풀. 청크가 계속 생기고 사라지므로 메시를 새로 만들지 않고 재사용해 GC 끊김을 막는다
class Pool {
  constructor(factory) {
    this.factory = factory;
    this.free = [];
  }
  get() { return this.free.pop() ?? noCull(this.factory()); }
  release(o) { o.removeFromParent(); this.free.push(o); }
}

const std = opts => bent(new THREE.MeshStandardMaterial(opts));
const glow = (color, intensity) => std({ color, emissive: color, emissiveIntensity: intensity });

// ── 공유 지오메트리 ──
// 단위 박스를 scale로 늘려 쓴다. 곡선 셰이더가 정점 단위로 휘므로 길이 방향 분할을 넣었다
const unitBox = new THREE.BoxGeometry(1, 1, 1, 1, 1, 3);
const unitPlane = new THREE.PlaneGeometry(1, 1, 1, 2);
const groundGeo = new THREE.PlaneGeometry(400, CHUNK, 1, 4).rotateX(-Math.PI / 2).translate(0, 0, -CHUNK / 2);

// ── 재질 ──
const facadeSets = [0, 1, 2].map(facadeTextures);
const storefrontTex = storefrontTexture();
const stoneTex = stoneWallTexture();
const hanokTex = hanokWallTextures();
const crosswalkTex = crosswalkTexture();
const stackTextures = [0, 1, 2, 3].map(containerStackTexture);
export const billboards = [0, 1, 2].map(billboardTexture); // world.js가 오프셋을 흘려 움직인다

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// 부스터 패드: 화살표(쉐브론)를 그려 두고 오프셋을 흘려 앞으로 빨려 들어가는 느낌을 준다
export const padTexture = canvasTex(64, 128, g => {
  g.fillStyle = '#FF7A00'; g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#FFE14D';
  for (let y = 0; y < 128; y += 32) {
    g.beginPath(); g.moveTo(6, y + 26); g.lineTo(32, y + 6); g.lineTo(58, y + 26); g.lineTo(58, y + 34); g.lineTo(32, y + 14); g.lineTo(6, y + 34); g.fill();
  }
});
padTexture.repeat.set(1, 2);
// 결승선 체커 무늬
const checkerTex = canvasTex(128, 16, g => {
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#F4F4F4'; g.fillRect(x * 8, y * 8, 8, 8);
  }
}, false);
checkerTex.magFilter = THREE.NearestFilter;
const bannerTex = canvasTex(1024, 160, g => {
  for (let x = 0; x < 64; x++) for (let y = 0; y < 10; y++) {
    g.fillStyle = (x + y) % 2 ? '#141414' : '#F4F4F4'; g.fillRect(x * 16, y * 16, 16, 16);
  }
  g.fillStyle = 'rgba(20,20,20,.85)'; g.fillRect(250, 30, 524, 100);
  g.fillStyle = '#FFD23F'; g.font = '72px "Black Han Sans", "Do Hyeon", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('START · FINISH', 512, 84);
}, false);

const M = {
  land: std({ color: '#111016', roughness: 0.9 }),
  lowLand: std({ color: '#0C0B10', roughness: 0.95 }),
  grass: std({ color: '#0E1A12', roughness: 1 }),
  yard: std({ color: '#2A2A2E', roughness: 0.85 }), // 항만 콘크리트 야적장
  water: std({ color: '#0A1826', roughness: 0.1, metalness: 0.3 }), // 매끈해야 환경맵 반사가 수면처럼 보인다
  walk: std({ color: '#55535C', roughness: 0.85 }),
  stonePave: std({ color: '#6A6258', roughness: 0.9 }),
  curb: std({ color: '#7A7880', roughness: 0.7 }),
  sideRoad: std({ color: '#26262B', roughness: 0.8 }),
  pole: std({ color: '#2E2E34', metalness: 0.7, roughness: 0.45 }),
  sodium: glow('#FFB060', 8),
  led: glow('#DCE6FF', 4), // 흰색은 같은 세기에서도 블룸이 훨씬 크게 번져 주황보다 낮춘다
  beacon: glow('#FF2020', 8),
  concrete: std({ color: '#4A4952', roughness: 0.8 }),
  barrier: std({ color: '#8C8A86', roughness: 0.75 }),
  tunnelWall: std({ color: '#8A8578', roughness: 0.55 }), // 터널 타일은 약간 광택이 있어 조명이 벽에 번진다
  tunnelLight: glow('#FFA040', 9),
  archSteel: std({ color: '#C9CED6', metalness: 0.8, roughness: 0.3 }),
  // 난간은 전조등 빛이 매끈한 금속에 맺히면 화면에 고정된 빛덩이로 보여서 거칠게 둔다
  rail: std({ color: '#9AA0A8', metalness: 0.4, roughness: 0.65 }),
  archLed: glow('#7FD8FF', 3),
  trunk: std({ color: '#3A2A1E', roughness: 1 }),
  leaf: std({ color: '#1E3A24', roughness: 0.9 }),
  pine: std({ color: '#16301E', roughness: 0.9 }),
  roof: std({ color: '#3B2F2F', roughness: 0.8 }),
  tile: std({ color: '#2B2E33', roughness: 0.7, metalness: 0.1 }), // 기와
  hedge: std({ color: '#15301C', roughness: 1 }),
  crane: std({ color: '#C23B22', roughness: 0.6, metalness: 0.3 }),
  craneWhite: std({ color: '#D8D8D4', roughness: 0.6, metalness: 0.3 }),
  signalRed: glow('#FF2A1A', 6),
  signalGreen: glow('#2AFF8A', 6),
  signPost: std({ color: '#5A5E66', metalness: 0.6, roughness: 0.5 }),
  underGlow: glow('#7FD8FF', 2),
  crosswalk: bent(new THREE.MeshStandardMaterial({ map: crosswalkTex, alphaTest: 0.5, roughness: 0.6 })),
  stone: std({ map: stoneTex, roughness: 0.95 }),
  hanokWall: std({ map: hanokTex.map, emissive: '#ffffff', emissiveMap: hanokTex.emissiveMap, emissiveIntensity: 1.2, roughness: 0.9 }),
};
const NEON = ['#FF3CAC', '#2EE6D6', '#7CFF4F', '#FFD23F', '#8F5BFF', '#FF6B3D'].map(c => glow(c, 3));
// 컨테이너 더미 재질: 텍스처(4종) × 쌓인 단수(1~4). 4단짜리 텍스처를 n단 높이에 맞춰 아래 n단만 보이게 반복을 조절한다
const stackMats = new Map();
function stackMat(t, n) {
  const key = t * 10 + n;
  if (!stackMats.has(key)) {
    const tex = stackTextures[t].clone();
    tex.repeat.set(1, n / 4);
    stackMats.set(key, std({ map: tex, roughness: 0.7, metalness: 0.2 }));
  }
  return stackMats.get(key);
}
const BILLBOARD_MATS = billboards.map(t => bent(new THREE.MeshBasicMaterial({ map: t })));
const padMat = bent(new THREE.MeshStandardMaterial({ map: padTexture, emissive: '#ffffff', emissiveMap: padTexture, emissiveIntensity: 1.1, roughness: 0.4 }));
const checkerMat = bent(new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.6 }));
const bannerMat = bent(new THREE.MeshStandardMaterial({ map: bannerTex, emissive: '#ffffff', emissiveMap: bannerTex, emissiveIntensity: 0.6 }));

// 표지판 텍스처는 처음 쓸 때 만든다. 캔버스에 한글 웹폰트를 그리려면 폰트 로딩이 끝나 있어야 하기 때문이다
const PLACES = [
  ['서울역', 'Seoul Sta.', '↑'], ['강남', 'Gangnam', '↗'], ['여의도', 'Yeouido', '↑'], ['광화문', 'Gwanghwamun', '↖'],
  ['잠실', 'Jamsil', '↑'], ['인천공항', 'Incheon Airport', '↗'], ['판교', 'Pangyo', '↑'], ['성수', 'Seongsu', '↖'],
];
const signMats = new Map();
function signMat(i) {
  if (!signMats.has(i)) {
    const t = signTexture(...PLACES[i]);
    // 반사 시트 표지판은 전조등을 받아 밝게 보이므로 약하게 자체 발광시킨다
    signMats.set(i, std({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.35, roughness: 0.6 }));
  }
  return signMats.get(i);
}

// ── 풀 ──
const lampGeo = {
  pole: new THREE.CylinderGeometry(0.07, 0.1, 7, 8, 4),
  arm: new THREE.BoxGeometry(1.8, 0.07, 0.07),
  head: new THREE.BoxGeometry(0.7, 0.1, 0.3),
};
function makeLamp(headMat) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(lampGeo.pole, M.pole);
  pole.position.y = 3.5;
  const arm = new THREE.Mesh(lampGeo.arm, M.pole);
  arm.position.set(0.9, 7, 0);
  const head = new THREE.Mesh(lampGeo.head, headMat);
  head.position.set(1.6, 6.93, 0);
  g.add(pole, arm, head); // +x 방향으로 뻗은 가로등. 배치할 때 도로 쪽을 향하게 돌린다
  return g;
}

const treeGeo = {
  trunk: new THREE.CylinderGeometry(0.15, 0.22, 3, 6),
  leaf: new THREE.IcosahedronGeometry(1.7, 1),
  pine: new THREE.ConeGeometry(1.6, 4.5, 7),
};
const archGeo = {
  steel: new THREE.TorusGeometry(R + 4, 0.35, 8, 40, Math.PI),
  led: new THREE.TorusGeometry(R + 3.6, 0.08, 6, 40, Math.PI),
};
const lanternGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.6, 10);
// 청사초롱(위는 붉고 아래는 푸름)을 텍스처 한 장으로 칠해 메시 하나로 그린다. 메시 두 개면 드로콜이 두 배다
const lanternMat = (() => {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#E8303A'; g.fillRect(0, 0, 4, 8);
  g.fillStyle = '#2F5BD8'; g.fillRect(0, 8, 4, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return std({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 3 });
})();

const pools = {
  building: new Pool(() => {
    // 건물마다 텍스처 반복 횟수가 달라 재질을 개별로 가진다. 텍스처 이미지 자체는 공유된다
    const mat = std({ emissive: '#ffffff', emissiveIntensity: 2.2, roughness: 1, metalness: 1 });
    return new THREE.Mesh(unitBox, mat);
  }),
  storefront: new Pool(() => new THREE.Mesh(
    unitPlane,
    std({ color: '#0A0A0C', emissive: '#ffffff', emissiveMap: storefrontTex.clone(), emissiveIntensity: 0.9 }), // 면적이 넓어 블룸 임계값 근처로만 둔다
  )),
  box: new Pool(() => new THREE.Mesh(unitBox, M.concrete)),   // 재질은 배치할 때 지정
  plane: new Pool(() => new THREE.Mesh(unitPlane, M.crosswalk)), // 재질은 배치할 때 지정
  ground: new Pool(() => new THREE.Mesh(groundGeo, M.land)),
  sodiumLamp: new Pool(() => makeLamp(M.sodium)),
  ledLamp: new Pool(() => makeLamp(M.led)),
  tree: new Pool(() => {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(treeGeo.trunk, M.trunk);
    trunk.position.y = 1.5;
    const leaf = new THREE.Mesh(treeGeo.leaf, M.leaf);
    leaf.position.y = 3.8;
    g.add(trunk, leaf);
    return g;
  }),
  pine: new Pool(() => {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(treeGeo.trunk, M.trunk);
    trunk.position.y = 1.5;
    const leaf = new THREE.Mesh(treeGeo.pine, M.pine);
    leaf.position.y = 4.4;
    g.add(trunk, leaf);
    return g;
  }),
  roof: new Pool(() => new THREE.Mesh(new THREE.ConeGeometry(0.72, 1, 4).rotateY(Math.PI / 4), M.roof)),
  arch: new Pool(() => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(archGeo.steel, M.archSteel), new THREE.Mesh(archGeo.led, M.archLed));
    return g;
  }),
  lantern: new Pool(() => new THREE.Mesh(lanternGeo, lanternMat)),
};

// ── 청크 조립 도우미 ──
function place(chunk, poolName, setup) {
  const obj = pools[poolName].get();
  setup(obj);
  chunk.group.add(obj);
  chunk.items.push([poolName, obj]);
  return obj;
}

function box(chunk, mat, x, y, z, w, h, d) {
  return place(chunk, 'box', o => {
    o.material = mat;
    o.scale.set(w, h, d);
    o.position.set(x, y, z);
    o.rotation.set(0, 0, 0);
  });
}

// 평면(바닥에 까는 것은 flat=true, 도로를 향해 세우는 것은 side 지정)
function plane(chunk, mat, x, y, z, w, h, { flat = false, facing = 0 } = {}) {
  return place(chunk, 'plane', o => {
    o.material = mat;
    o.scale.set(w, h, 1);
    o.position.set(x, y, z);
    o.rotation.set(flat ? -Math.PI / 2 : 0, flat ? 0 : facing, 0);
  });
}

function building(chunk, { x, z, w, h, d, set, base = 0 }) {
  return place(chunk, 'building', o => {
    const mat = o.material;
    const f = facadeSets[set];
    // 외벽 세트가 바뀔 때만 텍스처를 교체한다. clone은 이미지(GPU 텍스처)를 공유하므로 비용이 작다
    if (mat.userData.set !== set) {
      mat.map = f.map.clone();
      mat.emissiveMap = f.emissiveMap.clone();
      mat.roughnessMap = mat.metalnessMap = f.rmMap.clone();
      mat.userData.set = set;
      mat.needsUpdate = true;
    }
    for (const t of [mat.map, mat.emissiveMap, mat.roughnessMap]) t.repeat.set(d / 8, h / 32); // 창문 1칸 ≈ 2m × 2m
    o.scale.set(w, h, d);
    o.position.set(x, base + h / 2, z);
  });
}

function lamp(chunk, side, z, kind = 'sodiumLamp', color = '#FFA850', x = side * (R + 0.6)) {
  place(chunk, kind, o => {
    o.position.set(x, 0, z);
    o.rotation.y = side > 0 ? Math.PI : 0; // 팔이 도로 쪽을 향하게
  });
  chunk.anchors.push({ x: x - side * 1.6, y: 6.7, z, color });
}

// 가로등은 좌우를 12m씩 엇갈려 배치한다(청크 하나에 양쪽 하나씩)
function streetLamps(chunk, kind, color) {
  lamp(chunk, -1, -6, kind, color);
  lamp(chunk, 1, -18, kind, color);
}

// 보도와 연석. 구역마다 모양이 달라(한옥 마을은 박석, 고가도로는 없음) 청크마다 만든다.
// from~to 구간만 깔 수 있게 해 교차로에서는 보도를 끊는다
function sidewalks(chunk, mat = M.walk, from = 0, to = -CHUNK) {
  const len = from - to, zc = (from + to) / 2;
  for (const side of [-1, 1]) {
    box(chunk, mat, side * (R + 1.5), 0.09, zc, 3, 0.18, len);
    box(chunk, M.curb, side * (R + 0.1), 0.1, zc, 0.2, 0.2, len);
  }
}

// 도로변을 따라 건물을 from~to 구간만큼 채운다
function buildingRow(chunk, side, { h, d, gap, set, setback = 3, extra, from = 0, to = -CHUNK, base = 0 }) {
  let cursor = from - rand(0, gap[1]);
  while (cursor > to + 4) {
    const depth = Math.min(rand(...d), cursor - to - 0.5);
    if (depth < 4) break;
    const width = rand(10, 18);
    const height = rand(...h);
    const x = side * (R + setback + width / 2);
    const z = cursor - depth / 2;
    building(chunk, { x, z, w: width, h: height, d: depth, set: set(), base });
    extra?.({ side, x, z, width, height, depth, face: side * (R + setback) });
    cursor -= depth + rand(...gap);
  }
}

function ground(chunk, mat, { x = 0, y = -0.01, sx = 1 } = {}) {
  place(chunk, 'ground', o => {
    o.material = mat;
    o.position.set(x, y, 0);
    o.scale.set(sx, 1, 1);
  });
}

function tree(chunk, kind, x, z, s) {
  place(chunk, kind, o => { o.position.set(x, 0, z); o.scale.setScalar(s); });
}

// ── 구간 이벤트(교차로·표지판·육교) ──
// 같은 이벤트가 연달아 나오지 않게 마지막 이벤트 이후 지난 청크 수를 센다
let sinceFeature = 0;
// 바퀴가 시작될 때 초기화해 매 바퀴 같은 자리에 같은 이벤트가 나오게 한다
export function resetFeatures() { sinceFeature = 0; }
function rollFeature(options) {
  sinceFeature++;
  if (sinceFeature < 4) return null; // 최소 4청크(96m) 간격
  for (const [name, p] of options) {
    if (rng() < p) { sinceFeature = 0; return name; }
  }
  return null;
}

// 교차로: 이 청크 가운데 10m를 옆길로 비우고 횡단보도·신호등을 둔다
const CROSS_FROM = -7, CROSS_TO = -17;
function intersection(chunk) {
  plane(chunk, M.crosswalk, 0, 0.015, CROSS_FROM + 2.2, R * 2 - 0.6, 3.6, { flat: true });
  for (const side of [-1, 1]) {
    // 옆길 노면
    box(chunk, M.sideRoad, side * (R + 40), -0.05, (CROSS_FROM + CROSS_TO) / 2, 80, 0.1, CROSS_FROM - CROSS_TO);
    // 신호등: 기둥 + 도로 위로 뻗은 팔 + 신호(우리 방향은 초록, 옆길 방향은 빨강)
    const px = side * (R + 0.8), pz = CROSS_FROM + 0.5;
    box(chunk, M.signPost, px, 3, pz, 0.18, 6, 0.18);
    box(chunk, M.signPost, px - side * 3, 6, pz, 6, 0.14, 0.14);
    box(chunk, M.concrete, px - side * 5, 5.6, pz, 1.4, 0.45, 0.35);
    box(chunk, M.signalGreen, px - side * 5.45, 5.6, pz + 0.18, 0.3, 0.3, 0.05);
    box(chunk, M.signalRed, px + side * 0.12, 3.2, pz - 0.3, 0.05, 0.3, 0.3);
  }
}

// 도로 표지판 갠트리: 도로를 가로지르는 문형 구조물에 녹색 표지판 두 개
function signGantry(chunk, { base = 0, span = R + 0.8 } = {}) {
  const z = -12;
  for (const side of [-1, 1]) box(chunk, M.signPost, side * span, base + 3.8, z, 0.35, 7.6, 0.35);
  box(chunk, M.signPost, 0, base + 7.4, z, span * 2, 0.4, 0.5);
  const a = (rng() * PLACES.length) | 0;
  const b = (a + 1 + ((rng() * (PLACES.length - 1)) | 0)) % PLACES.length;
  plane(chunk, signMat(a), -3.2, base + 6.3, z + 0.3, 5.2, 2.3);
  plane(chunk, signMat(b), 3.2, base + 6.3, z + 0.3, 5.2, 2.3);
}

// 육교: 도로 위를 건너는 보행자 다리. 아래 조명이 지나갈 때 속도감을 준다
function overpass(chunk) {
  const z = -12, w = R * 2 + 10;
  box(chunk, M.concrete, 0, 6.6, z, w, 0.6, 3.2);
  box(chunk, M.underGlow, 0, 6.27, z, w - 2, 0.06, 0.2);
  for (const dz of [-1.5, 1.5]) box(chunk, M.rail, 0, 7.45, z + dz, w, 0.08, 0.08);
  for (const side of [-1, 1]) {
    box(chunk, M.concrete, side * (R + 4), 3.3, z, 2.4, 6.6, 3.2); // 계단탑
  }
}

// LED 전광판을 건물 도로 쪽 면에 붙인다
function billboard(chunk, { side, z, depth, height, face }) {
  const w = Math.min(depth * 0.8, 12), h = Math.min(w * 0.55, 7);
  if (height < h + 8) return;
  plane(chunk, pick(BILLBOARD_MATS), face - side * 0.08, rand(h / 2 + 5, height - h / 2 - 2), z, w, h, { facing: -side * Math.PI / 2 });
}

// ── 구역별 조립 ──
export const builders = {
  downtown(chunk) {
    const f = rollFeature([['intersection', 0.18], ['gantry', 0.14]]);
    ground(chunk, M.land);
    streetLamps(chunk);
    if (f === 'intersection') {
      sidewalks(chunk, M.walk, 0, CROSS_FROM);
      sidewalks(chunk, M.walk, CROSS_TO, -CHUNK);
      intersection(chunk);
    } else sidewalks(chunk);
    if (f === 'gantry') signGantry(chunk);
    const rows = f === 'intersection' ? [[0, CROSS_FROM], [CROSS_TO, -CHUNK]] : [[0, -CHUNK]];
    for (const side of [-1, 1]) {
      for (const [from, to] of rows) {
        buildingRow(chunk, side, {
          h: [28, 85], d: [12, 22], gap: [0.5, 2], from, to,
          set: () => pick([0, 2, 2]), // 업무지구는 유리 커튼월 비중을 높인다
          extra: info => {
            // 고층 건물 옥상의 항공 장애등. 작은 디테일이지만 "도시의 밤" 느낌을 크게 살린다
            if (info.height > 55) box(chunk, M.beacon, info.x, info.height + 0.3, info.z, 0.5, 0.5, 0.5);
            if (rng() < 0.12) billboard(chunk, info);
          },
        });
      }
    }
  },

  shopping(chunk) {
    const f = rollFeature([['intersection', 0.16], ['overpass', 0.12]]);
    ground(chunk, M.land);
    streetLamps(chunk);
    if (f === 'intersection') {
      sidewalks(chunk, M.walk, 0, CROSS_FROM);
      sidewalks(chunk, M.walk, CROSS_TO, -CHUNK);
      intersection(chunk);
    } else sidewalks(chunk);
    if (f === 'overpass') overpass(chunk);
    const rows = f === 'intersection' ? [[0, CROSS_FROM], [CROSS_TO, -CHUNK]] : [[0, -CHUNK]];
    for (const side of [-1, 1]) {
      for (const [from, to] of rows) {
        buildingRow(chunk, side, {
          h: [9, 22], d: [8, 14], gap: [0.3, 1.2], setback: 3, from, to,
          set: () => pick([0, 1]),
          extra: info => {
            const { z, depth, height, face } = info;
            // 1층 쇼윈도: 건물 도로 쪽 면에 발광 판을 붙인다
            place(chunk, 'storefront', o => {
              o.scale.set(depth * 0.95, 3.6, 1);
              o.position.set(face - side * 0.06, 1.9, z);
              o.rotation.set(0, -side * Math.PI / 2, 0);
              o.material.emissiveMap.repeat.set(depth / 12, 1);
            });
            // 세로 네온 간판: 벽에서 튀어나오게 달아 멀리서도 보이게 한다
            const n = height > 14 ? 2 : 1;
            for (let i = 0; i < n; i++) {
              const sz = n > 1 ? z + (i ? -depth / 4 : depth / 4) : z;
              box(chunk, pick(NEON), face - side * 0.7, rand(5.5, Math.min(height - 3, 11)), sz, 0.25, rand(3, 5), 1.1);
            }
            if (height > 18 && rng() < 0.15) billboard(chunk, info);
          },
        });
      }
    }
  },

  bridge(chunk, info) {
    ground(chunk, M.water, { y: -5 }); // 다리 구간은 수면을 도로보다 한참 아래에 둔다
    sidewalks(chunk);
    box(chunk, M.concrete, 0, -0.75, -CHUNK / 2, R * 2 + 7, 1.3, CHUNK); // 상판
    for (const side of [-1, 1]) {
      box(chunk, M.rail, side * (R + 3.1), 0.9, -CHUNK / 2, 0.08, 0.08, CHUNK);
      for (let z = -2; z > -CHUNK; z -= 4) box(chunk, M.rail, side * (R + 3.1), 0.45, z, 0.08, 0.9, 0.08);
      lamp(chunk, side, side < 0 ? -6 : -18, 'ledLamp', '#D8E4FF');
      // 강 건너 스카이라인. 멀리 있어 디테일이 필요 없으니 작은 창문 텍스처 그대로 크게 쓴다
      if (rng() < 0.6) {
        const w = rand(20, 40), h = rand(30, 110), d = rand(14, 22);
        building(chunk, { x: side * rand(110, 220), z: -rand(4, 20), w, h, d, set: pick([0, 2]) });
      }
    }
    // 아치는 두 청크(48m)마다. 리듬감 있는 반복이 다리를 달리는 느낌을 준다
    if ((info.index & 1) === 0) place(chunk, 'arch', o => o.position.set(0, 0, -12));
  },

  park(chunk) {
    const f = rollFeature([['overpass', 0.1]]);
    ground(chunk, M.grass);
    sidewalks(chunk);
    streetLamps(chunk);
    if (f === 'overpass') overpass(chunk);
    for (const side of [-1, 1]) {
      box(chunk, M.hedge, side * (R + 3.4), 0.5, -CHUNK / 2, 0.8, 1, CHUNK); // 보도와 공원을 나누는 생울타리
      for (let z = -4; z > -CHUNK; z -= 8) tree(chunk, 'tree', side * (R + 2.2), z + rand(-1, 1), rand(0.85, 1.25));
      // 나무는 메시 2개짜리라 드로콜이 빨리 늘어 공원 안쪽은 듬성하게 둔다
      for (let i = 0; i < 2; i++) tree(chunk, pick(['tree', 'pine']), side * rand(R + 6, R + 40), -rand(0, CHUNK), rand(1, 1.8));
      if (rng() < 0.55) {
        const w = rand(7, 10), h = rand(5, 8), d = rand(8, 12);
        const x = side * rand(R + 12, R + 20), z = -rand(d / 2, CHUNK - d / 2);
        building(chunk, { x, z, w, h, d, set: 1 });
        place(chunk, 'roof', o => { o.material = M.roof; o.scale.set(w * 1.05, rand(2.5, 3.5), d * 1.05); o.position.set(x, h + o.scale.y / 2, z); });
      }
    }
  },

  tunnel(chunk, info) {
    ground(chunk, M.land);
    sidewalks(chunk);
    const H = 7.5, W = R + 3.2;
    for (const side of [-1, 1]) {
      box(chunk, M.tunnelWall, side * W, H / 2, -CHUNK / 2, 0.5, H, CHUNK);
      for (let z = -3; z > -CHUNK; z -= 6) box(chunk, M.tunnelLight, side * (W - 0.3), H - 0.6, z, 0.12, 0.2, 2.4);
    }
    box(chunk, M.concrete, 0, H + 0.25, -CHUNK / 2, W * 2 + 0.5, 0.5, CHUNK);
    chunk.anchors.push({ x: 0, y: H - 1, z: -12, color: '#FF9A3C' });
    if (info.isFirst) {
      // 터널 입구: 산을 뚫은 느낌이 나도록 입구 위와 옆을 두꺼운 벽으로 막는다
      box(chunk, M.concrete, 0, H + 6, 0, 80, 12, 2);
      for (const side of [-1, 1]) box(chunk, M.concrete, side * (W + 20), H / 2, 0, 40, H, 2);
    }
  },

  // 항만: 왼쪽은 컨테이너 야적장, 오른쪽은 안벽과 바다, 그 위에 거대한 크레인
  port(chunk, info) {
    ground(chunk, M.yard, { x: -200 + R + 14, sx: 1 }); // 왼쪽 땅(오른쪽 끝이 x = R+14)
    ground(chunk, M.water, { x: 200 + R + 14, y: -2.5 }); // 오른쪽 바다
    box(chunk, M.yard, R + 7, -1.25, -CHUNK / 2, 14, 2.5, CHUNK); // 오른쪽 안벽(부두)
    sidewalks(chunk);
    lamp(chunk, -1, -6);
    lamp(chunk, 1, -18);
    // 도로와 야적장 사이 철망 울타리(가로 봉 두 줄로 표현)
    for (const y of [0.6, 2.2]) box(chunk, M.rail, -(R + 3.3), y, -CHUNK / 2, 0.05, 0.05, CHUNK);
    for (let z = -3; z > -CHUNK; z -= 6) box(chunk, M.rail, -(R + 3.3), 1.2, z, 0.06, 2.4, 0.06);
    // 컨테이너 더미: 3열 × 2더미. 더미 하나 = 박스 하나(텍스처로 컨테이너 여러 단을 표현)
    for (let row = 0; row < 3; row++) {
      for (const z of [-6.3, -18.3]) {
        if (rng() < 0.15) continue; // 빈 칸이 있어야 야적장처럼 보인다
        const n = 1 + ((rng() * 4) | 0);
        box(chunk, stackMat((rng() * 4) | 0, n), -(R + 6 + row * 3.2), 1.3 * n, z, 2.44, 2.6 * n, 12.2);
      }
    }
    // 안벽 크레인: 세 청크(72m)마다
    if (info.index % 3 === 0) {
      const x = R + 10, z = -12, H = 32;
      for (const dx of [-4, 4]) for (const dz of [-5, 5]) box(chunk, M.crane, x + dx, H / 2, z + dz, 0.8, H, 0.8);
      box(chunk, M.crane, x, H * 0.55, z, 9, 0.8, 11);
      box(chunk, M.craneWhite, x + 14, H + 1, z, 50, 1.4, 2.2); // 붐: 바다 쪽으로 길게
      box(chunk, M.craneWhite, x, H + 5, z, 3, 8, 3);
      box(chunk, M.beacon, x + 38, H + 2, z, 0.5, 0.5, 0.5);
      box(chunk, M.beacon, x, H + 9.3, z, 0.5, 0.5, 0.5);
    }
  },

  // 고가도로: 도로는 그대로 두고 주변 지면을 20m 아래로 내려 공중을 달리는 느낌을 낸다
  elevated(chunk, info) {
    const DROP = -20;
    ground(chunk, M.lowLand, { y: DROP });
    box(chunk, M.concrete, 0, -0.9, -CHUNK / 2, R * 2 + 3, 1.6, CHUNK); // 상판
    for (const side of [-1, 1]) {
      box(chunk, M.barrier, side * (R + 1.2), 0.5, -CHUNK / 2, 0.5, 1.1, CHUNK); // 중앙분리대 같은 방호벽
      box(chunk, M.underGlow, side * (R + 1.45), 0.25, -CHUNK / 2, 0.02, 0.06, CHUNK); // 방호벽 아래 LED 라인
    }
    lamp(chunk, -1, -6, 'ledLamp', '#D8E4FF', -(R + 1.2));
    lamp(chunk, 1, -18, 'ledLamp', '#D8E4FF', R + 1.2);
    if (info.index % 2 === 0) box(chunk, M.concrete, 0, DROP / 2 - 1, -12, 5, -DROP - 2, 3); // 교각
    if (rollFeature([['gantry', 0.18]]) === 'gantry') signGantry(chunk, { span: R + 1.2 });
    // 아래로 내려다보이는 도시: 도로에서 떨어진 곳에 건물을 둔다
    for (const side of [-1, 1]) {
      buildingRow(chunk, side, { h: [12, 45], d: [10, 18], gap: [2, 8], setback: 14, base: DROP, set: () => pick([0, 1, 2]) });
    }
  },

  // 한옥 마을: 돌담, 기와지붕, 청사초롱, 소나무
  hanok(chunk) {
    ground(chunk, M.land);
    sidewalks(chunk, M.stonePave);
    streetLamps(chunk);
    for (const side of [-1, 1]) {
      const wx = side * (R + 3.3);
      box(chunk, M.stone, wx, 0.9, -CHUNK / 2, 0.6, 1.8, CHUNK); // 돌담
      // 청사초롱: 담장 위에 8m 간격으로 건다
      for (let z = -4; z > -CHUNK; z -= 8) place(chunk, 'lantern', o => o.position.set(wx, 2.3, z));
      // 한옥: 낮은 몸채 + 넓게 튀어나온 기와지붕
      let cursor = -rand(0, 3);
      while (cursor > -CHUNK + 6) {
        const d = Math.min(rand(9, 13), cursor + CHUNK - 0.5);
        if (d < 6) break;
        const w = rand(7, 10), h = 3.2;
        const x = side * (R + 6 + w / 2), z = cursor - d / 2;
        box(chunk, M.stone, x, 0.4, z, w + 0.6, 0.8, d + 0.6); // 기단
        box(chunk, M.hanokWall, x, 0.8 + h / 2, z, w, h, d); // 몸채
        place(chunk, 'roof', o => {
          o.material = M.tile;
          o.scale.set(w * 1.5, 2.4, d * 1.35); // 처마가 벽보다 한참 밖으로 나와야 한옥처럼 보인다
          o.position.set(x, 0.8 + h + 1.1, z);
        });
        cursor -= d + rand(1.5, 4);
      }
      if (rng() < 0.6) tree(chunk, 'pine', side * rand(R + 20, R + 35), -rand(0, CHUNK), rand(1.2, 1.8));
    }
  },
};

// 출발·결승선: 체커 라인 + 도로를 가로지르는 현수막 갠트리
export function startLine(chunk) {
  plane(chunk, checkerMat, 0, 0.016, -1, R * 2, 2, { flat: true });
  for (const side of [-1, 1]) {
    box(chunk, M.signPost, side * (R + 1), 4.5, -1, 0.5, 9, 0.5);
    box(chunk, M.sodium, side * (R + 1), 9.2, -1, 0.7, 0.4, 0.7);
  }
  plane(chunk, bannerMat, 0, 8, -0.8, R * 2 + 2, 2.2);
}

// 부스터 패드. z는 청크 안의 위치(0 ~ -CHUNK)
export function boostPad(chunk, x, z) {
  plane(chunk, padMat, x, 0.017, z, 2.6, 5, { flat: true });
}

export function releaseChunk(chunk) {
  for (const [poolName, obj] of chunk.items) pools[poolName].release(obj);
  chunk.items.length = 0;
  chunk.anchors.length = 0;
}
