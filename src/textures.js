import * as THREE from 'three';

// 건물·도로 텍스처를 캔버스로 생성한다.
// 같은 배치(layout)로 색상·발광·거칠기/금속성 세 장을 그려야 창문 위치가 맞으므로 배치를 먼저 정한다

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; // 거칠기·금속성 같은 데이터 텍스처는 색 변환을 하면 값이 틀어진다
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4; // 도로처럼 비스듬히 보이는 면이 뭉개지지 않게 한다
  return t;
}

const FACADES = [
  { wall: '#5A5C63', glass: '#141C26' }, // 콘크리트
  { wall: '#6B6258', glass: '#1A1A20' }, // 석재
  { wall: '#2A3440', glass: '#10202E' }, // 커튼월(유리 비중이 큰 오피스)
];
const LIGHTS = ['#FFD08A', '#FFE7B8', '#FFF4E0', '#BFD8FF'];

// 한 장 = 가로 4칸 × 16층. 창문 1칸이 약 2m × 2m가 되도록 repeat을 건다
export function facadeTextures(variant) {
  const f = FACADES[variant];
  const W = 256, H = 512, cols = 4, rows = 16;
  const cw = W / cols, ch = H / rows;
  const glassRatio = variant === 2 ? 0.86 : 0.62; // 커튼월은 창이 넓다

  const layout = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = Math.random() < 0.38;
      layout.push({
        r, c, lit,
        color: LIGHTS[(Math.random() * LIGHTS.length) | 0],
        curtain: lit && Math.random() < 0.4 ? 0.3 + Math.random() * 0.5 : 0, // 블라인드가 반쯤 내려온 창
        dim: 0.55 + Math.random() * 0.45,
      });
    }
  }

  const [cBase, gBase] = canvas(W, H);
  const [cEmit, gEmit] = canvas(W, H);
  const [cRM, gRM] = canvas(W, H);

  gBase.fillStyle = f.wall; gBase.fillRect(0, 0, W, H);
  // 벽면 얼룩: 균일한 단색은 CG 티가 가장 많이 나는 요소라 미세한 노이즈를 깐다
  for (let i = 0; i < 1800; i++) {
    gBase.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    gBase.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 2 + Math.random() * 6);
  }
  gEmit.fillStyle = '#000'; gEmit.fillRect(0, 0, W, H);
  // G 채널 = 거칠기, B 채널 = 금속성 (three.js의 metalnessMap/roughnessMap 규약)
  gRM.fillStyle = 'rgb(0,220,0)'; gRM.fillRect(0, 0, W, H);

  const gw = cw * glassRatio, gh = ch * 0.62;
  for (const w of layout) {
    const x = w.c * cw + (cw - gw) / 2;
    const y = w.r * ch + (ch - gh) / 2;
    // 층 슬래브 라인
    gBase.fillStyle = 'rgba(0,0,0,.25)';
    gBase.fillRect(w.c * cw, w.r * ch + ch - 2, cw, 2);

    gBase.fillStyle = f.glass; gBase.fillRect(x, y, gw, gh);
    gRM.fillStyle = 'rgb(0,30,170)'; gRM.fillRect(x, y, gw, gh); // 유리는 매끈하고 반사가 강하다

    if (w.lit) {
      const grad = gEmit.createLinearGradient(0, y, 0, y + gh);
      grad.addColorStop(0, w.color);
      grad.addColorStop(1, '#6B4A2A'); // 천장 조명이라 창 아래쪽이 어둡다
      gEmit.globalAlpha = w.dim;
      gEmit.fillStyle = grad; gEmit.fillRect(x, y, gw, gh);
      gEmit.globalAlpha = 1;
      if (w.curtain) {
        gEmit.fillStyle = '#000'; gEmit.fillRect(x, y, gw, gh * w.curtain);
      }
      // 창틀(멀리언)
      gEmit.fillStyle = '#000'; gEmit.fillRect(x + gw / 2 - 1, y, 2, gh);
    }
  }

  return { map: toTexture(cBase, true), emissiveMap: toTexture(cEmit, true), rmMap: toTexture(cRM, false) };
}

