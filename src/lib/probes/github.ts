// Builds the code bundle a with-code probe needs, from a pull request URL.
//
// The point is to measure something blind-solve cannot: once the agent has the
// repository, is finding and fixing this actually hard? Blind-solve answers
// "is the fix derivable from the prose", which is a different question, and
// when the models all ask to see the code it has no answer at all.
//
// Two rules shape what gets fetched:
//
//   1. Files are taken at the PR's BASE commit - the state before the fix.
//      Fetching the merged state would hand the models the answer.
//   2. The changed files are mixed with their siblings from the same
//      directories and never labelled. Locating the defect is part of the
//      difficulty; a bundle containing only the touched file has already done
//      the hard part for the model.

export interface BundleFile {
  path: string;
  content: string;
  /** Kept server-side for scoring. Never sent to the model. */
  changed: boolean;
}

export interface CodeBundle {
  owner: string;
  repo: string;
  number: number;
  title: string;
  baseSha: string;
  files: BundleFile[];
  changedPaths: string[];
  /** Everything that was left out, and why - so the reading can be qualified. */
  notes: string[];
}

const MAX_CHANGED = 6;
const MAX_SIBLINGS = 12;
const MAX_FILE_BYTES = 60_000;
const MAX_TOTAL_BYTES = 400_000;

const TEXT = /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|c|h|cc|cpp|hpp|cs|sh|bash|sql|ya?ml|toml|json|md|txt|cfg|ini|conf|Dockerfile)$/i;

export function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = url
    .trim()
    .match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, ""), number: Number(m[3]) };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "g0-prompt-evaluator",
  };
  // Optional: lifts the unauthenticated 60 requests/hour ceiling.
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    const hint =
      res.status === 403
        ? " (GitHub rate limit; set GITHUB_TOKEN on the server to raise it)"
        : res.status === 404
          ? " (not found, or the repository is private)"
          : "";
    throw new Error(`GitHub ${res.status}${hint}`);
  }
  return (await res.json()) as T;
}

async function rawAt(
  owner: string,
  repo: string,
  sha: string,
  path: string,
): Promise<string | null> {
  const res = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`,
    { headers: { "user-agent": "g0-prompt-evaluator" }, cache: "no-store" },
  );
  if (!res.ok) return null;
  const text = await res.text();
  if (text.length > MAX_FILE_BYTES) return null;
  if (text.includes("\u0000")) return null;
  return text;
}

interface PrFile {
  filename: string;
  status: string;
}

export async function bundleFromPr(url: string): Promise<CodeBundle> {
  const parsed = parsePrUrl(url);
  if (!parsed) {
    throw new Error("Not a GitHub pull request URL (expected .../owner/repo/pull/123).");
  }
  const { owner, repo, number } = parsed;
  const notes: string[] = [];

  const pr = await api<{ title: string; base: { sha: string } }>(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
  );
  const baseSha = pr.base.sha;

  const prFiles = await api<PrFile[]>(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`,
  );

  // Only files that existed before the PR can be shown "before the fix". A PR
  // that only adds files has no pre-state to reason about, and saying so is
  // more useful than quietly measuring something else.
  const modified = prFiles.filter((f) => f.status === "modified" && TEXT.test(f.filename));
  const added = prFiles.filter((f) => f.status === "added");
  if (modified.length === 0) {
    throw new Error(
      added.length > 0
        ? `This PR only adds files (${added.length} added, 0 modified), so there is no pre-fix state to hand the models. The with-code probe needs a PR that changes existing code.`
        : "No modified text files in this PR.",
    );
  }
  if (modified.length > MAX_CHANGED) {
    notes.push(`PR touches ${modified.length} files; only the first ${MAX_CHANGED} were fetched.`);
  }

  const chosen = modified.slice(0, MAX_CHANGED);
  const files: BundleFile[] = [];
  let total = 0;

  for (const f of chosen) {
    const content = await rawAt(owner, repo, baseSha, f.filename);
    if (content === null) {
      notes.push(`Skipped ${f.filename} (too large, binary, or unreadable at the base commit).`);
      continue;
    }
    total += content.length;
    files.push({ path: f.filename, content, changed: true });
  }

  if (files.length === 0) {
    throw new Error("None of the modified files could be read at the base commit.");
  }

  // Siblings from the same directories, so the model has to pick rather than
  // being handed the answer.
  const dirs = [...new Set(files.map((f) => f.path.split("/").slice(0, -1).join("/")))];
  const taken = new Set(files.map((f) => f.path));
  for (const dir of dirs) {
    if (files.length - chosen.length >= MAX_SIBLINGS || total >= MAX_TOTAL_BYTES) break;
    let listing: Array<{ name: string; path: string; type: string; size: number }>;
    try {
      listing = await api(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(dir)}?ref=${baseSha}`,
      );
    } catch {
      continue;
    }
    if (!Array.isArray(listing)) continue;
    for (const entry of listing) {
      if (total >= MAX_TOTAL_BYTES) break;
      if (entry.type !== "file" || taken.has(entry.path)) continue;
      if (!TEXT.test(entry.name) || entry.size > MAX_FILE_BYTES) continue;
      const content = await rawAt(owner, repo, baseSha, entry.path);
      if (content === null) continue;
      taken.add(entry.path);
      total += content.length;
      files.push({ path: entry.path, content, changed: false });
      if (files.filter((f) => !f.changed).length >= MAX_SIBLINGS) break;
    }
  }

  const decoys = files.filter((f) => !f.changed).length;
  if (decoys === 0) {
    notes.push(
      "No sibling files could be added, so every file in the bundle is one the PR touched. " +
        "The models are effectively told where to look, which makes this an easier test than the real task.",
    );
  }

  // Shuffled so position carries no signal.
  files.sort((a, b) => (a.path < b.path ? -1 : 1));

  return {
    owner,
    repo,
    number,
    title: pr.title,
    baseSha,
    files,
    changedPaths: files.filter((f) => f.changed).map((f) => f.path),
    notes,
  };
}
