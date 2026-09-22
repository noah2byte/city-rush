import { makeRng } from './rng.js';
import { CONFIG } from './config.js';

// 레이스 코스: 맵의 구역 5개를 이어 붙인 한 바퀴를 여러 번 돈다. 구역 정의는 maps.js에 있다
export const CHUNK = 24; // 월드를 스트리밍하는 단위 길이(m). 가로등 간격과 맞췄다
const BEND_STEP = 240;   // 곡률이 바뀌는 간격(m)

const LANES = [-4.5, -1.5, 1.5, 4.5];

export class RaceCourse {
  // zones: 맵의 구역 정의. options.first·weather: 첫 구역과 날씨를 고정한다(?zone=bridge&weather=rain). 구역별 작업·확인용
  constructor(zones, seed = (Math.random() * 1e9) | 0, { first = null, weather = null } = {}) {
    const ZONES = zones;
    this.zones = zones;
    this.seed = seed;
    const r = makeRng(seed);
    const types = Object.keys(ZONES);
    // 한 바퀴에 구역 5개를 겹치지 않게 뽑는다. 레이스마다 다른 코스가 된다
    const order = [];
    if (ZONES[first]) order.push(first);
    while (order.length < Math.min(5, types.length)) {
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

    // 아이템 박스 줄: 부스터처럼 바퀴 안 위치를 미리 정해 매 바퀴 같은 자리에 둔다
    this.itemRows = [];
    const [ia, ib] = CONFIG.items.rowEvery;
    for (let d = 260 + r() * 60; d < this.lapLength - 80; d += ia + r() * (ib - ia)) this.itemRows.push(d);

    // 곡률: BEND_STEP마다 그 구역 성격에 맞는 값을 미리 뽑아 둔다(바퀴마다 같은 커브)
    this.bends = [];
    for (let d = 0; d < this.lapLength; d += BEND_STEP) {
      const z = this.zones[this.#item(d).type];
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

  // [a, b) 구간의 아이템 박스 줄(절대 거리)
  itemRowsBetween(a, b) {
    const out = [];
    const L = this.lapLength;
    for (let lap = Math.floor(a / L); lap * L < b; lap++) {
      for (const p of this.itemRows) {
        const d = lap * L + p;
        if (d >= a && d < b) out.push(d);
      }
    }
    return out;
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
