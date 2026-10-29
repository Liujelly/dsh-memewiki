/**
 * dsh-memewiki（梗百科）
 *
 * 移植自 AstrBot 插件 astrbot_plugin_memewiki（MIT）：
 *   - 本地 6668 条梗词库（memes.db，SQLite，只读挂载）
 *   - search_meme_wiki 工具：模型查梗、缩写、黑话
 *   - 自动预查注入：用户说了像梗的话，先把词条塞进上下文（不再联网）
 *   - 设置页：开关、黑话增删、在线查词测试
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const name = 'memewiki';
export const inject = ['tools', 'systemPrompt', 'webServer'];

export const defaults = {
  /** 自动预查注入：用户发来的话像梗时，先把词条放进上下文 */
  preload: true,
  /** 内置「怎么用梗」的常驻提示 */
  guide: true,
  /** 词库没有时，查词工具是否去 cnmeme.wiki 在线补查 */
  online: false,
  /** 自动预查时，一句话最多当多长的词去查 */
  maxQueryChars: 10,
  /** 自定义提示词；留空则用内置文案 */
  guidance: '',
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const DIR = path.join(HOME, 'memewiki');
const SETTINGS_FILE = path.join(DIR, 'settings.json');
const TERMS_FILE = path.join(DIR, 'terms.json');
const USER_DB = path.join(DIR, 'memes.db');
const BUNDLED_DB = path.join(HERE, '..', 'data', 'memes.db');
const API_BASE = 'https://cnmeme.wiki/api/v1/public/memes';
const UA = 'dsh-memewiki/1.0';

const GUIDANCE = [
  '[梗百科·内置用法]',
  '1. 看到没把握的网络新词、梗、缩写、黑话，先调 search_meme_wiki，别硬猜、别现编；',
  '2. 查到先接梗、别科普：照着词条里的「怎么用 / 怎么接」说一句，像本来就会；',
  '3. 只有对方明确问「这是什么梗 / 啥意思」才解释出处，一两句就行，别把词条念一遍；',
  '4. 查不到就说不知道，别把两个不相干的梗拼在一起；',
  '5. 说短句，别用「首先 / 其次 / 希望对你有帮助」这类客服腔。',
].join('\n');

/* ------------------------------------------------------------------ 基础工具 */

