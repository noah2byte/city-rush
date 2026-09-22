import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bent, noCull } from './bend.js';
import { modelOptions, PLAYER_MODEL } from './carModels.js';

// 모든 차를 같은 크기로 맞춘다. 모델마다 단위(m·cm)와 비율이 달라도 차선 폭(3m)과 충돌 판정이 일정해야 하기 때문이다
const TARGET_LENGTH = 4.3;
const MAX_WIDTH = 2.05;

const templates = new Map(); // 모델 이름 → { group, opts }

// 차 밑 그림자: 실제 그림자 맵 대신 흐린 타원 판을 깐다. 차 8대를 그림자 맵에 한 번 더 그리는 비용을 피하면서도
// 낮 맵에서 차가 땅에 붙어 보이게 해 준다
const shadowMat = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.6, 'rgba(0,0,0,.6)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return bent(new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.5 }));
})();
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
export function setShadowOpacity(o) { shadowMat.opacity = o; }
export const carDims = { halfW: 1, halfL: 2 }; // 모든 모델 중 가장 큰 값. 판정을 모델마다 다르게 하지 않아 로직이 단순하다

// meshopt로 양자화된 속성(Int16 정규화 등)은 변환 행렬을 곱하면 범위를 넘어 잘린다.
// 병합 전에 Float32로 풀어준다
function toFloat(attr) {
  const out = new Float32Array(attr.count * attr.itemSize);
  const get = ['getX', 'getY', 'getZ', 'getW'];
  for (let i = 0; i < attr.count; i++) {
    for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr[get[k]](i);
  }
  return new THREE.BufferAttribute(out, attr.itemSize);
}

// 부품별 메시를 같은 재질끼리 하나로 합친다. 원본은 차 한 대가 드로콜 수십~수백 회라 여러 대를 그리면 CPU 병목이 된다
function mergeByMaterial(root, hidden) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return;
    if (hidden && hidden.test(o.material.name)) return;
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'uv1']) {
      if (o.geometry.attributes[name]) g.setAttribute(name, toFloat(o.geometry.attributes[name]));
    }
    if (o.geometry.index) g.setIndex(Array.from(o.geometry.index.array));
    if (o.isSkinnedMesh) {
      // 뼈대로 움직이는 모델(문이 열리는 차 등)은 정점 좌표만 보면 뼈대 변형 전의 위치라, 부품이 엉뚱한 곳에 박힌다.
      // 현재 자세의 뼈대 변형을 정점에 구워 넣은 뒤 합친다. 법선은 변형 후 다시 계산한다
      o.skeleton.update();
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    } else {
      g.applyMatrix4(o.matrixWorld); // 원본 노드의 크기·회전(예: 0.0001배, 90° 회전)을 정점에 구워 넣는다
    }
    if (!groups.has(o.material)) groups.set(o.material, []);
    groups.get(o.material).push(g);
  });

  const merged = new THREE.Group();
  for (const [material, geos] of groups) {
    // 병합하려면 속성 구성이 같아야 하므로 그룹 안에서 공통 속성만 남긴다
    const common = ['position', 'normal', 'uv', 'uv1'].filter(n => geos.every(g => g.attributes[n]));
    for (const g of geos) for (const n of Object.keys(g.attributes)) if (!common.includes(n)) g.deleteAttribute(n);
    const allIndexed = geos.every(g => g.index);
    const geo = mergeGeometries(allIndexed ? geos : geos.map(g => (g.index ? g.toNonIndexed() : g)));
    if (!common.includes('normal')) geo.computeVertexNormals();
    merged.add(new THREE.Mesh(geo, material));
  }
  return merged;
}

function tuneMaterials(root, lights) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const m = bent(o.material); // 차도 멀리 있을수록 도로 곡선을 따라 휘어야 도로 위에 붙어 보인다
    // 투과(transmission) 재질이 하나라도 있으면 매 프레임 장면 전체를 한 번 더 렌더링한다.
    // 차창에는 과한 비용이라 일반 반투명으로 바꾼다
    if (m.transmission > 0) {
      m.transmission = 0;
      m.transparent = true;
      m.opacity = 0.35;
      m.color.set('#0B0F14');
    }
    if (m.iridescence) m.iridescence = 0;
    if (m.sheen) m.sheen = 0; // 천 재질 광택. 비용 대비 차이가 보이지 않는다
    // 블룸 임계값을 넘겨야 빛 번짐이 생기므로 등화류 발광 세기를 올린다
    if (lights.brake.test(m.name)) { m.emissive = new THREE.Color('#FF1010'); m.emissiveIntensity = 6; }
    if (lights.head.test(m.name)) { m.emissive = new THREE.Color('#FFF1D6'); m.emissiveIntensity = 8; }
  });
}

