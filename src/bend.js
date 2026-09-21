import * as THREE from 'three';

// 곡선 도로·언덕 효과. 도로를 실제로 굽히면 차량 이동·충돌 판정을 곡선 좌표계로 다시 짜야 한다.
// 대신 버텍스 셰이더에서 "멀리 있을수록 옆·위로 더 밀어내는" 방식으로 화면에서만 휘게 만든다.
// 플레이어가 있는 z=0 근처는 변위가 0이라 판정 로직은 그대로 직선 기준으로 둘 수 있다
export const bend = { value: new THREE.Vector2() }; // x: 좌우 곡률, y: 오르막·내리막 곡률

const patched = new WeakSet(); // material.clone()은 onBeforeCompile을 복사하지 않으므로 userData 대신 인스턴스로 추적한다

export function bent(material) {
  if (patched.has(material)) return material;
  patched.add(material);
  material.onBeforeCompile = shader => {
    shader.uniforms.uBend = bend;
    shader.vertexShader = 'uniform vec2 uBend;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `
      vec4 bentWorld = modelMatrix * vec4( transformed, 1.0 );
      float bz = min( bentWorld.z, 0.0 ); // 카메라 뒤쪽은 휘지 않는다
      bentWorld.xy += uBend * bz * bz;
      vec4 mvPosition = viewMatrix * bentWorld;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  material.customProgramCacheKey = () => 'bent';
  return material;
}

// CPU에서도 같은 변위를 계산해야 하는 것(광원 위치 등)을 위한 함수
export function bendOffset(z, out = new THREE.Vector2()) {
  const bz = Math.min(z, 0);
  return out.copy(bend.value).multiplyScalar(bz * bz);
}

// 셰이더로 휜 메시는 원래 바운딩 스피어가 실제 화면 위치와 달라 잘못 컬링될 수 있다.
// 장면 오브젝트 수가 적어 컬링을 끄는 편이 안전하다
export function noCull(obj) {
  obj.traverse(o => { o.frustumCulled = false; });
  return obj;
}
