import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import './style.css';
import { CONFIG } from './config.js';
import { loadAssets } from './loaders.js';
import { createWorld } from './world.js';
import { prepareCarTemplate, createCar, addHeadlight } from './cars.js';
import { Rivals, makeRacer, accelAt, checkPads, resolveBump, standings } from './racers.js';
import { bend } from './bend.js';
import { Confetti } from './confetti.js';
import { AdaptiveResolution, DebugOverlay } from './perf.js';

const $ = id => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
// 프레임레이트와 무관하게 같은 속도로 목표에 다가가는 지수 감쇠 계수.
// Math.min(1, dt*k) 방식은 프레임 간격이 흔들리면 움직임도 같이 흔들린다
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const fmt = t => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; // 밝은 등화가 하얗게 뭉개지지 않고 자연스럽게 포화되게 한다
renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);

let world, playerCar, rivals, composer, adaptive, debug, confetti;

// ── 레이스 상태 ──
// phase: menu(시작 화면) → countdown(3·2·1) → race → finished
const race = { phase: 'menu', countdown: 0, time: 0, lap: 1, lapStart: 0, rank: 0, menuPos: 0 };
const player = makeRacer('나', true);
player.steer = 0;
let best = 0;
try { best = Number(localStorage.getItem(CONFIG.bestKey)) || 0; } catch { /* 비공개 모드 등 */ }

async function init() {
  // 표지판·현수막 텍스처에 한글 웹폰트를 그리므로 폰트 로딩을 기다린다
  const [{ gltf, envTex }] = await Promise.all([loadAssets(), document.fonts.ready]);
  prepareCarTemplate(gltf);

  world = createWorld(renderer, envTex);
  world.onZone = showZone;
  playerCar = createCar('#E8621C');
  addHeadlight(playerCar);
  world.scene.add(playerCar);
  rivals = new Rivals(world.scene);
  confetti = new Confetti($('confetti'));

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(world.scene, world.camera));
  // 블룸은 임계값을 높게 잡아 등화·창문처럼 실제로 밝은 것만 번지게 한다
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 0.92));
  composer.addPass(new OutputPass()); // 톤매핑과 sRGB 변환을 마지막에 한 번만 적용한다

  adaptive = new AdaptiveResolution(renderer, composer);
  if (location.hash === '#debug') {
    debug = new DebugOverlay(renderer, adaptive);
    window.__game = { world, player, rivals, race, THREE }; // 브라우저 콘솔에서 장면을 들여다보기 위한 훅
  }

  // 출발 전에 모든 셰이더를 미리 컴파일한다. 주행 중 첫 등장 시 컴파일되면 그 순간 화면이 멈춘다
  for (const r of rivals.list) { r.car.visible = true; r.car.position.set(0, 0, -30); }
  renderer.compile(world.scene, world.camera);
  for (const r of rivals.list) r.car.visible = false;

  $('startBtn').disabled = false;
  $('startBtn').textContent = '레이스 시작';
  if (best) $('bestLine').textContent = `최고 기록 ${fmt(best)}`;
  renderer.setAnimationLoop(loop);
}

// ── 입력 ──
const keys = {};
// 블로그 글에 iframe으로 넣으면 방향키가 바깥 페이지까지 스크롤시키므로 기본 동작을 막는다
const GAME_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ']);
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (GAME_KEYS.has(k)) e.preventDefault();
  keys[k] = true;
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
const pointer = { active: false, x: 0 };
const toRoadX = e => (e.clientX / innerWidth * 2 - 1) * CONFIG.playerHalfX;
addEventListener('pointerdown', e => { pointer.active = true; pointer.x = toRoadX(e); });
addEventListener('pointermove', e => { if (pointer.active) pointer.x = toRoadX(e); });
addEventListener('pointerup', () => { pointer.active = false; });
addEventListener('pointercancel', () => { pointer.active = false; });

// ── 화면 메시지 ──
let zoneTimer;
function showZone(name) {
  const el = $('zone');
  el.textContent = name;
  el.classList.add('show');
  clearTimeout(zoneTimer);
  zoneTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 900);
}

