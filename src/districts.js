import * as THREE from 'three';
import { CONFIG } from './config.js';
import { CHUNK } from './course.js';
import { rng } from './rng.js';
import { bent, noCull } from './bend.js';
import {
  facadeTextures, storefrontTexture, containerStackTexture, stoneWallTexture,
  hanokWallTextures, crosswalkTexture, signTexture, billboardTexture,
  dayFacadeTextures, rockTexture, sandTexture,
} from './textures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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


// ════════════════════════════════════════════════════════════════
// 햇살 해안 도시 · 하늘 섬
// ════════════════════════════════════════════════════════════════

const dayFacades = [0, 1, 2, 3, 4, 5, 6].map(dayFacadeTextures);
const rockTex = rockTexture();
const sandTex = sandTexture();
const D = {
  sea: std({ color: '#1E6FA8', roughness: 0.08, metalness: 0.2 }),         // 한낮 바다: 하늘을 비추는 짙은 청록
  sand: std({ map: sandTex, roughness: 1 }),
  grass: std({ color: '#6FA850', roughness: 1 }),
  stoneWalk: std({ color: '#B8B0A2', roughness: 0.9 }),
  rock: std({ map: rockTex, roughness: 0.95 }),
  white: std({ color: '#E6E2D8', roughness: 0.7 }),
  red: std({ color: '#C8372D', roughness: 0.6 }),
  glassRail: std({ color: '#BFE3F2', roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.35 }),
  pole: std({ color: '#E8E8E4', metalness: 0.4, roughness: 0.5 }),
  lampOff: std({ color: '#F4F1EA', roughness: 0.4 }),                      // 낮이라 가로등 머리는 빛나지 않는다
  wood: std({ color: '#8B5A34', roughness: 0.8 }),
  palmTrunk: std({ color: '#9C7A55', roughness: 1 }),
  palmLeaf: std({ color: '#3F8F3A', roughness: 0.8, side: THREE.DoubleSide }),
  olive: std({ color: '#7A9A5A', roughness: 1 }),
  lighthouseTop: glow('#FFE9A8', 2),
  // 하늘 섬
  deck: std({ color: '#CFC8E0', roughness: 0.5 }),
  gold: std({ color: '#E8C25A', metalness: 0.9, roughness: 0.25 }),
  edgeGlow: glow('#7FD8FF', 2.5),
  cloud: std({ color: '#F4F0F8', emissive: '#FFF4F8', emissiveIntensity: 0.12, roughness: 1 }), // 그늘진 면도 너무 어둡지 않게 살짝 발광
  islandRock: std({ color: '#8C7560', roughness: 1, flatShading: true }),
  islandGrass: std({ color: '#7CC86A', roughness: 1, flatShading: true }),
  waterfall: bent(new THREE.MeshBasicMaterial({ color: '#BFE8FF', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })),
  marble: std({ color: '#E4DED2', roughness: 0.35 }),
};
const CRYSTALS = ['#B98CFF', '#7FE3FF', '#FF9FD8'].map(c => std({ color: c, emissive: c, emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.9 }));
const BALLOONS = ['#FF6B6B', '#FFD166', '#6BCB77', '#4D96FF', '#C77DFF'].map(c => std({ color: c, roughness: 0.6 }));
const PARASOLS = ['#E84A5F', '#2A9D8F', '#F4A261', '#FFFFFF', '#3D5A80'].map(c => std({ color: c, roughness: 0.8, side: THREE.DoubleSide }));
const SAILS = std({ color: '#FFFFFF', roughness: 0.9, side: THREE.DoubleSide });

// 야자수: 줄기와 잎을 각각 하나의 지오메트리로 합친다. 잎마다 메시를 두면 나무 한 그루가 드로콜 8회다
const palmGeo = (() => {
  const trunk = new THREE.CylinderGeometry(0.16, 0.28, 7, 7, 6);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 3.5; p.setX(i, p.getX(i) + (y / 7) ** 2 * 0.9); } // 한쪽으로 휜 줄기
  trunk.translate(0, 3.5, 0);
  const leaves = [];
  for (let k = 0; k < 8; k++) {
    const leaf = new THREE.PlaneGeometry(0.9, 3.6, 1, 4);
    const lp = leaf.attributes.position;
    for (let i = 0; i < lp.count; i++) { const y = lp.getY(i) + 1.8; lp.setZ(i, -((y / 3.6) ** 2) * 1.4); } // 끝으로 갈수록 처진다
    leaf.translate(0, 1.8, 0).rotateX(-Math.PI / 2.6).rotateY((k / 8) * Math.PI * 2).translate(0.9, 7, 0);
    leaves.push(leaf);
  }
  return { trunk, leaves: mergeGeometries(leaves) };
})();