// 불러온 차 모델을 게임 좌표계에 맞춘다: 바닥에 붙이고, 중심을 원점에, 앞을 -z로, 크기를 표준 차 크기로
export function prepareCarTemplate(name, gltf) {
  const opts = modelOptions(name);
  tuneMaterials(gltf.scene, opts.lights);
  const body = mergeByMaterial(gltf.scene, opts.hidden);

  const box = new THREE.Box3().setFromObject(body);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  body.position.set(-center.x, -box.min.y, -center.z);

  // 방향: 차는 길이 방향이 가장 길다. 옆으로 누워 있으면(x가 더 길면) 90° 돌린다.
  // 앞뒤는 전조등이 있는 쪽을 앞으로 본다. 전조등 재질이 없으면 glTF 관례(+z가 앞)를 따른다
  const sideways = size.x > size.z;
  let yaw;
  if (opts.rotate != null) {
    yaw = THREE.MathUtils.degToRad(opts.rotate);
  } else {
    const head = body.children.find(m => opts.lights.head.test(m.material.name));
    const c = head ? new THREE.Box3().setFromObject(head).getCenter(new THREE.Vector3()).sub(center) : null;
    const front = c ? Math.sign(sideways ? c.x : c.z) || 1 : 1;
    // y축 회전으로 앞쪽을 -z에 맞춘다. (+z가 앞 → 180°, +x가 앞 → +90°, -x가 앞 → -90°)
    yaw = sideways ? (front > 0 ? Math.PI / 2 : -Math.PI / 2) : (front > 0 ? Math.PI : 0);
  }

  const pivot = new THREE.Group();
  pivot.add(body);
  pivot.rotation.y = yaw;

  const len = sideways ? size.x : size.z;
  const wid = sideways ? size.z : size.x;
  const s = Math.min(TARGET_LENGTH / len, MAX_WIDTH / wid);
  const group = new THREE.Group();
  group.add(pivot);
  group.scale.setScalar(s);

  carDims.halfW = Math.max(templates.size ? carDims.halfW : 0, (wid * s) / 2);
  carDims.halfL = Math.max(templates.size ? carDims.halfL : 0, (len * s) / 2);
  templates.set(name, { group, opts });
}

// 플레이어 차가 맨 앞, 나머지는 이름순. 라이벌에게 모델을 나눠 줄 때 순서가 일정해야 한다
export function modelNames() {
  return [...templates.keys()].sort((a, b) => (a === PLAYER_MODEL ? -1 : b === PLAYER_MODEL ? 1 : a.localeCompare(b)));
}

export function labelOf(name) {
  return templates.get(name)?.opts.label ?? [name, ''];
}

export function canPaint(name) {
  return !!templates.get(name)?.opts.paint;
}

export function swatchOf(name, color) {
  return canPaint(name) ? color : templates.get(name)?.opts.swatch;
}

export function credits() {
  // 같은 작가의 모델이 여러 대면 표기를 한 번만 한다
  return [...new Set(modelNames().map(n => templates.get(n).opts.credit).filter(Boolean))];
}

// 도색 재질만 색별로 복제해 캐시한다. 나머지 재질·지오메트리는 모든 차가 공유해 메모리를 아낀다
const paintCache = new Map();
function paint(material, color) {
  const key = `${material.uuid}:${color}`;
  if (!paintCache.has(key)) {
    const m = bent(material.clone()); // clone은 셰이더 패치를 복사하지 않으므로 다시 건다
    m.color.set(color);
    paintCache.set(key, m);
  }
  return paintCache.get(key);
}

export function createCar(color, name = PLAYER_MODEL) {
  const t = templates.get(name) ?? templates.get(modelNames()[0]);
  const car = noCull(t.group.clone());
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.scale.set(carDims.halfW * 2.6, 1, carDims.halfL * 2.3);
  shadow.position.y = 0.03;
  shadow.renderOrder = -1; // 도로 위, 차 아래에 먼저 그려지게
  car.add(noCull(shadow));
  if (t.opts.paint) {
    car.traverse(o => {
      if (o.isMesh && t.opts.paint.test(o.material.name)) o.material = paint(o.material, color);
    });
  }
  return car;
}

// 플레이어 차에만 실제 광원을 단다. 모든 차에 달면 광원 수만큼 셰이더 비용이 늘기 때문이다
export function addHeadlight(car) {
  // 레이스에서는 바로 앞에 라이벌 차가 붙어 달려서, 세면 앞차가 하얗게 날아간다
  const spot = new THREE.SpotLight('#FFF1D6', 30, 60, 0.32, 0.6, 1.2);
  spot.position.set(0, 0.8, -carDims.halfL);
  spot.target.position.set(0, 0, -18);
  car.add(spot, spot.target);
}
