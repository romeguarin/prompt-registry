/**
 * Azure DevOps Repository Adapter
 *
 * Fetches prompt bundles from Azure DevOps cloud Git repositories.
 * 
 * **Supported:** Azure DevOps Services (https://dev.azure.com only)
 * **Not Supported:** On-premise installations, visualstudio.com URLs
 *
 * ## Bundle discovery strategy — "targeted collection scan"
 *
 * The adapter uses `recursionLevel=OneLevel` to fetch only the collections
 * directory and its immediate children (depth-0 and depth-1), then filters
 * for `.collection.yml` files. This is more efficient than fetching the
 * entire repository tree.
 *
 * After finding collection blob paths, the adapter fetches the **content** of
 * each `.collection.yml` file (one request per bundle) and parses it to
 * construct `Bundle` objects.
 *
 * Results are cached for 5 minutes to reduce API calls.
 *
 * **API call count**: 1 (collections tree) + N (one per discovered bundle)
 *
 * ## Downloading bundles
 * Bundles are assembled on the fly: the adapter re-fetches the `.collection.yml`,
 * individually downloads each item listed there, and packages them — together
 * with a synthesised `deployment-manifest.yml` — into an in-memory ZIP archive.
 * No `deployment-manifest.yml` needs to exist in the repository.
 *
 * ## Configuration example
 *
 * ```json
 * {
 *   "id": "my-ado-source",
 *   "name": "My ADO Prompts",
 *   "type": "azure-devops",
 *   "url": "https://dev.azure.com/myorg/myproject/_git/myrepo",
 *   "enabled": true,
 *   "priority": 1,
 *   "private": true,
 *   "token": "<personal-access-token>",
 *   "config": {
 *     "branch": "main",
 *     "collectionsPath": "/"
 *   }
 * }
 * ```
 *
 * ## Authentication
 * 
 * **Personal Access Token (PAT) - Required**
 * 
 * Set `token` on the source. Generate a PAT with "Code (read)" scope at:
 * https://dev.azure.com/{org}/_usersettings/tokens
 * 
 * PAT authentication produces an `Authorization: Basic base64(":"+PAT)` header.
 * 
 * Note: VS Code Microsoft auth and Azure CLI authentication are no longer supported.
 * Only PAT authentication is accepted for Azure DevOps adapter.
 */

import * as https from 'node:https';
import archiver from 'archiver';
import * as yaml from 'js-yaml';
import {
  Bundle,
  RegistrySource,
  SourceMetadata,
  ValidationResult,
} from '../types/registry';
import {
  Logger,
} from '../utils/logger';
import {
  RepositoryAdapter,
} from './repository-adapter';

/** Maximum redirect depth to prevent infinite loops */
const MAX_REDIRECTS = 10;

/** ADO REST API version used for all requests */
const ADO_API_VERSION = '7.0';

// ---------------------------------------------------------------------------
// Collection manifest schema (shared with awesome-copilot-adapter)
// ---------------------------------------------------------------------------

/**
 * Schema for a `.collection.yml` file — a lightweight manifest that lists
 * the individual prompt/instruction/chat-mode files that make up a bundle.
 * The adapter reads this file from the ADO repository and synthesises a
 * standard `deployment-manifest.yml` on the fly during download.
 */
interface CollectionManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  items: CollectionItem[];
  mcp?: {
    items?: Record<string, any>;
  };
  mcpServers?: Record<string, any>;
}

interface CollectionItem {
  path: string;
  kind: 'prompt' | 'instruction' | 'chat-mode' | 'agent' | 'skill';
}

/**
 * ADO Items API response for a single item
 */
interface AdoItem {
  objectId: string;
  gitObjectType: 'blob' | 'tree' | 'commit' | 'tag';
  commitId: string;
  path: string;
  isFolder: boolean;
  url: string;
}

/**
 * ADO Items API list response
 */
interface AdoItemsResponse {
  count: number;
  value: AdoItem[];
}

/**
 * ADO Repository metadata response
 */
interface AdoRepository {
  id: string;
  name: string;
  project: {
    name: string;
    description?: string;
  };
  remoteUrl: string;
  defaultBranch?: string;
}

/**
 * Parsed components extracted from an Azure DevOps repository URL.
 *
 * Supported URL formats:
 * - `https://dev.azure.com/{org}/{project}/_git/{repo}`
 * - `https://{org}.visualstudio.com/{project}/_git/{repo}`
 * - `https://{server}/{collection}/{project}/_git/{repo}`  (on-premises)
 */
interface ParsedAdoUrl {
  /** Full base URL up to and including the project segment */
  projectBaseUrl: string;
  /** Repository name */
  repository: string;
}

/**
 * Azure DevOps repository adapter.
 *
 * Implements `IRepositoryAdapter` to expose prompt bundles stored in an ADO Git
 * repository. Bundles are discovered by scanning for `deployment-manifest.yml`
 * files under the configured `collectionsPath`.
 */
export class AzureDevOpsAdapter extends RepositoryAdapter {
  public readonly type = 'azure-devops';

  private readonly logger: Logger;

  /** Cached resolved auth token — set after the first successful authentication */
  private authToken: string | undefined;

