// 외부 오픈소스 자산을 내려받아 게임용으로 가공한다.
// 바이너리를 git에 넣지 않고 "출처 + 가공 방법"을 코드로 남겨, 누구든 같은 결과물을 재현할 수 있게 하기 위함이다.
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const OUT = 'src/assets';
const CACHE = '.asset-cache';

// 브랜치가 아닌 커밋 SHA로 고정한다. 원본 저장소가 바뀌어도 같은 파일을 받기 위해서다
const KHRONOS = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/c6a6bd13ab2b3c685c7903d03561b8a9392f38b8';
const THREEJS = 'https://raw.githubusercontent.com/mrdoob/three.js/3f9f3b511c67b6bbb468fea374ee2b95d75431d2';

const ASSETS = [
  {
    name: 'car.glb',
    url: `${KHRONOS}/Models/CarConcept/glTF-Binary/CarConcept.glb`,
    // 원본 11.8MB / 64만 정점은 차량 10여 대를 동시에 그리기에 무겁다.
    // 뒤에서 보는 시점이라 디테일 손실이 잘 보이지 않으므로 과감하게 줄인다
    optimize: [
      '--compress', 'meshopt',       // 디코더가 JS라 wasm 파일 배포가 필요 없는 meshopt를 쓴다
      '--texture-compress', 'webp',
      '--texture-size', '512',
      '--simplify-ratio', '0.25',
      '--simplify-error', '0.002',
      '--join', 'false',             // 재질 이름으로 도색을 바꾸므로 메시 병합을 막는다
      '--palette', 'false',
      '--instance', 'false',
    ],
  },
  {
    name: 'night.hdr',
    // 차체·유리 반사용 환경맵. 밤 장면이라 어두운 야외 HDRI를 고른다
    url: `${THREEJS}/examples/textures/equirectangular/moonless_golf_1k.hdr`,
  },
];

const ifMissing = process.argv.includes('--if-missing');
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

for (const asset of ASSETS) {
  const out = join(OUT, asset.name);
  if (ifMissing && existsSync(out)) continue;

  const raw = join(CACHE, `raw-${asset.name}`);
  if (!existsSync(raw)) {
    console.log(`↓ ${asset.url}`);
    const res = await fetch(asset.url);
    if (!res.ok) throw new Error(`${asset.name} 다운로드 실패: HTTP ${res.status}`);
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  }

  if (asset.optimize) {
    execFileSync('npx', ['gltf-transform', 'optimize', raw, out, ...asset.optimize], { stdio: 'inherit' });
  } else {
    copyFileSync(raw, out);
  }
  console.log(`✓ ${out}`);
}
