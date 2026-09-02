/**
 * Two routers serve /api/users, and the order they are mounted in decides which
 * one answers.
 *
 * server.js mounts usersRouter at /api/users before connectionsRouter at /api.
 * users.js ends with a bare "/:userId", which matches any single segment nobody
 * above claimed - including the word "discover". So /api/users/discover was read
 * as a request for a user with that id, answered 404, and the real handler in
 * connections.js was never reached. The Discover tab sat empty for as long as
 * that was true, and said the app was offline, because the client tests the
 * response with Array.isArray and a 404 body is an object.
 *
 * Nothing about that is visible from either file on its own, which is why it
 * survived. This reads both and fails if they disagree again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf-8');

const users = read('routes/users.js');
const connections = read('routes/connections.js');
const server = read('server.js');

/** Single-segment paths connections.js serves under /users/. */
function shadowablePaths(source: string): string[] {
  const found = new Set<string>();
  const pattern = /router\.(?:get|post|put|patch|delete)\(\s*['"]\/users\/([^'"/]+)['"]/g;
  for (const m of source.matchAll(pattern)) {
    if (!m[1].startsWith(':')) found.add(m[1]);
  }
  return [...found];
}

/** The escape hatch users.js uses to pass those on. */
function reservedPaths(source: string): string[] {
  const block = source.match(/RESERVED_USER_PATHS = new Set\(\[([^\]]*)\]\)/);
  if (!block) return [];
  return [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('the two routers that both answer /api/users', () => {
  it('is still mounted in the order that makes this a problem', () => {
    // If this ever flips, the rest of this file is guarding nothing and should
    // be rewritten rather than deleted.
    const usersAt = server.indexOf("app.use('/api/users'");
    const connectionsAt = server.indexOf("app.use('/api', connectionsRouter)");
    expect(usersAt).toBeGreaterThan(-1);
    expect(connectionsAt).toBeGreaterThan(usersAt);
  });

  it('keeps the catch-all last, where it can only take what is left', () => {
    const catchAll = users.indexOf('router.get("/:userId"');
    expect(catchAll).toBeGreaterThan(-1);
    const later = users.slice(catchAll + 1).match(/router\.(?:get|post|put|patch|delete)\(\s*["']\/(?!:)/);
    expect(later).toBeNull();
  });

  it('lets through every /users path the other router owns', () => {
    const shadowable = shadowablePaths(connections);
    expect(shadowable).toContain('discover');
    expect(reservedPaths(users)).toEqual(expect.arrayContaining(shadowable));
  });

  it('actually calls next() for those, rather than only listing them', () => {
    // Listing a path and then answering it anyway would be worse than not
    // listing it, because the list would read as a fix.
    expect(users).toMatch(/RESERVED_USER_PATHS\.has\(req\.params\.userId\)\)\s*return next\(\)/);
    expect(users).toMatch(/router\.get\("\/:userId", async \(req, res, next\)/);
  });
});

describe('who discover offers', () => {
  it('skips the account that has no id at all', () => {
    // A missing field satisfies both $ne and $nin, so it came back and rendered
    // a row with no key and a Connect button that would post a null id.
    expect(connections).toMatch(/userId: \{ \$type: 'string', \$ne: userId, \$nin: connectedUserIds \}/);
  });

  it('no longer serves a second /users/all that shadows the real one', () => {
    expect(connections).not.toMatch(/router\.get\('\/users\/all'/);
  });
});
