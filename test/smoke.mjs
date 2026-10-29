import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DSH_HOME = path.join(os.tmpdir(), `memewiki-test-${process.pid}`);
fs.rmSync(process.env.DSH_HOME, { recursive: true, force: true });

const mod = await import(pathToFileURL(path.join(here, '..', 'lib', 'index.js')).href);
const { apply, defaults, validateConfig, extractQuery, normalizeQuery, worthSearch } = mod;

/* ---------- 纯函数 ---------- */
assert.equal(extractQuery('管人痴是什么梗'), '管人痴');
assert.equal(extractQuery('这个是什么梗'), '');
assert.equal(extractQuery('管人痴'), '管人痴');
assert.equal(extractQuery('好的'), '');
assert.equal(extractQuery('@小蓝 杂鱼 是什么意思'), '杂鱼');
assert.equal(extractQuery('今天天气不错啊'), '今天天气不错啊');
assert.equal(extractQuery('这是一句很长很长很长的话'), '');
assert.equal(extractQuery('小鲸鱼 已取餐什么意思'), '已取餐');
assert.equal(normalizeQuery('管人痴管人痴'), '管人痴');
assert.equal(normalizeQuery('666666'), '666');
assert.equal(normalizeQuery('管人痴'), '管人痴');
assert.equal(worthSearch('这是什么梗', 10), true);
assert.equal(worthSearch('为什么这个不行', 10), false);
assert.equal(worthSearch('这局打得跟管人痴一样', 10, { inSentence: true }), true);
assert.equal(worthSearch('晚上吃什么好呢', 10, { inSentence: true }), false);
assert.equal(extractQuery('这局打得跟管人痴一样', 10), '这局打得跟管人痴一样');
assert.equal(extractQuery('这局打得跟管人痴一样', 6), '');
assert.equal(extractQuery('管人痴是什么梗', 3), '管人痴');
assert.equal(extractQuery('管人痴是什么梗', 2), '');
assert.equal(validateConfig({}).maxQueryChars, defaults.maxQueryChars);
assert.throws(() => validateConfig({ maxQueryChars: 99 }), /2 到 20/);
assert.throws(() => validateConfig({ preload: 'yes' }), /布尔值/);

/* ---------- 假 ctx ---------- */
const calls = { tools: [], sections: [], contexts: [], routes: [], listeners: {}, effects: [] };
const makeCtx = (bucket) => ({
  tools: { register: (def) => (bucket.tools.push(def), () => {}) },
  systemPrompt: {
    section: (s) => {
      bucket.sections.push(s);
      return () => {
        const index = bucket.sections.indexOf(s);
        if (index !== -1) bucket.sections.splice(index, 1);
      };
    },
    context: (c) => (bucket.contexts.push(c), () => {}),
  },
  webServer: { register: (r) => (bucket.routes.push(r), () => {}) },
  on: (event, handler) => (bucket.listeners[event] = handler, () => {}),
  effect: (fn) => {
    const off = fn();
    bucket.effects.push(off);
    return () => off?.();
  },
  get: () => undefined,
});

apply(makeCtx(calls), {});

const tool = calls.tools.find((t) => t.name === 'search_meme_wiki');
assert.ok(tool, '工具应注册');
const run = (query, brief) => tool.execute({ query, brief }, {});
const render = (value) => tool.output.render({}, value)[0].text;

const hit = await run('管人痴');
assert.equal(hit.found, true);
assert.match(hit.text, /【梗百科】管人痴/);
assert.match(hit.text, /怎么用/);
assert.match(render(hit), /梗百科/);
console.log('--- 管人痴 ---\n' + hit.text.slice(0, 400));

const alias = await run('管人痴管人痴');
assert.equal(alias.title, hit.title);

const brief = await run('管人痴', true);
assert.ok(!brief.text.includes('【出处'));
assert.ok(!brief.text.includes('cnmeme.wiki'));
assert.ok(brief.text.includes('怎么用'), 'brief 应保留用法');
assert.ok(!brief.text.includes('“管人”一词源于'), 'brief 不该带出处正文');
assert.ok(!brief.text.includes('演化'), 'brief 不该带词条正文的后续段落');
assert.ok(brief.text.length < hit.text.length / 2, 'brief 应明显短于完整词条');

const miss = await run('不存在的词啊啊');
assert.equal(miss.found, false);
assert.match(miss.text, /没有/);

/* 提示分段 */
const guide = calls.sections.find((s) => s.name === 'memewiki:guide');
assert.ok(guide, '常驻提示应注册');
assert.match(guide.text(), /search_meme_wiki/);

/* 预查注入：每个 agent 一份 */
const agentBucket = { tools: [], sections: [], contexts: [], routes: [], listeners: {}, effects: [] };
const agentCtx = makeCtx(agentBucket);
const events = [
  { type: 'assistant/message', data: {} },
  {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '这局打得跟管人痴一样' }] },
  },
];
const agent = { id: 'a1', ctx: agentCtx, session: { snapshotEvents: () => events } };
calls.listeners['agent/created']({ agent, source: 'startup' });

const ctxReg = agentBucket.contexts.find((c) => c.name === 'memewiki:preload');
assert.ok(ctxReg, '预查上下文应注册到 agent.ctx');
const injected = ctxReg.text();
assert.match(injected, /梗词库内部资料/);
assert.match(injected, /管人痴/);
console.log('--- 预查注入 ---\n' + injected.slice(0, 300));