// 구름: 구 몇 개를 겹쳐 하나의 지오메트리로
const cloudGeo = (() => {
  const parts = [[0, 0, 0, 3], [2.6, -0.4, 0.5, 2.3], [-2.4, -0.5, -0.3, 2.1], [1, 1.2, -0.6, 2], [-0.8, 0.9, 0.8, 1.8]];
  return mergeGeometries(parts.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 2).translate(x, y, z)));
})();

// 떠 있는 섬: 뒤집힌 바위 원뿔 + 잔디 원판
const islandGeo = {
  rock: new THREE.ConeGeometry(1, 1.6, 7, 3).rotateX(Math.PI).translate(0, -0.8, 0),
  grass: new THREE.CylinderGeometry(1.04, 1, 0.18, 7).translate(0, 0.09, 0),
};

// 무지개: 색 띠 6개를 반원 고리로 만들어 정점 색으로 칠한 뒤 하나로 합친다
const rainbowGeo = (() => {
  const cols = ['#FF5A5A', '#FFA24C', '#FFE45C', '#6BD66B', '#5AB0FF', '#9B7BFF'];
  const rings = cols.map((c, i) => {
    const g = new THREE.RingGeometry(R + 3 + i * 0.55, R + 3.5 + i * 0.55, 48, 1, 0, Math.PI);
    const col = new THREE.Color(c);
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => [col.r, col.g, col.b]).flat(), 3));
    return g;
  });
  return mergeGeometries(rings);
})();
const rainbowMat = bent(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));

Object.assign(pools, {
  dayBuilding: new Pool(() => new THREE.Mesh(unitBox, std({ roughness: 1, metalness: 1 }))),
  palm: new Pool(() => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(palmGeo.trunk, D.palmTrunk), new THREE.Mesh(palmGeo.leaves, D.palmLeaf));
    return g;
  }),
  dayLamp: new Pool(() => makeLamp(D.lampOff)),
  cloud: new Pool(() => new THREE.Mesh(cloudGeo, D.cloud)),
  island: new Pool(() => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(islandGeo.rock, D.islandRock), new THREE.Mesh(islandGeo.grass, D.islandGrass));
    return g;
  }),
  rainbow: new Pool(() => new THREE.Mesh(rainbowGeo, rainbowMat)),
  sphere: new Pool(() => new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), BALLOONS[0])),
  cone: new Pool(() => new THREE.Mesh(new THREE.ConeGeometry(1, 1, 12), D.white)),
  cyl: new Pool(() => new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14), D.white)),
  gem: new Pool(() => new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), CRYSTALS[0])),
});

function shape(chunk, pool, mat, x, y, z, sx, sy, sz, ry = 0) {
  return place(chunk, pool, o => {
    o.material = mat;
    o.scale.set(sx, sy, sz);
    o.position.set(x, y, z);
    o.rotation.set(0, ry, 0);
  });
}

function dayBuilding(chunk, { x, z, w, h, d, v }) {
  return place(chunk, 'dayBuilding', o => {
    const mat = o.material, f = dayFacades[v % dayFacades.length];
    if (mat.userData.v !== v) {
      mat.map = f.map.clone();
      mat.roughnessMap = mat.metalnessMap = f.rmMap.clone();
      mat.userData.v = v;
      mat.needsUpdate = true;
    }
    for (const t of [mat.map, mat.roughnessMap]) t.repeat.set(d / 8, h / 32);
    o.scale.set(w, h, d);
    o.position.set(x, h / 2, z);
  });
}

// 파스텔 건물 줄. 지붕 끝에 흰 처마 띠를 둘러 상자 느낌을 덜어 낸다
function pastelRow(chunk, side, { h, d = [7, 12], gap = [0.2, 1], setback = 3 }) {
  let cursor = -rand(0, 1);
  while (cursor > -CHUNK + 3) {
    const depth = Math.min(rand(...d), cursor + CHUNK - 0.3);
    if (depth < 3) break;
    const width = rand(8, 12), height = rand(...h);
    const x = side * (R + setback + width / 2), z = cursor - depth / 2;
    dayBuilding(chunk, { x, z, w: width, h: height, d: depth, v: (rng() * 7) | 0 });
    box(chunk, D.white, x, height + 0.15, z, width + 0.3, 0.3, depth + 0.3);
    cursor -= depth + rand(...gap);
  }
}

function palm(chunk, x, z, s = 1) {
  place(chunk, 'palm', o => { o.position.set(x, 0, z); o.scale.setScalar(s); o.rotation.y = rng() * Math.PI * 2; });
}

function dayLamps(chunk) {
  for (const [side, z] of [[-1, -6], [1, -18]]) {
    place(chunk, 'dayLamp', o => { o.position.set(side * (R + 0.6), 0, z); o.rotation.y = side > 0 ? Math.PI : 0; });
  }
}

