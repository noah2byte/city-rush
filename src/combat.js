import * as THREE from 'three';
import { CONFIG } from './config.js';
import { bent, noCull } from './bend.js';

const clamp = THREE.MathUtils.clamp;

export const ITEMS = {
  boost: { icon: '🚀', name: '부스터' },
  missile: { icon: '🎯', name: '유도 미사일' },
  mine: { icon: '💣', name: '지뢰' },
  shield: { icon: '🛡️', name: '방패' },
};

// 순위별 아이템 확률. 뒤처질수록 따라잡는 아이템이, 앞설수록 지키는 아이템이 잘 나온다(마리오 카트 방식).
// 1등이 공격 아이템을 계속 받으면 격차가 벌어지기만 해서 레이스가 일찍 결판난다
const TABLE = [
  { upTo: 2, w: { mine: 45, shield: 35, missile: 15, boost: 5 } },
  { upTo: 5, w: { missile: 40, boost: 30, mine: 15, shield: 15 } },
  { upTo: 99, w: { boost: 45, missile: 45, shield: 10 } },
];
export function rollItem(rank) {
  const w = TABLE.find(t => rank <= t.upTo).w;
  let n = Math.random() * Object.values(w).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(w)) if ((n -= v) < 0) return k;
  return 'boost';
}

