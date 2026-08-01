import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const SRC = resolve(__dirname, '../..');

/**
 * Every *.controller.ts under api/src, recursively.
 *
 * Same approach as `controllerFiles` in permissions.catalog.spec.ts (that spec
 * verifies permission *names* agree between the catalog and the decorators;
 * this one verifies endpoint *coverage* — that every mutating handler carries
 * a decorator at all). Re-derived here rather than imported so this file has
 * no dependency on the other spec's internals.
 */
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
 * True for a (trimmed) line that is a comment, or part of a block comment.
 * These must be treated like blank lines when scanning for decorator blocks:
 * they carry no decorator information, but must not be mistaken for the
 * start of a class member either (a JSDoc block sitting just above a class
 * declaration is not itself a "member" — treating it as one would make the
 * brace-depth skip start counting from the comment instead of the class body,
 * swallowing the entire class in one gulp).
 */
function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

const MUTATING_METHODS = ['Post', 'Patch', 'Put', 'Delete'] as const;
type MutatingMethod = (typeof MUTATING_METHODS)[number];

interface Handler {
  file: string;
  method: MutatingMethod;
  routePath: string; // decorator argument, e.g. ':id/void' or '' for @Post()
  fullPath: string; // controller prefix + routePath, for reporting
  guarded: boolean;
  name: string; // best-effort handler function name, for reporting
}

/**
 * Extract the @Controller('prefix') argument, if any.
 */
function controllerPrefix(src: string): string {
  const m = src.match(/@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/);
  if (!m) return '';
  return m[1] ?? m[2] ?? '';
}

function joinPath(prefix: string, routePath: string): string {
  const parts = [prefix, routePath].filter((p) => p.length > 0);
  return '/' + parts.join('/').replace(/\/+/g, '/').replace(/^\/+/, '');
}

/**
 * Walk a controller file's class body and find every @Post/@Patch/@Put/@Delete
 * handler, determining for each whether it also carries @RequirePermissions.
 *
 * Handles:
 *  - decorators in either order relative to each other (@RequirePermissions
 *    before or after the route decorator)
 *  - blank lines and other decorators (@ApiOperation, @HttpCode, ...) mixed in
 *  - argument-less route decorators (@Post()) and ones with a path
 *    (@Post('print')) or params (@Post(':id/void'))
 *  - multi-line handler signatures, including inline object-literal type
 *    annotations in parameters (e.g. `body: { email: string }`), by tracking
 *    brace depth across the whole member rather than assuming one line == one
 *    brace pair.
 *
 * Approach: scan line by line. Accumulate a "decorator block" of consecutive
 * lines that are blank or start with `@` (decorators may themselves span
 * multiple lines; a simple paren-depth count keeps multi-line decorator calls
 * together). The first line after the block that isn't blank/decorator is the
 * start of the class member the block belongs to. If any decorator in the
 * block is a route decorator, record whether @RequirePermissions was also in
 * the block. Then skip forward past the member's body using brace-depth
 * counting (which naturally handles inline object-literal types in the
 * parameter list, since their braces balance out before the body's opening
 * brace) so the body's contents are never mistaken for the next member's
 * decorators.
 */
