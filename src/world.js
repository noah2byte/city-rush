import * as THREE from 'three';
import { CONFIG } from './config.js';
import { asphaltTextures } from './textures.js';
import { bend, bent, bendOffset, noCull } from './bend.js';
import { RaceCourse, ZONES, CHUNK } from './course.js';
import { builders, releaseChunk, billboards, padTexture, startLine, boostPad, resetFeatures } from './districts.js';
import { seed } from './rng.js';
import { Rain } from './weather.js';

const { roadHalf, despawnZ } = CONFIG;
const ROAD_TILE = 12;          // 아스팔트 텍스처 한 장이 덮는 길이(m)
const VIEW = 300;              // 앞쪽으로 미리 만들어 둘 거리(m). 안개에 묻히는 거리보다 길게 둔다
const LIGHT_FAR = -44, LIGHT_NEAR = 10; // 실제 광원을 붙일 구간
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export function createWorld(renderer, envTex) {
  const scene = new THREE.Scene();

  const sky = document.createElement('canvas');
  sky.width = 2; sky.height = 256;
  const sg = sky.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#05070F');
  grad.addColorStop(0.6, '#161A2E');
  grad.addColorStop(1, '#4A3446'); // 지평선의 붉은 기운은 도시 불빛이 대기에 번진 광해를 흉내 낸다
  sg.fillStyle = grad; sg.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.FogExp2('#1C1A28', ZONES.downtown.fog);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(envTex).texture;
  scene.environmentIntensity = 0.7;
  envTex.dispose();
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
  camera.position.set(0, 2.6, 7);
  camera.lookAt(0, 1, -8);

  scene.add(new THREE.HemisphereLight('#6F7FB8', '#140F1A', 0.35 * Math.PI));
  const moon = new THREE.DirectionalLight('#9FB0FF', 0.25 * Math.PI);
  moon.position.set(8, 20, 10);
  scene.add(moon);

  // ── 도로·보도: 고정 메시 + 텍스처 스크롤. 곡선 셰이더가 정점 단위로 휘므로 길이 방향을 잘게 나눈다 ──
  // 보도·연석은 구역마다 모양이 달라 청크(districts.js)에서 만든다
  const staticLen = VIEW + 40;
  const segs = Math.ceil(staticLen / 2.5);
  const asphalt = asphaltTextures();
  const reps = staticLen / ROAD_TILE;
  asphalt.map.repeat.set(1, reps);
  asphalt.rmMap.repeat.set(1, reps);
  const roadMat = bent(new THREE.MeshStandardMaterial({ map: asphalt.map, roughnessMap: asphalt.rmMap, roughness: 1, metalness: 0 }));
  const road = new THREE.Mesh(new THREE.PlaneGeometry(roadHalf * 2, staticLen, 1, segs).rotateX(-Math.PI / 2), roadMat);
  road.position.z = -staticLen / 2 + despawnZ;
  scene.add(noCull(road));

  // ── 청크 스트리밍 ──
  // 월드를 24m 청크로 나눠, 앞쪽에 새 청크를 만들고 지나간 청크는 풀에 돌려준다.
  // 청크마다 그 위치의 구역(course)에 맞는 건물·소품을 조립하므로 달릴수록 풍경이 바뀐다
  const params = new URLSearchParams(location.search);
  const courseOptions = { first: params.get('zone'), weather: params.get('weather') };
  let course = new RaceCourse(undefined, courseOptions);
  const chunks = [];
  let traveled = 0;       // 카메라(플레이어)의 코스상 위치
  let nextChunkStart = 0;

  function spawnChunk() {
    const start = nextChunkStart;
    const seg = course.at(start + 0.01);
    const lapPos = course.lapPos(start);
    // 같은 바퀴 위치면 같은 시드 → 매 바퀴 같은 풍경. 코스 시드를 섞어 레이스마다 달라지게 한다
    seed(course.seed * 31 + lapPos);
    if (lapPos === 0) resetFeatures();
    const chunk = { start, group: new THREE.Group(), items: [], anchors: [] };
    builders[seg.type](chunk, {
      index: lapPos / CHUNK,
      isFirst: start === seg.start,
      isLast: start + CHUNK >= seg.end,
    });
    if (lapPos === 0) startLine(chunk);
    for (const pad of course.padsBetween(start, start + CHUNK)) boostPad(chunk, pad.x, -(pad.d - start));
    scene.add(chunk.group);
    chunks.push(chunk);
    nextChunkStart += CHUNK;
  }

  // 새 레이스: 청크를 모두 비우고 새 코스의 position 위치부터 다시 채운다
  function reset(newCourse, position) {
    course = newCourse ?? new RaceCourse(undefined, courseOptions);
    for (const c of chunks) { releaseChunk(c); c.group.removeFromParent(); }
    chunks.length = 0;
    traveled = position;
    // 청크 경계를 CHUNK 격자에 맞춰야 바퀴 시작(0m)이 항상 청크 시작과 일치해 결승선이 제자리에 놓인다
    nextChunkStart = Math.floor((position - 48) / CHUNK) * CHUNK;
    zoneKey = null;
    update(0, position, 0);
    return course;
  }

  // ── 가로등·터널등 광원: 개수는 고정하고 가까운 앵커로 옮겨 단다 ──
  const lights = Array.from({ length: CONFIG.lamps.realLights }, () => {
    const l = new THREE.PointLight('#FFA850', 0, 20, 2);
    scene.add(l);
    return l;
  });
  const tmp = new THREE.Vector2();

  // ── 날씨 ──
  const rain = new Rain(scene);
  let rainAmount = 0, rainTarget = 0;

  // ── 구역 상태 ──
  let zoneKey = null;
  let fogTarget = ZONES.downtown.fog;
  const bendTarget = new THREE.Vector2();
  const api = { scene, camera, update, reset, resize, onZone: null, zoneName: '', get course() { return course; } };

  // position: 플레이어의 코스상 위치(m). 레이스 로직이 위치를 정하고 월드는 그 위치를 비춘다
  function update(dt, position, velocity) {
    traveled = position;

    const offset = (traveled / ROAD_TILE) % 1;
    asphalt.map.offset.y = offset;
    asphalt.rmMap.offset.y = offset;

    while (nextChunkStart < traveled + VIEW) spawnChunk();
    while (chunks.length && traveled - chunks[0].start - CHUNK > despawnZ + 40) {
      const old = chunks.shift();
      releaseChunk(old);
      old.group.removeFromParent();
    }
    for (const c of chunks) c.group.position.z = traveled - c.start;

    // 구역이 바뀌면 안개 농도·곡률 성격을 바꾼다
    const seg = course.at(Math.max(traveled, 0));
    const zone = ZONES[seg.type];
    if (seg.key !== zoneKey) {
      zoneKey = seg.key;
      const raining = seg.weather === 'rain';
      rainTarget = raining ? 1 : 0;
      fogTarget = zone.fog * (raining ? 1.35 : 1); // 비 오는 날은 시야가 짧다
      api.zoneName = raining ? `${zone.name} · 비` : zone.name;
      api.onZone?.(api.zoneName);
    }
    bendTarget.fromArray(course.bendAt(traveled)); // 코스에 미리 정해 둔 커브라 매 바퀴 같은 자리에서 휜다
    // 곡률과 안개는 천천히 바꾼다. 급변하면 도로가 순간적으로 꺾여 보여 멀미가 난다
    bend.value.lerp(bendTarget, damp(0.35, dt));
    scene.fog.density += (fogTarget - scene.fog.density) * damp(0.8, dt);

    // 비는 서서히 오고 서서히 그친다. 노면은 비의 양만큼 매끈해져 반사가 늘어난다
    rainAmount += (rainTarget - rainAmount) * damp(0.6, dt);
    rain.update(dt, velocity, rainAmount);
    roadMat.roughness = 1 - 0.45 * rainAmount;

    // 전광판은 텍스처를 흘려 영상처럼 보이게 한다
    billboards[0].offset.x += dt * 0.25;
    billboards[1].offset.y += dt * 0.15;
    billboards[2].offset.x -= dt * 0.4;
    padTexture.offset.y -= dt * 1.5;

    // 광원: 구간 가장자리에서 서서히 줄여 조명이 툭툭 바뀌지 않게 한다
    let used = 0;
    for (const c of chunks) {
      for (const a of c.anchors) {
        const z = c.group.position.z + a.z;
        if (z < LIGHT_FAR || z > LIGHT_NEAR || used >= lights.length) continue;
        const fade = THREE.MathUtils.smoothstep(z, LIGHT_FAR, LIGHT_FAR + 10) * (1 - THREE.MathUtils.smoothstep(z, LIGHT_NEAR - 10, LIGHT_NEAR));
        const light = lights[used++];
        bendOffset(z, tmp); // 휘어 보이는 가로등 위치에 광원을 맞춘다
        light.position.set(a.x + tmp.x, a.y + tmp.y, z);
        light.color.set(a.color);
        light.intensity = CONFIG.lamps.intensity * fade;
      }
    }
    for (; used < lights.length; used++) lights[used].intensity = 0;
  }

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }

  reset(course, 0); // 첫 프레임 전에 청크를 채운다
  return api;
}
