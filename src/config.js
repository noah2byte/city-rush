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
  wallDrag: 0.9,                 // 벽에 긁힐 때 초당 잃는 속도 비율
  bump: { speedLoss: 0.22, push: 6 }, // 라이벌과 부딪히면 뒤차가 속도를 잃고 옆으로 튕긴다
  ai: {
    topSpeed: [57, 58, 59, 60, 60.5, 61, 61.5], // 라이벌별 최고 속도. 차이를 둬야 순위가 섞인다
    rubberBand: 0.07,            // 플레이어와 격차가 벌어지면 최고 속도를 ±7%까지 조절해 끝까지 접전을 만든다
    padChance: 0.45,             // 앞쪽 부스터 패드를 노릴 확률
  },
  car: { scale: 0.82 },           // 원본 콘셉트카는 폭이 2.5m로 넓어 3m 차선에 맞게 줄인다
  lamps: { realLights: 5, intensity: 40 }, // 가까운 가로등 몇 개에만 실제 광원을 옮겨 단다
  bestKey: 'city-rush-best-time',
};