// 화면 가운데 큰 글씨(카운트다운, 랩, 결승). 같은 글자를 연달아 띄워도 애니메이션이 다시 돌도록 요소를 새로 만든다
function banner(text, cls = '') {
  const el = document.createElement('div');
  el.className = `banner ${cls}`;
  el.textContent = text;
  $('banners').replaceChildren(el);
}

// ── 레이스 흐름 ──
function start() {
  const { gridGap, playerGrid, rivals: n } = CONFIG.race;
  // 출발 그리드: 2열 종대. 앞줄부터 채우고 플레이어는 뒤쪽에서 출발한다
  const slots = Array.from({ length: n + 1 }, (_, i) => ({
    dist: -6 - Math.floor(i / 2) * gridGap - (i % 2) * gridGap / 2,
    x: i % 2 ? 2.25 : -2.25,
  }));
  const mine = slots.splice(playerGrid, 1)[0];
  Object.assign(player, makeRacer('나', true), { dist: mine.dist, x: mine.x, steer: 0 });
  rivals.place(slots);

  world.reset(null, player.dist); // 레이스마다 새 코스
  Object.assign(race, { phase: 'countdown', countdown: 3.999, time: 0, lap: 1, lapStart: 0, rank: 0 });
  lastCount = 4;
  playerCar.rotation.set(0, 0, 0);
  confetti.stop();

  $('start').classList.add('hidden');
  $('result').classList.add('hidden');
  document.querySelector('.credit').classList.add('hidden'); // 저작자 표기는 시작 화면에만 둔다
  $('hud').classList.remove('hidden');
  $('board').classList.remove('hidden');
  $('lap').textContent = `LAP 1/${CONFIG.race.laps}`;
  showZone(world.zoneName);
}

let lastCount = 4;
function updateCountdown(dt) {
  race.countdown -= dt;
  const n = Math.ceil(race.countdown);
  if (n !== lastCount && n >= 1) banner(String(n), 'count');
  lastCount = n;
  if (race.countdown <= 0) {
    race.phase = 'race';
    banner('GO!', 'go');
  }
}

function finish(rank) {
  race.phase = 'finished';
  player.finished = true;
  player.finishTime = race.time;
  if (!best || race.time < best) {
    best = race.time;
    try { localStorage.setItem(CONFIG.bestKey, String(best)); } catch { /* 저장 실패는 무시 */ }
  }
  if (rank === 1) {
    banner('1등!', 'win');
    confetti.burst(); // 우승일 때만 꽃가루. 모든 순위에 주면 1등의 특별함이 사라진다
  } else {
    banner(`${rank}위`, 'finish');
  }
  setTimeout(showResult, 2600);
}

function showResult() {
  const all = standings([player, ...rivals.list]);
  const rows = all.map((r, i) => {
    // 아직 들어오지 않은 라이벌은 남은 거리와 현재 속도로 도착 시간을 예상한다
    const t = r.finished ? fmt(r.finishTime)
      : `${fmt(race.time + (CONFIG.race.laps * world.course.lapLength - r.dist) / Math.max(r.speed, 20))} 예상`;
    return `<tr class="${r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><span class="swatch" style="background:${r.isPlayer ? '#E8621C' : r.color}"></span>${r.name}</td><td>${t}</td></tr>`;
  }).join('');
  const rank = all.indexOf(player) + 1;
  $('resultTitle').textContent = rank === 1 ? '우승!' : `${rank}위로 완주`;
  $('resultTable').innerHTML = rows;
  $('resultBest').textContent = `내 기록 ${fmt(player.finishTime)} · 최고 기록 ${fmt(best)}`;
  $('result').classList.remove('hidden');
  $('retryBtn').focus();
}

$('startBtn').addEventListener('click', start);
$('retryBtn').addEventListener('click', start);

