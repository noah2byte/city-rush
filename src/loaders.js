import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import carUrl from './assets/car.glb?url';
import hdrUrl from './assets/night.hdr?url';

// 단일 HTML로 빌드하면 자산이 data: URL로 인라인된다.
// 배포 환경의 보안 정책(CSP)이 data: URL fetch를 막을 수 있어, 그 경우엔 fetch 없이 직접 디코딩한다
async function loadBuffer(url) {
  if (url.startsWith('data:')) {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 로드 실패: HTTP ${res.status}`);
  return res.arrayBuffer();
}

export async function loadAssets() {
  const [carBuf, hdrBuf] = await Promise.all([loadBuffer(carUrl), loadBuffer(hdrUrl)]);

  const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await gltfLoader.parseAsync(carBuf, '');

  const hdr = new RGBELoader().setDataType(THREE.FloatType).parse(hdrBuf);
  // HDRI 속 가로등 같은 점광원은 값이 수천에 달한다. 그대로 두면 매끈한 수면·젖은 노면에 비쳐
  // 블룸 임계값을 한참 넘는 빛덩이가 되고, 환경맵은 무한히 멀어 카메라를 따라다니는 얼룩처럼 보인다.
  // 반사용으로만 쓰므로 최대 밝기를 잘라 부드러운 반사만 남긴다
  const HDR_MAX = 3;
  for (let i = 0; i < hdr.data.length; i++) if (hdr.data[i] > HDR_MAX) hdr.data[i] = HDR_MAX;
  const envTex = new THREE.DataTexture(hdr.data, hdr.width, hdr.height, THREE.RGBAFormat, hdr.type);
  envTex.colorSpace = THREE.LinearSRGBColorSpace;
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.flipY = true;
  envTex.minFilter = envTex.magFilter = THREE.LinearFilter;
  envTex.generateMipmaps = false;
  envTex.needsUpdate = true;

  return { gltf, envTex };
}
