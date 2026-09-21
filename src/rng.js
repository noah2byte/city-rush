// 시드 고정 난수. 레이스는 같은 코스를 여러 바퀴 돌므로, 청크마다 위치로 시드를 정해
// 매 바퀴 같은 건물·소품·부스터가 같은 자리에 나오게 한다(Math.random이면 바퀴마다 풍경이 달라진다)
let state = 1;

export function seed(n) {
  state = (n | 0) ^ 0x9e3779b9;
  if (state === 0) state = 1;
}

// mulberry32: 짧고 빠르며 게임 연출용으로 분포가 충분히 고르다
export function rng() {
  state = (state + 0x6d2b79f5) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// 독립된 난수열이 필요한 곳(코스 설계 등)을 위한 생성기
export function makeRng(s) {
  let st = (s | 0) ^ 0x2545f491 || 1;
  return () => {
    st = (st + 0x6d2b79f5) | 0;
    let t = st;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
