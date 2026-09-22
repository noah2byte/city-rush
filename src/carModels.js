// 차량 모델별 게임 설정. 키는 src/assets/cars/<키>.glb 의 파일 이름이다.
// 모델마다 재질 이름·방향·크기가 제각각이라, 자동으로 맞추지 못하는 부분만 여기서 지정한다.
//
// paint    도색 재질 이름(정규식). 맞으면 라이벌 색으로 칠한다. 없으면 모델 원래 색을 쓴다
// swatch   도색을 못 바꾸는 모델의 순위표 색(원래 차 색과 비슷하게)
// hidden   그리지 않을 재질 이름(정규식). 추격 시점에서 안 보이는 실내·하부 부품을 빼 성능을 아낀다
// lights   전조등·후미등 재질 이름(정규식). 블룸에 걸리도록 발광을 키우고, 전조등 위치로 차의 앞쪽을 판별한다
// rotate   앞쪽 자동 판별이 틀릴 때 강제로 돌릴 각도(도). 0이면 모델의 -z가 앞, 180이면 +z가 앞
// credit   시작 화면에 표시할 저작자 표기(CC BY는 필수, CC0는 선택)
// label    차고 화면에 보일 이름과 차종
export const DEFAULT_MODEL = {
  paint: null,
  swatch: '#9AA0A8',
  hidden: null,
  // brake는 브레이크 '캘리퍼'(brakeCalipers)와 겹치지 않게 등화 이름만 잡는다. 캘리퍼가 빛나면 바퀴가 빨갛게 발광한다
  lights: { head: /head/i, brake: /tail|stop|brake.?light|rear.?light/i },
  rotate: null,
  credit: '',
  label: ['콘셉트카', ''],
};

const UNITY_FAN = 'Concept Cars by Unity Fan (CC0)';

export const CAR_MODELS = {
  'car-concept': {
    label: ['Concept 004', '스포츠 쿠페'],
    paint: /^Paint/,
    // License: 번호판. Khronos·3D Commerce 로고가 있는데, 로고는 모델의 CC BY 4.0이 아닌 Khronos 상표라 사용 권리가 없어 숨긴다
    hidden: /^(Interior|Floormat|Dashboard|Mechanical|Panel Sides|License)/,
    lights: { head: /^Headlight$/, brake: /^Brakelight$/ },
    credit: 'Car Concept by Eric Chadwick, Darmstadt Graphics Group (CC BY 4.0)',
  },
  // Unity Fan 콘셉트카 시리즈. 라이선스 확인 전까지 모델 파일을 넣지 않는다(ASSETS.md 참고).
  // 설정은 남겨 두어, 확인 후 src/models/cars/에 파일만 넣으면 바로 쓰이게 했다
  'concept-car-001': { label: ['Concept 001', '레트로 해치백'], paint: /^Material\.003$/, credit: UNITY_FAN },
  'concept-car-002': { label: ['Concept 002', '미드십 스포츠카'], paint: /^carpaint$/, credit: UNITY_FAN },
  'concept-car-011': { label: ['Concept 011', '일렉트릭 GT'], paint: /^body$/, credit: UNITY_FAN }, // 문이 뼈대로 움직이는 스킨드 메시 모델(cars.js가 자세를 구워 합친다)
  'concept-car-033': { label: ['Concept 033', '하이퍼카'], paint: /^body_color_supra\.001$/, credit: UNITY_FAN },
  'concept-car-037': { label: ['Concept 037', '클래식 쿠페'], paint: /^body_color_supra\.001$/, credit: UNITY_FAN },
  'concept-car-040': { label: ['Concept 040', '그랜드 투어러'], paint: /^body_color_supra\.001$/, credit: UNITY_FAN },
};

// 차고에서 처음 선택돼 있는 기본 차
export const PLAYER_MODEL = 'car-concept';

export function modelOptions(name) {
  const o = CAR_MODELS[name] ?? {};
  return { ...DEFAULT_MODEL, ...o, lights: { ...DEFAULT_MODEL.lights, ...o.lights } };
}

// 차고에서 고를 수 있는 색. 라이벌 고유색과 겹치면 그 라이벌이 남는 색으로 바꿔 탄다(racers.js)
export const PAINT_COLORS = [
  ['#E8621C', '선셋 오렌지'], ['#D7263D', '레이싱 레드'], ['#F4D35E', '썬 옐로'], ['#2FBF71', '에메랄드'],
  ['#1B6CA8', '딥 블루'], ['#8E5BD6', '바이올렛'], ['#F2F2F2', '펄 화이트'], ['#8A8D93', '건메탈'],
  ['#1C1C1E', '미드나잇 블랙'], ['#FF5FA2', '네온 핑크'],
];
