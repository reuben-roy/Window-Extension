import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

interface TextbookEntry {
  title: string;
  url: string;
  fit: string;
}

type Mapping = {
  topics: Record<string, Record<string, TextbookEntry[]>>;
};

type DownloadStatus =
  | 'downloaded_binary'
  | 'saved_html_only'
  | 'downloaded_from_discovered_link'
  | 'failed';

interface BookManifest {
  parentTopic: string;
  subtopic: string;
  title: string;
  sourceUrl: string;
  fit: string;
  slug: string;
  outputDir: string;
  discoveredAt: string;
  status: DownloadStatus;
  landingPage?: {
    url: string;
    contentType: string | null;
    savedPath: string;
    sha256: string;
  };
  binary?: {
    url: string;
    contentType: string | null;
    savedPath: string;
    sha256: string;
    bytes: number;
  };
  discoveredLinks?: Array<{
    url: string;
    score: number;
    label: string;
  }>;
  error?: string;
}

type CliOptions = {
  force: boolean;
  dryRun: boolean;
  limit: number | null;
  topic: string | null;
  subtopic: string | null;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../../../');
const repoRoot = path.resolve(backendRoot, '..');
const mappingPath = path.join(repoRoot, 'docs', 'learning-textbooks.json');
const rawRoot = path.join(backendRoot, 'data', 'learning', 'raw');
const execFileAsync = promisify(execFile);

function parseArgs(argv: string[]): CliOptions {
  let force = false;
  let dryRun = false;
  let limit: number | null = null;
  let topic: string | null = null;
  let subtopic: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') force = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--limit') limit = Number(argv[index + 1] ?? '0') || null;
    else if (arg === '--topic') topic = argv[index + 1] ?? null;
    else if (arg === '--subtopic') subtopic = argv[index + 1] ?? null;
  }

  return { force, dryRun, limit, topic, subtopic };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function fileExtensionFromUrl(urlString: string): string | null {
  try {
    const { pathname } = new URL(urlString);
    const extension = path.extname(pathname).trim().toLowerCase();
    return extension || null;
  } catch {
    return null;
  }
}

function isLikelyBinary(contentType: string | null, urlString: string): boolean {
  if (!contentType) return Boolean(fileExtensionFromUrl(urlString)?.match(/\.(pdf|epub|zip|mobi)$/));
  return /(application\/pdf|application\/epub\+zip|application\/zip|application\/octet-stream)/i.test(contentType);
}

function extensionFor(contentType: string | null, urlString: string, fallback: string): string {
  if (contentType?.includes('pdf')) return '.pdf';
  if (contentType?.includes('epub')) return '.epub';
  if (contentType?.includes('zip')) return '.zip';
  if (contentType?.includes('html')) return '.html';
  return fileExtensionFromUrl(urlString) ?? fallback;
}

function summarizeText(text: string, limit = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, limit);
}

function scoreDiscoveredLink(label: string, href: string): number {
  const haystack = `${label} ${href}`.toLowerCase();
  let score = 0;
  if (haystack.includes('pdf')) score += 10;
  if (haystack.includes('download')) score += 8;
  if (haystack.includes('textbook')) score += 4;
  if (haystack.includes('book')) score += 3;
  if (haystack.includes('student')) score += 2;
  if (haystack.includes('chapter')) score -= 5;
  if (haystack.includes('solution')) score -= 6;
  if (haystack.includes('answer')) score -= 8;
  if (haystack.includes('instructor')) score -= 10;
  if (haystack.endsWith('.pdf')) score += 6;
  return score;
}

function extractDownloadLinks(html: string, baseUrl: string): Array<{ url: string; score: number; label: string }> {
  const matches = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const links: Array<{ url: string; score: number; label: string }> = [];
  for (const match of matches) {
    const href = match[1]?.trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) continue;
    const label = summarizeText(match[2]?.replace(/<[^>]+>/g, ' ') ?? '', 160);
    let resolved: string;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const score = scoreDiscoveredLink(label, resolved);
    if (score <= 0) continue;
    links.push({ url: resolved, score, label });
  }

  const deduped = new Map<string, { url: string; score: number; label: string }>();
  for (const link of links) {
    const existing = deduped.get(link.url);
    if (!existing || link.score > existing.score) deduped.set(link.url, link);
  }
  return [...deduped.values()].sort((a, b) => b.score - a.score).slice(0, 12);
}

async function ensureDir(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchBuffer(url: string): Promise<{ buffer: Buffer; contentType: string | null; finalUrl: string }> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'window-learning-downloader/1.0',
        accept: 'text/html,application/pdf,application/epub+zip,application/zip;q=0.9,*/*;q=0.8',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get('content-type'),
      finalUrl: response.url,
    };
  } catch (error) {
    return fetchBufferWithCurl(url, error instanceof Error ? error.message : String(error));
  }
}