function clip(text, limit) {
  const s = String(text ?? '').trim();
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

/* -------------------------------------------------------------- 配置与校验 */

export function validateConfig(input, previous = defaults) {
  const next = { ...previous };
  if (input == null) return next;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('配置必须是一个对象');
  for (const key of ['preload', 'guide', 'online']) {
    if (key in input) {
      if (typeof input[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
      next[key] = input[key];
    }
  }
  if ('maxQueryChars' in input) {
    const n = Number(input.maxQueryChars);
    if (!Number.isFinite(n) || n < 2 || n > 20) throw new Error('maxQueryChars 需要在 2 到 20 之间');
    next.maxQueryChars = Math.round(n);
  }
  if ('guidance' in input) {
    if (typeof input.guidance !== 'string') throw new Error('guidance 必须是文本');
    if (input.guidance.length > 4000) throw new Error('guidance 太长了（上限 4000 字）');
    next.guidance = input.guidance;
  }
  return next;
}

/* ------------------------------------------------------------ 查询抽取（移植） */

const ASK_PATTERN =
  /(?:是)?(?:什么梗|啥梗|什么来头|什么来历|什么出处|什么意思|啥意思|怎么用|怎么接|怎么玩|如何用)(?:啊|呀|呢|的|啊这是)?[？?。！!~～]*$/;
/** 裸词只允许中英文数字和间隔号；长度上限跟着 maxQueryChars 走 */
const BARE_PATTERN = /^[\u4e00-\u9fa5A-Za-z0-9·]+$/;
const PRONOUN_HEADS = new Set([
  '这', '那', '它', '他', '她', '这个', '那个', '你', '这句话', '那句话', '上面', '刚才', '下文', '前面',
]);
const STOP_WORDS = new Set([
  '在吗', '在不在', '哈哈', '哈哈哈', '笑死', '好的', '好吧', '晚安', '早安', '睡觉', '吃饭', '干嘛',
  '没事', '收到', '谢谢', '好耶', '草', '典', '乐',
]);
const WAKE_WORDS = ['小鲸鱼', '大鲸鱼', '大肥鲸', '小肥鲸', '大肥鱼', '奶鱼', '鲸鱼', 'deepseek', 'ds'];
const SENTENCE_WORDS = [
  '怎么样', '怎么', '多少', '为什么', '能不能', '是不是', '什么', '了吗', '了没', '一下',
  '你说', '要不要', '有没有',
];
const PRONOUN_WORDS = ['自己', '你们', '我们', '他们', '她们', '咱们', '大家', '别人'];
const INTENT_WORDS = [
  '什么梗', '啥梗', '梗是啥', '什么来头', '什么来历', '什么出处', '啥意思', '什么意思',
  '黑话', '谐音', '缩写', '怎么来的', '谁说的', '怎么用', '怎么接',
];

function cleanText(raw) {
  let text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^(?:@\S+\s*)+/, '');
  let changed = true;
  while (changed) {
    changed = false;
    for (const word of WAKE_WORDS) {
      if (text.toLowerCase().startsWith(word)) {
        text = text.slice(word.length).replace(/^[\s,，。!！:：]+/, '');
        changed = true;
      }
    }
  }
  return text.trim();
}

/** 词长上限：设置允许 2–20，超出范围按边界收拢 */
function queryLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return defaults.maxQueryChars;
  return Math.max(2, Math.min(20, Math.round(n)));
}

/** 从一句话里认出「要查哪个词」；认不出返回空串 */
export function extractQuery(raw, maxQueryChars = defaults.maxQueryChars) {
  const limit = queryLimit(maxQueryChars);
  const text = cleanText(raw);
  if (!text) return '';
  const ask = ASK_PATTERN.exec(text);
  if (ask) {
    let head = text.slice(0, ask.index).trim();
    head = head.replace(/是$/, '').trim();
    head = head.replace(/(这个梗|那个梗|这梗|那梗|这个|那个)$/, '').trim();
    head = head.replace(/(到底|究竟)$/, '').trim();
    if (!head || PRONOUN_HEADS.has(head)) return '';
    if (head.length > limit) return '';
    return head.length >= 1 ? head : '';
  }
  if (text.length < 2 || text.length > limit) return '';
  if (!BARE_PATTERN.test(text)) return '';
  if (STOP_WORDS.has(text)) return '';
  return text;
}

/** 「杂鱼杂鱼」→「杂鱼」；「666666」→「666」 */
export function normalizeQuery(query) {
  const q = String(query ?? '').trim();
  const n = q.length;
  if (n < 4) return q;
  for (let size = Math.min(4, Math.floor(n / 2)); size >= 2; size -= 1) {
    if (n % size !== 0) continue;
    const block = q.slice(0, size);
    if (block.repeat(n / size) === q) return block;
  }
  return q;
}

/**
 * 判断一句话「值不值得当词去查」。
 * `options.inSentence` 用于自动预查：允许「这局打得跟管人痴一样」这类在句子里用梗的说法，
 * 但仍然挡住「晚上吃什么好呢」这种普通疑问句。
 */
export function worthSearch(text, maxQueryChars, options = {}) {
  const t = String(text ?? '');
  if (INTENT_WORDS.some((word) => t.includes(word))) return true;
  const q = t.trim();
  if (q.length < 2 || q.length > queryLimit(maxQueryChars)) return false;
  if (SENTENCE_WORDS.some((word) => q.includes(word))) return false;
  if (options.inSentence) return true;
  if (PRONOUN_WORDS.some((word) => q.includes(word))) return false;
  if (q.length >= 3 && '我你他她它这那'.includes(q[0])) return false;
  if (q.length >= 4 && '不没别请快都还就再又也'.includes(q[0])) return false;
  return true;
}

/* ------------------------------------------------------------------- 词库 */

function dbFile() {
  for (const file of [USER_DB, BUNDLED_DB]) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
    } catch {}
  }
  return '';
}

function openDatabase(file) {
  if (!file) return null;
  try {
    return new DatabaseSync(file, { readOnly: true });
  } catch {
    return null;
  }
}

