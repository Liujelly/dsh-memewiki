/**
 * 客户端面板冒烟：不开浏览器，用极简 React 桩跑一遍渲染函数，
 * 确认槽位声明正确、两条分支（未加载 / 已加载）都能渲染出内容。
 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const fakeState = {
  settings: { preload: true, guide: true, online: false, maxQueryChars: 10 },
  db: { available: true, count: 6668, builtAt: '2026-10-26T19:07:22' },
  terms: [{ name: '杂鱼', meaning: '打不过就嘴硬', author: '妮娅', at: '2026-10-26' }],
  stats: { lookups: 3 },
};

function makeReact(overrides) {
  let us = 0;
  const React = {
    createElement(type, props, ...children) {
      if (typeof type === 'function') {
        return type({ ...(props ?? {}) });
      }
      return { type, props: { ...(props ?? {}), children } };
    },
    useState(initial) {
      const index = us;
      us += 1;
      return [overrides?.[index] !== undefined ? overrides[index] : initial, () => {}];
    },
    useEffect() {},
    useCallback(fn) {
      return fn;
    },
  };
  React.__reset = () => {
    us = 0;
  };
  return React;
}

function texts(node, out = []) {
  if (node == null || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) texts(child, out);
    return out;
  }
  if (node.props) texts(node.props.children, out);
  return out;
}

function load(React) {
  let registered = null;
  const g = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        const mod = factory((name) => {
          if (name === 'react') return React;
          throw new Error(`未预期的 require(${name})`);
        });
        mod.apply({
          slots: {
            inject: (key, fn) => fn(),
            register: (decl, component) => {
              registered = { decl, component, key: decl.name, id };
            },
          },
        });
      },
    },
  };
  new Function('window', fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8'))(g);
  return registered;
}

/* --- 未加载：只有标题和占位 --- */
const cold = makeReact();
const reg = load(cold);
if (!reg) throw new Error('没有注册 settings.section');
if (reg.key !== 'settings.section') throw new Error(`槽位不对：${reg.key}`);
if (reg.id !== 'dsh-memewiki') throw new Error(`模块注册 id 必须等于包名，现在是：${reg.id}`);
if (reg.decl.id !== 'memewiki') throw new Error(`id 不对：${reg.decl.id}`);
if (reg.decl.order !== 44) throw new Error(`order 不对：${reg.decl.order}`);
if (reg.decl.label !== '梗百科') throw new Error(`label 不对：${reg.decl.label}`);

const coldTree = reg.component({ close() {} });
const coldText = texts(coldTree).join('\n');
for (const expected of ['梗百科', '正在读取…']) {
  if (!coldText.includes(expected)) throw new Error(`首屏缺少「${expected}」`);
}

/* --- 已加载：整页内容都在 --- */
const warm = makeReact({ 0: fakeState });
const warmTree = load(warm).component({ close() {} });
const warmText = texts(warmTree).join('\n');
const expectedBits = [
  '梗百科',
  '词库 6,668 条',
  '黑话 1 条',
  '自动预查',
  '常驻用法提示',
  '允许联网补查',
  '预查词长上限',
  '自定义用法提示',
  '保存提示',
  '查一下',
  '杂鱼',
  '打不过就嘴硬',
  '删除',
  '加入',
];
for (const bit of expectedBits) {
  if (!warmText.includes(bit)) throw new Error(`加载后缺少「${bit}」`);
}
if (warmText.includes('undefined') || warmText.includes('NaN')) throw new Error('渲染结果里出现了 undefined / NaN');

console.log(`槽位 ${reg.decl.id} · order ${reg.decl.order} · ${reg.decl.label}`);
console.log(`未加载分支 ${coldText.length} 字符，已加载分支 ${warmText.length} 字符`);
