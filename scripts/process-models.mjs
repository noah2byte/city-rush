// 로그인이 필요한 사이트(Sketchfab 등)에서 받은 차량 원본을 게임용으로 가공해 src/models/cars/에 저장한다.
// 결과물은 저장소에 커밋한다. 원본은 크고(대당 4~13MB) 그대로 공개 배포하는 것은 라이선스가 제한할 수 있어 커밋하지 않는다.
// 사용: 원본을 .asset-originals/<이름>.glb 로 두고 `npm run models` (새 모델을 추가하거나 가공 옵션을 바꿀 때만)
import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { carOptimize } from './build-assets.mjs';

const ORIGINALS = '.asset-originals';
const OUT = 'src/models/cars';

// ratio: 원본 삼각형 수를 대당 약 12~16만 개로 줄이는 비율(10만은 곡면이 각져 보였다)
const MODELS = [
  { name: 'concept-car-001', ratio: 0.8 },  // 원본 14.3만
  { name: 'concept-car-002', ratio: 1 },    // 원본 10.8만(이미 가벼워 단순화하지 않는다)
  { name: 'concept-car-011', ratio: 0.5 },  // 원본 32만
  { name: 'concept-car-033', ratio: 0.6 },  // 원본 21.9만
  { name: 'concept-car-037', ratio: 0.65 }, // 원본 19.8만
  { name: 'concept-car-040', ratio: 0.55 }, // 원본 29.2만
];

mkdirSync(OUT, { recursive: true });
for (const m of MODELS) {
  const src = `${ORIGINALS}/${m.name}.glb`;
  if (!existsSync(src)) {
    console.log(`- ${src} 없음, 건너뜀(커밋된 ${OUT}/${m.name}.glb를 그대로 쓴다)`);
    continue;
  }
  execFileSync('npx', ['gltf-transform', 'optimize', src, `${OUT}/${m.name}.glb`, ...carOptimize(m.ratio)], { stdio: 'inherit' });
  console.log(`✓ ${OUT}/${m.name}.glb`);
}
