// 속도선: 화면 가장자리에서 가운데로 흐르는 흰 선. 3D가 아닌 2D 캔버스라 비용이 거의 없고,
// 같은 속도라도 체감 속도를 크게 올려 준다
export class SpeedLines {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lines = Array.from({ length: 36 }, () => this.#spawn(Math.random()));
    this.resize();
  }

  resize() {
    this.canvas.width = innerWidth;
    this.canvas.height = innerHeight;
  }

  #spawn(t = 0) {
    return { a: Math.random() * Math.PI * 2, r: 0.55 + Math.random() * 0.5, t, speed: 1.5 + Math.random() * 1.5 };
  }

  update(dt, amount) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (amount <= 0.01) return;
    const cx = canvas.width / 2, cy = canvas.height * 0.42, R = Math.hypot(cx, cy);
    ctx.lineWidth = 2;
    for (const l of this.lines) {
      l.t += dt * l.speed;
      if (l.t > 1) Object.assign(l, this.#spawn());
      // 바깥에서 안쪽으로 흐른다. 가운데(시선 방향)는 비워 도로가 가려지지 않게 한다
      const r1 = R * (l.r + (1 - l.t) * 0.5), r2 = r1 - R * 0.18 * amount;
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * amount * Math.sin(l.t * Math.PI)})`;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(l.a) * r1, cy + Math.sin(l.a) * r1);
      ctx.lineTo(cx + Math.cos(l.a) * r2, cy + Math.sin(l.a) * r2);
      ctx.stroke();
    }
  }
}
