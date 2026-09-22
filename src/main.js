import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import './style.css';
import { CONFIG } from './config.js';
import { loadAssets } from './loaders.js';
import { createWorld } from './world.js';
import { prepareCarTemplate, createCar, addHeadlight, credits, modelNames, labelOf, canPaint, setShadowOpacity } from './cars.js';
import { MAPS, DEFAULT_MAP, mapIds } from './maps.js';
import { PAINT_COLORS, PLAYER_MODEL } from './carModels.js';
import { Rivals, makeRacer, accelAt, checkPads, resolveBump, standings } from './racers.js';
import { bend } from './bend.js';
import { Confetti } from './confetti.js';
import { Combat, ITEMS } from './combat.js';
import { SpeedLines } from './speedlines.js';
import { NukeEvents } from './nuke.js';
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

let world, playerCar, rivals, composer, adaptive, debug, confetti, showroom, bloom, combat, speedLines, nuke;

// ── 레이스 상태 ──
// phase: menu(시작 화면) → countdown(3·2·1) → race → finished
const race = { phase: 'menu', countdown: 0, time: 0, lap: 1, lapStart: 0, rank: 0, menuPos: 0 };
const player = makeRacer('나', true);
player.steer = 0;
let best = 0;
try { best = Number(localStorage.getItem(CONFIG.bestKey)) || 0; } catch { /* 비공개 모드 등 */ }

// 차고에서 고른 차·색. 다음 방문 때도 같은 차로 시작하도록 저장한다
const SELECT_KEY = 'city-rush-selection';
const selection = { model: PLAYER_MODEL, color: PAINT_COLORS[0][0], map: DEFAULT_MAP };
try { Object.assign(selection, JSON.parse(localStorage.getItem(SELECT_KEY)) ?? {}); } catch { /* 저장된 선택 없음 */ }
let playerColor = selection.color;