// 젖은 아스팔트: 거칠기 맵에 물웅덩이(낮은 거칠기)를 섞어 환경맵 반사가 군데군데 번들거리게 한다
export function asphaltTextures() {
  const S = 512;
  const [cBase, gBase] = canvas(S, S);
  const [cRM, gRM] = canvas(S, S);
  gBase.fillStyle = '#2B2B30'; gBase.fillRect(0, 0, S, S);
  for (let i = 0; i < 20000; i++) {
    const v = (Math.random() * 60) | 0;
    gBase.fillStyle = `rgba(${v + 40},${v + 40},${v + 44},.35)`;
    gBase.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
  }
  gRM.fillStyle = 'rgb(0,175,0)'; gRM.fillRect(0, 0, S, S);
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 20 + Math.random() * 70;
    const grad = gRM.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgb(0,25,0)');
    grad.addColorStop(1, 'rgba(0,175,0,0)');
    gRM.fillStyle = grad; gRM.fillRect(x - r, y - r, r * 2, r * 2);
    gBase.fillStyle = 'rgba(0,0,0,.18)'; // 젖은 곳은 색도 약간 짙다
    gBase.beginPath(); gBase.arc(x, y, r * 0.7, 0, Math.PI * 2); gBase.fill();
  }
  // 차선을 도로 텍스처에 직접 그린다. 차선을 별도 메시로 두면 곡선 셰이더에서 따로 휘어
  // 도로와 어긋나고, 수십 개 메시를 스크롤시키는 비용도 든다
  // 텍스처 한 장 = 도로 폭 12m × 길이 12m
  const px = x => ((x + 6) / 12) * S;
  for (const x of [-3, 0, 3]) {
    gBase.fillStyle = '#CFCDC6'; gBase.fillRect(px(x) - 3, 0, 6, S / 3); // 4m 칠하고 8m 비운다
    gRM.fillStyle = 'rgb(0,120,0)'; gRM.fillRect(px(x) - 3, 0, 6, S / 3); // 도료는 아스팔트보다 매끈하다
  }
  for (const x of [-5.7, 5.7]) {
    gBase.fillStyle = '#D9B44A'; gBase.fillRect(px(x) - 3, 0, 6, S);
  }
  return { map: toTexture(cBase, true), rmMap: toTexture(cRM, false) };
}

// 상가 1층 쇼윈도. 발광 맵만 쓰므로 한 장이면 된다
export function storefrontTexture() {
  const W = 512, H = 64;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const warm = ['#FFE2B0', '#FFF4E0', '#FFD08A', '#E8F0FF'];
  let x = 4;
  while (x < W - 20) {
    const w = 60 + Math.random() * 90;
    const lit = Math.random() < 0.8; // 셔터 내린 가게도 섞어야 자연스럽다
    if (lit) {
      g.fillStyle = warm[(Math.random() * warm.length) | 0];
      g.fillRect(x, 18, Math.min(w, W - 4 - x), H - 22);
      g.fillStyle = `hsl(${(Math.random() * 360) | 0},70%,55%)`; // 간판 띠
      g.fillRect(x, 4, Math.min(w, W - 4 - x), 10);
    } else {
      g.fillStyle = '#1A1A1E'; g.fillRect(x, 18, Math.min(w, W - 4 - x), H - 22);
    }
    x += w + 6;
  }
  return toTexture(c, true);
}

// ── 이하 구역 확장용 텍스처 ──

// 컨테이너 더미. 컨테이너를 하나씩 메시로 만들면 드로콜이 폭증하므로,
// 색이 다른 컨테이너 4단을 한 장에 그려 두고 "쌓인 높이"만큼 반복시켜 박스 하나로 표현한다
export function containerStackTexture() {
  const W = 256, H = 256, rows = 4, rh = H / rows;
  const [c, g] = canvas(W, H);
  const colors = ['#B8352B', '#1F5FA8', '#2F7D4A', '#D9822B', '#7A7F87', '#E3C33A', '#5B3A8C', '#C9CDD2'];
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    g.fillRect(0, y, W, rh);
    for (let x = 0; x < W; x += 6) { // 골판 주름
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, y, 2, rh);
    }
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, y + rh - 3, W, 3); // 컨테이너 사이 틈
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(W * 0.06, y + rh * 0.3, W * 0.2, rh * 0.18); // 선사 로고 자리(무지)
  }
  return toTexture(c, true);
}

