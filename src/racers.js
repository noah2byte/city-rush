import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createCar, carDims } from './cars.js';

const clamp = THREE.MathUtils.clamp;
const damp = (k, dt) => 1 - Math.exp(-k * dt);

// 라이벌: 이름과 색이 분명해야 순위표에서 누가 누군지 바로 보인다
const RIVALS = [
  { name: '번개', color: '#D7263D' },
  { name: '치타', color: '#F4D35E' },
  { name: '상어', color: '#1B6CA8' },
  { name: '여우', color: '#2FBF71' },
  { name: '부엉이', color: '#8E5BD6' },
  { name: '호랑이', color: '#F2F2F2' },
  { name: '까마귀', color: '#1C1C1E' },
];

// 가속 곡선: 저속에서는 세게, 최고 속도에 가까울수록 약하게(공기 저항). 플레이어와 AI가 같은 식을 쓴다
export function accelAt(speed, top) {
  const { launch, accel } = CONFIG.speed;
  return accel + launch * Math.max(0, 1 - speed / top);
}

// 레이서 공통 상태. dist는 코스상 절대 위치(m), x는 좌우 위치(m)
export function makeRacer(name, isPlayer = false) {
  return { name, isPlayer, dist: 0, x: 0, vx: 0, speed: 0, boost: 0, finished: false, finishTime: 0, spin: 0 };
}

export class Rivals {
  constructor(scene) {
    this.list = RIVALS.slice(0, CONFIG.race.rivals).map((r, i) => {
      const car = createCar(r.color);
      car.visible = false;
      scene.add(car);
      return {
        ...makeRacer(r.name), color: r.color, car,
        top: CONFIG.ai.topSpeed[i], targetX: 0, think: 0,
      };
    });
  }

  place(gridSlots) {
    this.list.forEach((r, i) => {
      Object.assign(r, makeRacer(r.name), { car: r.car, color: r.color, top: CONFIG.ai.topSpeed[i], think: Math.random() });
      r.dist = gridSlots[i].dist;
      r.x = r.targetX = gridSlots[i].x;
    });
  }

  // 한 프레임 진행. racers: 플레이어를 포함한 전체(차선 판단용)
  update(dt, { player, racers, course, running, raceTime }) {
    const { lanes, ai, speed: sp } = CONFIG;
    for (const r of this.list) {
      if (running || r.finished) {
        // 러버밴딩: 플레이어보다 한참 앞서면 살짝 느려지고, 한참 뒤처지면 살짝 빨라진다
        const gap = r.dist - player.dist;
        const band = clamp(-gap / 150, -1, 1) * ai.rubberBand;
        const top = r.top * (1 + band) + (r.boost > 0 ? sp.boostExtra : 0);
        // 부스트가 끝나 최고 속도가 내려가면 순간적으로 깎지 않고 서서히 줄인다
        if (r.speed < top) r.speed = Math.min(top, r.speed + accelAt(r.speed, top) * dt);
        else r.speed += (top - r.speed) * damp(1.5, dt);
      } else {
        r.speed = 0;
      }
      if (r.spin > 0) { r.spin = Math.max(0, r.spin - dt); r.speed *= 1 - 0.8 * dt; }
      r.boost = Math.max(0, r.boost - dt);
      r.dist += r.speed * dt;

      // 차선 판단: 앞에 느린 차가 막고 있으면 비어 있는 차선으로 옮긴다
      r.think -= dt;
      if (r.think <= 0 && running) {
        r.think = 0.4 + Math.random() * 0.8;
        const blocked = racers.some(o => o !== r && o.dist > r.dist && o.dist - r.dist < 14 && Math.abs(o.x - r.x) < 2.2 && o.speed <= r.speed + 1);
        if (blocked) {
          const free = lanes.filter(l => !racers.some(o => o !== r && Math.abs(o.dist - r.dist) < 12 && Math.abs(o.x - l) < 2));
          if (free.length) r.targetX = free.sort((a, b) => Math.abs(a - r.x) - Math.abs(b - r.x))[0];
        } else {
          const pad = course.padsBetween(r.dist + 20, r.dist + 70)[0];
          if (pad && Math.random() < ai.padChance) r.targetX = pad.x;
        }
      }
      r.vx = (r.targetX - r.x) * 2.5;
      r.x += clamp(r.vx, -6, 6) * dt;

      if (!r.finished && r.dist >= CONFIG.race.laps * course.lapLength) {
        r.finished = true;
        r.finishTime = raceTime;
      }
    }
  }

  // 플레이어 기준 상대 위치로 그린다(플레이어는 z=0 고정)
  render(playerDist) {
    for (const r of this.list) {
      const z = playerDist - r.dist;
      r.car.visible = z > -200 && z < 25;
      if (!r.car.visible) continue;
      r.car.position.set(r.x, 0, z);
      r.car.rotation.y = r.spin > 0 ? r.spin * 9 : -clamp(r.vx, -6, 6) * 0.03;
    }
  }
}

// 부스터 패드 밟기: 이번 프레임에 지나간 구간 안에 패드가 있고 좌우로 겹치면 부스트
export function checkPads(r, prevDist, course) {
  for (const pad of course.padsBetween(prevDist, r.dist)) {
    if (Math.abs(pad.x - r.x) < 1.6) {
      r.boost = CONFIG.speed.boostTime;
      return true;
    }
  }
  return false;
}

// 두 레이서가 겹치면 옆으로 떼어 놓고, 뒤에 있던 쪽이 속도를 잃는다
export function resolveBump(a, b) {
  const w = carDims.halfW * 2 * 0.95, l = carDims.halfL * 2 * 0.9;
  const dx = a.x - b.x, dz = a.dist - b.dist;
  if (Math.abs(dx) >= w || Math.abs(dz) >= l) return false;
  const dir = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx);
  const push = (w - Math.abs(dx)) / 2 + 0.05;
  a.x += dir * push; b.x -= dir * push;
  a.vx += dir * CONFIG.bump.push; b.vx -= dir * CONFIG.bump.push;
  const back = dz < 0 ? a : b;
  back.speed *= 1 - CONFIG.bump.speedLoss;
  return true;
}

// 순위: 완주한 레이서는 완주 시간순, 나머지는 달린 거리순
export function standings(racers) {
  return [...racers].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.dist - a.dist;
  });
}