function tagList(tags) {
  return String(tags ?? '')
    .split('、')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** 查词条：先同名，再「完整标题出现在查询里」 */
function matchTitle(db, query) {
  const q = String(query ?? '').trim();
  if (!q) return '';
  try {
    const exact = db.prepare('SELECT title FROM memes WHERE title = ?').get(q);
    if (exact?.title) return String(exact.title);
    const near = db
      .prepare('SELECT title FROM memes WHERE length(title) >= 2 AND instr(?, title) > 0 ORDER BY length(title) DESC LIMIT 1')
      .get(q);
    return near?.title ? String(near.title) : '';
  } catch {
    return '';
  }
}

function rowData(db, title) {
  try {
    const row = db
      .prepare('SELECT title, slug, tags, usage, origin, other, summary FROM memes WHERE title = ?')
      .get(title);
    if (!row) return null;
    const usage = String(row.usage ?? '').trim();
    const origin = String(row.origin ?? '').trim();
    let other = String(row.other ?? '').trim();
    if (!usage && !origin) other = other || String(row.summary ?? '').trim();
    return {
      title: String(row.title),
      slug: String(row.slug ?? '').trim(),
      tags: tagList(row.tags),
      usage,
      origin,
      other,
      note: '',
      extra: [],
      source: '词库',
      footer: String(row.slug ?? '').trim() ? `cnmeme.wiki/词条/${String(row.slug).trim()}` : '',
    };
  } catch {
    return null;
  }
}

function dbInfo(db) {
  if (!db) return { available: false, count: 0, builtAt: '', path: '' };
  try {
    const count = db.prepare('SELECT COUNT(*) AS n FROM memes').get();
    const built = db.prepare("SELECT value FROM meta WHERE key = 'built_at'").get();
    return {
      available: true,
      count: Number(count?.n ?? 0),
      builtAt: String(built?.value ?? ''),
      path: dbFile(),
    };
  } catch {
    return { available: false, count: 0, builtAt: '', path: dbFile() };
  }
}

/* --------------------------------------------------------------- 词条文本 */

function entryText(entry, forLLM = true, brief = false) {
  const lines = [`【梗百科】${entry.title}`];
  if (entry.note) lines.push(entry.note);
  if (entry.tags.length) lines.push(`标签：${entry.tags.join('、')}`);
  if (forLLM) {
    if (entry.usage) lines.push(`【怎么用 / 怎么接】\n${clip(entry.usage, 600)}`);
    if (!brief && entry.origin) lines.push(`【出处（仅用于理解，别照搬）】\n${clip(entry.origin, 450)}`);
  } else {
    if (entry.origin) lines.push(`【来源】\n${clip(entry.origin, 450)}`);
    if (entry.usage) lines.push(`【用法】\n${clip(entry.usage, 600)}`);
  }
  if (!brief && entry.other) lines.push(clip(entry.other, 400));
  if (!brief && entry.extra.length) lines.push(`同批检索到的其它相关词条：${entry.extra.join('、')}`);
  if (!brief && entry.footer) lines.push(entry.footer);
  return lines.join('\n');
}

function dictHint(query, text) {
  return [
    '[梗词库内部资料·仅用于理解，禁止原样输出]',
    `用户在说「${query}」。参考下面词条，优先用这个词接梗；不要复述标题、标签、来源，也不要说明自己查了一下。`,
    '',
    text,
  ].join('\n');
}

/* --------------------------------------------------------------- 在线补查 */

function htmlToText(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSections(text) {
  const parts = String(text ?? '').split(/\n#{2,3}\s*/g);
  const out = { usage: '', origin: '', other: '' };
  if (parts.length <= 1) {
    out.other = String(text ?? '').trim();
    return out;
  }
  out.other = parts[0].trim();
  for (const part of parts.slice(1)) {
    const lines = part.split('\n');
    const title = lines.shift() ?? '';
    const body = lines.join('\n').trim();
    if (/用法|怎么用|如何用|例句|接梗/.test(title)) out.usage = out.usage ? `${out.usage}\n${body}` : body;
    else if (/来源|出处|背景|起源|介绍/.test(title)) out.origin = out.origin ? `${out.origin}\n${body}` : body;
    else out.other = out.other ? `${out.other}\n${body}` : body;
  }
  return out;
}

async function apiGet(params, timeoutMs = 4000) {
  const url = new URL(API_BASE);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`接口返回 ${res.status}`);
  return await res.json();
}

async function searchOnline(query) {
  const list = await apiGet({ q: query, limit: 5 });
  const items = Array.isArray(list?.items) ? list.items : Array.isArray(list?.data) ? list.data : [];
  if (!items.length) return null;
  const pick =
    items.find((item) => String(item?.title ?? '').trim() === query) ??
    items.find((item) => query.includes(String(item?.title ?? '').trim()) && String(item?.title ?? '').trim().length >= 2);
  if (!pick) return null;
  const slug = String(pick.slug ?? '').trim();
  let detail = pick;
  if (slug) {
    try {
      const one = await apiGet({ slug });
      const item = one?.item ?? (Array.isArray(one?.items) ? one.items[0] : null) ?? one?.data ?? null;
      if (item && typeof item === 'object') detail = item;
    } catch {}
  }
  const body = htmlToText(detail?.content_html ?? detail?.content ?? '');
  const sections = splitSections(body);
  const title = String(detail?.title ?? pick.title ?? query).trim();
  return {
    title,
    slug,
    tags: Array.isArray(detail?.tags) ? detail.tags.map(String) : tagList(detail?.tags),
    usage: sections.usage,
    origin: sections.origin,
    other: sections.other || String(detail?.summary ?? '').trim(),
    note: title === query ? '' : `（词库里没有完全同名的条目，最接近的是「${title}」）`,
    extra: items
      .map((item) => String(item?.title ?? '').trim())
      .filter((name) => name && name !== title)
      .slice(0, 4),
    source: '在线',
    footer: slug ? `cnmeme.wiki/词条/${slug}` : '',
  };
}

/* ------------------------------------------------------------------ 插件本体 */

export function apply(ctx, config) {
  fs.mkdirSync(DIR, { recursive: true });

  let settings;
  try {
    settings = validateConfig({ ...defaults, ...(config && typeof config === 'object' ? config : {}) });
  } catch {
    settings = { ...defaults };
  }
  try {
    settings = validateConfig({ ...settings, ...readJSON(SETTINGS_FILE, {}) });
  } catch {}

  let terms = readJSON(TERMS_FILE, {});
  if (!terms || typeof terms !== 'object' || Array.isArray(terms)) terms = {};

  const stats = { lookups: 0, hits: 0, preloads: 0 };
  const preloadCache = new Map();
  const disposers = [];

  /* --- 词库连接：懒加载，文件变了就重开 --- */
  let db = null;
  let dbPath = '';

  function connection() {
    const file = dbFile();
    if (!file) return null;
    if (db && dbPath === file) return db;
    try {
      db?.close();
    } catch {}
    db = openDatabase(file);
    dbPath = db ? file : '';
    return db;
  }

  function findTerm(query) {
    const q = String(query ?? '').trim();
    if (!q) return null;
    if (terms[q]?.meaning) return termEntry(q);
    let best = '';
    for (const key of Object.keys(terms)) {
      if (key.length >= 2 && key.length > best.length && q.includes(key) && terms[key]?.meaning) best = key;
    }
    return best ? termEntry(best) : null;
  }

  function termEntry(key) {
    const record = terms[key] ?? {};
    const meaning = String(record.meaning ?? '').trim();
    if (!meaning) return null;
    return {
      title: key,
      slug: '',
      tags: [],
      usage: meaning,
      origin: '',
      other: '',
      note: '',
      extra: [],
      source: '黑话',
      footer: record.author ? `（${record.author} 建的黑话）` : '（自建黑话）',
    };
  }

  /** 同步查词：黑话 → 词库。毫秒级，不联网。 */
  function lookupLocal(query) {
    const q = String(query ?? '').trim();
    if (!q) return null;
    const term = findTerm(q);
    if (term) return term;
    const conn = connection();
    if (!conn) return null;
    const title = matchTitle(conn, q);
    if (!title) return null;
    const entry = rowData(conn, title);
    if (!entry) return null;
    if (title !== q) entry.note = `（这句话里提到了「${title}」，按这条参考）`;
    return entry;
  }

  async function lookup(query, brief = false) {
    const q = normalizeQuery(String(query ?? '').trim());
    if (!q) return { found: false, title: '', source: '', text: '查询词是空的。' };
    stats.lookups += 1;
    let entry = lookupLocal(q);
    if (!entry && settings.online && q.length <= 20) {
      try {
        entry = await searchOnline(q);
      } catch (error) {
        return {
          found: false,
          title: q,
          source: '在线',
          text: `在线补查失败：${String(error?.message ?? error).slice(0, 120)}\n词库里也没有「${q}」。`,
        };
      }
    }
    if (!entry) {
      return {
        found: false,
        title: q,
        source: '',
        text: `词库里没有「${q}」。别硬编；如果确实要解释，先说不确定。`,
      };
    }
    stats.hits += 1;
    return { found: true, title: entry.title, source: entry.source, text: entryText(entry, true, brief) };
  }

  /* --- 设置页与工具共用的一套写操作 --- */
  function publicSettings() {
    return { ...settings, guidanceText: settings.guidance || GUIDANCE };
  }

  function saveSettings(patch) {
    const next = validateConfig({ ...settings, ...(patch ?? {}) });
    writeJSON(SETTINGS_FILE, next);
    settings = next;
    syncGuide();
    return publicSettings();
  }

  function termList() {
    return Object.entries(terms)
      .map(([name, record]) => ({
        name,
        meaning: String(record?.meaning ?? ''),
        author: String(record?.author ?? ''),
        at: String(record?.at ?? ''),
      }))
      .filter((item) => item.meaning)
      .sort((a, b) => b.at.localeCompare(a.at) || a.name.localeCompare(b.name));
  }

  function saveTerm(input) {
    const term = String(input?.name ?? '').trim();
    const meaning = String(input?.meaning ?? '').trim();
    if (!term) throw new Error('词条名不能为空');
    if (term.length > 40) throw new Error('词条名最多 40 个字');
    if (!meaning) throw new Error('解释不能为空');
    if (meaning.length > 500) throw new Error('解释最多 500 个字');
    const previous = terms[term] ?? {};
    terms[term] = {
      meaning,
      author: String(input?.author ?? previous.author ?? '设置页').slice(0, 40),
      at: new Date().toISOString(),
    };
    writeJSON(TERMS_FILE, terms);
    return { name: term, meaning, author: terms[term].author, at: terms[term].at };
  }

  function deleteTerm(input) {
    const term = String(input?.name ?? '').trim();
    if (!term || !terms[term]) throw new Error('没有这个词条');
    delete terms[term];
    writeJSON(TERMS_FILE, terms);
    return { name: term };
  }

  /* --- 工具：search_meme_wiki --- */
  const str = { type: 'string' };
  const bool = { type: 'boolean' };
  disposers.push(
    ctx.tools.register({
      name: 'search_meme_wiki',
      description:
        '查网络梗、缩写、黑话、流行语的含义与用法（内置 6668 条词库）。看到没把握的新词先查，别硬猜。查不到会返回 found=false。',
      parameters: {
        type: 'object',
        properties: {
          query: { ...str, description: '要查的词，尽量只填词本身（如「杂鱼」「已取餐」），不要整句。' },
          brief: { ...bool, description: 'true 时只要一句怎么用，不要出处（默认 false）。' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { found: bool, title: str, source: str, text: str },
          additionalProperties: true,
        },
        render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
      },
      execute: (args) => lookup(args?.query, args?.brief === true),
    }),
  );

  /* --- 常驻提示：怎么用梗（设置页开关即时生效） --- */
  const prompt = ctx.systemPrompt;
  let guideOff = null;

  function syncGuide() {
    if (!prompt?.section) return;
    if (settings.guide && !guideOff) {
      guideOff = prompt.section({
        name: 'memewiki:guide',
        order: 10525,
        interpolate: false,
        text: () => settings.guidance || GUIDANCE,
      });
    } else if (!settings.guide && guideOff) {
      try {
        guideOff();
      } catch {}
      guideOff = null;
    }
  }

  syncGuide();
  disposers.push(() => {
    if (guideOff) {
      try {
        guideOff();
      } catch {}
      guideOff = null;
    }
  });

  /* --- per-agent：自动预查注入 --- */
  function lastUserText(agent) {
    let events = [];
    try {
      events = agent?.session?.snapshotEvents?.() ?? [];
    } catch {
      return '';
    }
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event?.type !== 'user/message') continue;
      if (event.data?.source?.kind && event.data.source.kind !== 'user') continue;
      const content = Array.isArray(event.data?.content) ? event.data.content : [];
      const text = content
        .filter((part) => part?.type === 'text')
        .map((part) => String(part.text ?? ''))
        .join('\n')
        .trim();
      return text;
    }
    return '';
  }

  function preloadText(agent) {
    if (!settings.preload) return '';
    const text = lastUserText(agent);
    if (!text) return '';
    const key = createHash('sha1').update(`${settings.maxQueryChars}|${text}`).digest('hex');
    const cached = preloadCache.get(key);
    if (cached && Date.now() - cached.at < 90_000) return cached.text;
    let out = '';
    try {
      // 普通疑问句（「晚上吃什么好呢」）不当成词去查，只放行在句子里用梗的说法
      const query = worthSearch(text, settings.maxQueryChars, { inSentence: true })
        ? extractQuery(text, settings.maxQueryChars)
        : '';
      if (query) {
        const normalized = normalizeQuery(query);
        const entry = lookupLocal(normalized);
        if (entry) {
          out = dictHint(normalized, entryText(entry, true));
          stats.preloads += 1;
        }
      }
    } catch {}
    if (preloadCache.size > 64) preloadCache.clear();
    preloadCache.set(key, { at: Date.now(), text: out });
    return out;
  }

  function attach(agent) {
    if (!agent?.ctx) return;
    const scope = agent.ctx;
    const own = [];
    const scoped = scope.systemPrompt ?? scope.get?.('systemPrompt');
    if (scoped?.context) {
      own.push(
        scoped.context({
          name: 'memewiki:preload',
          order: 925,
          interpolate: false,
          text: () => preloadText(agent),
        }),
      );
    }
    if (own.length) {
      scope.effect(() => () => {
        for (const off of own) {
          try {
            off();
          } catch {}
        }
      });
    }
  }

  if (typeof ctx.on === 'function') {
    disposers.push(
      ctx.on('agent/created', ({ agent }) => {
        try {
          attach(agent);
        } catch {}
        return undefined;
      }),
    );
  }

  /* --- 设置页 HTTP --- */
  if (ctx.webServer?.register) {
    const originOk = (req) => {
      const origin = req.headers?.origin;
      if (!origin) return true;
      try {
        return new URL(origin).host === req.headers?.host;
      } catch {
        return false;
      }
    };

    const guard = (req) => {
      if (req.headers?.['x-memewiki'] !== '1') throw new Error('请求缺少设置页标记');
      if (!originOk(req)) throw new Error('拒绝跨站修改');
    };

    const sendJSON = (res, status, body) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(body));
    };

    const readBody = async (req) => {
      guard(req);
      const type = String(req.headers?.['content-type'] ?? '');
      if (!type.includes('application/json')) throw new Error('请求需要 JSON');
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65_536) throw new Error('请求体太大');
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体必须是对象');
      return parsed;
    };

    const snapshot = (query) => {
      const conn = connection();
      const entry = query ? lookupLocal(query) : null;
      return {
        ok: true,
        settings: publicSettings(),
        db: dbInfo(conn),
        terms: termList(),
        stats: { ...stats },
        sample: entry ? { title: entry.title, source: entry.source, text: entryText(entry, false) } : null,
        settingsFile: SETTINGS_FILE,
      };
    };

    const route = (suffix, method, handler) =>
      ctx.webServer.register({
        kind: 'exact',
        path: `/dsh-memewiki/${suffix}`,
        handler: async (req, res) => {
          if ((req.method ?? 'GET').toUpperCase() !== method) {
            return sendJSON(res, 405, { ok: false, error: '方法不允许' });
          }
          try {
            const input = method === 'POST' ? await readBody(req) : {};
            const result = await handler(input, req);
            sendJSON(res, 200, { ok: true, ...(result ?? {}) });
          } catch (error) {
            sendJSON(res, 400, { ok: false, error: String(error?.message ?? error).slice(0, 300) });
          }
        },
      });

    disposers.push(
      route('state', 'GET', (input) => snapshot(String(input.query ?? ''))),
      route('settings', 'POST', (input) => ({ settings: saveSettings(input.settings ?? {}) })),
      route('lookup', 'POST', async (input) => ({ result: await lookup(input.query) })),
      route('term', 'POST', (input) => {
        const action = String(input.action ?? 'save');
        if (action === 'delete') return { removed: deleteTerm(input), terms: termList() };
        return { saved: saveTerm(input), terms: termList() };
      }),
    );
  }

  ctx.effect(() => () => {
    for (const off of disposers) {
      try {
        off?.();
      } catch {}
    }
    try {
      db?.close();
    } catch {}
    db = null;
  });
}