// ── 플레이어 물리 ──
function updatePlayer(dt) {
  const { steer: st, playerHalfX, speed: sp } = CONFIG;
  const racing = race.phase === 'race';
  const auto = race.phase === 'finished' || race.phase === 'menu';

  // 속도: 부스터 중에는 최고 속도가 올라가고, 끝나면 서서히 원래대로 돌아온다
  const top = sp.max + (player.boost > 0 ? sp.boostExtra : 0);
  if (racing) {
    if (keys.arrowdown || keys.s) player.speed = Math.max(0, player.speed - sp.brake * dt);
    else {
      const a = accelAt(player.speed, top) * (keys.arrowup || keys.w ? 1.25 : 1);
      if (player.speed < top) player.speed = Math.min(top, player.speed + a * dt);
    }
    if (player.speed > top) player.speed += (top - player.speed) * damp(1.5, dt);
  } else if (race.phase === 'finished') {
    player.speed += (28 - player.speed) * damp(0.8, dt); // 결승 후에는 천천히 감속하며 달린다
  } else if (race.phase === 'countdown') {
    player.speed = 0;
  }
  player.boost = Math.max(0, player.boost - dt);

  // 조향 1단계: 입력 → 핸들 각. 키를 누르는 순간 최대로 꺾이지 않고 핸들을 돌리는 시간이 생긴다
  let input = 0;
  if (racing) {
    if (keys.arrowleft || keys.a) input -= 1;
    if (keys.arrowright || keys.d) input += 1;
    // 터치는 손가락 위치까지 남은 거리에 비례해 핸들을 꺾는다. 가까워지면 저절로 핸들이 풀려 오버슈트가 없다
    if (pointer.active) input = clamp((pointer.x - player.x) * 0.6, -1, 1);
  } else if (auto) {
    input = clamp(-player.x * 0.3, -1, 1); // 자동 주행: 도로 가운데를 유지
  }
  player.steer += (input - player.steer) * damp(st.steerRate, dt);

  // 조향 2단계: 핸들 각 → 옆 방향 속도. 커브에서는 원심력만큼 바깥으로 밀린다
  const drift = racing ? -bend.value.x * player.speed * player.speed * CONFIG.centrifugal : 0;
  player.vx += (player.steer * st.lateral + drift - player.vx) * damp(st.grip, dt);
  player.x += player.vx * dt;
  if (Math.abs(player.x) > playerHalfX) { // 벽에 긁히면 옆 속도를 잃고 감속한다
    player.x = clamp(player.x, -playerHalfX, playerHalfX);
    player.vx = 0;
    if (racing) player.speed *= 1 - CONFIG.wallDrag * dt;
  }

  const prev = player.dist;
  player.dist += player.speed * dt;
  if (racing && checkPads(player, prev, world.course)) toast('부스트!');
}

function updateRace(dt) {
  race.time += dt;
  const racers = [player, ...rivals.list];

  rivals.list.forEach(r => { r.prev = r.dist; });
  rivals.update(dt, { player, racers, course: world.course, running: true, raceTime: race.time });
  for (const r of rivals.list) checkPads(r, r.prev, world.course);

  // 충돌: 플레이어와 라이벌, 라이벌끼리
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      if (resolveBump(racers[i], racers[j]) && (racers[i].isPlayer || racers[j].isPlayer)) {
        toast('쾅!');
        shake = 0.35;
      }
    }
  }

  // 랩
  const L = world.course.lapLength;
  const lap = Math.floor(Math.max(player.dist, 0) / L) + 1;
  if (lap > race.lap && lap <= CONFIG.race.laps) {
    const lapTime = race.time - race.lapStart;
    race.lap = lap;
    race.lapStart = race.time;
    $('lap').textContent = `LAP ${lap}/${CONFIG.race.laps}`;
    banner(lap === CONFIG.race.laps ? '마지막 바퀴!' : `LAP ${lap}`, lap === CONFIG.race.laps ? 'final' : 'lap');
    toast(`랩 타임 ${fmt(lapTime)}`);
  }

  // 순위: 바뀌면 숫자를 튀게 하고, 올라갔을 때만 알려 준다
  const order = standings(racers);
  const rank = order.indexOf(player) + 1;
  if (race.rank && rank !== race.rank) {
    const el = $('pos');
    el.classList.remove('up', 'down');
    void el.offsetWidth; // 애니메이션을 다시 시작시키기 위한 리플로우
    el.classList.add(rank < race.rank ? 'up' : 'down');
    if (rank < race.rank) toast(`추월! ${rank}위`);
  }
  race.rank = rank;
  renderBoard(order);

  if (player.dist >= CONFIG.race.laps * L) finish(rank);
}

