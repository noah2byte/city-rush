import { defineConfig } from 'vite';

// GitHub Pages 등 하위 경로 배포를 고려해 상대 경로로 빌드한다
export default defineConfig({
  base: './',
});
