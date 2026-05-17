# Azure DevOps Adapter Improvement Plan

## Overview

Improve the Azure DevOps adapter to match awesome-copilot-adapter feature parity with better performance and security.

## Goals

1. **Performance** — Add caching to reduce API calls
2. **Efficiency** — Optimize file fetching with targeted recursion
3. **Security** — Simplify to PAT-only authentication
4. **Compatibility** — Restrict to cloud-only (dev.azure.com)
5. **Features** — Add MCP support for feature parity

---

## Implementation Todos

### Phase 1: Core Infrastructure

- [x] **cache-key-generation** — Implement safe cache key generation function
  - Input: org + project + repo + collectionsPath
  - Output: Sanitized lowercase-alphanumeric-with-dashes string
  - Implementation: Helper function `generateCacheKey()`
  - Location: Private method in `AzureDevOpsAdapter` class

- [x] **add-caching-layer** — Add caching layer with 5-minute TTL
  - Add private field: `private readonly collectionsCache = new Map<string, { bundles: Bundle[]; timestamp: number }>()`
  - Constant: `private static readonly CACHE_TTL_MS = 5 * 60 * 1000`
  - Update `fetchBundles()`: Check cache before API call
  - Pattern: Match awesome-copilot-adapter lines 674-702

### Phase 2: Optimization

- [x] **optimize-tree-fetch** — Switch from Full recursion to OneLevel
  - Replace `fetchFullTree()` logic to use `path={collectionsPath}&recursionLevel=OneLevel`
  - Update to fetch collection files only (not entire repository)
  - Use `includeContent=true` when fetching individual `.collection.yml` files
  - Keep `findCollectionBlobs()` filtering logic for depth-0 and depth-1 detection

### Phase 3: Restrictions & Security

- [x] **validate-url-format** — Restrict to dev.azure.com only
  - Update `isValidAdoUrl()` to reject:
    - `visualstudio.com` domains
    - On-premise URLs (non-dev.azure.com)
  - Only accept: `https://dev.azure.com/{org}/{project}/_git/{repo}`
  - Update error message in constructor

- [x] **remove-fallback-auth** — Simplify to PAT-only authentication
  - Remove VS Code Microsoft authentication session fallback
  - Remove Azure CLI (`az account get-access-token`) fallback
  - Keep only: `source.token` (PAT)
  - Update `AzureDevOpsAuthService` or inline the auth logic
  - Mark source as `private: true` automatically

- [x] **update-error-messages** — Update error messages for clarity
  - Guide users to use dev.azure.com URLs
  - Mention PAT-only authentication in 401/403 errors
  - Remove references to on-premise and visualstudio.com

### Phase 4: Feature Parity

- [x] **add-mcp-support** — Add MCP support like awesome-copilot
  - Update `CollectionManifest` interface to include:
    - `mcpServers?: Record<string, McpServerConfig>`
    - `mcp?: { items?: Record<string, McpServerConfig> }`
  - Extract MCPs in `parseCollectionManifest()`
  - Count MCPs in bundle metadata (add breakdown field)
  - Include MCPs in `createDeploymentManifest()`
  - Pattern: Match awesome-copilot lines 168, 330, 342, 373

### Phase 5: Testing & Documentation

- [x] **update-tests** — Verify and update tests
  - Run existing tests: `npm test -- azure-devops`
  - Update mocks for new URL restrictions
  - Add test cases for caching behavior
  - Add test cases for MCP parsing
  - Verify authentication changes don't break tests

- [x] **update-docs** — Update documentation and code comments
  - Remove on-premise examples from code comments
  - Remove visualstudio.com references
  - Update setup instructions to mention PAT-only
  - Update JSDoc comments to reflect new behavior

---

## Implementation Order

1. Start with infrastructure (cache key + caching layer)
2. Optimize fetching strategy (OneLevel recursion)
3. Apply restrictions (URL validation + auth simplification)
4. Add features (MCP support)
5. Validate (tests + docs)

---

## Key Files Modified

| File | Changes |
|------|---------|
| `src/adapters/azure-devops-adapter.ts` | Main implementation: cache, fetch optimization, URL validation, MCP support |
| `src/services/azure-devops-auth.ts` | Simplify auth (PAT-only) or inline into adapter |
| `src/types/collection.ts` | Add MCP fields to CollectionManifest interface |
| `test/adapters/azure-devops-adapter.test.ts` | Update tests for new restrictions and features |

---

## Reference Implementation

**Cache pattern from awesome-copilot-adapter:**
```typescript
// Cache field
private readonly collectionsCache = new Map<string, { bundles: Bundle[]; timestamp: number }>();

// In fetchBundles()
const cacheKey = this.generateCacheKey();
const cached = this.collectionsCache.get(cacheKey);
if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
  this.logger.debug(`[Adapter] Using cached bundles (${cached.bundles.length} bundles)`);
  return cached.bundles;
}

// After fetching
this.collectionsCache.set(cacheKey, { bundles, timestamp: Date.now() });
```

**MCP extraction from awesome-copilot-adapter:**
```typescript
// Extract MCPs
const mcpServers = collection.mcpServers || collection.mcp?.items;

// Count in breakdown
mcpServers: mcpServers ? Object.keys(mcpServers).length : 0

// Include in manifest
if (mcpServers && Object.keys(mcpServers).length > 0) {
  manifest.mcpServers = mcpServers;
}
```

---

## Success Criteria

- ✅ Caching reduces API calls (bundles cached for 5 minutes)
- ✅ Only dev.azure.com URLs accepted
- ✅ Only PAT authentication works
- ✅ MCPs detected and displayed in marketplace
- ✅ All tests pass
- ✅ No breaking changes to existing functionality (except deprecated auth/URLs)
- ✅ Performance improvement measurable (fewer API calls)

---

## Notes

- **Breaking Changes:**
  - Users with visualstudio.com URLs must update to dev.azure.com
  - Users relying on VS Code auth or Azure CLI must create PAT
  - Migration path: Clear error messages guide users to correct setup

- **Non-Breaking Changes:**
  - Caching is transparent (users see faster responses)
  - MCP support is additive (works with existing collections)
  - Fetch optimization improves performance without changing behavior
