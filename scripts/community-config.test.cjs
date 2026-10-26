const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const jsx = (type, props) => ({ type, props: props || {} });

function evaluate(source, bindings = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
  });
  assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports, URL,
    require(id) {
      assert.equal(id, 'react/jsx-runtime');
      return { jsx, jsxs: jsx };
    },
    ...bindings,
  }, { timeout: 1000 });
  return module.exports;
}

function functions(file, names, bindings = {}) {
  const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = tree.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name?.text));
  assert.equal(selected.length, names.length);
  return evaluate(selected.map(s => s.getText(tree)).join('\n') + `\nmodule.exports = { ${names.join(',')} };`, bindings);
}

function backend(env = {}) {
  const file = 'apps/api-server/src/modules/auth/auth.service.ts';
  const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const service = tree.statements.find(s => ts.isClassDeclaration(s) && s.name.text === 'AuthService');
  const methods = service.members.filter(s => ts.isMethodDeclaration(s) && ['getPublicConfig', 'getOAuthStartUrl'].includes(s.name.getText(tree)));
  assert.equal(methods.length, 2);
  return evaluate(`class CommunityConfig { ${methods.map(m => m.getText(tree)).join('\n')} }\nmodule.exports = new CommunityConfig();`,
    { process: { env }, BadRequestException: Error });
}

function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
const text = node => Array.isArray(node) ? node.map(text).join('') :
  node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');

test('public support config contains no implicit community destination when unset', () => {
  const support = backend().getPublicConfig().support;
  for (const key of ['orderKookUrl', 'discordUrl', 'kookUrl', 'voiceTrialDiscordUrl', 'voiceTrialKookUrl']) {
    assert.equal(support[key], null, key);
  }
});

test('configured support destinations remain available without embedded defaults', () => {
  const support = backend({
    SUPPORT_KOOK_URL: ' https://kook.example.invalid/community ',
    SUPPORT_DISCORD_URL: ' https://discord.example.invalid/community ',
    DISCORD_VOICE_WAITING_URL: 'https://discord.example.invalid/voice',
  }).getPublicConfig().support;
  assert.equal(support.kookUrl, 'https://kook.example.invalid/community');
  assert.equal(support.discordUrl, 'https://discord.example.invalid/community');
  assert.equal(support.voiceTrialKookUrl, support.kookUrl);
  assert.equal(support.voiceTrialDiscordUrl, 'https://discord.example.invalid/voice');
});

test('KOOK redirect rejects absent configuration and preserves an explicit destination', () => {
  assert.throws(() => backend().getOAuthStartUrl('kook', 'customer'), /尚未配置.*管理员/);
  assert.equal(backend({ SUPPORT_KOOK_URL: ' https://kook.example.invalid/community ' }).getOAuthStartUrl('kook', 'customer'),
    'https://kook.example.invalid/community');
});

test('a bound home-page platform does not manufacture an external destination', () => {
  const { getPlatformRouting } = functions('apps/customer-web/app/home/page.tsx', ['getPlatformRouting']);
  const absent = getPlatformRouting([{ platform: 'KOOK' }], {});
  assert.equal(absent.primaryHref, undefined);
  assert.equal(absent.isExternal, false);
  assert.equal(absent.showChoice, true);
  const configured = getPlatformRouting([{ platform: 'KOOK' }], { support: { kookUrl: ' https://kook.example.invalid/community ' } });
  assert.equal(configured.primaryHref, 'https://kook.example.invalid/community');
  assert.equal(configured.isExternal, true);
});

test('companion list and detail route missing trial destinations to support', () => {
  for (const file of ['apps/customer-web/app/companions/page.tsx', 'apps/customer-web/app/companions/[id]/page.tsx']) {
    const { companionTrialHref } = functions(file, ['companionTrialHref', 'companionTrialPlatform']);
    for (const platform of ['KOOK', 'DISCORD']) {
      const companion = { externalAccounts: [{ platform }] };
      assert.equal(companionTrialHref(companion, {}), '/support');
      const support = platform === 'KOOK'
        ? { voiceTrialKookUrl: 'https://kook.example.invalid/voice' }
        : { voiceTrialDiscordUrl: 'https://discord.example.invalid/voice' };
      assert.equal(companionTrialHref(companion, { support }), `https://${platform.toLowerCase()}.example.invalid/voice`);
    }
  }
});