function sea(chunk, x, width, y = -0.6) {
  ground(chunk, D.sea, { x, y, sx: width / 400 });
}

function parasol(chunk, x, z) {
  shape(chunk, 'cyl', D.pole, x, 1.1, z, 0.04, 2.2, 0.04);
  shape(chunk, 'cone', pick(PARASOLS), x, 2.3, z, 1.4, 0.5, 1.4);
}

function boat(chunk, x, z, y = 0) {
  box(chunk, D.white, x, y - 0.2, z, 2.2, 0.9, 6);
  box(chunk, D.wood, x, y + 0.3, z + 0.5, 1.6, 0.2, 3);
  shape(chunk, 'cyl', D.pole, x, y + 3.5, z - 0.5, 0.06, 7, 0.06);
  shape(chunk, 'cone', SAILS, x + 0.05, y + 3.8, z - 0.2, 0.05, 5.5, 1.8); // 얇게 누른 원뿔이 돛처럼 보인다
}

function balloon(chunk) {
  if (rng() > 0.35) return;
  const x = (rng() < 0.5 ? -1 : 1) * rand(30, 90), y = rand(12, 40), z = -rand(0, CHUNK);
  shape(chunk, 'sphere', pick(BALLOONS), x, y, z, 3, 3.6, 3);
  box(chunk, D.wood, x, y - 4.6, z, 1, 0.8, 1);
}

// ── 급커브 경고판 ──
// 곡률이 큰 청크에서 커브 바깥쪽에 화살표 판을 연달아 세운다. 휘어 보이기만 하던 커브를
// "여기서부터 꺾어야 한다"는 신호로 바꿔 준다. 곡률이 +면 도로가 오른쪽으로 휘므로 바깥은 왼쪽이다
const CURVE_SIGN = 0.0011;
function chevronTex(dir, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
  g.fillStyle = fg;
  g.beginPath();
  if (dir > 0) { g.moveTo(34, 14); g.lineTo(94, 64); g.lineTo(34, 114); g.lineTo(54, 114); g.lineTo(112, 64); g.lineTo(54, 14); }
  else { g.moveTo(94, 14); g.lineTo(34, 64); g.lineTo(94, 114); g.lineTo(74, 114); g.lineTo(16, 64); g.lineTo(74, 14); }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const chevronMats = {
  day: [-1, 1].map(d => std({ map: chevronTex(d, '#D62828', '#FFFFFF'), roughness: 0.5 })),
  sky: [-1, 1].map(d => { const t = chevronTex(d, '#1B2A6B', '#7FE8FF'); return std({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 1.4 }); }),
};
function chevrons(chunk, bendX, style = 'day') {
  if (Math.abs(bendX) < CURVE_SIGN) return;
  const outer = bendX > 0 ? -1 : 1;             // 커브 바깥쪽
  const mat = chevronMats[style][bendX > 0 ? 1 : 0]; // 화살표는 도는 방향을 가리킨다
  for (const z of [-4, -12, -20]) {
    const x = outer * (R + 1.4);
    shape(chunk, 'cyl', style === 'sky' ? D.gold : D.pole, x, 0.9, z, 0.06, 1.8, 0.06);
    plane(chunk, mat, x, 1.8, z + 0.05, 1.3, 1.1);
  }
}

// ── 해안 도시 소품 ──
const C = {
  hill: std({ color: '#8FAE78', roughness: 1, flatShading: true }),
  hillFar: std({ color: '#9DB4A0', roughness: 1, flatShading: true }),
  mountain: std({ color: '#A79C88', roughness: 1, flatShading: true }),
  cypress: std({ color: '#2F5A34', roughness: 1 }),
  dome: std({ color: '#2A6FC9', roughness: 0.4, metalness: 0.1 }),
  terracotta: std({ color: '#C0643E', roughness: 0.8 }),
  flower: ['#E0457B', '#C43C9A', '#F07BAA'].map(c => std({ color: c, roughness: 0.9 })),
  foam: bent(new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.7, depthWrite: false })),
  buoy: std({ color: '#F25C2A', roughness: 0.6 }),
  hull: ['#2F6DB5', '#C8372D', '#2E8B57', '#F2C230'].map(c => std({ color: c, roughness: 0.6 })),
};
Object.assign(pools, {
  dome: new Pool(() => new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), C.dome)),
  ridge: new Pool(() => new THREE.Mesh(new THREE.ConeGeometry(1, 1, 6, 1), C.hill)),
});

function cypress(chunk, x, z, s = 1, y = 0) {
  shape(chunk, 'cone', C.cypress, x, y + 3.2 * s, z, 0.9 * s, 6.5 * s, 0.9 * s);
}

