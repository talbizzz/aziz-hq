import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// ADR-8: modules import only from packages; packages import only from packages;
// apps may import packages and modules; nothing imports another workspace's src/.
const root = resolve(import.meta.dirname, '..');
const kinds = ['apps', 'packages', 'modules'];

const dirNames = (kind) => {
  try {
    return readdirSync(join(root, kind), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
};
const packageDirs = new Set(dirNames('packages'));
const appDirs = new Set(dirNames('apps'));

/** Which kind a "@aziz-hq/<name>" package belongs to; anything not a package or an app is a module. */
function kindOfName(name) {
  if (packageDirs.has(name)) return 'packages';
  if (appDirs.has(name)) return 'apps';
  return 'modules';
}

/** The workspace ("apps/web") a file path belongs to, or null if it is outside all of them. */
function workspaceOf(absPath) {
  const [kind, name] = relative(root, absPath).split(sep);
  return kinds.includes(kind) && name ? { kind, name } : null;
}

const allowed = {
  modules: new Set(['packages']),
  packages: new Set(['packages']),
  apps: new Set(['packages', 'modules']),
};

export const rule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden: '{{from}} must not import {{to}} (module boundaries, ADR-8).',
      deep: 'Import {{source}} through the package entry point, not its src/ (module boundaries, ADR-8).',
    },
  },
  create(context) {
    const own = workspaceOf(context.filename);
    if (!own) return {};

    const check = (node, source) => {
      if (typeof source !== 'string') return;
      if (source.startsWith('.')) {
        const target = workspaceOf(resolve(dirname(context.filename), source));
        if (!target || (target.kind === own.kind && target.name === own.name)) return;
        context.report({ node, messageId: 'deep', data: { source } });
        return;
      }
      const match = /^@aziz-hq\/([^/]+)(\/.*)?$/.exec(source);
      if (!match) return;
      const [, name, subpath] = match;
      if (subpath) {
        context.report({ node, messageId: 'deep', data: { source } });
        return;
      }
      const targetKind = kindOfName(name);
      const isSelf = own.kind === targetKind && own.name === name;
      if (!isSelf && !allowed[own.kind].has(targetKind)) {
        context.report({
          node,
          messageId: 'forbidden',
          data: { from: `${own.kind}/${own.name}`, to: source },
        });
      }
    };

    return {
      ImportDeclaration: (n) => check(n, n.source.value),
      ExportAllDeclaration: (n) => check(n, n.source.value),
      ExportNamedDeclaration: (n) => n.source && check(n, n.source.value),
      ImportExpression: (n) => n.source.type === 'Literal' && check(n, n.source.value),
    };
  },
};

export default { rules: { 'workspace-imports': rule } };
