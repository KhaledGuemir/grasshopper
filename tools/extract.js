// One-shot extraction of CSS, body markup and the game IIFE from the original
// single-file HTML game into Next.js app pieces. Usage: node tools/extract.js <source.html>
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/extract.js <source.html>');
  process.exit(1);
}
const html = fs.readFileSync(src, 'utf8');

// ---- CSS: content of <style> ----
const styleTag = html.indexOf('<style>');
const styleStart = styleTag + '<style>'.length;
const styleEnd = html.indexOf('</style>', styleStart);
if (styleStart < 8 || styleEnd < 0) throw new Error('style block not found');
const css = html.slice(styleStart, styleEnd).trim() + '\n';
fs.mkdirSync(path.join(root, 'app'), { recursive: true });
fs.writeFileSync(path.join(root, 'app', 'globals.css'), css);

// ---- Body markup: between <body> and the final </body> ----
const bodyStart = html.indexOf('<body>') + '<body>'.length;
const bodyEnd = html.lastIndexOf('</body>');
if (bodyStart < 6 || bodyEnd < bodyStart) throw new Error('body block not found');
const body = html.slice(bodyStart, bodyEnd).trim() + '\n';
fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
fs.writeFileSync(path.join(root, 'tools', 'body.html'), body);

// ---- Game script: the inline <script> (not the CDN one) ----
const scriptTag = html.lastIndexOf('<script>\n');
const scriptEnd = html.indexOf('</script>', scriptTag);
if (scriptTag < 8 || scriptEnd < 0) throw new Error('inline script not found');
let js = html.slice(scriptTag + '<script>'.length, scriptEnd).trim();

// Strip the IIFE wrapper: (function(){ ... })();
const open = js.indexOf('(function(){');
const close = js.lastIndexOf('})();');
if (open < 0 || close < open) throw new Error('IIFE wrapper not found');
const inner = js.slice(open + '(function(){'.length, close).trim();

const out = [
  "import * as THREE from 'three';",
  '',
  'export function start(){',
  inner,
  '}',
  '',
].join('\n');
fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
fs.writeFileSync(path.join(root, 'lib', 'game.js'), out);

console.log('css   bytes:', css.length);
console.log('body  bytes:', body.length);
console.log('game  lines:', out.split('\n').length);