async function fetchBufferWithCurl(
  url: string,
  fetchErrorMessage: string,
): Promise<{ buffer: Buffer; contentType: string | null; finalUrl: string }> {
  const { stdout } = await execFileAsync(
    'curl',
    [
      '-sSL',
      '-D',
      '-',
      '-A',
      'window-learning-downloader/1.0',
      '-H',
      'Accept: text/html,application/pdf,application/epub+zip,application/zip;q=0.9,*/*;q=0.8',
      url,
    ],
    {
      encoding: 'buffer',
      maxBuffer: 512 * 1024 * 1024,
    },
  );

  const separator = Buffer.from('\r\n\r\n');
  const headerEnd = stdout.lastIndexOf(separator);
  if (headerEnd === -1) {
    throw new Error(`curl fallback failed for ${url}: ${fetchErrorMessage}`);
  }

  const rawHeaders = stdout.subarray(0, headerEnd).toString('utf8');
  const buffer = stdout.subarray(headerEnd + separator.length);
  const headerBlocks = rawHeaders
    .split(/\r\n\r\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const finalHeaderBlock = headerBlocks.at(-1) ?? '';
  const contentTypeMatch = finalHeaderBlock.match(/^content-type:\s*(.+)$/im);
  const locationMatches = [...rawHeaders.matchAll(/^location:\s*(.+)$/gim)];
  const finalUrl = locationMatches.at(-1)?.[1]?.trim() ?? url;

  return {
    buffer,
    contentType: contentTypeMatch?.[1]?.trim() ?? null,
    finalUrl,
  };
}

async function writeManifest(directory: string, manifest: BookManifest): Promise<void> {
  const filePath = path.join(directory, 'manifest.json');
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function processBook(
  parentTopic: string,
  subtopic: string,
  book: TextbookEntry,
  options: CliOptions,
): Promise<BookManifest> {
  const slug = slugify(`${parentTopic}-${subtopic}-${book.title}`);
  const outputDir = path.join(rawRoot, slug);
  const manifestPath = path.join(outputDir, 'manifest.json');

  if (!options.force && (await exists(manifestPath))) {
    const existing = JSON.parse(await readFile(manifestPath, 'utf8')) as BookManifest;
    return existing;
  }

  const manifest: BookManifest = {
    parentTopic,
    subtopic,
    title: book.title,
    sourceUrl: book.url,
    fit: book.fit,
    slug,
    outputDir,
    discoveredAt: new Date().toISOString(),
    status: 'failed',
  };

  if (options.dryRun) {
    manifest.error = 'dry-run';
    return manifest;
  }

  await ensureDir(outputDir);

  try {
    const fetched = await fetchBuffer(book.url);

    if (isLikelyBinary(fetched.contentType, fetched.finalUrl)) {
      const extension = extensionFor(fetched.contentType, fetched.finalUrl, '.bin');
      const savedPath = path.join(outputDir, `source${extension}`);
      await writeFile(savedPath, fetched.buffer);
      manifest.binary = {
        url: fetched.finalUrl,
        contentType: fetched.contentType,
        savedPath,
        sha256: sha256(fetched.buffer),
        bytes: fetched.buffer.byteLength,
      };
      manifest.status = 'downloaded_binary';
      await writeManifest(outputDir, manifest);
      return manifest;
    }

    const htmlPath = path.join(outputDir, 'landing-page.html');
    await writeFile(htmlPath, fetched.buffer);
    manifest.landingPage = {
      url: fetched.finalUrl,
      contentType: fetched.contentType,
      savedPath: htmlPath,
      sha256: sha256(fetched.buffer),
    };

    const html = fetched.buffer.toString('utf8');
    const discoveredLinks = extractDownloadLinks(html, fetched.finalUrl);
    manifest.discoveredLinks = discoveredLinks;

    for (const candidate of discoveredLinks) {
      try {
        const candidateFetch = await fetchBuffer(candidate.url);
        if (!isLikelyBinary(candidateFetch.contentType, candidateFetch.finalUrl)) {
          continue;
        }
        const extension = extensionFor(candidateFetch.contentType, candidateFetch.finalUrl, '.bin');
        const savedPath = path.join(outputDir, `source${extension}`);
        await writeFile(savedPath, candidateFetch.buffer);
        manifest.binary = {
          url: candidateFetch.finalUrl,
          contentType: candidateFetch.contentType,
          savedPath,
          sha256: sha256(candidateFetch.buffer),
          bytes: candidateFetch.buffer.byteLength,
        };
        manifest.status = 'downloaded_from_discovered_link';
        await writeManifest(outputDir, manifest);
        return manifest;
      } catch {
        continue;
      }
    }

    manifest.status = 'saved_html_only';
    await writeManifest(outputDir, manifest);
    return manifest;
  } catch (error) {
    manifest.status = 'failed';
    manifest.error = error instanceof Error ? error.message : String(error);
    await ensureDir(outputDir);
    await writeManifest(outputDir, manifest);
    return manifest;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const mapping = JSON.parse(await readFile(mappingPath, 'utf8')) as Mapping;
  const jobs: Array<{ parentTopic: string; subtopic: string; book: TextbookEntry }> = [];

  for (const [parentTopic, subtopics] of Object.entries(mapping.topics)) {
    if (options.topic && options.topic !== parentTopic && slugify(options.topic) !== slugify(parentTopic)) continue;
    for (const [subtopic, books] of Object.entries(subtopics)) {
      if (options.subtopic && options.subtopic !== subtopic && slugify(options.subtopic) !== slugify(subtopic)) continue;
      for (const book of books) {
        jobs.push({ parentTopic, subtopic, book });
      }
    }
  }

  const limitedJobs = options.limit ? jobs.slice(0, options.limit) : jobs;
  await ensureDir(rawRoot);

  const results: BookManifest[] = [];
  for (const job of limitedJobs) {
    const result = await processBook(job.parentTopic, job.subtopic, job.book, options);
    results.push(result);
    console.log(
      JSON.stringify({
        title: result.title,
        parentTopic: result.parentTopic,
        subtopic: result.subtopic,
        status: result.status,
        outputDir: result.outputDir,
        binaryUrl: result.binary?.url ?? null,
        discoveredLinks: result.discoveredLinks?.length ?? 0,
        error: result.error ?? null,
      }),
    );
  }

  const summary = results.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.status] += 1;
      return acc;
    },
    {
      total: 0,
      downloaded_binary: 0,
      saved_html_only: 0,
      downloaded_from_discovered_link: 0,
      failed: 0,
    },
  );

  console.log(JSON.stringify({ summary }, null, 2));
}

await main();