function glowTex(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner); grad.addColorStop(0.35, outer); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const missileGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.2, 8).rotateX(Math.PI / 2);
const missileMat = bent(new THREE.MeshStandardMaterial({ color: '#E8E8EC', emissive: '#FF5A1F', emissiveIntensity: 1.5, metalness: 0.6, roughness: 0.3 }));
const mineGeo = new THREE.CylinderGeometry(0.55, 0.65, 0.25, 14);
const mineMat = bent(new THREE.MeshStandardMaterial({ color: '#1C1C1E', emissive: '#FF2020', emissiveIntensity: 0, roughness: 0.5 }));
const bubbleGeo = new THREE.SphereGeometry(1, 20, 14);
const bubbleMat = bent(new THREE.MeshStandardMaterial({ color: '#7FE8FF', emissive: '#7FE8FF', emissiveIntensity: 0.6, transparent: true, opacity: 0.25, depthWrite: false }));
// 불꽃·섬광: 가산 합성 스프라이트. 블룸이 걸려 짧게 번쩍인다
const flashMat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,255,230,1)', 'rgba(255,140,40,.8)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const trailMat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,220,160,1)', 'rgba(255,90,30,.6)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const shieldFlashMat = new THREE.SpriteMaterial({ map: glowTex('rgba(220,255,255,1)', 'rgba(80,220,255,.8)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });

// 미사일·지뢰·방패·폭발을 관리한다. 모든 위치는 레이서와 같은 좌표(dist: 코스상 거리, x: 좌우)로 둔다
export class Combat {
  constructor(scene, { onHit, onBlock } = {}) {
    this.scene = scene;
    this.onHit = onHit;
    this.onBlock = onBlock;
    this.missiles = [];
    this.mines = [];
    this.fx = [];
    this.bubbles = new Map();
    this.meshPool = { missile: [], mine: [], flash: [], trail: [] };
  }

  #mesh(kind) {
    const free = this.meshPool[kind].pop();
    if (free) { free.visible = true; return free; }
    let m;
    if (kind === 'missile') m = new THREE.Mesh(missileGeo, missileMat);
    else if (kind === 'mine') m = new THREE.Mesh(mineGeo, mineMat);
    else m = new THREE.Sprite((kind === 'flash' ? flashMat : trailMat).clone()); // 불꽃마다 투명도가 달라 재질을 따로 둔다
    noCull(m);
    this.scene.add(m);
    return m;
  }
  #free(kind, m) { m.visible = false; this.meshPool[kind].push(m); }

  reset() {
    for (const m of this.missiles) this.#free('missile', m.mesh);
    for (const m of this.mines) this.#free('mine', m.mesh);
    for (const f of this.fx) this.#free(f.kind, f.mesh);
    this.missiles = []; this.mines = []; this.fx = [];
    for (const b of this.bubbles.values()) b.visible = false;
  }

  // 아이템 박스 줄을 이번 프레임에 지나갔으면 아이템을 준다(이미 들고 있으면 못 받는다)
  pickup(r, prevDist, course, rank) {
    if (r.item || r.finished) return false;
    if (!course.itemRowsBetween(prevDist, r.dist).length) return false;
    r.item = rollItem(rank);
    r.itemWait = 0.4 + Math.random() * 1.2; // AI가 받자마자 쓰지 않게 잠깐 들고 있는다
    return true;
  }

  use(r, racers) {
    const it = CONFIG.items;
    const kind = r.item;
    if (!kind) return false;
    r.item = null;
    if (kind === 'boost') {
      r.boost = it.boost.time;
      r.boostExtra = it.boost.extra;
    } else if (kind === 'shield') {
      r.shield = it.shield.time;
    } else if (kind === 'mine') {
      this.mines.push({ dist: r.dist - it.mine.dropBack, x: r.x, owner: r, life: it.mine.life, arm: 0.3, mesh: this.#mesh('mine') });
    } else if (kind === 'missile') {
      // 바로 앞(완주 전) 레이서를 노린다. 앞에 아무도 없으면 앞으로 그냥 날아간다
      const target = racers.filter(o => o !== r && !o.finished && o.dist > r.dist && o.dist - r.dist < it.missile.range * 3)
        .sort((a, b) => a.dist - b.dist)[0] ?? null;
      this.missiles.push({ dist: r.dist + 2.5, x: r.x, owner: r, target, life: it.missile.life, mesh: this.#mesh('missile'), trailT: 0 });
    }
    return kind;
  }

  hit(victim, attacker, kind) {
    if (victim.shield > 0) {
      victim.shield = 0;
      this.#burst(victim.dist, victim.x, 1.2, 'shield');
      this.onBlock?.(victim, attacker, kind);
      return;
    }
    victim.spin = CONFIG.items.spinTime;
    victim.speed *= CONFIG.items.spinSpeedKeep;
    victim.boost = 0;
    this.#burst(victim.dist, victim.x, 2.4, 'hit');
    this.onHit?.(victim, attacker, kind);
  }

  #burst(dist, x, size, type) {
    const mesh = this.#mesh('flash');
    mesh.material.map = (type === 'shield' ? shieldFlashMat : flashMat).map;
    this.fx.push({ kind: 'flash', mesh, dist, x, y: 1, t: 0, life: 0.45, size });
  }

  update(dt, racers) {
    const it = CONFIG.items;
    for (const r of racers) r.shield = Math.max(0, (r.shield ?? 0) - dt);

    this.missiles = this.missiles.filter(m => {
      m.life -= dt;
      m.dist += it.missile.speed * dt;
      if (m.target && !m.target.finished) {
        m.x += clamp(m.target.x - m.x, -14 * dt, 14 * dt); // 좌우로 따라붙는다
        if (Math.abs(m.target.dist - m.dist) < 2.4 && Math.abs(m.target.x - m.x) < 1.8) {
          this.hit(m.target, m.owner, 'missile');
          this.#free('missile', m.mesh);
          return false;
        }
      }
      m.trailT -= dt;
      if (m.trailT <= 0) { // 꼬리 불꽃
        m.trailT = 0.03;
        this.fx.push({ kind: 'trail', mesh: this.#mesh('trail'), dist: m.dist - 0.8, x: m.x, y: 0.8, t: 0, life: 0.35, size: 0.9 });
      }
      if (m.life <= 0) { this.#free('missile', m.mesh); return false; }
      return true;
    });

    this.mines = this.mines.filter(mine => {
      mine.life -= dt;
      mine.arm -= dt;
      if (mine.arm <= 0) {
        for (const r of racers) {
          if (r.finished || r.spin > 0) continue;
          if (r.prevDist <= mine.dist + 1.2 && r.dist >= mine.dist - 1.2 && Math.abs(r.x - mine.x) < 1.5) {
            this.hit(r, mine.owner, 'mine');
            this.#free('mine', mine.mesh);
            return false;
          }
        }
      }
      if (mine.life <= 0) { this.#free('mine', mine.mesh); return false; }
      return true;
    });

    this.fx = this.fx.filter(f => {
      f.t += dt;
      if (f.t >= f.life) { this.#free(f.kind, f.mesh); return false; }
      return true;
    });
  }

  // 플레이어 기준 상대 위치로 그린다
  render(playerDist, racers, t) {
    const place = (mesh, dist, x, y) => {
      const z = playerDist - dist;
      mesh.visible = z > -220 && z < 25;
      mesh.position.set(x, y, z);
    };
    for (const m of this.missiles) { place(m.mesh, m.dist, m.x, 0.8); m.mesh.rotation.z += 0.3; }
    mineMat.emissiveIntensity = Math.sin(t * 12) > 0 ? 3 : 0.2; // 지뢰는 깜빡여서 멀리서도 보이게 한다
    for (const m of this.mines) place(m.mesh, m.dist, m.x, 0.15);
    for (const f of this.fx) {
      const k = f.t / f.life;
      place(f.mesh, f.dist, f.x, f.y);
      f.mesh.scale.setScalar(f.size * (0.6 + k * 1.6));
      f.mesh.material.opacity = 1 - k;
    }
    // 방패: 레이서마다 반투명 구를 씌운다
    for (const r of racers) {
      let b = this.bubbles.get(r);
      if (!b && r.shield > 0) {
        b = noCull(new THREE.Mesh(bubbleGeo, bubbleMat));
        b.scale.set(1.4, 1.1, 2.6);
        this.scene.add(b);
        this.bubbles.set(r, b);
      }
      if (!b) continue;
      b.visible = r.shield > 0;
      if (b.visible) place(b, r.dist, r.x, 0.8);
    }
  }
}
