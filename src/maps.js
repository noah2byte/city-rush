// 맵(레이스 무대) 정의. 맵마다 하늘·조명·노면과, 한 바퀴를 이루는 구역 목록을 가진다.
// 콘텐츠 데이터라 로직(world.js)·조립(districts.js)과 분리해, 맵을 추가·조정할 때 이 파일부터 보면 되게 했다
//
// 구역 필드
//   name: 화면에 띄울 이름, len: 한 바퀴 안에서의 길이 범위(m), fog: 안개 농도
//   curve·hill: 곡선 셰이더 곡률 최댓값(100m 앞이 curve × 10000 m만큼 휘어 보인다), rain: 비 올 확률
//   곡률이 districts.js의 CURVE_SIGN(0.0011)을 넘는 구간에는 커브 바깥쪽에 화살표 경고판이 선다
//   구역 키는 districts.js의 builders 함수 이름과 같다
//
// 테마 필드
//   sky: 배경 하늘(textures.js skyTexture), env: 차체·유리에 비치는 반사(hdr: 밤 HDRI 사용)
//   hemi·sun: 주변광·태양광 [색, 세기], exposure: 노출, bloom: 빛 번짐 [세기, 임계값]
//   lamps: 가로등 실제 광원 세기 배율(낮에는 0), shadowOpacity: 차 밑 그림자 진하기
//   aiScale: 라이벌 최고 속도 배율. 맵마다 벽·커브 조건과 핵폭격이 선두를 휘말리게 하는 정도가 달라
//            같은 속도라도 난이도가 달라서, 봇 시뮬레이션(맵별 20판)으로 1등 약 10%가 되게 맞췄다
export const MAPS = {
  'seoul-night': {
    name: '서울의 밤',
    desc: '도심·한강 다리·터널·한옥 마을을 누비는 야간 레이스',
    road: 'night',
    theme: {
      sky: { stops: [[0, '#05070F'], [0.6, '#161A2E'], [1, '#4A3446']], stars: 120 }, // 지평선의 붉은 기운은 도시 불빛이 번진 광해
      fogColor: '#1C1A28',
      env: { hdr: true }, envIntensity: 0.7,
      hemi: ['#6F7FB8', '#140F1A', 0.35], sun: ['#9FB0FF', 0.25, [8, 20, 10]],
      exposure: 1.05, bloom: [0.55, 0.92], lamps: 1, shadowOpacity: 0.55,
      aiScale: 1.02,
    },
    zones: {
      downtown: { name: '도심 업무지구', len: [360, 540], fog: 0.009, curve: 0.0016, hill: 0.0003, rain: 0.3 },
      shopping: { name: '상가 거리', len: [312, 456], fog: 0.011, curve: 0.001, hill: 0.0002, rain: 0.35 },
      bridge: { name: '한강 다리', len: [384, 528], fog: 0.0045, curve: 0.0006, hill: 0.0001, rain: 0.3 },
      park: { name: '공원 대로', len: [312, 432], fog: 0.008, curve: 0.0013, hill: 0.0005, rain: 0.3 },
      tunnel: { name: '터널', len: [264, 360], fog: 0.016, curve: 0.001, hill: 0, rain: 0 }, // 지붕이 있으니 비가 오지 않는다
      port: { name: '항만 부두', len: [336, 480], fog: 0.0065, curve: 0.0008, hill: 0.0001, rain: 0.35 },
      elevated: { name: '고가도로', len: [336, 504], fog: 0.006, curve: 0.0014, hill: 0.0004, rain: 0.3 },
      hanok: { name: '한옥 마을', len: [288, 408], fog: 0.009, curve: 0.0012, hill: 0.0003, rain: 0.3 },
    },
  },

  'coast-day': {
    name: '햇살 해안 도시',
    desc: '지중해풍 항구 마을과 해안 절벽을 달리는 한낮의 레이스',
    road: 'day',
    theme: {
      sky: { stops: [[0, '#2E7FD6'], [0.55, '#8CC7F2'], [1, '#EAF4FA']], sun: [0.78, 0.18, 26, '255,250,225'], clouds: 14 },
      fogColor: '#CFE4F2',
      env: { top: '#3F8FE0', horizon: '#DDEEF8', ground: '#8A8578', sun: [0.2, 0.2, '255,250,230'] }, envIntensity: 0.8,
      // 낮 장면은 밝은 면이 넓어 조금만 세도 하얗게 날아간다. 주변광을 낮추고 태양으로 명암을 만든다
      hemi: ['#CFE6FF', '#8C7A5E', 0.55], sun: ['#FFF3DC', 1.7, [-30, 40, -20]],
      exposure: 0.9, bloom: [0.1, 0.99], lamps: 0, shadowOpacity: 0.5,
      aiScale: 1.012,
    },
    // 비는 넣지 않는다. 맑은 하늘 배경과 비가 섞이면 어색하다
    zones: {
      beach: { name: '해변 도로', len: [360, 480], fog: 0.0035, curve: 0.0018, hill: 0.0002, rain: 0 },
      harbor: { name: '파스텔 항구 마을', len: [336, 456], fog: 0.005, curve: 0.0018, hill: 0.0003, rain: 0 },
      cliff: { name: '절벽 해안길', len: [336, 480], fog: 0.004, curve: 0.0026, hill: 0.0005, rain: 0 },
      cape: { name: '등대 곶', len: [288, 408], fog: 0.0035, curve: 0.0022, hill: 0.0006, rain: 0 },
      palm: { name: '야자수 대로', len: [312, 432], fog: 0.0045, curve: 0.0014, hill: 0.0001, rain: 0 },
    },
  },

  'sky-isles': {
    name: '하늘 섬',
    desc: '구름 위 떠 있는 섬과 수정 협곡, 무지개 다리를 잇는 판타지 레이스',
    road: 'sky',
    theme: {
      sky: { stops: [[0, '#6B8FE8'], [0.45, '#C9B8F0'], [0.8, '#FFD6E0'], [1, '#FFF1E0']], sun: [0.3, 0.42, 30, '255,244,220'], clouds: 22, cloudColor: '255,245,250' },
      fogColor: '#F0DDF0',
      env: { top: '#8FA8F0', horizon: '#FFE0EA', ground: '#C8C0E0', sun: [0.7, 0.3, '255,245,225'] }, envIntensity: 0.6,
      // 흰 구름·대리석이 화면 대부분이라 블룸 임계값을 높여 수정·난간처럼 실제로 빛나는 것만 번지게 한다
      hemi: ['#EAE0FF', '#B8A8D8', 0.5], sun: ['#FFF0E0', 1.3, [20, 35, -30]],
      exposure: 0.85, bloom: [0.3, 0.97], lamps: 0, shadowOpacity: 0.4,
      aiScale: 1.01,
    },
    zones: {
      clouds: { name: '구름 바다', len: [336, 456], fog: 0.004, curve: 0.0022, hill: 0.0008, rain: 0 },
      islands: { name: '떠 있는 섬', len: [360, 480], fog: 0.0035, curve: 0.0024, hill: 0.0006, rain: 0 },
      crystal: { name: '수정 협곡', len: [312, 432], fog: 0.006, curve: 0.0026, hill: 0.0004, rain: 0 },
      rainbow: { name: '무지개 다리', len: [288, 384], fog: 0.004, curve: 0.0014, hill: 0.0009, rain: 0 },
      temple: { name: '하늘 신전', len: [312, 432], fog: 0.005, curve: 0.0018, hill: 0.0003, rain: 0 },
    },
  },
};

export const DEFAULT_MAP = 'seoul-night';
export const mapIds = () => Object.keys(MAPS);