  /** Cache for collections with TTL */
  private readonly collectionsCache = new Map<string, { bundles: Bundle[]; timestamp: number }>();
  /** Cache TTL in milliseconds (5 minutes) */
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(source: RegistrySource) {
    super(source);
    this.logger = Logger.getInstance();

    if (!this.isValidAdoUrl(source.url)) {
      throw new Error(
        `Invalid Azure DevOps URL: "${source.url}". `
        + 'Only Azure DevOps cloud URLs are supported. '
        + 'Expected format: https://dev.azure.com/{org}/{project}/_git/{repo}\n'
        + 'Note: On-premise installations and visualstudio.com URLs are no longer supported.'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private getters
  // ---------------------------------------------------------------------------

  /**
   * Branch to use when fetching from the repository.
   * Defaults to `'main'` if not specified in source config.
   */
  private get branch(): string {
    return (this.source.config?.branch) ?? 'main';
  }

  /**
   * Root path within the repository to scan for bundles.
   * Defaults to `'/'` (repository root) if not specified in source config.
   */
  private get collectionsPath(): string {
    const p = (this.source.config?.collectionsPath) ?? '/';
    return p.startsWith('/') ? p : `/${p}`;
  }

  // ---------------------------------------------------------------------------
  // URL parsing
  // ---------------------------------------------------------------------------

  /**
   * Validate that the given URL is a valid Azure DevOps cloud repository URL.
   *
   * Only accepts:
   * - `https://dev.azure.com/{org}/{project}/_git/{repo}`
   *
   * Rejects:
   * - On-premise URLs (e.g., `https://ado.mycompany.com/...`)
   * - Old visualstudio.com URLs (e.g., `https://*.visualstudio.com/...`)
   * - Non-HTTPS URLs
   *
   * @param urlString - URL to validate
   */
  private isValidAdoUrl(urlString: string): boolean {
    if (!urlString.startsWith('https://dev.azure.com/')) {
      return false;
    }
    return urlString.includes('/_git/');
  }

  /**
   * Parse the Azure DevOps repository URL into components used for API calls.
   *
   * For `https://dev.azure.com/org/project/_git/repo`:
   * - projectBaseUrl = `https://dev.azure.com/org/project`
   * - repository = `repo`
   *
   * For `https://org.visualstudio.com/project/_git/repo`:
   * - projectBaseUrl = `https://org.visualstudio.com/project`
   * - repository = `repo`
   *
   * For on-premises `https://server/collection/project/_git/repo`:
   * - projectBaseUrl = `https://server/collection/project`
   * - repository = `repo`
   */
  private parseAdoUrl(): ParsedAdoUrl {
    const gitIdx = this.source.url.indexOf('/_git/');
    if (gitIdx === -1) {
      throw new Error(`Cannot parse Azure DevOps URL: "${this.source.url}"`);
    }

    const projectBaseUrl = this.source.url.substring(0, gitIdx);
    const afterGit = this.source.url.substring(gitIdx + '/_git/'.length);
    const repository = afterGit.split(/[?#/]/)[0];

    if (!repository) {
      throw new Error(`Cannot extract repository name from URL: "${this.source.url}"`);
    }

    return { projectBaseUrl, repository };
  }

  /**
   * Build the ADO Git API base URL for this repository.
   * Example: `https://dev.azure.com/org/project/_apis/git/repositories/repo`
   */
  private buildApiBase(): string {
    const { projectBaseUrl, repository } = this.parseAdoUrl();
    return `${projectBaseUrl}/_apis/git/repositories/${encodeURIComponent(repository)}`;
  }

  /**
   * Generate a safe cache key from the source configuration.
   * Combines org + project + repo + collectionsPath into a sanitized string.
   * @returns Lowercase alphanumeric string with dashes, safe for use as Map key
   */
  private generateCacheKey(): string {
    const { projectBaseUrl, repository } = this.parseAdoUrl();
    // Extract org and project from projectBaseUrl
    // Example: https://dev.azure.com/org/project → org-project
    const urlParts = projectBaseUrl.replace(/^https?:\/\//, '').split('/');
    const orgAndProject = urlParts.filter(Boolean).join('-');
    
    // Combine all parts: org-project-repo-collectionsPath
    const parts = [orgAndProject, repository, this.collectionsPath];
    
    // Sanitize: replace special chars with dashes, lowercase
    return parts
      .join('-')
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  /**
   * Resolve and cache the authentication token (PAT only).
   * Returns the Personal Access Token from source.token.
   */
  private async getAuthenticationToken(): Promise<{ token: string } | undefined> {
    if (this.authToken !== undefined) {
      this.logger.debug(`[AzureDevOpsAdapter] Using cached PAT token`);
      return { token: this.authToken };
    }

    const pat = this.getAuthToken();
    if (!pat) {
      this.logger.warn('[AzureDevOpsAdapter] No PAT configured. Requests will be unauthenticated.');
      return undefined;
    }

    this.authToken = pat;
    return { token: pat };
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  /**
   * Build request headers including the Authorization header when a PAT is available.
   * @param accept - Accept header value
   */
  private async buildHeaders(accept: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'User-Agent': 'Prompt-Registry-VSCode-Extension/1.0',
      Accept: accept
    };

    const auth = await this.getAuthenticationToken();
    if (auth) {
      // PAT authentication uses Basic auth with empty username
      const encodedPat = Buffer.from(`:${auth.token}`).toString('base64');
      headers.Authorization = `Basic ${encodedPat}`;
      this.logger.debug(`[AzureDevOpsAdapter] Auth header set (PAT)`);
    } else {
      this.logger.warn('[AzureDevOpsAdapter] No PAT configured — unauthenticated request will likely fail');
    }

    return headers;
  }

  /**
   * Construct a user-friendly HTTP error message.
   * @param statusCode - HTTP status code
   * @param requestUrl - URL that returned the error
   */
  private buildHttpErrorMessage(statusCode: number, requestUrl: string): string {
    switch (statusCode) {
      case 401: {
        return `Azure DevOps authentication failed (HTTP 401) for ${requestUrl}. `
          + 'Please provide a Personal Access Token (PAT) with "Code (read)" scope. '
          + 'Generate a PAT at https://dev.azure.com/{org}/_usersettings/tokens';
      }
      case 403: {
        return `Azure DevOps access denied (HTTP 403) for ${requestUrl}. `
          + 'Your PAT may lack the required permissions. Ensure it has "Code (read)" scope.';
      }
      case 404: {
        return `Azure DevOps resource not found (HTTP 404) for ${requestUrl}. `
          + 'Verify the organization, project, repository name, and branch are correct.';
      }
      default: {
        return `Azure DevOps API error (HTTP ${statusCode}) for ${requestUrl}.`;
      }
    }
  }

  /**
   * Make an HTTPS GET request and return the response body as a string.
   * Follows redirects up to `MAX_REDIRECTS` levels deep.
   * @param requestUrl - Full URL to request
   * @param accept - Accept header value
   * @param depth - Current redirect depth (used internally)
   */
  private async fetchString(requestUrl: string, accept = 'application/json', depth = 0): Promise<string> {
    if (depth >= MAX_REDIRECTS) {
      throw new Error(`[AzureDevOpsAdapter] Maximum redirect depth (${MAX_REDIRECTS}) exceeded for ${requestUrl}`);
    }

    const headers = await this.buildHeaders(accept);
    const parsedUrl = new URL(requestUrl);

    const sanitized = { ...headers };
    if (sanitized.Authorization) {
      // Log only the auth scheme (e.g. "Basic" or "Bearer") to avoid token exposure
      sanitized.Authorization = sanitized.Authorization.split(' ')[0] + ' [redacted]';
    }
    this.logger.debug(`[AzureDevOpsAdapter] GET ${requestUrl} headers: ${JSON.stringify(sanitized)}`);

    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers
      };

      const req = https.request(options, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, requestUrl).toString();
          this.logger.debug(`[AzureDevOpsAdapter] Redirect (${depth + 1}) → ${redirectUrl}`);
          this.fetchString(redirectUrl, accept, depth + 1).then(resolve).catch(reject);
          return;
        }

        let data = '';
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            this.logger.error(`[AzureDevOpsAdapter] HTTP ${res.statusCode} for ${requestUrl}: ${data.substring(0, 300)}`);
            reject(new Error(this.buildHttpErrorMessage(res.statusCode, requestUrl)));
            return;
          }
          resolve(data);
        });
      });

      req.on('error', (err) => {
        this.logger.error(`[AzureDevOpsAdapter] Network error for ${requestUrl}: ${err.message}`);
        reject(new Error(`Azure DevOps request failed: ${err.message}`));
      });

      req.end();
    });
  }

  /**
   * Make an HTTPS GET request and return the response body as a Buffer.
   * Used for binary downloads (ZIP archives).
   * Follows redirects up to `MAX_REDIRECTS` levels deep.
   * @param requestUrl - Full URL to request
   * @param depth - Current redirect depth (used internally)
   */
  private async fetchBuffer(requestUrl: string, depth = 0): Promise<Buffer> {
    if (depth >= MAX_REDIRECTS) {
      throw new Error(`[AzureDevOpsAdapter] Maximum redirect depth (${MAX_REDIRECTS}) exceeded for ${requestUrl}`);
    }

    const headers = await this.buildHeaders('application/zip');
    const parsedUrl = new URL(requestUrl);

    this.logger.debug(`[AzureDevOpsAdapter] GET (binary) ${requestUrl}`);

    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers
      };

      const req = https.request(options, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, requestUrl).toString();
          this.logger.debug(`[AzureDevOpsAdapter] Redirect (binary, ${depth + 1}) → ${redirectUrl}`);
          this.fetchBuffer(redirectUrl, depth + 1).then(resolve).catch(reject);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            const body = Buffer.concat(chunks).toString('utf8').substring(0, 300);
            this.logger.error(`[AzureDevOpsAdapter] HTTP ${res.statusCode} for ${requestUrl}: ${body}`);
            reject(new Error(this.buildHttpErrorMessage(res.statusCode, requestUrl)));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      });

      req.on('error', (err) => {
        this.logger.error(`[AzureDevOpsAdapter] Network error (binary) for ${requestUrl}: ${err.message}`);
        reject(new Error(`Azure DevOps download failed: ${err.message}`));
      });

      req.end();
    });
  }

  // ---------------------------------------------------------------------------
  // ADO API helpers
  // ---------------------------------------------------------------------------

  /**
   * Encode a repository path for use as a query-string parameter value.
   *
   * `URLSearchParams` percent-encodes forward slashes (`/` → `%2F`), but the
   * Azure DevOps Items API returns HTTP 400 when it receives `path=%2Fskills`
   * instead of `path=/skills`.  This helper percent-encodes each path segment
   * individually so that slashes remain literal in the query string.
   * @param path - Repository path, e.g. `/my-bundle/deployment-manifest.yml`
   */
  private encodePath(path: string): string {
    return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  }

  /**
   * Fetch Git items at the collections path using OneLevel recursion.
   *
   * Uses `path={collectionsPath}&recursionLevel=OneLevel` to fetch only:
   * - The collections directory itself
   * - Its direct children (files and subdirectories at depth-0 and depth-1)
   * 
   * This is more efficient than `recursionLevel=Full` which fetches the entire
   * repository. We only need collection files that sit exactly one level beneath
   * collectionsPath, so OneLevel recursion is perfect for this use case.
   * 
   * @returns Flat array of items at collectionsPath and one level deep
   */
  private async fetchCollectionsTree(): Promise<AdoItem[]> {
    const apiBase = this.buildApiBase();
    const params = new URLSearchParams({
      recursionLevel: 'OneLevel',
      'versionDescriptor.version': this.branch,
      'versionDescriptor.versionType': 'branch',
      'api-version': ADO_API_VERSION
    });
    // Append path manually to avoid URL encoding issues with slashes
    const requestUrl = `${apiBase}/items?${params.toString()}&path=${this.encodePath(this.collectionsPath)}`;

    this.logger.debug(
      `[AzureDevOpsAdapter] Fetching collections tree at "${this.collectionsPath}" `
      + `(branch: ${this.branch}, recursionLevel: OneLevel)`
    );
    const responseText = await this.fetchString(requestUrl);
    const response = JSON.parse(responseText) as AdoItemsResponse;
    return response.value ?? [];
  }

  /**
   * Fetch all items in the repository with Full recursion.
   * Used only when downloading bundles to resolve skill directory contents.
   * @returns Flat array of every item (blob or tree) in the repository
   */
  private async fetchFullTree(): Promise<AdoItem[]> {
    const apiBase = this.buildApiBase();
    const params = new URLSearchParams({
      recursionLevel: 'Full',
      'versionDescriptor.version': this.branch,
      'versionDescriptor.versionType': 'branch',
      'api-version': ADO_API_VERSION
    });
    const requestUrl = `${apiBase}/items?${params.toString()}`;

    this.logger.debug(
      `[AzureDevOpsAdapter] Fetching full tree (branch: ${this.branch}, recursionLevel: Full)`
    );
    const responseText = await this.fetchString(requestUrl);
    const response = JSON.parse(responseText) as AdoItemsResponse;
    return response.value ?? [];
  }

  /**
   * Filter a flat item list for **collection blobs** that are at most one
   * directory level beneath `collectionsPath`.
   *
   * Two layouts are supported:
   *
   * **Depth-0 (flat layout)** — the `.collection.yml` sits directly inside
   * `collectionsPath`.  Items at this depth have exactly one non-empty segment
   * after the base prefix:
   * ```
   * /collections/my-collection.collection.yml   → depth 0 ✓
   * ```
   *
   * **Depth-1 (bundle-directory layout)** — the `.collection.yml` sits one
   * level deeper, inside a dedicated bundle subdirectory.  Items at this depth
   * have exactly two non-empty segments after the base prefix:
   * ```
   * /collections/my-bundle/my-bundle.collection.yml  → depth 1 ✓
   * ```
   *
   * Files nested more than one level deep are silently ignored.
   *
   * Examples (collectionsPath = '/prompts'):
   * ```
   * /prompts/my-collection.collection.yml          → depth 0 ✓
   * /prompts/my-bundle/my-bundle.collection.yml    → depth 1 ✓
   * /prompts/nested/inner/other.collection.yml     → depth 2 ✗ (skipped)
   * ```
   * @param items - All items returned by {@link fetchFullTree}
   * @returns Items that are `.collection.yml` blobs at depth-0 or depth-1 under `collectionsPath`
   */
  private findCollectionBlobs(items: AdoItem[]): AdoItem[] {
    // Strip trailing slash from the base so the depth calculation is consistent
    // for both '/' (which becomes '') and '/bundles' (which stays '/bundles').
    const base = this.collectionsPath.replace(/\/$/, '');

    return items.filter((item) => {
      // Only blobs (files) — skip trees (directories)
      if (item.isFolder) {
        return false;
      }

      // File must be a .collection.yml file
      const filename = item.path.split('/').pop() ?? '';
      if (!filename.endsWith('.collection.yml')) {
        return false;
      }

      // Compute the path relative to collectionsPath.  We then split on '/'
      // and count non-empty segments.
      // segments.length === 1 → depth-0: <collection-file> directly in collectionsPath
      // segments.length === 2 → depth-1: <bundleDir>/<collection-file>
      // length > 2            → nested too deep, skip
      const relative = item.path.startsWith(base)
        ? item.path.substring(base.length).replace(/^\//, '')
        : item.path.replace(/^\//, '');

      const segments = relative.split('/').filter(Boolean);

      return segments.length === 1 || segments.length === 2;
    });
  }

  /**
   * Fetch a single text file from the repository.
   * @param path - Repository path of the file
   */
  private async fetchFileContent(path: string): Promise<string> {
    const apiBase = this.buildApiBase();
    // Path must be appended outside URLSearchParams to keep '/' characters literal.
    // URLSearchParams encodes '/' as '%2F', which the ADO Items API rejects (HTTP 400).
    const params = new URLSearchParams({
      'versionDescriptor.version': this.branch,
      'versionDescriptor.versionType': 'branch',
      'api-version': ADO_API_VERSION
    });
    const requestUrl = `${apiBase}/items?${params.toString()}&path=${this.encodePath(path)}`;

    this.logger.debug(`[AzureDevOpsAdapter] Fetching file "${path}"`);
    return this.fetchString(requestUrl, 'text/plain');
  }

  /**
   * Download a directory as a ZIP archive from the ADO Items API.
   * @param path - Repository path of the directory to zip
   */
  private async downloadDirectoryAsZip(path: string): Promise<Buffer> {
    const apiBase = this.buildApiBase();
    // Path must be appended outside URLSearchParams to keep '/' characters literal.
    // URLSearchParams encodes '/' as '%2F', which the ADO Items API rejects (HTTP 400).
    const params = new URLSearchParams({
      download: 'true',
      recursionLevel: 'Full',
      'versionDescriptor.version': this.branch,
      'versionDescriptor.versionType': 'branch',
      'api-version': ADO_API_VERSION
    });
    // `$format` uses a dollar sign which URLSearchParams encodes as %24.
    // Appending it as a literal string is safe here since `$` is a valid
    // query-string character (RFC 3986 §3.4) and ADO requires the exact string.
    const requestUrl = `${apiBase}/items?${params.toString()}&path=${this.encodePath(path)}&$format=zip`;

    this.logger.debug(`[AzureDevOpsAdapter] Downloading directory "${path}" as ZIP`);
    return this.fetchBuffer(requestUrl);
  }

  // ---------------------------------------------------------------------------
  // Bundle discovery helpers
  // ---------------------------------------------------------------------------

  /**
   * Parse the raw YAML text of a `.collection.yml` file.
   * Returns `null` if the text cannot be parsed (malformed file).
   * @param text - Raw YAML content of the collection file
   * @param collectionPath - Repository path (used in log messages)
   */
  private parseCollectionManifest(text: string, collectionPath: string): CollectionManifest | null {
    try {
      return yaml.load(text) as CollectionManifest;
    } catch (err) {
      this.logger.warn(`[AzureDevOpsAdapter] Failed to parse collection "${collectionPath}": ${err}`);
      return null;
    }
  }

  /**
   * Build a `Bundle` object from a parsed `CollectionManifest` and bundle directory path.
   *
   * **Depth-0 (flat layout)**: when `dirPath` equals the `collectionsPath` base the
   * collection file lives directly inside `collectionsPath` (e.g.
   * `/collections/my-collection.collection.yml`).  In that case `dirPath` alone would
   * be the same for every collection in the folder, so the manifest `id` field is
   * appended to make each bundle ID unique and stable.
   *
   * **Depth-1 (bundle-directory layout)**: `dirPath` is the dedicated bundle
   * subdirectory (e.g. `/collections/my-bundle`), which is already unique per bundle.
   * @param collection - Parsed collection manifest
   * @param dirPath - Repository path of the directory containing the `.collection.yml`
   * @param dirName - Basename of that directory
   * @param collectionPath - Full path to the `.collection.yml` file (used for manifestUrl)
   */
  private buildBundleFromCollection(
    collection: CollectionManifest,
    dirPath: string,
    dirName: string,
    collectionPath: string
  ): Bundle {
    const bundleId = collection.id ?? dirName;
    const mcpServers = collection.mcpServers || collection.mcp?.items;
    const breakdown = this.calculateBreakdown(collection.items, mcpServers);

    return {
      id: bundleId,
      name: collection.name ?? dirName,
      version: collection.version ?? '1.0.0',
      description: collection.description ?? '',
      author: collection.author ?? '',
      sourceId: this.source.id,
      environments: ['vscode'],
      tags: collection.tags ?? [],
      lastUpdated: new Date().toISOString(),
      size: `${collection.items.length} items`,
      dependencies: [],
      license: 'Unknown',
      manifestUrl: this.getCollectionFileUrl(collectionPath),
      downloadUrl: this.getCollectionFileUrl(collectionPath),
      repository: this.source.url,
      breakdown
    };
  }

  /**
   * Map a `.collection.yml` item kind to the deployment-manifest prompt type.
   * @param kind - Item kind from the collection manifest
   */
  private mapKindToType(kind: string): 'prompt' | 'instructions' | 'chatmode' | 'agent' | 'skill' {
    const kindMap: Record<string, 'prompt' | 'instructions' | 'chatmode' | 'agent' | 'skill'> = {
      prompt: 'prompt',
      instruction: 'instructions',
      'chat-mode': 'chatmode',
      agent: 'agent',
      skill: 'skill'
    };
    return kindMap[kind] ?? 'prompt';
  }

  /**
   * Calculate content breakdown from collection items and MCPs.
   * Returns counts for prompts, instructions, chatmodes, agents, skills, and mcpServers.
   * @param items - Collection items to count
   * @param mcpServers - MCP servers configuration
   */
  private calculateBreakdown(items: CollectionItem[], mcpServers?: Record<string, any>): Record<string, number> {
    const breakdown = {
      prompts: 0,
      instructions: 0,
      chatmodes: 0,
      agents: 0,
      skills: 0,
      mcpServers: mcpServers ? Object.keys(mcpServers).length : 0
    };

    for (const item of items) {
      switch (item.kind) {
        case 'prompt': {
          breakdown.prompts++;
          break;
        }
        case 'instruction': {
          breakdown.instructions++;
          break;
        }
        case 'chat-mode': {
          breakdown.chatmodes++;
          break;
        }
        case 'agent': {
          breakdown.agents++;
          break;
        }
        case 'skill': {
          breakdown.skills++;
          break;
        }
      }
    }

    return breakdown;
  }

  /**
   * Convert kebab-case or space-separated words to Title Case.
   * @param str - Input string
   */
  private titleCase(str: string): string {
    return str
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Synthesise a `deployment-manifest.yml` payload from a parsed collection.
   * This manifest is embedded into the downloaded ZIP so the bundle installer
   * can process it without any changes to the installation pipeline.
   * @param collection - Parsed collection manifest
   * @param dirName - Bundle directory name (used as fallback ID)
   */
  private createDeploymentManifest(collection: CollectionManifest, dirName: string): Record<string, unknown> {
    const prompts = collection.items.map((item) => {
      // Skills are directories — derive the skill name from the directory portion of the path
      // and preserve the full path so the installer can locate the skill folder.
      if (item.kind === 'skill') {
        const skillDirPath = item.path.endsWith('.md')
          ? item.path.substring(0, item.path.lastIndexOf('/'))
          : item.path;
        const skillName = skillDirPath.split('/').pop() ?? 'unknown-skill';
        return {
          id: skillName,
          name: this.titleCase(skillName.replace(/-/g, ' ')),
          description: `Skill from ${collection.name}`,
          file: skillDirPath,
          type: 'skill' as const,
          tags: collection.tags ?? []
        };
      }

      const filename = item.path.split('/').pop() ?? 'unknown';
      const id = filename.replace(/\.(prompt|instructions|chatmode|agent)\.md$/, '');
      return {
        id,
        name: this.titleCase(id.replace(/-/g, ' ')),
        description: `From ${collection.name}`,
        file: `prompts/${filename}`,
        type: this.mapKindToType(item.kind),
        tags: collection.tags ?? []
      };
    });

    const manifest: Record<string, unknown> = {
      id: collection.id ?? dirName,
      name: collection.name,
      version: collection.version ?? '1.0.0',
      description: collection.description ?? '',
      author: collection.author ?? '',
      repository: this.source.url,
      license: 'Unknown',
      tags: collection.tags ?? [],
      prompts
    };

    // Include MCPs if present (support both modern and legacy formats)
    const mcpServers = collection.mcpServers || collection.mcp?.items;
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      manifest.mcpServers = mcpServers;
    }

    return manifest;
  }

  /**
   * Fetch each file listed in a collection manifest from the ADO repository and
   * package them — together with a synthesised `deployment-manifest.yml` — into
   * an in-memory ZIP archive.
   *
   * This is the ADO equivalent of `AwesomeCopilotAdapter.createBundleArchive()`.
   * Rather than using the ADO `$format=zip` endpoint (which requires a
   * pre-existing directory), this method assembles the archive from individual
   * file fetches so that repos using the `.collection.yml` convention do not need
   * to maintain any `deployment-manifest.yml` files at all.
   *
   * **Skill items** are directories rather than single files.  For each item with
   * `kind === 'skill'`, all blobs under the skill directory are collected from the
   * already-fetched `allItems` tree and added to the archive preserving their
   * repo-root-relative paths (e.g. `skills/my-skill/SKILL.md`).
   * @param collection - Parsed collection manifest
   * @param dirName - Bundle directory basename (used as fallback in the manifest)
   * @param allItems - Full repository item tree (from {@link fetchFullTree}); used to
   *   discover skill directory contents without an extra API call
   */
  private async createBundleArchive(
    collection: CollectionManifest,
    dirName: string,
    allItems: AdoItem[]
  ): Promise<Buffer> {
    this.logger.debug(`[AzureDevOpsAdapter] Creating archive for collection: ${collection.name}`);

    return new Promise<Buffer>((resolve, reject) => {
      void (async () => {
        try {
          const archive = archiver('zip', { zlib: { level: 9 } });
          const chunks: Buffer[] = [];

          archive.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          archive.on('finish', () => {
            resolve(Buffer.concat(chunks));
          });
          archive.on('error', (err: Error) => {
            reject(err);
          });

          // Embed the synthesised deployment manifest
          const manifest = this.createDeploymentManifest(collection, dirName);
          archive.append(yaml.dump(manifest), { name: 'deployment-manifest.yml' });

          // Fetch and add each item file
          for (const item of collection.items) {
            try {
              if (item.kind === 'skill') {
                // Skills are directories — collect all blobs under the skill dir from
                // the already-fetched full tree and add them preserving repo-root paths.
                const skillDirPath = item.path.endsWith('.md')
                  ? item.path.substring(0, item.path.lastIndexOf('/'))
                  : item.path;
                // allItems paths always have a leading '/'; normalise item.path accordingly.
                const normalizedSkillDir = skillDirPath.startsWith('/')
                  ? skillDirPath
                  : `/${skillDirPath}`;
                const skillFiles = allItems.filter(
                  (treeItem) => !treeItem.isFolder
                    && treeItem.path.startsWith(normalizedSkillDir + '/')
                );
                for (const skillFile of skillFiles) {
                  const fileContent = await this.fetchFileContent(skillFile.path);
                  // Strip leading '/' to get a repo-root-relative archive path
                  archive.append(fileContent, { name: skillFile.path.replace(/^\//, '') });
                  this.logger.debug(`[AzureDevOpsAdapter] Added skill file ${skillFile.path} to archive`);
                }
              } else {
                const fileContent = await this.fetchFileContent(item.path);
                const filename = item.path.split('/').pop() ?? 'unknown';
                archive.append(fileContent, { name: `prompts/${filename}` });
                this.logger.debug(`[AzureDevOpsAdapter] Added ${filename} to archive`);
              }
            } catch (err) {
              this.logger.warn(`[AzureDevOpsAdapter] Skipping item "${item.path}": ${err}`);
            }
          }

          void archive.finalize();
        } catch (error) {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- rejection value is handled by caller
          reject(error);
        }
      })();
    });
  }

  /**
   * Build the ADO Items API URL for a specific file in the repository.
   * Used as the manifestUrl and downloadUrl for collection-based bundles — the
   * `.collection.yml` file itself is the canonical descriptor.
   * @param filePath - Repository path of the collection file
   */
  private getCollectionFileUrl(filePath: string): string {
    const apiBase = this.buildApiBase();
    const params = new URLSearchParams({
      'versionDescriptor.version': this.branch,
      'api-version': ADO_API_VERSION
    });
    return `${apiBase}/items?${params.toString()}&path=${this.encodePath(filePath)}`;
  }

  // ---------------------------------------------------------------------------
  // IRepositoryAdapter — public methods
  // ---------------------------------------------------------------------------

  /**
   * Force re-authentication by clearing the cached token.
   * The next request will re-read the PAT from source configuration.
   */
  public override forceAuthentication(): Promise<void> {
    this.logger.info('[AzureDevOpsAdapter] Invalidating cached PAT token');
    this.authToken = undefined;
    return Promise.resolve();
  }

  /**
   * Fetch all bundles from the Azure DevOps repository.
   *
   * Uses caching with 5-minute TTL to reduce API calls.
   * 
   * Discovery strategy:
   *
   * 1. **Check cache** — return cached bundles if < 5 minutes old
   * 
   * 2. **Fetch the full tree** — one `GET /items?recursionLevel=Full` call
   *    retrieves every file and directory in the repository at once.
   *
   * 3. **Filter collection blobs** — scan the returned item list in memory for
   *    `.collection.yml` files that sit exactly one level beneath
   *    `collectionsPath`.  This avoids probing every subdirectory individually.
   *
   * 4. **Fetch collection content** — for each `.collection.yml` blob found,
   *    one `GET /items?path=…` call retrieves the file content, which is then
   *    parsed and converted to a `Bundle`.
   *
   * Total API calls: **1** (full tree) + **N** (one per discovered bundle).
   * @returns Array of discovered bundles
   */
  public async fetchBundles(): Promise<Bundle[]> {
    this.logger.info(
      `[AzureDevOpsAdapter] Fetching bundles from "${this.source.url}" `
      + `(branch: ${this.branch}, path: ${this.collectionsPath})`
    );

    // ── Check cache first ───────────────────────────────────────────────────
    const cacheKey = this.generateCacheKey();
    const cached = this.collectionsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < AzureDevOpsAdapter.CACHE_TTL_MS) {
      this.logger.debug(
        `[AzureDevOpsAdapter] Using cached bundles (${cached.bundles.length} bundles, `
        + `age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`
      );
      return cached.bundles;
    }

    try {
      // ── Step 1: Fetch collections tree with OneLevel recursion ──────────────
      const allItems = await this.fetchCollectionsTree();

      // ── Step 2: Filter for .collection.yml blobs exactly one level deep ─────
      const collectionBlobs = this.findCollectionBlobs(allItems);

      this.logger.debug(
        `[AzureDevOpsAdapter] Collections tree: ${allItems.length} item(s), `
        + `${collectionBlobs.length} collection blob(s) found`
      );

      // ── Step 3: Fetch and parse each collection file ─────────────────────────
      const bundles: Bundle[] = [];

      for (const blob of collectionBlobs) {
        try {
          const fileContent = await this.fetchFileContent(blob.path);
          const collection = this.parseCollectionManifest(fileContent, blob.path);

          if (collection) {
            // The bundle directory is the parent of the .collection.yml file
            const dirPath = blob.path.substring(0, blob.path.lastIndexOf('/'));
            const dirName = dirPath.split('/').pop() ?? dirPath;
            const bundle = this.buildBundleFromCollection(collection, dirPath, dirName, blob.path);
            bundles.push(bundle);
            this.logger.debug(
              `[AzureDevOpsAdapter] Found bundle: ${bundle.id} `
              + `(${bundle.name} v${bundle.version})`
            );
          }
        } catch (err) {
          // Log and continue — a single bad collection file should not block others
          this.logger.warn(
            `[AzureDevOpsAdapter] Failed to load collection at "${blob.path}": ${err}`
          );
        }
      }

      this.logger.info(`[AzureDevOpsAdapter] Discovered ${bundles.length} bundle(s)`);
      
      // ── Cache the results ────────────────────────────────────────────────────
      this.collectionsCache.set(cacheKey, { bundles, timestamp: Date.now() });
      this.logger.debug(`[AzureDevOpsAdapter] Cached ${bundles.length} bundles with key: ${cacheKey}`);
      
      return bundles;
    } catch (error) {
      throw new Error(`Failed to fetch bundles from Azure DevOps: ${error}`);
    }
  }

  /**
   * Download a bundle from Azure DevOps as an in-memory ZIP archive.
   *
   * Rather than using the ADO `$format=zip` endpoint (which requires a
   * pre-existing directory with a `deployment-manifest.yml`), this method
   * re-fetches the `.collection.yml` for the bundle, then individually
   * downloads each listed item and packages them — together with a synthesised
   * `deployment-manifest.yml` — into an archive that the standard bundle
   * installer can process without modification.
   * @param bundle - Bundle to download
   * @returns Buffer containing the ZIP archive
   */
  public async downloadBundle(bundle: Bundle): Promise<Buffer> {
    this.logger.info(`[AzureDevOpsAdapter] Downloading bundle: ${bundle.id}`);
    try {
      // Recover the collection file path from the bundle's manifestUrl.
      // manifestUrl is the ADO Items API URL for the .collection.yml, e.g.:
      //   https://.../items?...&path=/my-bundle/my-bundle.collection.yml
      const collectionFilePath = new URL(bundle.manifestUrl).searchParams.get('path');
      if (!collectionFilePath) {
        throw new Error(`Cannot determine collection file path from bundle manifestUrl: "${bundle.manifestUrl}"`);
      }

      const dirPath = collectionFilePath.substring(0, collectionFilePath.lastIndexOf('/'));
      const dirName = dirPath.split('/').pop() ?? dirPath;

      // The full tree is still needed for skill directory resolution in createBundleArchive.
      const allItems = await this.fetchFullTree();

      const fileContent = await this.fetchFileContent(collectionFilePath);
      const collection = this.parseCollectionManifest(fileContent, collectionFilePath);

      if (!collection) {
        throw new Error(`Failed to parse collection file at "${collectionFilePath}"`);
      }

      return await this.createBundleArchive(collection, dirName, allItems);
    } catch (error) {
      throw new Error(`Failed to download bundle "${bundle.id}" from Azure DevOps: ${error}`);
    }
  }

  /**
   * Fetch metadata about the Azure DevOps repository.
   * @returns Source metadata including repository name, description, and bundle count
   */
  public async fetchMetadata(): Promise<SourceMetadata> {
    const apiBase = this.buildApiBase();
    const params = new URLSearchParams({ 'api-version': ADO_API_VERSION });
    const requestUrl = `${apiBase}?${params.toString()}`;

    try {
      const responseText = await this.fetchString(requestUrl);
      const repo = JSON.parse(responseText) as AdoRepository;
      const bundles = await this.fetchBundles();

      return {
        name: repo.name,
        description: repo.project?.description ?? '',
        bundleCount: bundles.length,
        lastUpdated: new Date().toISOString(),
        version: '1.0.0'
      };
    } catch (error) {
      throw new Error(`Failed to fetch Azure DevOps metadata: ${error}`);
    }
  }

  /**
   * Validate that the configured Azure DevOps repository is accessible.
   *
   * Checks that:
   * 1. The URL is a valid Azure DevOps repository URL
   * 2. The repository API endpoint returns successfully
   * 3. At least one bundle was found (warning if none, not an error)
   * @returns Validation result
   */
  public async validate(): Promise<ValidationResult> {
    if (!this.isValidAdoUrl(this.source.url)) {
      return {
        valid: false,
        errors: [
          `Invalid Azure DevOps URL: "${this.source.url}". `
          + 'Expected format: https://dev.azure.com/{org}/{project}/_git/{repo}'
        ],
        warnings: [],
        bundlesFound: 0
      };
    }

    try {
      const apiBase = this.buildApiBase();
      const params = new URLSearchParams({ 'api-version': ADO_API_VERSION });
      await this.fetchString(`${apiBase}?${params.toString()}`);

      const bundles = await this.fetchBundles();
      return {
        valid: true,
        errors: [],
        warnings: bundles.length === 0
          ? [`No bundles found in "${this.collectionsPath}" on branch "${this.branch}"`]
          : [],
        bundlesFound: bundles.length
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Azure DevOps validation failed: ${error}`],
        warnings: [],
        bundlesFound: 0
      };
    }
  }

  /**
   * Get the collection manifest URL for a bundle.
   * Bundle IDs are no longer URL-encoded paths, so this returns the ADO repository
   * URL as a stable reference. The actual collection file URL is stored in
   * `bundle.manifestUrl` and used directly by `downloadBundle`.
   * @param _bundleId - Bundle identifier (not used)
   * @param _version - Not used; ADO uses branch-based versioning
   * @returns ADO repository URL
   */
  public getManifestUrl(_bundleId: string, _version?: string): string {
    return this.source.url;
  }

  /**
   * Get the download URL for a bundle.
   * @param _bundleId - Bundle identifier (not used)
   * @param _version - Not used; ADO uses branch-based versioning
   * @returns ADO repository URL
   */
  public getDownloadUrl(_bundleId: string, _version?: string): string {
    return this.source.url;
  }
}
