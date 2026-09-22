import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createCar, carDims, modelNames, swatchOf } from './cars.js';
import { PAINT_COLORS } from './carModels.js';

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
  return {
    name, isPlayer, dist: 0, prevDist: 0, x: 0, vx: 0, speed: 0,
    boost: 0, boostExtra: 0, finished: false, finishTime: 0, spin: 0,
    item: null, itemWait: 0, shield: 0, slip: 0,
  };
}

export class Rivals {
  constructor(scene) {
    this.scene = scene;
    this.list = RIVALS.slice(0, CONFIG.race.rivals).map((r, i) => ({
      ...makeRacer(r.name), baseColor: r.color, top: CONFIG.ai.topSpeed[i], targetX: 0, think: 0, car: null,
    }));
    this.assign(null, null);
  }

  // 플레이어가 고른 차·색을 피해서 라이벌에게 차와 색을 나눠 준다.
  // 같은 차·색이 섞여 있으면 레이스 중 내 차와 라이벌이 구분되지 않는다
  assign(playerModel, playerColor) {
    const models = modelNames();
    const others = models.filter(m => m !== playerModel);
    const pool = others.length ? others : models;
    // 플레이어 색과 겹치는 라이벌은 아무도 안 쓰는 색으로 바꾼다
    const used = new Set([playerColor, ...this.list.map(r => r.baseColor)]);
    const spare = PAINT_COLORS.map(c => c[0]).filter(c => !used.has(c));
    this.list.forEach((r, i) => {
      const color = r.baseColor === playerColor ? spare.shift() ?? r.baseColor : r.baseColor;
      const model = pool[i % pool.length];
      if (r.car && r.model === model && r.color === color) return; // 그대로면 다시 만들지 않는다
      r.car?.removeFromParent();
      r.car = createCar(color, model);
      r.car.visible = false;
      this.scene.add(r.car);
      Object.assign(r, { model, color, swatch: swatchOf(model, color) });
    });
  }

  place(gridSlots) {
    const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    const field = gauss() * CONFIG.ai.fieldForm; // 이번 판 라이벌 전체의 컨디션
    this.list.forEach((r, i) => {
      r.form = 1 + field + gauss() * CONFIG.ai.form;
      Object.assign(r, makeRacer(r.name), { top: CONFIG.ai.topSpeed[i], think: Math.random(), form: r.form });
      r.dist = gridSlots[i].dist;
      r.x = r.targetX = gridSlots[i].x;
    });
  }

  // 한 프레임 진행. racers: 플레이어를 포함한 전체(차선·아이템 판단용)
  update(dt, { player, racers, course, running, raceTime, combat, rankOf, aiScale = 1, nuke = null }) {
    const { lanes, ai, speed: sp } = CONFIG;
    for (const r of this.list) {
      r.prevDist = r.dist;
      if (running || r.finished) {
        // 러버밴딩: 플레이어보다 뒤처지면 강하게 따라붙고, 앞서 있으면 조금만 늦춘다
        const gap = r.dist - player.dist;
        const band = gap < 0 ? clamp(-gap / 150, 0, 1) * ai.rubberBehind : -clamp(gap / 150, 0, 1) * ai.rubberAhead;
        let top = r.top * r.form * aiScale * ai.difficulty * (1 + band) + (r.boost > 0 ? r.boostExtra : 0);
        // 핵 경보: 신중한 라이벌은 폭발 순간에 폭심에 닿을 것 같으면 속도를 늦춘다(모두가 피하면 이벤트가 무의미해 일부만)
        const w = nuke?.warning;
        if (w && r.cautious && r.dist < w.at && w.at - r.dist < r.speed * Math.max(0, w.warnTime - w.t) + 40) top *= 0.7;
        // 부스트가 끝나 최고 속도가 내려가면 순간적으로 깎지 않고 서서히 줄인다
        if (r.spin > 0) r.speed += (8 - r.speed) * damp(2.5, dt); // 스핀 중에는 거의 멈춘다
        else if (r.speed < top) r.speed = Math.min(top, r.speed + accelAt(r.speed, top) * dt);
        else r.speed += (top - r.speed) * damp(1.5, dt);
      } else {
        r.speed = 0;
      }
      r.spin = Math.max(0, r.spin - dt);
      r.boost = Math.max(0, r.boost - dt);
      r.dist += r.speed * dt;

      if (running && !r.finished && combat) {
        combat.pickup(r, r.prevDist, course, rankOf(r));
        r.itemWait -= dt;
        if (r.item && r.itemWait <= 0 && r.spin <= 0) this.#useItem(r, racers, combat);
      }

      // 차선 판단: 앞이 막히면 빈 차선으로, 아니면 부스터 패드를 노리거나(공격형은) 플레이어를 들이받으러 간다
      r.think -= dt;
      if (r.think <= 0 && running && r.spin <= 0) {
        r.think = 0.35 + Math.random() * 0.6;
        const obstacles = [...(combat?.mines ?? []).map(m => ({ dist: m.dist, x: m.x, w: 0.6 })), ...(nuke?.obstaclesAhead(r.dist, 35) ?? [])];
        const hazard = obstacles.some(m => m.dist > r.dist && m.dist - r.dist < 30 && Math.abs(m.x - r.x) < m.w + 1.2);
        const blocked = hazard || racers.some(o => o !== r && o.dist > r.dist && o.dist - r.dist < 14 && Math.abs(o.x - r.x) < 2.2 && o.speed <= r.speed + 1);
        const dz = player.dist - r.dist, dx = player.x - r.x;
        if (r.aggressive && !player.finished && Math.abs(dz) < 5 && Math.abs(dx) > 1.5 && Math.abs(dx) < 4.5 && Math.random() < 0.6) {
          r.targetX = player.x; // 옆에 나란히 붙으면 들이받으러 온다
        } else if (blocked) {
          const free = lanes.filter(l => !racers.some(o => o !== r && Math.abs(o.dist - r.dist) < 12 && Math.abs(o.x - l) < 2)
            && !obstacles.some(m => m.dist > r.dist && m.dist - r.dist < 30 && Math.abs(m.x - l) < m.w + 1.2));
          if (free.length) r.targetX = free.sort((a, b) => Math.abs(a - r.x) - Math.abs(b - r.x))[0];
        } else {
          const pad = course.padsBetween(r.dist + 20, r.dist + 70)[0];
          if (pad && Math.random() < ai.padChance) r.targetX = pad.x;
        }
      }
      // 옆으로 움직이는 속도. 들이받으러 갈 때는 더 빠르게 꺾는다
      const lateral = r.aggressive && Math.abs(r.targetX - player.x) < 0.1 ? 9 : 6;
      r.vx = r.spin > 0 ? 0 : clamp((r.targetX - r.x) * 2.5, -lateral, lateral);
      r.x = clamp(r.x + r.vx * dt, -CONFIG.playerHalfX, CONFIG.playerHalfX);

      if (!r.finished && r.dist >= CONFIG.race.laps * course.lapLength) {
        r.finished = true;
        r.finishTime = raceTime;
      }
    }
  }