// 먼 산·언덕 능선. 안개에 묻혀 흐릿하게 보여 풍경에 깊이를 준다
function farHills(chunk, side, n = 1) {
  for (let i = 0; i < n; i++) {
    if (rng() > 0.7) continue;
    const far = rng() < 0.5;
    const x = side * rand(far ? 190 : 110, far ? 280 : 170);
    const w = rand(50, 110), h = rand(far ? 40 : 18, far ? 80 : 40);
    shape(chunk, 'ridge', far ? C.mountain : C.hillFar, x, h / 2 - 2, -rand(0, CHUNK), w, h, w * 0.7, rng() * 3);
  }
}

// 언덕을 따라 층층이 올라간 마을: 흰 집과 가끔 파란 돔
function hillTown(chunk, side, { from = 18, to = 60, n = 5, rise = 0.35 } = {}) {
  for (let i = 0; i < n; i++) {
    const dist = rand(from, to), base = (dist - from) * rise;
    const x = side * (R + dist), z = -rand(0, CHUNK), w = rand(4, 7), h = rand(3, 6), d = rand(4, 7);
    // 언덕 흙 받침 + 집
    box(chunk, C.hill, x, base / 2 - 0.5, z, w + 3, base + 1, d + 3);
    const v = (rng() * 7) | 0;
    if (rng() < 0.55) box(chunk, D.white, x, base + h / 2, z, w, h, d);
    else dayBuilding(chunk, { x, z, w, h, d, v }).position.y = base + h / 2;
    if (rng() < 0.25) shape(chunk, 'dome', C.dome, x, base + h, z, w * 0.35, w * 0.35, w * 0.35);
    else if (rng() < 0.4) shape(chunk, 'cone', C.terracotta, x, base + h + 0.7, z, w * 0.8, 1.4, d * 0.8, Math.PI / 4);
    if (rng() < 0.5) cypress(chunk, x + side * rand(3, 5), z + rand(-3, 3), rand(0.8, 1.2));
  }
}

function flowers(chunk, x, z) {
  shape(chunk, 'sphere', pick(C.flower), x, 0.8, z, rand(0.8, 1.3), rand(0.6, 0.9), rand(0.8, 1.3));
}

function fishingBoat(chunk, x, z) {
  box(chunk, pick(C.hull), x, -0.5, z, 1.8, 0.9, 5);
  box(chunk, D.white, x, 0.35, z + 0.6, 1.2, 0.9, 1.6);
}

