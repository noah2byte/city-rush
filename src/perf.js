// 기기 성능에 맞춰 렌더링 해상도를 자동 조절한다.
// 프레임이 무거우면 해상도를 낮추고, 여유가 생기면 다시 올린다. 버벅임보다 약간 흐린 화면이 낫기 때문이다
export class AdaptiveResolution {
  constructor(renderer, composer) {
    this.renderer = renderer;
    this.composer = composer;
    this.max = Math.min(devicePixelRatio, 1.5); // 블룸 비용이 해상도에 비례해 늘어 상한을 둔다
    this.min = 0.6;
    this.ratio = this.max;
    this.avg = 1 / 60;
    this.cooldown = 1;
    this.apply();
  }

  apply() {
    this.renderer.setPixelRatio(this.ratio);
    this.composer.setPixelRatio(this.ratio);
  }

  update(dt) {
    this.avg += (dt - this.avg) * 0.05; // 지수 이동 평균으로 순간 튐에 반응하지 않게 한다
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    // 해상도 변경은 버퍼 재할당이라 그 자체로 한 번 끊긴다. 자주 바꾸지 않도록 간격과 여유 폭을 둔다
    if (this.avg > 1 / 45 && this.ratio > this.min) {
      this.ratio = Math.max(this.min, this.ratio - 0.15);
      this.apply();
      this.cooldown = 2;
    } else if (this.avg < 1 / 58 && this.ratio < this.max) {
      this.ratio = Math.min(this.max, this.ratio + 0.1);
      this.apply();
      this.cooldown = 4;
    }
  }
}

// 주소 끝에 #debug를 붙이면 FPS·드로콜·삼각형 수·해상도 배율을 보여준다
export class DebugOverlay {
  constructor(renderer, adaptive) {
    this.renderer = renderer;
    this.adaptive = adaptive;
    // 후처리 패스마다 render()가 호출되므로 자동 초기화를 끄고 한 프레임 합계를 직접 잰다
    renderer.info.autoReset = false;
    this.el = document.createElement('pre');
    this.el.style.cssText = 'position:fixed;left:8px;bottom:8px;margin:0;padding:6px 8px;background:rgba(0,0,0,.6);color:#9f9;font:12px/1.4 monospace;pointer-events:none;z-index:9';
    document.body.append(this.el);
    this.t = 0;
    this.frames = 0;
  }

  update() {
    const { calls, triangles } = this.renderer.info.render;
    this.renderer.info.reset();
    // FPS는 dt(0.05초로 잘림)가 아닌 실제 경과 시간으로 잰다. 느린 기기에서 FPS가 부풀려 보이지 않게 하기 위함이다
    const now = performance.now();
    this.start ??= now;
    this.frames++;
    this.t = (now - this.start) / 1000;
    if (this.t < 0.5) return;
    this.el.textContent = `fps ${(this.frames / this.t).toFixed(0)}  calls ${calls}  tris ${(triangles / 1000).toFixed(0)}k  dpr ${this.adaptive.ratio.toFixed(2)}`;
    this.start = now;
    this.frames = 0;
  }
}