// The community links moved from the top bar to the customer home page; the contract is unchanged.
test('navigation fallback names the missing configuration and offers support', () => {
  const file = 'apps/customer-web/app/home/page.tsx';
  const { ActionLink, getPlatformRouting } = functions(file, ['ActionLink', 'getPlatformRouting'], { Link: 'a' });
  const missing = getPlatformRouting([], {});
  assert.equal(missing.showChoice, true);
  assert.equal(missing.kookHref, undefined);
  const fallback = ActionLink({ href: missing.kookHref ?? '/support', external: Boolean(missing.kookHref), className: '', children: 'KOOK 未配置，联系客服' });
  assert.equal(fallback.props.href, '/support');
  assert.equal(fallback.props.target, undefined);
  assert.match(read(file), /KOOK 未配置，联系客服/);
  const configured = getPlatformRouting([], { support: { kookUrl: ' https://kook.example.invalid/community ' } });
  assert.equal(configured.kookHref, 'https://kook.example.invalid/community');
  const link = ActionLink({ href: configured.kookHref, external: true, className: '', children: 'KOOK 社群' });
  assert.equal(link.props.target, '_blank');
});

test('demand guide distinguishes missing destinations from configured community links', () => {
  for (const support of [{}, { kookUrl: 'https://kook.example.invalid/community', discordUrl: 'https://discord.example.invalid/community' }]) {
    let state = 0;
    const { DemandGuide } = functions('apps/customer-web/app/order/demand-guide.tsx', ['DemandGuide', 'GuideStep'], {
      Link: 'a', CustomerShell: 'section',
      useEffect() {},
      useState(initial) { return [state++ === 0 ? { support } : initial, () => {}]; },
    });
    const tree = DemandGuide();
    const links = nodes(tree).filter(n => n.type === 'a');
    assert.ok(links.every(n => n.props.href));
    if (support.kookUrl) {
      assert.ok(links.some(n => n.props.href === support.kookUrl && n.props.target === '_blank'));
    } else {
      assert.equal(links.filter(n => n.props.href === '/support' && /未配置/.test(text(n))).length, 2);
    }
  }
});

test('reviewed changed entry files have no embedded community invitation URL', () => {
  for (const file of [
    'apps/api-server/src/modules/auth/auth.service.ts',
    'apps/customer-web/app/components.tsx', 'apps/customer-web/app/home/page.tsx',
    'apps/customer-web/app/companions/page.tsx', 'apps/customer-web/app/companions/[id]/page.tsx',
    'apps/customer-web/app/order/demand-guide.tsx',
  ]) {
    assert.doesNotMatch(read(file), /https?:\/\/(?:discord\.gg\/|(?:www\.)?kook\.(?:top|vip)\/|(?:www\.)?(?:kookapp|kaiheila)\.cn\/(?:app\/)?(?:invite|go)\/)/i, file);
  }
});

test('secret scan exceptions remain limited to the reviewed legacy storage-key fingerprint', () => {
  // This exact historical finding was reviewed as a localStorage key, not an API credential.
  // Any other exception still requires an explicit review instead of silently widening the scan scope.
  const reviewed = new Set([
    'be952f027c77dd99dadb5bb5290cef5e270d3876:apps/admin-web/app/order-drafts/pending-direct-order.ts:generic-api-key:1',
  ]);
  const entries = read('.gitleaksignore').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  assert.equal(entries.every(entry => reviewed.has(entry)), true, 'Unreviewed secret-scan exception');
  assert.equal(new Set(entries).size, entries.length, 'Duplicate secret-scan exception');
});