// ── 햇살 해안 도시 ──
Object.assign(builders, {
  beach(chunk, info) {
    // 왼쪽: 모래사장과 바다, 오른쪽: 파스텔 건물과 그 뒤 언덕 마을
    sea(chunk, -200 - R - 24, 400);
    ground(chunk, C.hill, { x: 200 + R, sx: 1 });
    box(chunk, D.sand, -(R + 13.5), -0.3, -CHUNK / 2, 21, 0.6, CHUNK);
    sidewalks(chunk, D.stoneWalk);
    dayLamps(chunk);
    chevrons(chunk, info.bend);
    for (let i = 0; i < 3; i++) parasol(chunk, -rand(R + 7, R + 21), -rand(2, CHUNK - 2));
    for (let z = -4; z > -CHUNK; z -= 8) palm(chunk, -(R + 4), z + rand(-1, 1), rand(0.9, 1.2));
    plane(chunk, C.foam, -(R + 24.5), -0.55, -CHUNK / 2, 1.2, CHUNK, { flat: true }); // 물가에 밀려오는 파도 거품
    if (rng() < 0.5) boat(chunk, -rand(R + 45, R + 90), -rand(4, 20), -0.4); // 먼바다 요트
    pastelRow(chunk, 1, { h: [6, 12], setback: 4 });
    for (let z = -3; z > -CHUNK; z -= 12) flowers(chunk, R + 3.4, z);
    hillTown(chunk, 1, { from: 20, to: 55, n: 3 });
    farHills(chunk, 1, 2);
    balloon(chunk);
  },

  harbor(chunk, info) {
    // 왼쪽: 파스텔 마을(언덕으로 이어짐), 오른쪽: 안벽과 요트·어선이 떠 있는 항구
    sidewalks(chunk, D.stoneWalk);
    dayLamps(chunk);
    chevrons(chunk, info.bend);
    pastelRow(chunk, -1, { h: [9, 18] });
    for (let z = -5; z > -CHUNK; z -= 10) flowers(chunk, -(R + 3.4), z);
    ground(chunk, C.hill, { x: -200 - R, sx: 1 });
    hillTown(chunk, -1, { from: 22, to: 70, n: 4, rise: 0.4 });
    box(chunk, D.stoneWalk, R + 6, -0.9, -CHUNK / 2, 6, 1.8, CHUNK); // 안벽
    sea(chunk, 200 + R + 9, 400, -1.2);
    if (info.index % 2 === 0) boat(chunk, R + 13, -8);
    if (rng() < 0.7) boat(chunk, R + 20, -18);
    if (rng() < 0.7) fishingBoat(chunk, R + rand(12, 30), -rand(2, CHUNK - 2));
    if (rng() < 0.5) shape(chunk, 'sphere', C.buoy, R + rand(14, 40), -1.1, -rand(0, CHUNK), 0.4, 0.4, 0.4);
    if (rng() < 0.4) shape(chunk, 'cone', C.hillFar, rand(140, 240), -1.2, -rand(0, CHUNK), rand(40, 80), rand(20, 40), rand(30, 60)); // 만 건너편 곶
    balloon(chunk);
  },

  cliff(chunk, info) {
    // 왼쪽: 깎아지른 바위 절벽(위에 흰 집), 오른쪽: 난간 너머 한참 아래 바다
    box(chunk, D.stoneWalk, 0, -0.75, -CHUNK / 2, R * 2 + 4, 1.3, CHUNK);
    chevrons(chunk, info.bend);
    for (let z = -2; z > -CHUNK; z -= 5) {
      const h = rand(16, 40), x = -(R + 3 + rand(0, 3));
      box(chunk, D.rock, x, h / 2 - 1, z, rand(4, 8), h, rand(5, 7));
      if (rng() < 0.2) { // 절벽 위 흰 집과 파란 돔
        box(chunk, D.white, x - 4, h + 1.5, z, 5, 4, 5);
        shape(chunk, 'dome', C.dome, x - 4, h + 3.5, z, 1.8, 1.8, 1.8);
      } else if (rng() < 0.3) cypress(chunk, x - 2, z, 1.2, h - 1); // 절벽 위 사이프러스
    }
    ground(chunk, C.hill, { x: -200 - R - 6, y: 20, sx: 1 });
    box(chunk, D.white, R + 1.8, 0.3, -CHUNK / 2, 0.35, 0.6, CHUNK); // 흰 방호벽(낮게 두어 바다 쪽 시야를 튼다)
    box(chunk, D.rock, R + 6, -18, -CHUNK / 2, 6, 34, CHUNK);       // 도로를 받치는 절벽 면
    // 먼바다 바위섬과 그 위 흰 마을: 오른쪽이 하늘만 보이지 않게 수평선 가까이를 채운다
    if (rng() < 0.6) {
      const x = rand(70, 160), z = -rand(0, CHUNK), w = rand(25, 50), h = rand(20, 45);
      shape(chunk, 'ridge', D.rock, x, -34 + h / 2, z, w, h, w * 0.8, rng() * 3);
      for (let k = 0; k < 3; k++) box(chunk, D.white, x + rand(-w / 5, w / 5), -34 + h * 0.75 + k, z + rand(-w / 5, w / 5), rand(3, 5), rand(2.5, 4), rand(3, 5));
    }
    for (let z = -4; z > -CHUNK; z -= 9) box(chunk, D.rock, R + rand(10, 16), -30, z, rand(4, 8), rand(6, 12), rand(4, 8)); // 바다에 선 바위
    plane(chunk, C.foam, R + 12, -33.8, -CHUNK / 2, 8, CHUNK, { flat: true });
    sea(chunk, 200 + R, 400, -34);
    if (rng() < 0.5) shape(chunk, 'cone', C.hillFar, rand(110, 220), -34, -rand(0, CHUNK), rand(30, 60), rand(25, 45), rand(30, 60)); // 먼 섬
    if (rng() < 0.4) boat(chunk, rand(60, 120), -rand(4, 20), -34); // 저 아래 바다의 요트
    balloon(chunk);
  },

  cape(chunk, info) {
    // 잔디 언덕, 돌담, 올리브·사이프러스, 풍차, 가끔 등대
    ground(chunk, D.grass);
    sidewalks(chunk, D.stoneWalk);
    dayLamps(chunk);
    chevrons(chunk, info.bend);
    for (const side of [-1, 1]) {
      box(chunk, D.stoneWalk, side * (R + 3.4), 0.5, -CHUNK / 2, 0.7, 1, CHUNK);
      for (let i = 0; i < 3; i++) {
        const x = side * rand(R + 8, R + 40), z = -rand(0, CHUNK), s = rand(1.4, 2.2);
        shape(chunk, 'cyl', D.wood, x, s * 0.8, z, 0.15 * s, s * 1.6, 0.15 * s);
        shape(chunk, 'sphere', D.olive, x, s * 2, z, s * 1.2, s * 0.9, s * 1.2);
      }
      for (let i = 0; i < 2; i++) cypress(chunk, side * rand(R + 6, R + 30), -rand(0, CHUNK), rand(0.9, 1.4));
      farHills(chunk, side, 1);
    }
    if (info.index % 5 === 1) { // 풍차: 흰 원통 + 원뿔 지붕 + 날개
      const x = R + rand(16, 26), z = -12;
      shape(chunk, 'cyl', D.white, x, 3.5, z, 2, 7, 2);
      shape(chunk, 'cone', C.terracotta, x, 8, z, 2.3, 2, 2.3);
      for (let k = 0; k < 4; k++) box(chunk, D.wood, x - 2.2, 7, z, 0.2, 7, 0.8).rotation.set(0, 0, k * Math.PI / 2 + 0.3);
    }
    if (info.index % 8 === 2) {
      // 등대: 흰·빨강 줄무늬 탑 + 빛나는 등실
      const x = -(R + 18), z = -12;
      for (let k = 0; k < 5; k++) shape(chunk, 'cyl', k % 2 ? D.red : D.white, x, 1.6 + k * 3.2, z, 2.2 - k * 0.15, 3.2, 2.2 - k * 0.15);
      shape(chunk, 'cyl', D.lighthouseTop, x, 18, z, 1.2, 2, 1.2);
      shape(chunk, 'cone', D.red, x, 19.8, z, 1.6, 1.6, 1.6);
    }
    sea(chunk, -200 - R - 45, 400, -3);
    balloon(chunk);
  },

  palm(chunk, info) {
    // 야자수가 촘촘한 대로, 꽃 화단, 흰 리조트 건물과 그 뒤 언덕
    ground(chunk, D.grass);
    sidewalks(chunk, D.stoneWalk);
    dayLamps(chunk);
    chevrons(chunk, info.bend);
    for (const side of [-1, 1]) {
      for (let z = -3; z > -CHUNK; z -= 6) palm(chunk, side * (R + 2.3), z, rand(0.95, 1.25));
      for (let z = -6; z > -CHUNK; z -= 12) flowers(chunk, side * (R + 4.6), z);
      let cursor = -rand(0, 3);
      while (cursor > -CHUNK + 6) {
        const d = Math.min(rand(10, 16), cursor + CHUNK - 0.5), w = rand(10, 16), h = rand(10, 28);
        const x = side * (R + 8 + w / 2), z = cursor - d / 2;
        dayBuilding(chunk, { x, z, w, h, d, v: 3 }); // 흰 외벽에 창문·덧창이 있는 리조트
        // 발코니: 층마다 상자를 두면 건물 하나가 드로콜 수 회라, 전 층을 덮는 유리 난간 띠 하나로 표현한다
        box(chunk, D.glassRail, x - side * (w / 2 + 0.4), h / 2, z, 0.8, h - 2, d * 0.9);
        box(chunk, pick(PARASOLS), x, h + 0.4, z, w * 0.5, 0.2, d * 0.5); // 옥상 차양
        cursor -= d + rand(3, 6);
      }
      farHills(chunk, side, 1);
    }
  },
});

