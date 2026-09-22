import * as THREE from 'three';
import { CONFIG } from './config.js';
import { bent, noCull, bendOffset } from './bend.js';

const rand = (a, b) => a + Math.random() * (b - a);

// 핵폭격 이벤트: 경보 → 낙하 → 폭발 → 폐허.
// 선두 무리가 도착할 지점을 노려서 앞선 차일수록 위험하다. 순위를 뒤집는 변수로 쓰기 위해서다
// 폐허는 바퀴 안 위치(lapPos)에 남아 이후 바퀴에도 그대로 장애물이 된다

function radial(inner, mid, outer = 'rgba(0,0,0,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner); grad.addColorStop(0.45, mid); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 조준 원: 붉은 고리와 삼각 경고 무늬
const targetTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = '#FF2A1A'; g.lineWidth = 14;
  for (const r of [118, 80]) { g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = '#FF2A1A';
  g.fillRect(122, 8, 12, 60); g.fillRect(122, 188, 12, 60); g.fillRect(8, 122, 60, 12); g.fillRect(188, 122, 60, 12);
  g.font = 'bold 70px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('☢', 128, 132);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const MAT = {
  target: bent(new THREE.MeshBasicMaterial({ map: targetTex, transparent: true, depthWrite: false, opacity: 0.9 })),
  beam: bent(new THREE.MeshBasicMaterial({ color: '#FF3020', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending })),
  body: bent(new THREE.MeshStandardMaterial({ color: '#C8CCD2', metalness: 0.7, roughness: 0.35 })),
  stripe: bent(new THREE.MeshStandardMaterial({ color: '#F2C230', emissive: '#F2C230', emissiveIntensity: 0.4 })),
  fireball: bent(new THREE.MeshBasicMaterial({ color: '#FFD9A0', transparent: true, depthWrite: false })),
  shock: bent(new THREE.MeshBasicMaterial({ color: '#FFF2DA', transparent: true, depthWrite: false, side: THREE.DoubleSide })),
  cloudHot: bent(new THREE.MeshStandardMaterial({ color: '#6B5448', emissive: '#FF7A2A', emissiveIntensity: 2, roughness: 1, transparent: true })),
  crater: bent(new THREE.MeshBasicMaterial({ map: radial('rgba(10,8,8,1)', 'rgba(30,20,16,.95)', 'rgba(40,30,26,0)'), transparent: true, depthWrite: false })),
  ember: bent(new THREE.MeshBasicMaterial({ map: radial('rgba(255,140,40,.9)', 'rgba(255,60,20,.4)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })),
  rubble: bent(new THREE.MeshStandardMaterial({ color: '#5E5852', roughness: 1, flatShading: true })),
  charred: bent(new THREE.MeshStandardMaterial({ color: '#241E1C', roughness: 0.9, flatShading: true })),
  rebar: bent(new THREE.MeshStandardMaterial({ color: '#7A4A30', metalness: 0.6, roughness: 0.6 })),
};
const fireMat = new THREE.SpriteMaterial({ map: radial('rgba(255,240,180,1)', 'rgba(255,120,30,.8)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const smokeMat = new THREE.SpriteMaterial({ map: radial('rgba(60,55,55,.9)', 'rgba(50,46,46,.5)'), depthWrite: false, transparent: true });

const GEO = {
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  beam: new THREE.CylinderGeometry(1, 1, 1, 16, 1, true),
  body: new THREE.CylinderGeometry(0.7, 0.7, 7, 12),
  nose: new THREE.ConeGeometry(0.7, 2, 12),
  sphere: new THREE.SphereGeometry(1, 20, 14),
  ring: new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
  rock: new THREE.DodecahedronGeometry(1, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
};

const mesh = (geo, mat) => noCull(new THREE.Mesh(geo, mat));

export class NukeEvents {
  constructor(scene, hooks = {}) {
    this.scene = scene;
    this.hooks = hooks;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.events = [];
    this.ruins = [];     // 폐허(바퀴 안 위치에 남는 장애물·연출)
  }

  reset(lapLength) {
    this.root.clear();
    this.events = [];
    this.ruins = [];
    this.lapLength = lapLength;
    // 레이스당 두 번: 선두가 2바퀴째 초반과 3바퀴째 초중반을 지날 때. 결승 직전은 피한다(마지막 순간 운만으로 결판나지 않게)
    const { laps } = CONFIG.race;
    const at = [rand(0.85, 1.15), rand(1.9, 2.3)].filter(f => f < laps - 0.15);
    for (const f of at) this.events.push({ trigger: f * lapLength, state: 'pending' });
  }

  // 폐허 인스턴스의 절대 위치: 폭발한 바퀴부터 매 바퀴 같은 자리에 있다
  #instance(ruin, dist) {
    const k = Math.max(0, Math.round((dist - ruin.at) / this.lapLength));
    return ruin.at + k * this.lapLength;
  }

  // AI가 피할 장애물(앞쪽 range m 안). 지뢰와 같은 방식으로 차선 판단에 쓴다
  obstaclesAhead(dist, range = 40) {
    const out = [];
    for (const r of this.ruins) {
      for (const d of r.debris) {
        const inst = this.#instance(r, dist - d.dz) + d.dz;
        if (inst > dist && inst - dist < range) out.push({ dist: inst, x: d.x, w: d.w });
      }
    }
    return out;
  }

  // 경보 중인 폭심(AI가 감속 판단에 쓴다)
  get warning() {
    return this.events.find(e => e.state === 'warning' || e.state === 'falling') ?? null;
  }

  update(dt, racers, leader) {
    for (const e of this.events) {
      e.t = (e.t ?? 0) + dt;
      if (e.state === 'pending' && leader.dist >= e.trigger) this.#warn(e, leader);
      else if (e.state === 'warning' && e.t >= e.warnTime - 1.4) { e.state = 'falling'; this.#spawnMissile(e); }
      else if (e.state === 'falling' && e.t >= e.warnTime) this.#impact(e, racers);
      else if (e.state === 'blast' && e.t >= e.warnTime + 9) e.state = 'done';
    }
    // 폐허 잔해와 충돌: 스핀하고 크게 감속한다
    for (const r of this.ruins) {
      for (const d of r.debris) {
        for (const c of racers) {
          if (c.finished || c.spin > 0) continue;
          const inst = this.#instance(r, c.dist - d.dz) + d.dz;
          if (Math.abs(c.dist - inst) < d.l && Math.abs(c.x - d.x) < d.w + 0.9) {
            if (c.shield > 0) { c.shield = 0; continue; }
            // 폐허는 이후 바퀴에도 남아 여러 번 걸릴 수 있어, 폭발 직격보다 훨씬 가볍게 둔다
            c.spin = 0.5;
            c.speed *= 0.65;
            this.hooks.onDebris?.(c);
          }
        }
      }
    }
  }

  #warn(e, leader) {
    e.state = 'warning';
    e.t = 0;
    e.warnTime = 5;
    // 선두가 경보 시간 뒤 도착할 지점(+약간 앞)을 노린다
    e.at = leader.dist + leader.speed * e.warnTime + 25;
    e.fx = new THREE.Group();
    e.target = mesh(GEO.plane, MAT.target);
    e.target.scale.set(16, 1, 16);
    e.target.position.y = 0.05;
    e.beam = mesh(GEO.beam, MAT.beam);
    e.beam.scale.set(1.6, 160, 1.6); // 가늘고 진한 빛기둥이 멀리서도 낙하 지점을 알려 준다
    e.beam.position.y = 80;
    e.fx.add(e.target, e.beam);
    this.root.add(e.fx);
    this.hooks.onWarn?.(e);
  }

  #spawnMissile(e) {
    e.missile = new THREE.Group();
    const body = mesh(GEO.body, MAT.body);
    const nose = mesh(GEO.nose, MAT.stripe);
    nose.position.y = -4.5; nose.rotation.x = Math.PI; // 아래를 향해 떨어진다
    const band = mesh(GEO.body, MAT.stripe);
    band.scale.set(1.05, 0.08, 1.05);
    e.missile.add(body, nose, band);
    e.trail = [];
    e.fx.add(e.missile);
  }

  #impact(e, racers) {
    e.state = 'blast';
    e.fx.remove(e.target, e.beam, e.missile);
    for (const s of e.trail) e.fx.remove(s);
    // 폭심 ±45m 안의 차는 모두 스핀하며 거의 멈춘다(방패는 한 번 막는다)
    const hit = [];
    for (const c of racers) {
      if (c.finished) continue;
      const d = Math.abs(c.dist - e.at);
      if (d > 45) continue;
      if (c.shield > 0) { c.shield = 0; continue; }
      c.spin = 1.8 - d / 60;
      c.speed *= 0.15 + d / 90;
      c.boost = 0;
      hit.push(c);
    }
    // 폭발 연출: 불덩이, 충격파, 버섯구름
    e.fireball = mesh(GEO.sphere, MAT.fireball.clone());
    e.shock = mesh(GEO.ring, MAT.shock.clone());
    e.stem = mesh(GEO.sphere, MAT.cloudHot.clone());
    e.cap = mesh(GEO.sphere, MAT.cloudHot.clone());
    e.fx.add(e.fireball, e.shock, e.stem, e.cap);
    this.#makeRuin(e);
    this.hooks.onImpact?.(e, hit);
  }

  // 폐허: 크레이터, 잔해 더미(차선을 막되 한 줄은 비운다), 불, 연기 기둥
  #makeRuin(e) {
    const ruin = { at: e.at, debris: [], group: new THREE.Group(), fires: [], smokes: [] };
    const crater = mesh(GEO.plane, MAT.crater);
    crater.scale.set(34, 1, 70);
    crater.position.y = 0.04;
    ruin.group.add(crater);
    for (let k = 0; k < 10; k++) { // 달아오른 균열
      const em = mesh(GEO.plane, MAT.ember);
      em.scale.set(rand(2, 5), 1, rand(3, 8));
      em.position.set(rand(-6, 6), 0.06, rand(-30, 30));
      ruin.group.add(em);
    }
    const lanes = CONFIG.lanes;
    for (let dz = -48; dz <= 48; dz += 16) {
      // 이 줄에서 막을 차선 2~3개(적어도 한 차선은 비운다)
      const free = lanes[(Math.random() * lanes.length) | 0];
      for (const x of lanes) {
        if (x === free || Math.random() < 0.3) continue;
        const w = rand(0.9, 1.4), l = rand(1.2, 2.2), jitter = rand(-4, 4);
        ruin.debris.push({ dz: dz + jitter, x: x + rand(-0.4, 0.4), w, l });
        const g = new THREE.Group();
        const rock = mesh(GEO.rock, Math.random() < 0.5 ? MAT.rubble : MAT.charred);
        rock.scale.set(w * 1.1, rand(0.8, 1.6), l);
        rock.position.y = 0.5;
        g.add(rock);
        if (Math.random() < 0.5) { // 튀어나온 철근
          const bar = mesh(GEO.box, MAT.rebar);
          bar.scale.set(0.08, rand(1.5, 2.5), 0.08);
          bar.position.set(rand(-0.4, 0.4), 1.2, 0);
          bar.rotation.z = rand(-0.6, 0.6);
          g.add(bar);
        }
        g.position.set(x, 0, -(dz + jitter));
        g.userData.dz = dz + jitter;
        ruin.group.add(g);
        if (Math.random() < 0.45) {
          const f = new THREE.Sprite(fireMat.clone());
          f.position.set(x, 1.4, -(dz + jitter));
          f.userData.base = rand(2.2, 3.4);
          ruin.fires.push(f); ruin.group.add(f);
        }
      }
    }
    for (let k = 0; k < 6; k++) { // 폭발에 들려 기울어진 도로 판
      const slab = mesh(GEO.box, MAT.rubble);
      slab.scale.set(rand(3, 6), 0.4, rand(3, 6));
      slab.position.set(rand(-9, 9) * (Math.random() < 0.5 ? 1 : 1.6), 0.4, rand(-40, 40));
      slab.rotation.set(rand(-0.4, 0.4), rand(0, 3), rand(-0.4, 0.4));
      ruin.group.add(slab);
    }
    for (let k = 0; k < 3; k++) { // 길가에 뒤집혀 불타는 차 잔해
      const side = Math.random() < 0.5 ? -1 : 1, z = rand(-40, 40);
      const wreck = mesh(GEO.box, MAT.charred);
      wreck.scale.set(1.9, 1.1, 4.2);
      wreck.position.set(side * rand(7.5, 10), 0.6, z);
      wreck.rotation.set(0, rand(0, 3), side * 0.4);
      const f = new THREE.Sprite(fireMat.clone());
      f.position.set(wreck.position.x, 1.8, z);
      f.userData.base = rand(3, 4.5);
      ruin.fires.push(f);
      ruin.group.add(wreck, f);
    }
    for (let k = 0; k < 5; k++) { // 연기 기둥
      const sm = new THREE.Sprite(smokeMat.clone());
      sm.position.set(rand(-14, 14), rand(6, 22), rand(-40, 40));
      sm.scale.setScalar(rand(10, 18));
      sm.userData.phase = Math.random() * 6;
      ruin.smokes.push(sm); ruin.group.add(sm);
    }
    this.ruins.push(ruin);
    this.root.add(ruin.group);
  }

  render(playerDist, t) {
    for (const e of this.events) {
      if (!e.fx) continue;
      e.fx.position.z = playerDist - e.at;
      if (e.state === 'warning' || e.state === 'falling') {
        const pulse = 0.55 + 0.45 * Math.sin(t * 12);
        e.target.material.opacity = pulse;
        e.target.rotation.y = t * 0.8;
        e.beam.material.opacity = 0.3 + 0.35 * pulse;
      }
      if (e.state === 'falling') {
        // 멀리 앞 하늘에서 비스듬히 날아와 내리꽂힌다. 수직으로 떨어지면 카메라 시야 밖이라 오는 게 보이지 않는다
        const k = Math.min(1, (e.t - (e.warnTime - 1.4)) / 1.4), q = k * k;
        const mz = -260 * (1 - q);
        // 미사일 몸체는 곡선 셰이더로 휘지만 꼬리 불꽃(스프라이트)은 휘지 않는다. 같은 변위를 CPU에서 더해 궤적을 맞춘다
        const off = bendOffset(e.fx.position.z + mz);
        e.missile.position.set(0, 90 * (1 - q) + 3, mz);
        e.missileOff = off;
        e.missile.rotation.x = -Math.atan2(260, 90) * 0.85; // 진행 방향으로 기울인다
        if (Math.random() < 0.7) {
          const s = new THREE.Sprite(fireMat.clone());
          s.position.copy(e.missile.position);
          s.position.x += e.missileOff.x;
          s.position.y += e.missileOff.y + 3;
          s.scale.setScalar(rand(2, 4));
          s.userData.born = t;
          e.trail.push(s); e.fx.add(s);
        }
        for (const s of e.trail) s.material.opacity = Math.max(0, 1 - (t - s.userData.born) * 1.2);
      }
      if (e.state === 'blast' || e.state === 'done') {
        const k = e.t - e.warnTime; // 폭발 후 경과 시간
        const fb = Math.min(1, k / 0.4);
        e.fireball.scale.setScalar(4 + fb * 26);
        e.fireball.position.y = 6 + k * 3;
        e.fireball.material.opacity = Math.max(0, 1 - k / 1.4);
        e.fireball.visible = k < 1.4;
        e.shock.scale.setScalar(5 + k * 140);
        e.shock.position.y = 0.5;
        e.shock.material.opacity = Math.max(0, 0.8 - k / 1.6);
        e.shock.visible = k < 1.6;
        // 버섯구름: 기둥이 솟고 갓이 펼쳐진다. 처음엔 불빛이 강하다가 점점 잿빛으로 식는다
        const rise = Math.min(1, k / 4);
        e.stem.scale.set(5 + rise * 3, 8 + rise * 34, 5 + rise * 3);
        e.stem.position.y = 8 + rise * 32;
        e.cap.scale.set(10 + rise * 30, 8 + rise * 12, 10 + rise * 30);
        e.cap.position.y = 20 + rise * 62;
        const cool = Math.max(0, 2 - k * 0.35);
        const fade = e.state === 'done' ? Math.max(0, 1 - (k - 9) / 4) : 1;
        for (const m of [e.stem, e.cap]) { m.material.emissiveIntensity = cool; m.material.opacity = 0.95 * fade; m.visible = fade > 0; }
      }
    }
    for (const r of this.ruins) {
      const inst = this.#instance(r, playerDist + 60);
      r.group.position.z = playerDist - inst;
      r.group.visible = Math.abs(playerDist - inst) < 260;
      for (const f of r.fires) {
        const s = f.userData.base * (0.8 + 0.25 * Math.sin(t * 17 + f.position.x * 3) + 0.15 * Math.random());
        f.scale.set(s, s * 1.4, 1);
      }
      for (const sm of r.smokes) sm.position.y += Math.sin(t * 0.5 + sm.userData.phase) * 0.02;
    }
  }
}