function scanControllerFile(file: string): Handler[] {
  const src = readFileSync(file, 'utf8');
  const prefix = controllerPrefix(src);
  const lines = src.split('\n');
  const handlers: Handler[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('@') || isCommentLine(trimmed)) {
      // Accumulate a decorator block (blank lines, comments, and decorator
      // lines; decorator calls may themselves span multiple lines).
      const blockLines: string[] = [];
      const blockStart = i;

      while (i < lines.length) {
        const t = lines[i].trim();
        if (t === '' || isCommentLine(t)) {
          i++;
          continue;
        }
        if (t.startsWith('@')) {
          // Consume this decorator, following its parens across lines if needed.
          let depth = 0;
          let started = false;
          const decoratorLines: string[] = [];
          while (i < lines.length) {
            const l = lines[i];
            decoratorLines.push(l);
            for (const ch of l) {
              if (ch === '(') {
                depth++;
                started = true;
              } else if (ch === ')') {
                depth--;
              }
            }
            i++;
            if (started && depth <= 0) break;
            if (!started) break; // bare decorator with no parens, e.g. @Public
          }
          blockLines.push(decoratorLines.join('\n'));
          continue;
        }
        break;
      }

      // `i` now points at the first non-blank, non-decorator line: the start
      // of the member (method signature, field, or the class/constructor
      // itself) that this decorator block belongs to.
      if (i >= lines.length) break;

      const blockText = blockLines.join('\n');
      const routeMatch = blockText.match(
        /@(Post|Patch|Put|Delete)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/,
      );

      if (routeMatch) {
        const method = routeMatch[1] as MutatingMethod;
        const routePath = routeMatch[2] ?? routeMatch[3] ?? '';
        const guarded = /@RequirePermissions\(/.test(blockText);
        const nameMatch = lines[i].match(/^\s*(?:async\s+)?(\w+)\s*\(/);
        handlers.push({
          file,
          method,
          routePath,
          fullPath: joinPath(prefix, routePath),
          guarded,
          name: nameMatch ? nameMatch[1] : lines[i].trim().slice(0, 40),
        });
      }

      if (i === blockStart) {
        // Safety valve: nothing consumed (shouldn't happen), avoid infinite loop.
        i++;
        continue;
      }

      // A class (or interface) declaration is a *container*, not a leaf
      // member — its body holds the methods we still need to scan, each with
      // their own decorator blocks. Step into it one line at a time rather
      // than brace-skipping over the whole thing (which would swallow every
      // method inside as if it were one member).
      if (/^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w/.test(lines[i])) {
        i++;
        continue;
      }

      // Skip past the member's body using brace-depth counting. This starts
      // at the member's first line (the signature) and continues until the
      // depth returns to zero after having gone positive — which lands on the
      // body's closing brace regardless of intervening object-literal type
      // annotations, template literals, or nested blocks.
      let depth = 0;
      let started = false;
      while (i < lines.length) {
        const l = lines[i];
        for (const ch of l) {
          if (ch === '{') {
            depth++;
            started = true;
          } else if (ch === '}') {
            depth--;
          }
        }
        i++;
        if (started && depth <= 0) break;
        // Member with no body at all (e.g. a field ending in `;`) — stop at
        // the first line ending the statement if no `{` ever appears.
        if (!started && /;\s*$/.test(l.trim())) break;
      }
      continue;
    }

    i++;
  }

  return handlers;
}

/**
 * Allow-list of mutating handlers that legitimately run without
 * @RequirePermissions, because no authenticated company membership exists
 * yet at the point they run. Every entry must be justified — do NOT add an
 * entry here to silence a genuine authorization gap; report it instead.
 */
const ALLOW_LIST: Array<{ file: string; method: MutatingMethod; routePath: string; reason: string }> = [
  {
    file: 'auth/auth.controller.ts',
    method: 'Post',
    routePath: 'login',
    reason: 'Local login. Runs before a session exists.',
  },
  {
    file: 'auth/auth.controller.ts',
    method: 'Post',
    routePath: 'saml/callback',
    reason: 'SAML SSO callback. Runs before a session exists.',
  },
  {
    file: 'auth/auth.controller.ts',
    method: 'Post',
    routePath: 'logout',
    reason: 'Stateless JWT logout is a client-side no-op; nothing to gate.',
  },
  {
    file: 'auth/onboarding.controller.ts',
    method: 'Post',
    routePath: '',
    reason: 'Creates the first organization + company; no membership exists yet.',
  },
  {
    file: 'auth/onboarding.controller.ts',
    method: 'Post',
    routePath: 'company',
    reason: 'Creates an additional (or bootstrap) company for the caller; no membership on the new company exists yet.',
  },
];

function isAllowListed(h: Handler): boolean {
  const relFile = relative(SRC, h.file).split('\\').join('/');
  return ALLOW_LIST.some(
    (a) => a.file === relFile && a.method === h.method && a.routePath === h.routePath,
  );
}

describe('mutating handler coverage', () => {
  const files = controllerFiles(SRC);
  const allHandlers = files.flatMap(scanControllerFile);
  const mutatingHandlers = allHandlers; // scanControllerFile only records mutating methods

  it('discovers a non-trivial number of controllers and handlers (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(mutatingHandlers.length).toBeGreaterThanOrEqual(30);
  });

  it('every allow-list entry corresponds to a real, currently-unguarded handler', () => {
    // If this fails, the allow-list has drifted from the actual code: either
    // the route no longer exists, moved, or (better) has since been gated and
    // the allow-list entry should be deleted rather than adjusted to match.
    const missing = ALLOW_LIST.filter((a) => {
      const relFiles = allHandlers.map((h) => relative(SRC, h.file).split('\\').join('/'));
      return !allHandlers.some(
        (h, idx) =>
          relFiles[idx] === a.file && h.method === a.method && h.routePath === a.routePath,
      );
    });
    expect(missing).toEqual([]);
  });

  it('every mutating handler carries @RequirePermissions unless explicitly allow-listed', () => {
    const unguarded = mutatingHandlers.filter((h) => !h.guarded && !isAllowListed(h));

    if (unguarded.length > 0) {
      const msg = unguarded
        .map(
          (h) =>
            `  ${relative(SRC, h.file)} — @${h.method}('${h.routePath}') [${h.name}] — route: ${h.method} ${h.fullPath}`,
        )
        .join('\n');
      throw new Error(
        `Found mutating handler(s) with no @RequirePermissions and not on the allow-list:\n${msg}\n\n` +
          `Every @Post/@Patch/@Put/@Delete handler must either carry @RequirePermissions(...) ` +
          `or be added to the ALLOW_LIST in this file with a one-line justification ` +
          `(pre-authentication routes only — do not allow-list a real authorization gap).`,
      );
    }

    expect(unguarded).toEqual([]);
  });
});
