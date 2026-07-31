import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  isKnownPermission,
} from '../permissions.catalog';

const SRC = resolve(__dirname, '../..');

/** Every *.controller.ts under api/src, recursively. */
function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...controllerFiles(full));
    } else if (entry.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Every string passed to @RequirePermissions(...) across all controllers. */
function enforcedPermissions(): Set<string> {
  const found = new Set<string>();
  for (const file of controllerFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/@RequirePermissions\(([^)]*)\)/g)) {
      for (const s of m[1].matchAll(/'([^']+)'/g)) found.add(s[1]);
    }
  }
  return found;
}

describe('permission catalog integrity', () => {
  it('has unique keys', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('gives every entry a label, description and group', () => {
    for (const p of PERMISSION_CATALOG) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.group.length).toBeGreaterThan(0);
    }
  });

  it('uses only resource:action keys', () => {
    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z]+:[a-z]+$/);
    }
  });

  it('does not list the * wildcard as a grantable permission', () => {
    expect(PERMISSION_KEYS).not.toContain('*');
  });

  it('recognises known keys and rejects unknown ones', () => {
    expect(isKnownPermission('sales:manage')).toBe(true);
    expect(isKnownPermission('invoice:create')).toBe(false);
  });

  it('marks the irreversible actions as high risk', () => {
    const high = PERMISSION_CATALOG.filter((p) => p.risk === 'high').map((p) => p.key);
    expect(high).toEqual(
      expect.arrayContaining([
        'period:close',
        'payroll:run',
        'checks:print',
        'checks:void',
      ]),
    );
  });
});

describe('catalog matches enforcement', () => {
  it('has no phantom enforcement: every decorator permission is in the catalog', () => {
    const unknown = [...enforcedPermissions()].filter((p) => !isKnownPermission(p));
    expect(unknown).toEqual([]);
  });

  // Activated in Task 8, once the enforcement sweep is complete. Until then
  // most catalog entries legitimately have no decorator yet.
  it.todo('has no phantom offers: every catalog permission is enforced somewhere');
});
