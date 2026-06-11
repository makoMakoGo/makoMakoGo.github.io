import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://makoMakoGo.github.io',
  build: {
    format: 'file',
  },
  trailingSlash: 'ignore',
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: false,
    },
  },
});