  // AI 아이템 사용: 미사일은 앞에 목표가 있을 때, 지뢰는 뒤에 차가 붙었을 때, 나머지는 바로 쓴다
  #useItem(r, racers, combat) {
    const { missile } = CONFIG.items;
    if (r.item === 'missile') {
      const ahead = racers.some(o => o !== r && !o.finished && o.dist > r.dist && o.dist - r.dist < missile.range);
      if (!ahead && r.itemWait > -6) return; // 6초 기다려도 목표가 없으면 그냥 쏜다
    } else if (r.item === 'mine') {
      const behind = racers.some(o => o !== r && o.dist < r.dist && r.dist - o.dist < 25);
      if (!behind && r.itemWait > -5) return;
    }
    combat.use(r, racers);
  }

  hide() {
    for (const r of this.list) r.car.visible = false;
  }

  // 플레이어 기준 상대 위치로 그린다(플레이어는 z=0 고정)
  render(playerDist) {
    for (const r of this.list) {
      const z = playerDist - r.dist;
      r.car.visible = z > -200 && z < 25;
      if (!r.car.visible) continue;
      r.car.position.set(r.x, 0, z);
      r.car.rotation.y = r.spin > 0 ? r.spin * 10 : -clamp(r.vx, -9, 9) * 0.03; // 스핀 중에는 팽이처럼 돈다
    }
  }
}

// 부스터 패드 밟기: 이번 프레임에 지나간 구간 안에 패드가 있고 좌우로 겹치면 부스트
export function checkPads(r, prevDist, course) {
  for (const pad of course.padsBetween(prevDist, r.dist)) {
    if (Math.abs(pad.x - r.x) < 1.6) {
      r.boost = CONFIG.speed.boostTime;
      r.boostExtra = CONFIG.speed.boostExtra;
      return true;
    }
  }
  return false;
}

// 두 레이서가 겹치면 옆으로 떼어 놓고, 뒤에 있던 쪽이 속도를 잃는다.
// 옆으로 세게(slam.lateral 이상) 들이받으면 맞은 쪽이 스핀한다. 반환값: 없음 | 'bump' | { slam: 가해자, victim }
export function resolveBump(a, b) {
  const w = carDims.halfW * 2 * 0.95, l = carDims.halfL * 2 * 0.9;
  const dx = a.x - b.x, dz = a.dist - b.dist;
  if (Math.abs(dx) >= w || Math.abs(dz) >= l) return null;
  const dir = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx);
  // 서로를 향해 다가간 옆 속도. a가 b 쪽(-dir)으로 움직이면 +
  const aIn = -dir * a.vx, bIn = dir * b.vx;
  const push = (w - Math.abs(dx)) / 2 + 0.05;
  a.x += dir * push; b.x -= dir * push;
  const { slam, bump } = CONFIG;
  if (Math.max(aIn, bIn) > slam.lateral && a.spin <= 0 && b.spin <= 0) {
    const [att, vic] = aIn > bIn ? [a, b] : [b, a];
    if (vic.shield > 0) { vic.shield = 0; return { blocked: true, slam: att, victim: vic }; }
    vic.spin = slam.spin;
    vic.speed *= 0.6;
    att.speed *= 1 - slam.attackerLoss;
    return { slam: att, victim: vic };
  }
  a.vx += dir * bump.push; b.vx -= dir * bump.push;
  const back = dz < 0 ? a : b;
  back.speed *= 1 - bump.speedLoss;
  return 'bump';
}

// 순위: 완주한 레이서는 완주 시간순, 나머지는 달린 거리순
export function standings(racers) {
  return [...racers].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.dist - a.dist;
  });
}
