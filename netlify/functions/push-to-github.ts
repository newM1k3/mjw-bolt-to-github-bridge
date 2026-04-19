import JSZip from 'jszip';
import { Octokit } from '@octokit/rest';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'newM1k3';
const PB_URL = process.env.PB_URL || 'https://mjwdesign-core.pockethost.io';
const PB_SUPERUSER_TOKEN = process.env.PB_SUPERUSER_TOKEN!;

const MAX_ZIP_BYTES = 6 * 1024 * 1024; // 6MB Netlify function body limit

interface PushRequest {
  repoName: string;
  description?: string;
  zipBase64: string;
}

interface StepResult {
  success: boolean;
  repoUrl?: string;
  repoName?: string;
  filesCount?: number;
  failedAt?: string;
  error?: string;
}

export const handler = async (event: {
  httpMethod: string;
  body: string | null;
}): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, failedAt: 'Request validation', error: 'Method not allowed' }),
    };
  }

  let repoName = '';

  try {
    // ── Parse request ────────────────────────────────────────────────────────
    const { repoName: rn, description = '', zipBase64 }: PushRequest = JSON.parse(event.body || '{}');
    repoName = rn?.trim();

    if (!repoName) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, failedAt: 'Request validation', error: 'repoName is required' }),
      };
    }
    if (!zipBase64) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, failedAt: 'Request validation', error: 'zipBase64 is required' }),
      };
    }

    // ── Step 1: Decode and unzip ─────────────────────────────────────────────
    let zipBuffer: Buffer;
    try {
      zipBuffer = Buffer.from(zipBase64, 'base64');
    } catch {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, failedAt: 'Decoding ZIP', error: 'Invalid base64 data' }),
      };
    }

    if (zipBuffer.byteLength > MAX_ZIP_BYTES) {
      return {
        statusCode: 413,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          failedAt: 'Decoding ZIP',
          error: 'ZIP file too large for direct upload (max 6MB). Please use the manual workflow for this project.',
        }),
      };
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(zipBuffer);
    } catch {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, failedAt: 'Unzipping', error: 'Could not parse ZIP file' }),
      };
    }

    // Detect and strip the single top-level root folder Bolt always wraps files in
    const allPaths = Object.keys(zip.files);
    const topLevelFolders = new Set(allPaths.map(p => p.split('/')[0]));
    const rootPrefix =
      topLevelFolders.size === 1 ? [...topLevelFolders][0] + '/' : '';

    // Collect all non-directory files, stripping the root prefix
    const fileEntries: Array<{ path: string; content: Buffer }> = [];
    for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;
      const strippedPath = rootPrefix ? zipPath.replace(rootPrefix, '') : zipPath;
      if (!strippedPath) continue; // skip if path becomes empty after stripping
      const content = Buffer.from(await zipEntry.async('arraybuffer'));
      fileEntries.push({ path: strippedPath, content });
    }

    if (fileEntries.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, failedAt: 'Unzipping', error: 'ZIP contains no files' }),
      };
    }

    // ── Step 2: Create GitHub repo ───────────────────────────────────────────
    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    try {
      await octokit.repos.createForAuthenticatedUser({
        name: repoName,
        private: true,
        description: description || undefined,
        auto_init: false,
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      const message =
        status === 422
          ? 'Repo already exists on GitHub'
          : `GitHub API error: ${(err as Error).message}`;
      return {
        statusCode: status === 422 ? 409 : 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, failedAt: 'Creating GitHub repo', error: message }),
      };
    }

    // ── Step 3: Push all files via Git Data API ──────────────────────────────
    // 3a. Create blobs for every file
    const blobs: Array<{ path: string; sha: string; mode: '100644' }> = [];
    for (const { path, content } of fileEntries) {
      const { data } = await octokit.git.createBlob({
        owner: GITHUB_OWNER,
        repo: repoName,
        content: content.toString('base64'),
        encoding: 'base64',
      });
      blobs.push({ path, sha: data.sha, mode: '100644' });
    }

    // 3b. Create a tree
    const { data: treeData } = await octokit.git.createTree({
      owner: GITHUB_OWNER,
      repo: repoName,
      tree: blobs.map(b => ({
        path: b.path,
        mode: b.mode,
        type: 'blob' as const,
        sha: b.sha,
      })),
    });

    // 3c. Create a commit (no parent — this is the first commit)
    const { data: commitData } = await octokit.git.createCommit({
      owner: GITHUB_OWNER,
      repo: repoName,
      message: 'feat: initial build from Bolt',
      tree: treeData.sha,
      author: {
        name: 'MJW Platform',
        email: 'sessionthoughts@gmail.com',
      },
    });

    // 3d. Create the main branch ref pointing at the commit
    await octokit.git.createRef({
      owner: GITHUB_OWNER,
      repo: repoName,
      ref: 'refs/heads/main',
      sha: commitData.sha,
    });

    // ── Step 4: Log to PocketBase registry ──────────────────────────────────
    try {
      await fetch(`${PB_URL}/api/collections/registry_repos/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${PB_SUPERUSER_TOKEN}`,
        },
        body: JSON.stringify({
          github_name: repoName,
          category: 'Sprint Build — Apr 2026',
          live_visibility: 'PRIVATE',
          correct_visibility: 'PRIVATE',
          action_status: 'Deploy',
          netlify_url: '',
          domain: '',
          bolt_url: '',
          stack: '',
          notes: 'Pushed via Bolt-to-GitHub Bridge',
        }),
      });
    } catch {
      // PocketBase logging is best-effort — do not fail the whole operation
      console.warn('PocketBase registry update failed (non-fatal)');
    }

    // ── Step 5: Return success ───────────────────────────────────────────────
    const result: StepResult = {
      success: true,
      repoUrl: `https://github.com/${GITHUB_OWNER}/${repoName}`,
      repoName,
      filesCount: fileEntries.length,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(result),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        failedAt: 'Pushing files to GitHub',
        error: message,
      }),
    };
  }
};
