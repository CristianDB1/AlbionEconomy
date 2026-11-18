import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' permite desplegar en cualquier hosting estático (Cloudflare Pages, GitHub Pages, Netlify...)
export default defineConfig({ base: './', plugins: [react()] });
