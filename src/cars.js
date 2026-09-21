import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { bent, noCull } from './bend.js';

let template = null;
export const carDims = { halfW: 1, halfL: 2 }; // 모델을 불러온 뒤 실제 크기로 채운다

// 뒤에서 보는 시점이라 보이지 않는 실내·하부 부품. 그리지 않을 재질 이름
const HIDDEN = /^(Interior|Floormat|Dashboard|Mechanical|Panel Sides)/;

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

// 원본은 부품별로 메시가 97개라 차 한 대가 드로콜 97회다. 차 10여 대면 천 회를 넘어 CPU 병목이 된다.
// 같은 재질끼리 하나로 합쳐 차 한 대를 20회 이하로 줄인다
function mergeByMaterial(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse(o => {
    if (!o.isMesh || HIDDEN.test(o.material.name)) return;
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'uv1']) {
      if (o.geometry.attributes[name]) g.setAttribute(name, toFloat(o.geometry.attributes[name]));
    }
    if (o.geometry.index) g.setIndex(Array.from(o.geometry.index.array));
    g.applyMatrix4(o.matrixWorld);
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
    merged.add(new THREE.Mesh(geo, material));
  }
  return merged;
}

function tuneMaterials(root) {
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
    // 블룸 임계값을 넘겨야 빛 번짐이 생기므로 등화류 발광 세기를 올린다
    if (m.name === 'Brakelight') { m.emissive = new THREE.Color('#FF1010'); m.emissiveIntensity = 6; }
    if (m.name === 'Headlight') { m.emissive = new THREE.Color('#FFF1D6'); m.emissiveIntensity = 8; }
  });
}

// 불러온 차 모델을 게임 좌표계에 맞춘다: 바닥에 붙이고, 중심을 원점에, 앞을 -z로
export function prepareCarTemplate(gltf) {
  const src = gltf.scene;
  tuneMaterials(src);

  const box = new THREE.Box3().setFromObject(src);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  // 모델마다 앞 방향이 제각각이라, 전조등 위치로 앞쪽을 판별해 자동으로 돌린다
  let frontIsPlusZ = false;
  src.traverse(o => {
    if (o.isMesh && o.material.name === 'Headlight') {
      frontIsPlusZ = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).z > center.z;
    }
  });

  const body = mergeByMaterial(src);
  body.position.set(-center.x, -box.min.y, -center.z);

  const pivot = new THREE.Group();
  pivot.add(body);
  if (frontIsPlusZ) pivot.rotation.y = Math.PI;

  template = new THREE.Group();
  template.add(pivot);
  template.scale.setScalar(CONFIG.car.scale);

  carDims.halfW = (size.x * CONFIG.car.scale) / 2;
  carDims.halfL = (size.z * CONFIG.car.scale) / 2;
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

export function recolor(car, color) {
  car.traverse(o => {
    if (o.isMesh && o.userData.basePaint) o.material = paint(o.userData.basePaint, color);
  });
}

export function createCar(color) {
  const car = noCull(template.clone());
  car.traverse(o => {
    if (o.isMesh && o.material.name.startsWith('Paint')) o.userData.basePaint = o.material;
  });
  recolor(car, color);
  return car;
}

// 플레이어 차에만 실제 광원을 단다. 모든 차에 달면 광원 수만큼 셰이더 비용이 늘기 때문이다
export function addHeadlight(car) {
  // 빔을 도로 폭 안으로 좁히고 아래로 숙인다. 넓으면 난간·건물 벽에 빛이 맺혀 차를 따라다니는 얼룩이 생긴다
  const spot = new THREE.SpotLight('#FFF1D6', 30, 60, 0.32, 0.6, 1.2); // 레이스에서는 바로 앞에 라이벌 차가 붙어 달려서, 세면 앞차가 하얗게 날아간다
  spot.position.set(0, 0.8, -carDims.halfL);
  spot.target.position.set(0, 0, -18);
  car.add(spot, spot.target);
}