async function init() {
  // 표지판·현수막 텍스처에 한글 웹폰트를 그리므로 폰트 로딩을 기다린다
  const [{ cars, envTex }] = await Promise.all([loadAssets(), document.fonts.ready]);
  for (const c of cars) prepareCarTemplate(c.name, c.gltf);
  // 저작자 표기는 실제로 들어간 모델 기준으로 만든다(모델을 빼거나 더해도 표기가 따라간다)
  document.querySelector('.credit').textContent = ['차량: ' + credits().join(', '), '환경맵: Poly Haven (CC0)'].join(' · ');

  world = createWorld(renderer, envTex);
  world.onZone = showZone;
  // 맵이 바뀌면 빛 번짐과 차 그림자 진하기도 그 맵에 맞춘다(낮에는 번짐을 줄여야 하늘·흰 벽이 뿌옇게 번지지 않는다)
  world.onMapChange = theme => {
    if (bloom) { bloom.strength = theme.bloom[0]; bloom.threshold = theme.bloom[1]; }
    setShadowOpacity(theme.shadowOpacity);
  };
  rivals = new Rivals(world.scene);
  // 쇼룸 조명: 차고에서 고른 색이 잘 보이게 차 위에서 비춘다. 레이스 중에는 세기만 0으로 둔다
  // (광원을 끄거나 빼면 광원 수가 바뀌어 셰이더를 다시 컴파일하느라 출발 순간 멈춘다)
  showroom = new THREE.SpotLight('#FFF4E6', 0, 20, 0.7, 0.6, 1);
  showroom.position.set(2.5, 6, 3);
  showroom.target.position.set(0, 0.5, 0);
  world.scene.add(showroom, showroom.target);
  if (!modelNames().includes(selection.model)) selection.model = modelNames()[0]; // 저장된 차가 빠진 경우
  applySelection();
  buildGarage();
  confetti = new Confetti($('confetti'));
  speedLines = new SpeedLines($('speedlines'));
  nuke = new NukeEvents(world.scene, {
    onWarn() {
      banner('☢ 핵미사일 경보!', 'nuke');
      document.body.classList.add('alarm');
      setTimeout(() => toast('선두 앞 도로에 낙하한다! 감속하거나 버텨라'), 900);
    },
    onImpact(e, hit) {
      document.body.classList.remove('alarm');
      const near = Math.abs(player.dist - e.at);
      if (near < 300) { flash('nuke'); shake = near < 80 ? 1.2 : 0.6; } // 가까울수록 크게 흔든다
      if (hit.includes(player)) toast('핵폭발에 휘말렸다!');
      else if (hit.length) toast(`핵폭발! ${hit.length}대가 휘말렸다`);
      setTimeout(() => toast('폐허 구간! 잔해를 피하라'), 1500);
    },
    onDebris(c) { if (c.isPlayer) { toast('잔해에 걸렸다!'); shake = 0.5; } },
  });
  combat = new Combat(world.scene, {
    // 내가 맞았을 때·맞혔을 때만 알린다. 라이벌끼리의 공방까지 띄우면 화면이 시끄럽다
    onHit(victim, attacker, kind) {
      const how = kind === 'missile' ? '미사일' : '지뢰';
      if (victim.isPlayer) { toast(`${attacker.name}의 ${how}에 맞았다!`); shake = 0.6; flash('hit'); }
      else if (attacker.isPlayer) toast(`${how} 명중! ${victim.name} 스핀`);
    },
    onBlock(victim) { if (victim.isPlayer) toast('방패로 막았다!'); },
  });

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(world.scene, world.camera));
  // 블룸은 임계값을 높게 잡아 등화·창문처럼 실제로 밝은 것만 번지게 한다
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 0.92);
  composer.addPass(bloom);
  // ?map=coast-day 처럼 주소로 맵을 지정하면 저장된 선택보다 우선한다(맵별 작업·확인용)
  const urlMap = new URLSearchParams(location.search).get('map');
  if (MAPS[urlMap]) selection.map = urlMap;
  if (!MAPS[selection.map]) selection.map = DEFAULT_MAP;
  world.setMap(selection.map, 0);
  composer.addPass(new OutputPass()); // 톤매핑과 sRGB 변환을 마지막에 한 번만 적용한다

  adaptive = new AdaptiveResolution(renderer, composer);
  if (location.hash === '#debug') {
    debug = new DebugOverlay(renderer, adaptive);
    window.__game = { world, player, rivals, race, THREE, combat, sim, CONFIG, get nuke() { return nuke; } }; // 브라우저 콘솔에서 장면을 들여다보고 난이도를 시험하기 위한 훅
  }

  // 출발 전에 모든 셰이더를 미리 컴파일한다. 주행 중 첫 등장 시 컴파일되면 그 순간 화면이 멈춘다
  for (const r of rivals.list) { r.car.visible = true; r.car.position.set(0, 0, -30); }
  renderer.compile(world.scene, world.camera);
  for (const r of rivals.list) r.car.visible = false;

  $('startBtn').disabled = false;
  $('garagePanel').classList.remove('loading');
  showStep(1);
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
// 아이템 사용: Space 또는 Shift(키 반복으로 연달아 쓰이지 않게 keydown 한 번에 한 번만)
addEventListener('keydown', e => {
  if ((e.key === ' ' || e.key === 'Shift') && !e.repeat && race.phase === 'race') useItem();
});
const pointer = { active: false, x: 0 };
const toRoadX = e => (e.clientX / innerWidth * 2 - 1) * CONFIG.playerHalfX;
$('item').addEventListener('pointerdown', e => { e.stopPropagation(); if (race.phase === 'race') useItem(); }); // 조향 터치로 번지지 않게 막는다
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

