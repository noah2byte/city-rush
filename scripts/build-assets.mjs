// 외부 오픈소스 자산을 내려받아 게임용으로 가공한다.
// 바이너리를 git에 넣지 않고 "출처 + 가공 방법"을 코드로 남겨, 누구든 같은 결과물을 재현할 수 있게 하기 위함이다.
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname as dir } from 'node:path';

const OUT = 'src/assets';
const CACHE = '.asset-cache';

// 브랜치가 아닌 커밋 SHA로 고정한다. 원본 저장소가 바뀌어도 같은 파일을 받기 위해서다
const KHRONOS = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/c6a6bd13ab2b3c685c7903d03561b8a9392f38b8';
const THREEJS = 'https://raw.githubusercontent.com/mrdoob/three.js/3f9f3b511c67b6bbb468fea374ee2b95d75431d2';
// 로그인이 필요한 곳(Sketchfab 등)에서 받은 모델은 여기서 받지 않는다. 가공본을 src/models/에 커밋해 두고,
// 다시 가공할 때만 scripts/process-models.mjs를 로컬에서 돌린다(외부 저장소·토큰 없이 저장소 하나로 끝나게)

// 차량 모델 공통 경량화 옵션. 뒤에서 보는 시점이라 디테일 손실이 잘 보이지 않으므로 과감하게 줄인다
export const carOptimize = ratio => [
  '--compress', 'meshopt',       // 디코더가 JS라 wasm 파일 배포가 필요 없는 meshopt를 쓴다
  '--texture-compress', 'webp',
  '--texture-size', '512',
  '--simplify-ratio', String(ratio), // 모델마다 원본 폴리곤 수가 달라 목표 삼각형 수에 맞춰 비율을 정한다
  // 오차 한도(모델 크기 대비). 0.002에서는 곡면이 각지고 패널 라인이 뭉개져, 비율보다 모양 유지를 우선하도록 낮췄다
  '--simplify-error', '0.0008',
  '--join', 'false',             // 재질 이름으로 도색·등화를 찾으므로 메시 병합을 막는다(병합은 게임이 재질별로 한다)
  '--palette', 'false',
  '--instance', 'false',
];

// 차량: src/assets/cars/<name>.glb 로 저장되고, 게임은 이 폴더에 있는 모델을 모두 불러온다.
// 모델별 게임 설정(도색 재질·방향·저작자 표기)은 src/carModels.js에 둔다
const CARS = [
  { name: 'car-concept', url: `${KHRONOS}/Models/CarConcept/glTF-Binary/CarConcept.glb`, ratio: 0.25 },
];

const ASSETS = [
  ...CARS.map(c => ({ name: `cars/${c.name}.glb`, url: c.url, optimize: carOptimize(c.ratio) })),
  {
    name: 'night.hdr',
    // 차체·유리 반사용 환경맵. 밤 장면이라 어두운 야외 HDRI를 고른다
    url: `${THREEJS}/examples/textures/equirectangular/moonless_golf_1k.hdr`,
  },
];

async function download(url) {
  console.log(`↓ ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`다운로드 실패(${url}): HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
const ifMissing = process.argv.includes('--if-missing');
if (isMain) {
mkdirSync(join(OUT, 'cars'), { recursive: true });
mkdirSync(CACHE, { recursive: true });

for (const asset of ASSETS) {
  const out = join(OUT, asset.name);
  if (ifMissing && existsSync(out)) continue;

  const raw = join(CACHE, `raw-${asset.name.replaceAll('/', '_')}`);
  if (!existsSync(raw)) writeFileSync(raw, await download(asset.url));

  mkdirSync(dir(out), { recursive: true });
  if (asset.optimize) {
    execFileSync('npx', ['gltf-transform', 'optimize', raw, out, ...asset.optimize], { stdio: 'inherit' });
  } else {
    copyFileSync(raw, out);
  }
  console.log(`✓ ${out}`);
}
}
