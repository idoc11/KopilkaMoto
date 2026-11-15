// Генерирует иконки PWA из одного описания. Запуск: npm run icons
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const GLYPH = `
  <path d="M38 24h33a23 23 0 0 1 0 46H56v34H38V24zm18 16v14h15a7 7 0 0 0 0-14H56z" fill="#fff"/>
  <rect x="26" y="78" width="46" height="12" rx="3" fill="#fff"/>
  <circle cx="93" cy="93" r="17" fill="#171a21"/>
  <path d="M85 93h16M93 85v16" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`;

const svg = ({ rounded, scale }) => {
  const t = 64 - 64 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" ${rounded ? 'rx="28"' : ''} fill="#ad3a0b"/>
  <g transform="translate(${t} ${t}) scale(${scale})">${GLYPH}</g>
</svg>
`;
};

const icons = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 1 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 1 },
  // Безопасная зона maskable — круг 80% размера: уменьшаем рисунок, фон на весь квадрат.
  { file: 'icon-maskable-512.png', size: 512, rounded: false, scale: 0.7 },
  // iOS сам скругляет углы и не любит прозрачность.
  { file: 'apple-touch-icon.png', size: 180, rounded: false, scale: 0.86 },
];

await writeFile('icons/icon.svg', svg({ rounded: true, scale: 1 }));
const browser = await chromium.launch();
const page = await browser.newPage();
for (const i of icons) {
  await page.setViewportSize({ width: i.size, height: i.size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${i.size}px;height:${i.size}px}</style>${svg(i)}`,
  );
  await page.screenshot({ path: `icons/${i.file}`, omitBackground: true });
}
await browser.close();
console.log('Иконки обновлены');