// 피격 순간 화면 가장자리를 붉게 번쩍인다
function flash(kind) {
  const el = $('flash');
  el.className = '';
  void el.offsetWidth;
  el.className = kind;
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

// ── 차고 ──
// 플레이어 차를 선택대로 다시 만든다. 도색을 못 바꾸는 모델이면 색 선택은 무시하고 원래 색으로 탄다
function applySelection() {
  const { x, vx } = player;
  playerCar?.removeFromParent();
  playerCar = createCar(selection.color, selection.model);
  addHeadlight(playerCar);
  world.scene.add(playerCar);
  playerColor = canPaint(selection.model) ? selection.color : '#9AA0A8';
  Object.assign(player, { x, vx });
  try { localStorage.setItem(SELECT_KEY, JSON.stringify(selection)); } catch { /* 저장 실패는 무시 */ }
  renderGarage();
}

function buildGarage() {
  $('colors').innerHTML = PAINT_COLORS.map(([c, name]) =>
    `<button type="button" class="color" role="radio" data-color="${c}" style="--c:${c}" aria-label="${name}" title="${name}"></button>`).join('');
  $('colors').addEventListener('click', e => {
    const c = e.target.closest('.color')?.dataset.color;
    if (c) { selection.color = c; applySelection(); }
  });
  $('prevModel').addEventListener('click', () => stepModel(-1));
  $('nextModel').addEventListener('click', () => stepModel(1));
  $('prevMap').addEventListener('click', () => stepMap(-1));
  $('nextMap').addEventListener('click', () => stepMap(1));
  $('backBtn').addEventListener('click', () => showStep(1));
}

// 차고는 두 단계다: 1) 차·색 → 2) 맵. 맵을 넘기면 쇼룸 배경이 그 맵으로 바뀌어 미리 볼 수 있다
function showStep(step) {
  $('garagePanel').dataset.step = step;
  $('startBtn').textContent = step === 1 ? '다음' : '레이스 시작';
  $('backBtn').hidden = step === 1;
  if (step === 2) renderMap();
}

function stepMap(d) {
  const ids = mapIds();
  selection.map = ids[(ids.indexOf(selection.map) + d + ids.length) % ids.length];
  world.setMap(selection.map, race.menuPos);
  try { localStorage.setItem(SELECT_KEY, JSON.stringify(selection)); } catch { /* 저장 실패는 무시 */ }
  renderMap();
}

function renderMap() {
  const ids = mapIds(), m = MAPS[selection.map];
  $('mapName').textContent = m.name;
  $('mapDesc').textContent = m.desc;
  $('mapIndex').textContent = `${ids.indexOf(selection.map) + 1}/${ids.length}`;
}

function stepModel(d) {
  const list = modelNames();
  selection.model = list[(list.indexOf(selection.model) + d + list.length) % list.length];
  applySelection();
}

function renderGarage() {
  const list = modelNames();
  const [name, kind] = labelOf(selection.model);
  $('modelName').textContent = name;
  $('modelKind').textContent = list.length > 1 ? `${kind} · ${list.indexOf(selection.model) + 1}/${list.length}` : kind;
  // 차가 한 종류뿐이면 넘길 게 없으니 화살표를 숨긴다
  for (const id of ['prevModel', 'nextModel']) $(id).style.visibility = list.length > 1 ? 'visible' : 'hidden';
  const paintable = canPaint(selection.model);
  $('colors').classList.toggle('disabled', !paintable);
  $('colorName').textContent = paintable ? PAINT_COLORS.find(c => c[0] === selection.color)?.[1] ?? '' : '이 차는 색을 바꿀 수 없다';
  for (const b of $('colors').children) b.setAttribute('aria-checked', String(b.dataset.color === selection.color));
}

function openGarage() {
  race.phase = 'menu';
  confetti.stop();
  $('result').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('board').classList.add('hidden');
  $('item').classList.add('hidden');
  $('garage').classList.remove('hidden');
  showStep(1);
  document.querySelector('.credit').classList.remove('hidden');
  rivals.list.forEach(r => { r.car.visible = false; });
  nuke.reset(world.course.lapLength);
  document.body.classList.remove('alarm');
  Object.assign(player, { speed: 0, x: 0, vx: 0, steer: 0 });
  $('startBtn').focus();
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
  Object.assign(player, makeRacer('나', true), { dist: mine.dist, prevDist: mine.dist, x: mine.x, steer: 0 });
  rivals.place(slots);

  rivals.assign(selection.model, playerColor); // 라이벌은 내 차·색을 피한다
  world.setMap(selection.map, player.dist); // 고른 맵의 새 코스(레이스마다 구역 순서가 바뀐다)
  Object.assign(race, { phase: 'countdown', countdown: 3.999, time: 0, lap: 1, lapStart: 0, rank: 0, upAt: null, slipShown: false });
  combat.reset();
  nuke.reset(world.course.lapLength);
  document.body.classList.remove('alarm');
  renderItem();
  lastCount = 4;
  playerCar.rotation.set(0, 0, 0);
  confetti.stop();

  $('garage').classList.add('hidden');
  $('result').classList.add('hidden');
  document.querySelector('.credit').classList.add('hidden'); // 저작자 표기는 시작 화면에만 둔다
  $('hud').classList.remove('hidden');
  $('board').classList.remove('hidden');
  $('item').classList.remove('hidden');
  $('lap').textContent = `LAP 1/${CONFIG.race.laps}`;
  showZone(world.zoneName);
}

let lastCount = 4;
function updateCountdown(dt) {
  race.countdown -= dt;
  // 로켓 스타트: ↑(또는 화면 터치)를 처음 누른 시점을 기록한다. GO 직전 짧은 창 안이면 성공,
  // 카운트다운 내내 누르고 있었으면 실패로 본다(그냥 누르고 있기만 하면 누구나 되는 건 재미가 없다)
  if ((keys.arrowup || keys.w || pointer.active) && race.upAt == null) race.upAt = race.countdown;
  const n = Math.ceil(race.countdown);
  if (n !== lastCount && n >= 1) banner(String(n), 'count');
  lastCount = n;
  if (race.countdown <= 0) {
    race.phase = 'race';
    banner('GO!', 'go');
    const rs = CONFIG.rocketStart;
    if (race.upAt != null && race.upAt <= rs.window) {
      player.boost = rs.time;
      player.boostExtra = rs.extra;
      toast('로켓 스타트!');
    }
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
  // 3위 안이면 포디움. 1등은 큰 꽃가루, 2·3등은 작은 꽃가루로 차등을 둔다
  if (rank === 1) {
    banner('1등!', 'win');
    confetti.burst();
  } else if (rank <= 3) {
    banner(`${rank}위 포디움!`, 'podium');
    confetti.burst(70);
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
    return `<tr class="${r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><span class="swatch" style="background:${r.isPlayer ? playerColor : r.swatch}"></span>${r.name}</td><td>${t}</td></tr>`;
  }).join('');
  const rank = all.indexOf(player) + 1;
  $('resultTitle').textContent = rank === 1 ? '우승!' : rank <= 3 ? `${rank}위 · 포디움!` : `${rank}위로 완주`;
  $('resultTable').innerHTML = rows;
  $('resultBest').textContent = `내 기록 ${fmt(player.finishTime)} · 최고 기록 ${fmt(best)}`;
  // 이 순위가 얼마나 드문지 알려 준다(잘 달리는 봇으로 측정한 분포). 1등의 무게를 체감하게 하기 위해서다
  const odds = { 1: '백 판에 한 번 나올까 말까 한 기록', 2: '서른 판에 한 번꼴인 기록', 3: '스무 판에 한 번꼴인 기록' };
  $('resultOdds').textContent = odds[rank] ?? (rank <= 6 ? '잘 달린 판에 나오는 순위' : '대부분의 판이 여기서 끝난다. 다시 도전!');
  $('result').classList.remove('hidden');
  $('retryBtn').focus();
}

$('startBtn').addEventListener('click', () => ($('garagePanel').dataset.step === '2' ? start() : showStep(2)));
$('retryBtn').addEventListener('click', start);
$('garageBtn').addEventListener('click', openGarage);
// 차고에서는 ←/→로 차를 바꾸고 Enter로 출발한다(키보드만으로 고를 수 있게)
addEventListener('keydown', e => {
  if (race.phase !== 'menu' || $('startBtn').disabled) return;
  const step2 = $('garagePanel').dataset.step === '2';
  if (e.key === 'ArrowLeft') (step2 ? stepMap : stepModel)(-1);
  else if (e.key === 'ArrowRight') (step2 ? stepMap : stepModel)(1);
  else if (e.key === 'Escape' && step2) showStep(1);
});

// ── 아이템 ──
function useItem() {
  if (!player.item || player.spin > 0) return;
  const kind = combat.use(player, [player, ...rivals.list]);
  if (kind === 'boost') toast('부스터!');
  else if (kind === 'shield') toast('방패 전개!');
  renderItem();
}

function renderItem() {
  const it = player.item && ITEMS[player.item];
  $('item').classList.toggle('empty', !it);
  $('itemIcon').textContent = it ? it.icon : '';
  $('itemName').textContent = it ? it.name : '';
}

// ── 플레이어 물리 ──
function updatePlayer(dt) {
  const { steer: st, playerHalfX, speed: sp, slipstream } = CONFIG;
  const racing = race.phase === 'race';
  const auto = race.phase === 'finished';
  player.prevDist = player.dist;

  // 속도: 부스터·슬립스트림 중에는 최고 속도가 올라가고, 끝나면 서서히 원래대로 돌아온다
  const slipping = player.slip >= slipstream.charge;
  const top = sp.max + (player.boost > 0 ? player.boostExtra : 0) + (slipping ? slipstream.extra : 0);
  if (racing && player.spin > 0) {
    player.speed += (8 - player.speed) * damp(2.5, dt); // 스핀 중에는 거의 멈춘다
  } else if (racing) {
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
  player.spin = Math.max(0, player.spin - dt);

  // 조향 1단계: 입력 → 핸들 각. 키를 누르는 순간 최대로 꺾이지 않고 핸들을 돌리는 시간이 생긴다
  let input = 0;
  if (racing && player.spin <= 0) {
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
  if (Math.abs(player.x) > playerHalfX) {
    // 벽에 긁히면 옆 속도를 잃고 감속한다. 커브에서 밀려 세게 박으면 스핀까지 한다
    if (racing && Math.abs(player.vx) > CONFIG.wallSpin && player.spin <= 0) {
      player.spin = 0.6;
      player.speed *= 0.6;
      shake = 0.4;
      toast('벽에 박았다!');
    }
    player.x = clamp(player.x, -playerHalfX, playerHalfX);
    player.vx = 0;
    if (racing) player.speed *= 1 - CONFIG.wallDrag * dt;
  }

  player.dist += player.speed * dt;
  if (racing && checkPads(player, player.prevDist, world.course)) toast('부스트!');
}

function updateRace(dt) {
  race.time += dt;
  const racers = [player, ...rivals.list];
  const order0 = standings(racers);
  const rankOf = r => order0.indexOf(r) + 1;

  rivals.update(dt, { player, racers, course: world.course, running: true, raceTime: race.time, combat, rankOf, aiScale: world.theme.aiScale ?? 1, nuke });
  for (const r of rivals.list) checkPads(r, r.prevDist, world.course);

  // 아이템: 박스를 지나가면 받고, 미사일·지뢰를 진행시킨다
  if (combat.pickup(player, player.prevDist, world.course, rankOf(player))) {
    renderItem();
    toast(`${ITEMS[player.item].icon} ${ITEMS[player.item].name} 획득!`);
  }
  combat.update(dt, racers);
  nuke.update(dt, racers, order0.find(r => !r.finished) ?? order0[0]); // 아직 달리는 선두를 기준으로 낙하 지점을 정한다
  if (bot) botDrive(racers);

  // 슬립스트림: 앞차 바로 뒤에 붙어 있으면 충전되고, 다 차면 최고 속도가 오른다
  const ss = CONFIG.slipstream;
  const drafting = rivals.list.some(r => r.dist > player.dist && r.dist - player.dist < ss.range && Math.abs(r.x - player.x) < ss.width);
  player.slip = drafting ? player.slip + dt : Math.max(0, player.slip - dt * 2);
  if (player.slip >= ss.charge && !race.slipShown) { toast('슬립스트림!'); race.slipShown = true; }
  if (player.slip === 0) race.slipShown = false;

  // 충돌: 플레이어와 라이벌, 라이벌끼리. 옆으로 세게 들이받으면 상대가 스핀한다
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const res = resolveBump(racers[i], racers[j]);
      if (!res || !(racers[i].isPlayer || racers[j].isPlayer)) continue;
      if (res === 'bump') { toast('쾅!'); shake = 0.35; }
      else if (res.blocked) toast(res.victim.isPlayer ? '방패로 막았다!' : `${res.victim.name}의 방패에 막혔다`);
      else if (res.slam.isPlayer) { toast(`들이받기! ${res.victim.name} 스핀`); shake = 0.3; }
      else { toast(`${res.slam.name}에게 들이받혔다!`); shake = 0.6; flash('hit'); }
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

// ── 난이도 시험용 자동 운전(디버그 전용) ──
// 봇은 "잘하는 사람" 수준으로 운전한다: 항상 가속, 앞쪽 부스터 패드로, 막히면 빈 차선으로,
// 아이템은 상황에 맞게 쓴다. 이 봇이 대체로 2~4위, 가끔 1위를 하도록 난이도를 맞췄다
let bot = false;
function botDrive(racers) {
  keys.arrowup = true;
  const c = world.course;
  let tx = player.x;
  const pad = c.padsBetween(player.dist + 15, player.dist + 60)[0];
  const blocked = racers.some(o => o !== player && o.dist > player.dist && o.dist - player.dist < 18 && Math.abs(o.x - player.x) < 2.2);
  const obstacles = [...combat.mines.map(m => ({ dist: m.dist, x: m.x, w: 0.6 })), ...nuke.obstaclesAhead(player.dist, 40)];
  const mineAhead = obstacles.some(m => m.dist > player.dist && m.dist - player.dist < 30 && Math.abs(m.x - player.x) < m.w + 1.2);
  if (blocked || mineAhead) {
    const free = CONFIG.lanes.filter(l => !racers.some(o => o !== player && Math.abs(o.dist - player.dist) < 16 && Math.abs(o.x - l) < 2)
      && !obstacles.some(m => m.dist > player.dist && m.dist - player.dist < 30 && Math.abs(m.x - l) < m.w + 1.2));
    if (free.length) tx = free.sort((a, b) => Math.abs(a - player.x) - Math.abs(b - player.x))[0];
  } else if (pad) tx = pad.x;
  else {
    const ahead = rivals.list.filter(r => r.dist > player.dist && r.dist - player.dist < 25).sort((a, b) => a.dist - b.dist)[0];
    if (ahead) tx = ahead.x; // 앞차 뒤에 붙어 슬립스트림을 노린다
  }
  // 바깥 차선(±4.5m)은 벽(±5.1m)과 가까워 커브 원심력에 밀리면 바로 긁힌다. 잘하는 사람처럼 벽에서 여유를 둔다
  pointer.active = true;
  pointer.x = clamp(tx, -3.9, 3.9);
  if (player.item) {
    const aheadIn = racers.some(o => o !== player && o.dist > player.dist && o.dist - player.dist < CONFIG.items.missile.range);
    const behindIn = racers.some(o => o !== player && o.dist < player.dist && player.dist - o.dist < 25);
    if (player.item === 'boost' || player.item === 'shield' || (player.item === 'missile' && aheadIn) || (player.item === 'mine' && behindIn)) useItem();
  }
}

// n번 레이스를 화면 없이 빠르게 돌려 봇의 순위 분포를 돌려준다
function sim(n = 5, dt = 1 / 30) {
  const ranks = [];
  const stats = { wall: 0, spin: 0, speed: 0, steps: 0, slip: 0 }; // 봇이 어디서 시간을 잃는지 본다
  bot = true;
  for (let k = 0; k < n; k++) {
    start();
    race.countdown = 0.01;
    for (let i = 0; i < 30 * 400 && race.phase !== 'finished'; i++) {
      if (race.phase === 'countdown') updateCountdown(dt);
      updatePlayer(dt);
      if (race.phase === 'race') updateRace(dt);
      world.update(dt, player.dist, player.speed);
      if (race.phase === 'race') {
        stats.steps++; stats.speed += player.speed;
        if (Math.abs(player.x) >= CONFIG.playerHalfX - 0.01) stats.wall += dt;
        if (player.spin > 0) stats.spin += dt;
        if (player.slip >= CONFIG.slipstream.charge) stats.slip += dt;
      }
    }
    ranks.push(race.rank);
  }
  sim.stats = { wall: +(stats.wall / n).toFixed(1), spin: +(stats.spin / n).toFixed(1), slip: +(stats.slip / n).toFixed(1), avgSpeed: +(stats.speed / stats.steps).toFixed(1) };
  bot = false;
  keys.arrowup = false;
  pointer.active = false;
  return ranks;
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
  $('hud').classList.toggle('boosting', player.boost > 0 || player.slip >= CONFIG.slipstream.charge);
  $('item').classList.toggle('ready', !!player.item);
}
let boardKey = '';
function renderBoard(order) {
  const key = order.map(r => r.name).join();
  if (key === boardKey) return;
  boardKey = key;
  $('board').innerHTML = order.map((r, i) =>
    `<li class="${r.isPlayer ? 'me' : ''}"><b>${i + 1}</b><span class="swatch" style="background:${r.isPlayer ? playerColor : r.swatch}"></span>${r.name}</li>`).join('');
}

// ── 카메라 ──
const camLook = new THREE.Vector3(0, 1, -10);
let shake = 0;
function updateCamera(dt, t) {
  const { camera } = world;
  if (race.phase === 'menu') {
    // 쇼룸 시점: 차 주위를 천천히 돌며 비스듬히 내려다본다. 뒷모습만 보면 차를 고르기 어렵다
    // 시선을 차보다 아래로 두어 차가 화면 위쪽(패널 위 빈 공간)에 오게 한다
    const a = t * 0.35;
    camera.position.set(Math.sin(a) * 6.5, 2.0, Math.cos(a) * 6.5);
    camLook.set(0, -0.9, 0);
    camera.lookAt(camLook);
    if (camera.fov !== 50) { camera.fov = 50; camera.updateProjectionMatrix(); }
    return;
  }
  // 카메라는 차보다 한 박자 늦게, 더 부드럽게 따라간다. 차가 화면 안에서 움직이는 여유가 생긴다
  camera.position.x += (player.x * 0.7 - camera.position.x) * damp(3, dt);
  camera.position.z = 7; // 쇼룸에서 돌던 카메라가 레이스 시점으로 돌아오게 앞뒤 위치를 고정한다
  shake = Math.max(0, shake - dt);
  camera.position.y = 2.6 + Math.sin(t * 60) * shake * 0.15; // 충돌 순간에만 짧게 흔든다
  camLook.x += (player.x * 0.6 - camLook.x) * damp(4, dt);
  camLook.y = 1; camLook.z = -10;
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
  if (race.phase === 'menu') { player.dist = race.menuPos; player.x = 0; } // 차고: 차를 세워 두고 보여준다

  world.update(dt, player.dist, player.speed);
  playerCar.position.x = player.x;
  // 차머리 방향·기울기는 매끄러운 vx에서 파생되므로 따로 흔들리지 않는다. 스핀 중에는 팽이처럼 돈다
  playerCar.rotation.y = player.spin > 0 ? player.spin * 10 : -player.vx * 0.028;
  playerCar.rotation.z = player.vx * 0.005;
  if (race.phase === 'menu') rivals.hide(); // 차고에서는 라이벌이 출발 전 자리(0m)에 겹쳐 그려지지 않게 숨긴다
  else rivals.render(player.dist);
  combat.render(player.dist, [player, ...rivals.list], t);
  if (race.phase !== 'menu') nuke.render(player.dist, t);
  // 속도선: 빠를수록, 부스트 중일수록 진하게
  speedLines.update(dt, race.phase === 'race' ? clamp((player.speed - 45) / 25, 0, 1) + (player.boost > 0 ? 0.5 : 0) : 0);
  // 쇼룸 조명은 밤 맵에서만 세게. 낮 맵은 햇빛이 충분해 세게 비추면 차가 하얗게 번진다
  showroom.intensity = race.phase === 'menu' ? (world.theme.lamps ? 40 : 8) : 0;
  if (!window.__freeCam) updateCamera(dt, t); // 디버그: 콘솔에서 __freeCam = true 로 두면 카메라를 직접 움직일 수 있다
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
  speedLines.resize();
});

init().catch(err => {
  console.error(err);
  $('startBtn').textContent = '자산을 불러오지 못했다';
});