/* 普通聊天不注入 */
events.push({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你今天怎么样' }] } });
assert.equal(ctxReg.text(), '');

/* 普通疑问句不注入：虽然句子里有词库收录的「吃什么」 */
events.push({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '晚上吃什么好呢' }] } });
assert.equal(ctxReg.text(), '', '普通疑问句不应预查');

/* 设置页路由 */
const paths = calls.routes.map((r) => r.path).sort();
assert.deepEqual(paths, [
  '/dsh-memewiki/lookup',
  '/dsh-memewiki/settings',
  '/dsh-memewiki/state',
  '/dsh-memewiki/term',
]);

const routeOf = (p) => calls.routes.find((r) => r.path === p);
const fakeRes = () => {
  const out = { statusCode: 0, headers: {}, body: '' };
  out.setHeader = (k, v) => (out.headers[k] = v);
  out.end = (b) => (out.body = b);
  return out;
};
const getState = async () => {
  const res = fakeRes();
  await routeOf('/dsh-memewiki/state').handler({ method: 'GET', headers: { host: '127.0.0.1:1' } }, res);
  return JSON.parse(res.body);
};
const post = async (p, body, headers = {}) => {
  const res = fakeRes();
  const req = {
    method: 'POST',
    headers: { host: '127.0.0.1:1', 'content-type': 'application/json', 'x-memewiki': '1', ...headers },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
  await routeOf(p).handler(req, res);
  return JSON.parse(res.body);
};

const state = await getState();
assert.equal(state.ok, true);
assert.ok(state.db.count > 6000, `词库条数 ${state.db.count}`);
assert.equal(state.settings.preload, true);
console.log(`--- 状态 ---\n词库 ${state.db.count} 条，快照 ${state.db.builtAt}`);

const bad = await post('/dsh-memewiki/settings', {}, { 'x-memewiki': '' });
assert.equal(bad.ok, false, '缺少 x-memewiki 头应被拒');
const crossSite = await post('/dsh-memewiki/settings', {}, { origin: 'https://evil.example' });
assert.equal(crossSite.ok, false, '跨站写入应被拒');

const savedTerm = await post('/dsh-memewiki/term', { name: '妮娅的梗', meaning: '测试用黑话' });
assert.equal(savedTerm.ok, true);
assert.ok(savedTerm.terms.some((t) => t.name === '妮娅的梗'));

const termHit = await post('/dsh-memewiki/lookup', { query: '妮娅的梗' });
assert.equal(termHit.result.found, true);
assert.equal(termHit.result.source, '黑话');

const off = await post('/dsh-memewiki/settings', { settings: { preload: false, maxQueryChars: 6 } });
assert.equal(off.ok, true);
assert.equal(off.settings.preload, false);
assert.equal((await getState()).settings.maxQueryChars, 6);

const badSetting = await post('/dsh-memewiki/settings', { settings: { maxQueryChars: 0 } });
assert.equal(badSetting.ok, false);

/* 常驻提示即时开关 */
assert.equal(calls.sections.filter((s) => s.name === 'memewiki:guide').length, 1);
const guideOff = await post('/dsh-memewiki/settings', { settings: { guide: false } });
assert.equal(guideOff.ok, true);
assert.equal(calls.sections.filter((s) => s.name === 'memewiki:guide').length, 0, '关掉后应立即卸载');
const guideBack = await post('/dsh-memewiki/settings', { settings: { guide: true } });
assert.equal(guideBack.ok, true);
assert.equal(calls.sections.filter((s) => s.name === 'memewiki:guide').length, 1, '打开后应立即装回');

/* 自定义提示词 */
const custom = await post('/dsh-memewiki/settings', { settings: { guidance: '自定义：先查再说话' } });
assert.equal(custom.settings.guidance, '自定义：先查再说话');
assert.equal(custom.settings.guidanceText, '自定义：先查再说话');
assert.match(calls.sections.find((s) => s.name === 'memewiki:guide').text(), /先查再说话/);
const customReset = await post('/dsh-memewiki/settings', { settings: { guidance: '' } });
assert.equal(customReset.settings.guidance, '');
assert.match(calls.sections.find((s) => s.name === 'memewiki:guide').text(), /search_meme_wiki/, '留空应回到内置文案');

/* maxQueryChars 对预查生效 */
const widened = await post('/dsh-memewiki/settings', { settings: { preload: true, maxQueryChars: 10 } });
assert.equal(widened.ok, true);
events.push({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '打得跟管人痴一样' }] } });
assert.match(ctxReg.text(), /梗词库内部资料/, '十字的用法句应预查');
const narrowed = await post('/dsh-memewiki/settings', { settings: { maxQueryChars: 6 } });
assert.equal(narrowed.ok, true);
assert.equal(ctxReg.text(), '', '超过 maxQueryChars 的句子不预查');

/* 收尾：恢复默认，方便后面的落盘断言 */
const restore = await post('/dsh-memewiki/settings', { settings: { preload: false, maxQueryChars: 6 } });
assert.equal(restore.ok, true);

const del = await post('/dsh-memewiki/term', { action: 'delete', name: '妮娅的梗' });
assert.equal(del.ok, true);
assert.ok(!del.terms.some((t) => t.name === '妮娅的梗'));

const settingsOnDisk = JSON.parse(fs.readFileSync(path.join(process.env.DSH_HOME, 'memewiki', 'settings.json'), 'utf8'));
assert.equal(settingsOnDisk.preload, false);

console.log('\n全部通过');
fs.rmSync(process.env.DSH_HOME, { recursive: true, force: true });
