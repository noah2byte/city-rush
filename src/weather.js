import * as THREE from 'three';

// 비. 빗줄기를 선분으로 그리고 카메라 주변 상자 안에서만 순환시킨다.
// 파티클 수는 고정하고 drawRange로 보이는 개수만 조절해, 비가 오다 그칠 때 메모리 할당이 없다
export class Rain {
  constructor(scene, count = 2200) {
    this.count = count;
    this.pos = new Float32Array(count * 6);
    this.drops = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.#respawn(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ color: '#A8B8D8', transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.mesh = new THREE.LineSegments(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  #respawn(i, anyHeight) {
    const d = this.drops;
    d[i * 3] = (Math.random() * 2 - 1) * 28;
    d[i * 3 + 1] = anyHeight ? Math.random() * 22 : 18 + Math.random() * 6;
    d[i * 3 + 2] = 8 - Math.random() * 90;
  }

  update(dt, speed, amount) {
    this.mat.opacity = 0.3 * amount;
    this.mesh.visible = amount > 0.01;
    if (!this.mesh.visible) return;
    const n = Math.floor(this.count * amount);
    this.mesh.geometry.setDrawRange(0, n * 2);
    // 빗줄기 기울기는 낙하 속도와 차의 속도로 정해진다. 빠를수록 비가 앞에서 날아오는 것처럼 눕는다
    const fall = 24, sx = 0, sz = speed * 0.02, len = 0.9;
    const d = this.drops, p = this.pos;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      d[j + 1] -= fall * dt;
      d[j + 2] += speed * dt;
      if (d[j + 1] < 0 || d[j + 2] > 8) this.#respawn(i, false);
      const k = i * 6;
      p[k] = d[j]; p[k + 1] = d[j + 1]; p[k + 2] = d[j + 2];
      p[k + 3] = d[j] + sx; p[k + 4] = d[j + 1] + len; p[k + 5] = d[j + 2] - sz;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
