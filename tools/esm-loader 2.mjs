import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const rootUrl = pathToFileURL(root).href;

function aliasPath(specifier) {
  const rel = specifier.slice(2);
  const base = path.resolve(root, rel);
  const candidates = [base, base + '.js', base + '.mjs', path.join(base, 'index.js'), path.join(base, 'index.mjs')];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // ignore
    }
  }
  return base;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return nextResolve(pathToFileURL(aliasPath(specifier)).href, context);
  }
  return nextResolve(specifier, context);
}

/* Test-only: lib/ modules are ESM but package.json has no "type": "module".
 * Force just those files to module format so plain Node can import them without
 * adding a package-wide type (which would break tools/extract.js). */
export async function load(url, context, nextLoad) {
  if (
    url.startsWith(rootUrl + '/lib/') ||
    url.startsWith(rootUrl + '/app/api/')
  ) {
    return nextLoad(url, { ...context, format: 'module' });
  }
  return nextLoad(url, context);
}