// ── 하늘 섬 ──
// 땅이 없다. 도로는 구름 위에 떠 있는 대리석 상판이고, 가장자리에 빛나는 난간이 있다
function skyDeck(chunk) {
  box(chunk, D.deck, 0, -0.9, -CHUNK / 2, R * 2 + 2, 1.6, CHUNK);
  box(chunk, D.gold, 0, -1.75, -CHUNK / 2, R * 2 + 1, 0.2, CHUNK);
  for (const side of [-1, 1]) {
    box(chunk, D.edgeGlow, side * (R + 0.7), 0.55, -CHUNK / 2, 0.12, 0.12, CHUNK);
    for (let z = -3; z > -CHUNK; z -= 6) box(chunk, D.gold, side * (R + 0.7), 0.28, z, 0.14, 0.56, 0.14);
  }
}

function clouds(chunk, n, { below = true } = {}) {
  for (let i = 0; i < n; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = side * rand(R + 10, 120), y = below ? rand(-40, -8) : rand(-20, 25), z = -rand(0, CHUNK);
    shape(chunk, 'cloud', D.cloud, x, y, z, rand(1.5, 4), rand(1, 2.2), rand(1.5, 3), rng() * 6);
  }
}

// 도로 아래 깔린 구름바다: 납작하고 큰 구름을 촘촘히 깔아 발밑이 허공이 아니라 구름 위라는 느낌을 준다
function cloudSea(chunk) {
  for (let i = 0; i < 4; i++) {
    const x = (rng() * 2 - 1) * 90, z = -rand(0, CHUNK);
    shape(chunk, 'cloud', D.cloud, x, rand(-34, -24), z, rand(7, 12), rand(1.5, 2.5), rand(5, 8), rng() * 6);
  }
}

function island(chunk, x, y, z, s) {
  place(chunk, 'island', o => { o.position.set(x, y, z); o.scale.set(s, s * rand(0.8, 1.4), s); o.rotation.set(0, rng() * 6, 0); });
  return { x, y, z, s };
}

