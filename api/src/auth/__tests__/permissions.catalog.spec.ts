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

/**
 * Every string passed to @RequirePermissions(...) across all controllers.
 * Returns both the extracted permissions and any non-literal arguments.
 * Non-literals (constants, expressions) cannot be statically verified, so we
 * collect them and fail with a clear message if any are found.
 */
function enforcedPermissions(): {
  permissions: Set<string>;
  nonLiterals: Array<{ file: string; text: string }>;
} {
  const permissions = new Set<string>();
  const nonLiterals: Array<{ file: string; text: string }> = [];

  for (const file of controllerFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/@RequirePermissions\(([^)]*)\)/g)) {
      const argText = m[1];

      // Extract single-quoted strings
      for (const s of argText.matchAll(/'([^']+)'/g)) {
        permissions.add(s[1]);
      }

      // Extract double-quoted strings
      for (const s of argText.matchAll(/"([^"]+)"/g)) {
        permissions.add(s[1]);
      }

      // Check for non-literal arguments: anything that isn't just quotes and whitespace
      const withoutQuotes = argText.replace(/'[^']+'/g, '').replace(/"[^"]+"/g, '');
      if (withoutQuotes.trim().length > 0) {
        nonLiterals.push({ file, text: argText.trim() });
      }
    }
  }

  return { permissions, nonLiterals };
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
  it('discovers a non-zero set of controllers', () => {
    const controllers = controllerFiles(SRC);
    expect(controllers.length).toBeGreaterThan(0);
  });

  it('detects non-literal @RequirePermissions arguments and fails', () => {
    const { nonLiterals } = enforcedPermissions();
    if (nonLiterals.length > 0) {
      const msg = nonLiterals
        .map((nl) => `  ${nl.file}: @RequirePermissions(${nl.text})`)
        .join('\n');
      throw new Error(
        `Found non-literal permission arguments that cannot be verified:\n${msg}\n\nUse string literals (single or double quoted) so the drift test can extract and verify them.`,
      );
    }
    expect(nonLiterals).toEqual([]);
  });

  it('has no phantom enforcement: every decorator permission is in the catalog', () => {
    const { permissions } = enforcedPermissions();
    const unknown = [...permissions].filter((p) => !isKnownPermission(p));
    expect(unknown).toEqual([]);
  });

  it('has no phantom offers: every catalog permission is enforced somewhere', () => {
    const { permissions: enforced } = enforcedPermissions();
    const unenforced = PERMISSION_KEYS.filter((k) => !enforced.has(k));
    expect(unenforced).toEqual([]);
  });
});
