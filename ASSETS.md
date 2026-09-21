# 외부 자산 출처와 라이선스

게임에 쓰는 외부 자산은 저장소에 포함하지 않고 `npm run assets`로 내려받아 가공한다. 출처와 가공 방법은 `scripts/build-assets.mjs`에 커밋 SHA 단위로 고정돼 있다.

| 파일 | 원본 | 저작자 | 라이선스 | 가공 |
| --- | --- | --- | --- | --- |
| `src/assets/car.glb` | [Khronos glTF-Sample-Assets / CarConcept](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept) | Eric Chadwick, Darmstadt Graphics Group GmbH | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 메시 단순화(25%), 텍스처 512px WebP, meshopt 압축, 도색 색상 변경 |
| `src/assets/night.hdr` | [Poly Haven / Moonless Golf](https://polyhaven.com/a/moonless_golf) (three.js 저장소 사본) | Greg Zaal | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) | 없음 |

CC BY 4.0 자산은 배포 시 저작자 표기가 필요하다. 게임 시작 화면 하단에 표기를 넣었다.

건물·도로·가로등은 외부 자산 없이 코드로 생성한다 (`src/textures.js`).
