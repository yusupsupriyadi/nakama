/**
 * Build-time helpers that turn Vite's manifest into the service worker's
 * precache list. Pure so `bun test` can cover them without a build.
 */

export interface ViteManifestEntry {
  css?: string[];
  file: string;
  imports?: string[];
  isEntry?: boolean;
}

export type ViteManifest = Record<string, ViteManifestEntry>;

/** The shell document, always fetched by url rather than by chunk name. */
const SHELL_URL = "/";

/**
 * Entry chunks and everything they statically import — enough to boot the app
 * offline. Route chunks load lazily and are cached the first time they are
 * used, so precaching them would only slow the install down.
 */
export function precacheUrls(
  manifest: ViteManifest,
  extraUrls: string[]
): string[] {
  const urls = new Set<string>([SHELL_URL, ...extraUrls]);
  const visited = new Set<string>();
  const queue = Object.entries(manifest)
    .filter(([, entry]) => entry.isEntry === true)
    .map(([key]) => key);

  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined || visited.has(key)) {
      continue;
    }
    visited.add(key);

    const entry = manifest[key];
    if (!entry) {
      continue;
    }

    urls.add(toUrl(entry.file));
    for (const css of entry.css ?? []) {
      urls.add(toUrl(css));
    }
    queue.push(...(entry.imports ?? []));
  }

  return [...urls].toSorted((left, right) => left.localeCompare(right));
}

function toUrl(file: string): string {
  return file.startsWith("/") ? file : `/${file}`;
}

/**
 * Names the cache for one build. The inputs are content-hashed filenames, so
 * this only changes when the precached build does — which is what lets
 * `activate` drop the previous build's cache without churning on every deploy.
 */
export function buildVersion(precachedUrls: string[]): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const url of precachedUrls.toSorted((left, right) =>
    left.localeCompare(right)
  )) {
    hasher.update(`${url}\n`);
  }
  return hasher.digest("hex").slice(0, 12);
}
