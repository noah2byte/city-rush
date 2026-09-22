// 게임 밸런스 값을 한 곳에 모아 로직 파일을 건드리지 않고 튜닝할 수 있게 한다
// 거리 단위는 m, 속도 단위는 m/s (HUD에서만 km/h로 변환)
export const CONFIG = {
  lanes: [-4.5, -1.5, 1.5, 4.5], // 4차선. 차선 폭 3m
  roadHalf: 6,
  playerHalfX: 5.1,              // 차가 보도에 올라타지 않는 좌우 한계
  despawnZ: 20,
  race: {
    laps: 3,
    rivals: 7,
    gridGap: 7,                  // 출발 그리드 앞뒤 간격(m)
    playerGrid: 5,               // 플레이어 출발 순번(0부터). 뒤에서 출발해야 추월하는 재미가 생긴다
  },
  speed: {
    max: 62,                     // 약 223km/h
    launch: 16,                  // 저속 가속. 정지 상태에서 빨리 치고 나가야 출발이 답답하지 않다
    accel: 3,                    // 최고 속도 근처 가속
    brake: 28,
    boostExtra: 16,              // 부스터 패드를 밟았을 때 최고 속도 위로 더해지는 속도
    boostTime: 1.4,              // 부스터 지속 시간(s)
    idle: 10,
  },
  // 조향: 입력 → 핸들 각(steerRate) → 옆 방향 속도(grip)로 두 단계 관성을 둬서 움직임이 매끄럽게 이어지게 한다
  steer: { lateral: 10, steerRate: 7, grip: 5 },
  // 원심력: 커브에서 바깥쪽으로 밀리는 세기. 곡률 × 속도² × centrifugal (m/s)
  // 곡선 셰이더로 휘어 보이기만 하던 커브를 실제로 "꺾어야 하는" 커브로 만든다
  centrifugal: 0.7,
  wallDrag: 1.4,                 // 벽에 긁힐 때 초당 잃는 속도 비율(실수 한 번이 순위에 영향을 주도록 키웠다)
  bump: { speedLoss: 0.22, push: 6 }, // 라이벌과 부딪히면 뒤차가 속도를 잃고 옆으로 튕긴다
  wallSpin: 9,                   // 이 옆 속도(m/s) 이상으로 벽에 박으면 스핀한다
  ai: {
    // 라이벌 기본 최고 속도(플레이어 기본 62 전후). 여기에 difficulty·맵별 aiScale·컨디션이 곱해져
    // 실제로는 플레이어보다 빠르다. 부스터·아이템·슬립스트림 없이는 선두권을 못 따라가게 하기 위해서다
    topSpeed: [59, 60, 61, 61.5, 62, 62.5, 63],
    // 러버밴딩: 플레이어보다 뒤처진 라이벌은 최대 +50%로 끝까지 따라붙고, 앞선 라이벌은 전혀 늦춰 주지 않는다.
    // 앞차를 늦춰 주면 1등이 쉬워지고, 뒤차가 붙지 않으면 한 번 앞서면 끝이라 "항아리 게임" 같은 긴장이 사라진다
    rubberBehind: 0.5,
    rubberAhead: 0,
    padChance: 0.8,              // 앞쪽 부스터 패드를 노릴 확률
    aggressive: [2, 5],          // 플레이어를 들이받으러 오는 라이벌(목록 순번)
    // 전체 라이벌 속도 배율(난이도 손잡이). 맵별 aiScale과 곱한다.
    // 목표 분포(잘 달리는 봇 기준): 1등 1%, 2등 3%, 3등 5%, 4~6등 30%, 7~8등 61%. 서울 160판 측정 0/3.1/6.2/31.2/59.4%
    difficulty: 1.135,
    // 그날 컨디션: 판마다 라이벌 전체의 기량(fieldForm)과 라이벌 각자의 기량(form)이 정규분포로 오르내린다(표준편차).
    // 기량이 늘 같으면 결과가 한가운데 순위에 몰려, 드문 포디움과 잦은 꼴찌권이라는 분포를 만들 수 없다
    fieldForm: 0.08,
    form: 0.015,
  },
  // 차량 액션
  items: {
    rowEvery: [340, 420],        // 아이템 박스 줄 간격(m)
    boost: { extra: 20, time: 2 },
    missile: { speed: 110, range: 90, life: 4 },
    mine: { life: 60, dropBack: 3.5 },
    shield: { time: 8 },
    spinTime: 1.3,               // 피격 시 스핀 시간(s)
    spinSpeedKeep: 0.35,         // 피격 순간 남는 속도 비율
  },
  slipstream: { range: 16, width: 1.7, charge: 0.8, extra: 7 }, // 앞차 뒤 16m 안, 좌우 1.7m 안에서 0.8초 붙으면 +7m/s
  slam: { lateral: 5.5, spin: 0.8, attackerLoss: 0.05 },          // 옆으로 5.5m/s 넘게 부딪히면 상대가 스핀
  rocketStart: { window: 0.6, extra: 14, time: 1.5 },             // GO 직전 0.6초 안에 ↑를 누르면 로켓 스타트
  lamps: { realLights: 5, intensity: 40 }, // 가까운 가로등 몇 개에만 실제 광원을 옮겨 단다
  bestKey: 'city-rush-best-time',
};
