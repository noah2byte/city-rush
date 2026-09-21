import { makeRng } from './rng.js';

// 레이스 코스: 구역 5개를 이어 붙인 한 바퀴를 여러 번 돈다.
// 콘텐츠 데이터라 로직(world.js)과 분리해 두면 구역을 추가·조정할 때 이 파일만 고치면 된다
export const CHUNK = 24; // 월드를 스트리밍하는 단위 길이(m). 가로등 간격과 맞췄다
const BEND_STEP = 240;   // 곡률이 바뀌는 간격(m)

// curve·hill: 곡선 셰이더 곡률의 최댓값. 100m 앞이 curve × 10000(m)만큼 옆으로 휘어 보인다
// rain: 그 구간에 비가 올 확률, len: 한 바퀴 안에서 이 구역의 길이 범위(m)
export const ZONES = {
  downtown: { name: '도심 업무지구', len: [360, 540], fog: 0.009, curve: 0.0016, hill: 0.0003, rain: 0.3 },
  shopping: { name: '상가 거리', len: [312, 456], fog: 0.011, curve: 0.001, hill: 0.0002, rain: 0.35 },
  bridge: { name: '한강 다리', len: [384, 528], fog: 0.0045, curve: 0.0006, hill: 0.0001, rain: 0.3 },
  park: { name: '공원 대로', len: [312, 432], fog: 0.008, curve: 0.0013, hill: 0.0005, rain: 0.3 },
  tunnel: { name: '터널', len: [264, 360], fog: 0.016, curve: 0.001, hill: 0, rain: 0 }, // 지붕이 있으니 비가 오지 않는다
  port: { name: '항만 부두', len: [336, 480], fog: 0.0065, curve: 0.0008, hill: 0.0001, rain: 0.35 },
  elevated: { name: '고가도로', len: [336, 504], fog: 0.006, curve: 0.0014, hill: 0.0004, rain: 0.3 },
  hanok: { name: '한옥 마을', len: [288, 408], fog: 0.009, curve: 0.0012, hill: 0.0003, rain: 0.3 },
};

const LANES = [-4.5, -1.5, 1.5, 4.5];

export class RaceCourse {
  // options.first·weather: 첫 구역과 날씨를 고정한다(?zone=bridge&weather=rain). 구역별 작업·확인용
  constructor(seed = (Math.random() * 1e9) | 0, { first = null, weather = null } = {}) {
    this.seed = seed;
    const r = makeRng(seed);
    const types = Object.keys(ZONES);
    // 한 바퀴에 구역 5개를 겹치지 않게 뽑는다. 레이스마다 다른 코스가 된다
    const order = [];
    if (ZONES[first]) order.push(first);
    while (order.length < 5) {
      const t = types[(r() * types.length) | 0];
      if (!order.includes(t)) order.push(t);
    }

    let pos = 0;
    this.layout = order.map((type, i) => {
      const [a, b] = ZONES[type].len;
      const len = Math.round((a + r() * (b - a)) / CHUNK) * CHUNK; // 구역 경계가 청크 경계와 일치하도록 맞춘다
      let w = r() < ZONES[type].rain ? 'rain' : 'clear';
      if (i === 0 && (weather === 'rain' || weather === 'clear')) w = weather;
      if (type === 'tunnel') w = 'clear';
      const item = { type, start: pos, end: pos + len, weather: w, index: i };
      pos += len;
      return item;
    });
    this.lapLength = pos;

    // 부스터 패드: 한 바퀴 안의 위치를 미리 정해 매 바퀴 같은 자리에 둔다.
    // 출발선 직후 150m는 비워 출발 직후 혼잡한 구간에서 억울한 충돌이 없게 한다
    this.pads = [];
    for (let d = 150 + r() * 80; d < this.lapLength - 60; d += 170 + r() * 110) {
      this.pads.push({ d, x: LANES[(r() * LANES.length) | 0] });
    }

    // 곡률: BEND_STEP마다 그 구역 성격에 맞는 값을 미리 뽑아 둔다(바퀴마다 같은 커브)
    this.bends = [];
    for (let d = 0; d < this.lapLength; d += BEND_STEP) {
      const z = ZONES[this.#item(d).type];
      this.bends.push([(r() * 2 - 1) * z.curve, (r() * 2 - 1) * z.hill]);
    }
  }

  #item(lapPos) {
    return this.layout.find(s => lapPos >= s.start && lapPos < s.end) ?? this.layout.at(-1);
  }

  lapPos(d) {
    return ((d % this.lapLength) + this.lapLength) % this.lapLength;
  }

  // 절대 거리 d가 속한 구역. key는 "몇 바퀴째의 몇 번째 구역"이라 구역이 바뀌었는지 비교할 때 쓴다
  at(d) {
    const lap = Math.floor(d / this.lapLength);
    const item = this.#item(this.lapPos(d));
    const base = lap * this.lapLength;
    return { ...item, start: base + item.start, end: base + item.end, lap, key: `${lap}:${item.index}` };
  }

  bendAt(d) {
    return this.bends[Math.floor(this.lapPos(d) / BEND_STEP) % this.bends.length];
  }

  // [a, b) 구간의 부스터 패드(절대 거리)
  padsBetween(a, b) {
    const out = [];
    const L = this.lapLength;
    for (let lap = Math.floor(a / L); lap * L < b; lap++) {
      for (const p of this.pads) {
        const d = lap * L + p.d;
        if (d >= a && d < b) out.push({ d, x: p.x });
      }
    }
    return out;
  }
}
