# 외부 자산 출처와 라이선스

공개 URL로 받을 수 있는 자산은 저장소에 포함하지 않고 빌드 때 `npm run assets`로 내려받아 가공한다. 출처와 가공 방법은 `scripts/build-assets.mjs`에 커밋 SHA 단위로 고정돼 있다. 로그인이 필요한 사이트(Sketchfab)에서 받은 차량은 CI가 받을 수 없어 가공본을 `src/models/cars/`에 커밋했다. 차량을 추가하면 이 표에도 한 줄 추가한다.

| 파일 | 원본 | 저작자 | 라이선스 | 가공 |
| --- | --- | --- | --- | --- |
| `src/assets/cars/car-concept.glb` | [Khronos glTF-Sample-Assets / CarConcept](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept) | Eric Chadwick, Darmstadt Graphics Group GmbH | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 메시 단순화, 텍스처 512px WebP, meshopt 압축, 도색 색상 변경, 번호판(로고) 제거 |
| (보류) Unity Fan 콘셉트카 6대 — 현재 저장소·게임에 포함하지 않음 | [Sketchfab / Unity Fan 콘셉트카 컬렉션](https://sketchfab.com/unityfan777/collections/concept-cars-53d3883539f347b3adf508d21f6536f8) | Unity Fan | 설명란: CC0 / 라이선스 표시란: Free Standard (아래 참고) | 대당 약 10만 삼각형으로 단순화, 텍스처 512px WebP, meshopt 압축, 도색 색상 변경 |
| `src/assets/night.hdr` | [Poly Haven / Moonless Golf](https://polyhaven.com/a/moonless_golf) (three.js 저장소 사본) | Greg Zaal | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) | 없음 |

CC BY 4.0 자산은 배포 시 저작자 표기가 필요하다. 게임 시작 화면 하단에 표기를 넣었다.

건물·도로·가로등은 외부 자산 없이 코드로 생성한다 (`src/textures.js`).

## 로고·상표

CarConcept 모델의 번호판에는 Khronos·3D Commerce 로고가 들어 있다. 로고는 모델의 CC BY 4.0이 아니라 Khronos 상표 조건을 따르고, 그 조건은 "모델 라이선스가 로고 사용 권리를 주지 않는다"고 명시한다. 그래서 게임에서는 번호판 재질(`License`)을 숨겨 로고가 나오지 않게 했다(`src/carModels.js`).

## Unity Fan 콘셉트카 (보류)

Sketchfab의 Unity Fan 콘셉트카는 모델 페이지 설명란에는 작가가 "퍼블릭 도메인(CC0)"이라고 적었지만, Sketchfab이 붙인 라이선스 칸은 "Free Standard"다. Free Standard는 작품에 포함해 쓰는 것은 허용하지만 모델 파일의 단독 재배포는 제한한다. 공개 저장소에 `.glb`를 두면 가공본이라도 누구나 파일을 받을 수 있어 단독 재배포로 볼 여지가 있다.

두 표시 중 무엇이 우선하는지 불분명한 동안에는 법적으로 문제없다고 단정할 수 없으므로 **저장소와 게임에 포함하지 않는다.** 다음 중 하나가 확인되면 가공본을 `src/models/cars/`에 넣어 다시 쓴다(코드와 설정은 이미 들어 있다).

1. **작가의 서면 확인**: 작가에게 CC0로 공개 저장소·웹 게임에 포함해도 되는지 묻고, 답변(메시지·메일 캡처)을 보관한다.
2. **라이선스 칸 자체가 CC0 또는 CC BY인 모델로 교체**: Sketchfab 검색에서 라이선스 필터를 CC0/CC BY로 걸면 라이선스 칸이 명확한 모델만 나온다.
