// 우승 꽃가루. 3D 장면이 아닌 2D 캔버스에 그려 블룸·안개 같은 후처리 영향을 받지 않게 한다
const COLORS = ['#FFD23F', '#FF3CAC', '#2EE6D6', '#7CFF4F', '#FF6B3D', '#F2F4FF'];

export class Confetti {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.resize();
  }

  resize() {
    this.canvas.width = innerWidth * Math.min(devicePixelRatio, 2);
    this.canvas.height = innerHeight * Math.min(devicePixelRatio, 2);
  }

  burst(n = 220) {
    const W = this.canvas.width, H = this.canvas.height;
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0; // 양쪽 아래 모서리에서 쏘아 올린다
      this.parts.push({
        x: left ? 0 : W, y: H * 0.9,
        vx: (left ? 1 : -1) * (0.25 + Math.random() * 0.55) * W, vy: -(0.6 + Math.random() * 0.7) * H,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
        size: (6 + Math.random() * 8) * Math.min(devicePixelRatio, 2),
        color: COLORS[(Math.random() * COLORS.length) | 0], life: 4 + Math.random() * 2,
      });
    }
  }

  stop() {
    this.parts.length = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  update(dt) {
    if (!this.parts.length) return;
    const { ctx, canvas } = this;
    const g = canvas.height * 0.9;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of this.parts) {
      p.vy += g * dt;
      p.vx *= 1 - 1.2 * dt; // 공기 저항으로 금방 느려져 하늘하늘 떨어진다
      p.vy *= 1 - 1.2 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= dt;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    this.parts = this.parts.filter(p => p.life > 0 && p.y < canvas.height + 50);
    if (!this.parts.length) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}