const S = {
  castle: std({ color: '#EDE6F5', roughness: 0.6 }),
  roof: std({ color: '#6D5ACF', roughness: 0.5 }),
  ring: glow('#FFD66B', 2.2),
  ringCyan: glow('#7FE8FF', 2.2),
  sparkle: glow('#FFF6D0', 3),
};
// 반짝이는 빛 입자 무리: 작은 구 스무 개를 하나로 합쳐 드로콜 한 번에 그린다
const sparkleGeo = mergeGeometries(Array.from({ length: 20 }, () =>
  new THREE.IcosahedronGeometry(0.12 + Math.random() * 0.12, 0).translate((Math.random() * 2 - 1) * 14, Math.random() * 10, (Math.random() * 2 - 1) * 12)));
Object.assign(pools, {
  ringGate: new Pool(() => new THREE.Mesh(new THREE.TorusGeometry(R + 2.5, 0.35, 10, 48), S.ring)),
  sparkles: new Pool(() => new THREE.Mesh(sparkleGeo, S.sparkle)),
});

// 성이 올라앉은 거대한 떠 있는 섬(원경 랜드마크)과 긴 폭포
function castleIsland(chunk, side) {
  const s = rand(18, 34), x = side * rand(80, 180), y = rand(-10, 25), z = -rand(0, CHUNK);
  island(chunk, x, y, z, s);
  const top = y + 0.2 * (s / 10);
  for (const [dx, dz, h] of [[0, 0, 14], [-5, 3, 9], [5, -3, 10], [4, 5, 7]]) {
    const tx = x + dx * s / 20, tz = z + dz * s / 20, th = h * s / 22;
    shape(chunk, 'cyl', S.castle, tx, top + th / 2, tz, s * 0.06, th, s * 0.06);
    shape(chunk, 'cone', S.roof, tx, top + th + s * 0.06, tz, s * 0.085, s * 0.14, s * 0.085);
  }
  plane(chunk, D.waterfall, x - side * s * 0.95, y - 30, z, s * 0.25, 60, { facing: side * Math.PI / 2 });
}

