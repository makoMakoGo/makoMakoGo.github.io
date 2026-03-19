import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://makoMakoGo.github.io',
  build: {
    format: 'file',
  },
  trailingSlash: 'ignore',
});