// 한옥 마을 돌담: 크기가 제각각인 돌을 줄눈 사이로 채운다
export function stoneWallTexture() {
  const S = 256;
  const [c, g] = canvas(S, S / 2);
  g.fillStyle = '#3A3530'; g.fillRect(0, 0, S, S / 2);
  let y = 0;
  while (y < S / 2) {
    const h = 14 + Math.random() * 12;
    let x = -Math.random() * 20;
    while (x < S) {
      const w = 18 + Math.random() * 26;
      const v = 95 + Math.random() * 50;
      g.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
      g.beginPath(); g.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, 5); g.fill();
      x += w;
    }
    y += h;
  }
  g.fillStyle = '#2E3033'; g.fillRect(0, 0, S, 8); // 담장 위 기와
  return toTexture(c, true);
}

// 한옥 벽: 흰 회벽 + 나무 기둥 + 창호지 창. 창호지는 발광 맵에서 은은하게 빛난다
export function hanokWallTextures() {
  const W = 256, H = 64;
  const [cb, gb] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  gb.fillStyle = '#D9D2C3'; gb.fillRect(0, 0, W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 64) {
    gb.fillStyle = '#4A2E1C'; gb.fillRect(x, 0, 6, H); // 기둥
    if (Math.random() < 0.7) {
      gb.fillStyle = '#E8DCC0'; gb.fillRect(x + 14, 14, 36, 36);
      ge.fillStyle = '#FFB86B'; ge.fillRect(x + 14, 14, 36, 36);
      for (const g of [gb, ge]) { // 창살
        g.fillStyle = g === gb ? '#5A3A24' : '#000';
        for (let k = 1; k < 4; k++) { g.fillRect(x + 14 + k * 9, 14, 1.5, 36); g.fillRect(x + 14, 14 + k * 9, 36, 1.5); }
      }
    }
  }
  gb.fillStyle = '#4A2E1C'; gb.fillRect(0, 0, W, 5); gb.fillRect(0, H - 5, W, 5);
  return { map: toTexture(cb, true), emissiveMap: toTexture(ce, true) };
}

// 횡단보도. 알파 테스트로 줄무늬만 남긴다(투명 정렬 문제를 피하려고 블렌딩 대신 alphaTest를 쓴다)
export function crosswalkTexture() {
  const [c, g] = canvas(512, 128);
  for (let x = 8; x < 512; x += 42) { g.fillStyle = '#E6E4DC'; g.fillRect(x, 0, 24, 128); }
  return toTexture(c, true);
}

// 녹색 도로 표지판. 실제 서울 지명을 써야 "도시를 달리는" 느낌이 산다
export function signTexture(ko, en, arrow) {
  const [c, g] = canvas(512, 224);
  g.fillStyle = '#1E6B3A'; g.fillRect(0, 0, 512, 224);
  g.strokeStyle = '#F2F2F2'; g.lineWidth = 6; g.strokeRect(10, 10, 492, 204);
  g.fillStyle = '#F2F2F2';
  g.font = '88px "Do Hyeon", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  g.textBaseline = 'middle';
  g.fillText(ko, 40, 92);
  g.font = '36px "Do Hyeon", sans-serif';
  g.fillText(en, 44, 170);
  g.font = '120px sans-serif';
  g.textAlign = 'right';
  g.fillText(arrow, 480, 112);
  return toTexture(c, true);
}

// LED 전광판: 알록달록한 패턴을 그려 두고 오프셋을 흘려 움직이는 영상처럼 보이게 한다.
// 캔버스를 매 프레임 다시 그리면 텍스처 업로드 비용이 들어 오프셋 스크롤만 쓴다
export function billboardTexture(variant) {
  const [c, g] = canvas(256, 128);
  if (variant === 0) {
    for (let x = 0; x < 256; x += 2) { g.fillStyle = `hsl(${(x / 256) * 360},85%,55%)`; g.fillRect(x, 0, 2, 128); }
  } else if (variant === 1) {
    g.fillStyle = '#0A1030'; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `hsla(${190 + Math.random() * 120},90%,60%,.8)`;
      g.beginPath(); g.arc(Math.random() * 256, Math.random() * 128, 6 + Math.random() * 22, 0, Math.PI * 2); g.fill();
    }
  } else {
    const grad = g.createLinearGradient(0, 0, 256, 128);
    grad.addColorStop(0, '#FF3CAC'); grad.addColorStop(0.5, '#784BA0'); grad.addColorStop(1, '#2B86C5');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(255,255,255,.85)';
    for (let x = 0; x < 256; x += 32) g.fillRect(x, 54, 18, 20);
  }
  return toTexture(c, true);
}