// ── HUD ──
let shown = {};
function setText(id, v) {
  if (shown[id] === v) return; // 값이 바뀔 때만 DOM을 건드린다(매 프레임 쓰면 레이아웃 계산이 반복된다)
  shown[id] = v;
  $(id).textContent = v;
}
function updateHud() {
  setText('posNum', String(race.rank || CONFIG.race.playerGrid + 1));
  setText('posTotal', `/${CONFIG.race.rivals + 1}`);
  setText('timer', fmt(player.finished ? player.finishTime : race.time));
  setText('speedNum', String(Math.round(player.speed * 3.6)));
  $('hud').classList.toggle('boosting', player.boost > 0);
}
let boardKey = '';
function renderBoard(order) {
  const key = order.map(r => r.name).join();
  if (key === boardKey) return;
  boardKey = key;
  $('board').innerHTML = order.map((r, i) =>
    `<li class="${r.isPlayer ? 'me' : ''}"><b>${i + 1}</b><span class="swatch" style="background:${r.isPlayer ? '#E8621C' : r.color}"></span>${r.name}</li>`).join('');
}

// ── 카메라 ──
const camLook = new THREE.Vector3(0, 1, -10);
let shake = 0;
function updateCamera(dt, t) {
  const { camera } = world;
  // 카메라는 차보다 한 박자 늦게, 더 부드럽게 따라간다. 차가 화면 안에서 움직이는 여유가 생긴다
  camera.position.x += (player.x * 0.7 - camera.position.x) * damp(3, dt);
  shake = Math.max(0, shake - dt);
  camera.position.y = 2.6 + Math.sin(t * 60) * shake * 0.15; // 충돌 순간에만 짧게 흔든다
  camLook.x += (player.x * 0.6 - camLook.x) * damp(4, dt);
  camera.lookAt(camLook);
  // 속도·부스트에 따라 시야각을 넓혀 속도감을 키운다
  const fov = 54 + player.speed * 0.2 + (player.boost > 0 ? 8 : 0);
  if (Math.abs(camera.fov - fov) > 0.02) {
    camera.fov += (fov - camera.fov) * damp(3, dt);
    camera.updateProjectionMatrix();
  }
}

// ── 메인 루프 ──
let last = performance.now(), t = 0;
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); // 탭 전환 후 큰 dt로 차를 뚫고 지나가는 것을 막는다
  last = now;
  t += dt;

  if (race.phase === 'countdown') updateCountdown(dt);
  updatePlayer(dt);
  if (race.phase === 'race') updateRace(dt);
  else if (race.phase === 'finished') {
    // 결승 후에도 시간을 흘려 뒤따라오는 라이벌의 완주 시간을 기록한다
    race.time += dt;
    rivals.update(dt, { player, racers: [player, ...rivals.list], course: world.course, running: true, raceTime: race.time });
  }
  if (race.phase === 'menu') {
    race.menuPos += CONFIG.speed.idle * dt; // 시작 화면에서는 천천히 달리는 배경을 보여준다
    player.dist = race.menuPos;
  }

  world.update(dt, player.dist, Math.max(player.speed, race.phase === 'menu' ? CONFIG.speed.idle : 0));
  playerCar.position.x = player.x;
  playerCar.rotation.y = -player.vx * 0.028; // 차머리 방향·기울기는 매끄러운 vx에서 파생되므로 따로 흔들리지 않는다
  playerCar.rotation.z = player.vx * 0.005;
  rivals.render(player.dist);
  updateCamera(dt, t);
  if (race.phase !== 'menu') updateHud();
  confetti.update(dt);
  composer.render();

  adaptive.update(dt);
  debug?.update();
}

addEventListener('resize', () => {
  if (!world) return;
  world.resize();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  confetti.resize();
});

init().catch(err => {
  console.error(err);
  $('startBtn').textContent = '자산을 불러오지 못했다';
});