Object.assign(builders, {
  clouds(chunk, info) {
    skyDeck(chunk);
    chevrons(chunk, info.bend, 'sky');
    cloudSea(chunk);
    clouds(chunk, 4);
    clouds(chunk, 3, { below: false });
    if (info.index % 3 === 0) place(chunk, 'ringGate', o => { o.material = info.index % 2 ? S.ring : S.ringCyan; o.position.set(0, 0, -12); }); // 빛의 고리 게이트
    if (rng() < 0.5) castleIsland(chunk, rng() < 0.5 ? -1 : 1);
    place(chunk, 'sparkles', o => o.position.set(0, 2, -12));
    balloon(chunk);
  },

  islands(chunk, info) {
    skyDeck(chunk);
    chevrons(chunk, info.bend, 'sky');
    cloudSea(chunk);
    clouds(chunk, 2);
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        if (rng() > 0.75) continue;
        const is = island(chunk, side * rand(R + 12, R + 55), rand(-8, 14), -rand(3, CHUNK - 3), rand(5, 11));
        // 섬 가장자리에서 떨어지는 폭포
        if (rng() < 0.6) plane(chunk, D.waterfall, is.x - side * is.s * 0.9, is.y - 14, is.z, is.s * 0.45, 28, { facing: side * Math.PI / 2 });
        for (let t = 0; t < 1; t++) { // 섬 위 나무(드로콜을 아끼려고 섬당 한 그루)
          const tx = is.x + rand(-0.4, 0.4) * is.s, tz = is.z + rand(-0.4, 0.4) * is.s;
          shape(chunk, 'cyl', D.wood, tx, is.y + 1.2, tz, 0.25, 2.4, 0.25);
          shape(chunk, 'sphere', D.islandGrass, tx, is.y + 3, tz, 1.6, 1.4, 1.6);
        }
      }
    }
    if (rng() < 0.6) castleIsland(chunk, rng() < 0.5 ? -1 : 1);
    place(chunk, 'sparkles', o => o.position.set(0, 2, -12));
    balloon(chunk);
  },

  crystal(chunk, info) {
    skyDeck(chunk);
    chevrons(chunk, info.bend, 'sky');
    cloudSea(chunk);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const x = side * rand(R + 5, R + 26), z = -rand(2, CHUNK - 2), h = rand(6, 18);
        island(chunk, x, -2, z, rand(3, 5));
        // 큰 수정 하나에 작은 수정 둘이 기울어 붙은 무더기
        const mat = pick(CRYSTALS);
        shape(chunk, 'gem', mat, x, h / 2 - 1, z, h * 0.22, h / 2, h * 0.22, rng() * 3);
        for (const d of [-1, 1]) {
          const g = shape(chunk, 'gem', mat, x + d * h * 0.18, h * 0.2, z + rand(-1, 1), h * 0.1, h * 0.25, h * 0.1, rng() * 3);
          g.rotation.z = d * 0.4;
        }
      }
      if (rng() < 0.4) { // 멀리 떠 있는 거대 수정
        const h = rand(30, 60);
        shape(chunk, 'gem', pick(CRYSTALS), side * rand(60, 140), rand(0, 20), -rand(0, CHUNK), h * 0.2, h / 2, h * 0.2, rng() * 3);
      }
    }
    if (info.index % 4 === 0) { // 도로를 넘는 수정 아치
      for (const side of [-1, 1]) {
        const g = shape(chunk, 'gem', pick(CRYSTALS), side * (R + 2), 6, -12, 1.2, 8, 1.2);
        g.rotation.z = -side * 0.5;
      }
    }
    place(chunk, 'sparkles', o => o.position.set(0, 2, -12));
  },

  rainbow(chunk, info) {
    skyDeck(chunk);
    chevrons(chunk, info.bend, 'sky');
    cloudSea(chunk);
    clouds(chunk, 4);
    clouds(chunk, 2, { below: false });
    if (info.index % 2 === 0) place(chunk, 'rainbow', o => o.position.set(0, -1, -12)); // 48m마다 무지개 아치를 지난다
    if (rng() < 0.5) castleIsland(chunk, rng() < 0.5 ? -1 : 1);
    place(chunk, 'sparkles', o => o.position.set(0, 2, -12));
    balloon(chunk);
    balloon(chunk);
  },

  temple(chunk, info) {
    skyDeck(chunk);
    chevrons(chunk, info.bend, 'sky');
    cloudSea(chunk);
    clouds(chunk, 2);
    for (const side of [-1, 1]) {
      for (let z = -3; z > -CHUNK; z -= 8) {
        const x = side * (R + 3);
        shape(chunk, 'cyl', D.marble, x, 4.5, z, 0.55, 9, 0.55);
        shape(chunk, 'cyl', D.gold, x, 9.1, z, 0.75, 0.3, 0.75);
      }
      box(chunk, D.marble, side * (R + 3), 9.6, -CHUNK / 2, 1.6, 0.7, CHUNK); // 기둥 위 들보
      for (let k = 0; k < 2; k++) { // 떠다니는 부서진 기둥과 돌 조각
        const x = side * rand(R + 12, R + 36), y = rand(2, 16), z = -rand(0, CHUNK);
        const c = shape(chunk, 'cyl', D.marble, x, y, z, 0.8, rand(2, 5), 0.8);
        c.rotation.set(rng(), 0, rng());
      }
      if (rng() < 0.35) { // 먼 곳의 원형 신전 랜드마크
        const x = side * rand(70, 130), y = rand(-5, 15), z = -rand(0, CHUNK);
        island(chunk, x, y - 1, z, 16);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          shape(chunk, 'cyl', D.marble, x + Math.cos(a) * 8, y + 5, z + Math.sin(a) * 8, 0.7, 10, 0.7);
        }
        shape(chunk, 'dome', D.gold, x, y + 10, z, 9.5, 5, 9.5);
      }
    }
    if (info.index % 3 === 0) box(chunk, D.marble, 0, 10.4, -12, R * 2 + 8, 1, 2.5); // 도로를 가로지르는 신전 문 상인방
    place(chunk, 'sparkles', o => o.position.set(0, 2, -12));
  },
});

// 아이템 박스: 무지개빛 테두리에 "?"가 그려진 반투명 상자. 네 차선에 한 줄로 놓는다
const itemBoxMat = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 128, 128);
  ['#FF5A5A', '#FFD23F', '#5AE08A', '#5AB0FF', '#C77DFF'].forEach((col, i, a) => grad.addColorStop(i / (a.length - 1), col));
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(20,20,40,.55)'; g.fillRect(12, 12, 104, 104);
  g.fillStyle = '#FFFFFF'; g.font = 'bold 88px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('?', 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return std({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 1.1, transparent: true, opacity: 0.92 });
})();
pools.itemBox = new Pool(() => new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), itemBoxMat));

export function itemBoxRow(chunk, z) {
  for (const x of CONFIG.lanes) {
    const o = place(chunk, 'itemBox', b => { b.position.set(x, 1.1, z); b.rotation.set(0.6, 0, 0.6); });
    (chunk.spinners ??= []).push(o); // world.js가 매 프레임 돌린다
  }
}

export function releaseChunk(chunk) {
  if (chunk.spinners) chunk.spinners.length = 0;
  for (const [poolName, obj] of chunk.items) pools[poolName].release(obj);
  chunk.items.length = 0;
  chunk.anchors.length = 0;
}
