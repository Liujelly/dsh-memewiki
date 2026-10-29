window.__ModuleLoader__.load({
  id: 'dsh-memewiki',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useState } = React;

    const api = async (path, body) => {
      const res = await fetch(`/dsh-memewiki/${path}`, body === undefined
        ? { cache: 'no-store' }
        : {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json', 'x-memewiki': '1' },
          body: JSON.stringify(body),
        });
      let data = null;
      try {
        data = await res.json();
      } catch {
        throw new Error(`请求 ${path} 失败（${res.status}）`);
      }
      if (!data || data.ok !== true) throw new Error(data?.error || `请求 ${path} 失败`);
      return data;
    };

    const colors = {
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l1)',
      borderStrong: 'var(--dsw-alias-border-l2)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      brand: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
    };

    const S = {
      page: { display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px 32px', color: colors.text, fontSize: 13 },
      hero: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
      title: { margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '0.01em' },
      sub: { margin: 0, color: colors.muted, fontSize: 12 },
      card: {
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        background: colors.layer1,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      },
      cardTitle: { fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: colors.muted },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
      rowMain: { display: 'flex', flexDirection: 'column', gap: 2 },
      rowName: { fontWeight: 500 },
      hint: { color: colors.muted, fontSize: 12, lineHeight: 1.5 },
      toggle: (on) => ({
        width: 36,
        height: 20,
        borderRadius: 10,
        border: `1px solid ${on ? colors.brand : colors.borderStrong}`,
        background: on ? colors.brand : colors.layer2,
        position: 'relative',
        cursor: 'pointer',
        flex: 'none',
        transition: 'background 120ms ease',
      }),
      knob: (on) => ({
        position: 'absolute',
        top: 2,
        left: on ? 18 : 2,
        width: 14,
        height: 14,
        borderRadius: 7,
        background: on ? '#fff' : colors.muted,
        transition: 'left 120ms ease',
      }),
      input: {
        flex: 1,
        minWidth: 0,
        padding: '7px 10px',
        borderRadius: 7,
        border: `1px solid ${colors.borderStrong}`,
        background: colors.layer2,
        color: colors.text,
        fontSize: 13,
        outline: 'none',
        font: 'inherit',
      },
      textarea: {
        width: '100%',
        minHeight: 96,
        padding: '8px 10px',
        borderRadius: 7,
        border: `1px solid ${colors.borderStrong}`,
        background: colors.layer2,
        color: colors.text,
        fontSize: 13,
        lineHeight: 1.55,
        fontFamily: 'inherit',
        resize: 'vertical',
        outline: 'none',
        boxSizing: 'border-box',
      },
      button: (primary) => ({
        padding: '7px 14px',
        borderRadius: 7,
        border: `1px solid ${primary ? colors.brand : colors.borderStrong}`,
        background: primary ? colors.brand : 'transparent',
        color: primary ? '#fff' : colors.text,
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
        flex: 'none',
      }),
      mono: (bad) => ({
        margin: 0,
        padding: '10px 12px',
        borderRadius: 8,
        border: `1px solid ${bad ? colors.error : colors.border}`,
        background: colors.layer2,
        color: bad ? colors.error : colors.text,
        fontSize: 12,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 260,
        overflow: 'auto',
        fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
      }),
      term: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 10,
        padding: '8px 0',
        borderTop: `1px solid ${colors.border}`,
      },
      termName: { fontWeight: 600, marginRight: 8 },
      danger: {
        border: 'none',
        background: 'transparent',
        color: colors.muted,
        cursor: 'pointer',
        fontSize: 12,
        padding: '2px 4px',
        flex: 'none',
      },
      dot: { color: colors.muted, margin: '0 6px' },
    };

    function Toggle({ on, onClick, label }) {
      return h('div', {
        role: 'switch',
        'aria-checked': !!on,
        'aria-label': label,
        tabIndex: 0,
        style: S.toggle(!!on),
        onClick,
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        },
      }, h('span', { style: S.knob(!!on) }));
    }

    function SettingsRow({ name, hint, on, onToggle, disabled }) {
      return h('div', { style: { ...S.row, opacity: disabled ? 0.55 : 1 } },
        h('div', { style: S.rowMain },
          h('span', { style: S.rowName }, name),
          hint ? h('span', { style: S.hint }, hint) : null),
        h(Toggle, { on, label: name, onClick: () => { if (!disabled) onToggle(); } }));
    }

    function Meta({ db, terms, stats }) {
      const bit = (text) => h('span', null, text);
      const sep = h('span', { style: S.dot }, '·');
      return h('p', { style: S.sub },
        db.available
          ? bit(`词库 ${db.count.toLocaleString('zh-CN')} 条`)
          : bit('词库未找到'),
        db.builtAt ? sep : null,
        db.builtAt ? bit(`快照 ${db.builtAt.slice(0, 10)}`) : null,
        sep,
        bit(`黑话 ${terms.length} 条`),
        sep,
        bit(`本次会话查词 ${stats.lookups} 次`));
    }

    function Panel() {
      const [state, setState] = useState(null);
      const [message, setMessage] = useState('');
      const [busy, setBusy] = useState(false);
      const [query, setQuery] = useState('');
      const [answer, setAnswer] = useState(null);
      const [draftName, setDraftName] = useState('');
      const [draftMeaning, setDraftMeaning] = useState('');
      /** null = 没改过，直接显示已保存的值；字符串 = 正在编辑 */
      const [draftGuidance, setDraftGuidance] = useState(null);

      const load = useCallback(async () => {
        try {
          const data = await api('state');
          setState(data);
          setMessage('');
        } catch (error) {
          setMessage(String(error?.message || error));
        }
      }, []);

      useEffect(() => { load(); }, [load]);

      const settings = state?.settings ?? {};
      const db = state?.db ?? { available: false, count: 0, builtAt: '' };
      const terms = state?.terms ?? [];
      const stats = state?.stats ?? { lookups: 0 };
      const guidanceValue = draftGuidance ?? settings.guidance ?? '';

      const act = useCallback(async (fn) => {
        setBusy(true);
        try {
          await fn();
        } catch (error) {
          setMessage(String(error?.message || error));
        } finally {
          setBusy(false);
        }
      }, []);

      const patch = useCallback((key, value) => act(async () => {
        const data = await api('settings', { settings: { [key]: value } });
        setState((prev) => (prev ? { ...prev, settings: data.settings } : prev));
        setMessage('');
      }), [act]);

      const saveGuidance = useCallback(() => act(async () => {
        const data = await api('settings', { settings: { guidance: guidanceValue } });
        setState((prev) => (prev ? { ...prev, settings: data.settings } : prev));
        setDraftGuidance(null);
        setMessage('');
      }), [act, guidanceValue]);

      const resetGuidance = useCallback(() => act(async () => {
        const data = await api('settings', { settings: { guidance: '' } });
        setState((prev) => (prev ? { ...prev, settings: data.settings } : prev));
        setDraftGuidance(null);
        setMessage('');
      }), [act]);

      const doLookup = useCallback(() => act(async () => {
        const word = query.trim();
        if (!word) return;
        const data = await api('lookup', { query: word });
        setAnswer(data.result);
        setMessage('');
      }), [act, query]);

      const addTerm = useCallback(() => act(async () => {
        const name = draftName.trim();
        const meaning = draftMeaning.trim();
        if (!name || !meaning) throw new Error('词条名和解释都要填');
        const data = await api('term', { name, meaning });
        setState((prev) => (prev ? { ...prev, terms: data.terms } : prev));
        setDraftName('');
        setDraftMeaning('');
        setMessage('');
      }), [act, draftName, draftMeaning]);

      const removeTerm = useCallback((name) => act(async () => {
        const data = await api('term', { action: 'delete', name });
        setState((prev) => (prev ? { ...prev, terms: data.terms } : prev));
        setMessage('');
      }), [act]);

      return h('div', { style: S.page },
        h('div', { style: S.hero },
          h('h2', { style: S.title }, '梗百科'),
          h('p', { style: S.sub }, '网络梗、缩写、黑话——本地词库，不用联网')),
        state ? h(Meta, { db, terms, stats }) : h('p', { style: S.sub }, '正在读取…'),

        h('section', { style: S.card },
          h('div', { style: S.cardTitle }, '行为'),
          h(SettingsRow, {
            name: '自动预查',
            hint: '聊天里出现词库收录的词时，先把词条递给模型，回复更接得上梗。',
            on: !!settings.preload,
            disabled: busy,
            onToggle: () => patch('preload', !settings.preload),
          }),
          h(SettingsRow, {
            name: '常驻用法提示',
            hint: '给模型一段「怎么用梗」的固定要求：先查、别科普、查不到就说不知道。',
            on: !!settings.guide,
            disabled: busy,
            onToggle: () => patch('guide', !settings.guide),
          }),
          h(SettingsRow, {
            name: '允许联网补查',
            hint: '本地没有时去 cnmeme.wiki 问一次，但只认同名词条：近似的一律不要，免得硬接不相干的梗。新梗先入库的情况才用得上。',
            on: !!settings.online,
            disabled: busy,
            onToggle: () => patch('online', !settings.online),
          }),
          h('div', { style: S.row },
            h('div', { style: S.rowMain },
              h('span', { style: S.rowName }, '预查词长上限'),
              h('span', { style: S.hint }, '一句话不超过这么多字才当作词去查（2–20）。')),
            h('input', {
              type: 'number',
              min: 2,
              max: 20,
              value: settings.maxQueryChars ?? 10,
              disabled: busy,
              style: { ...S.input, flex: 'none', width: 72, textAlign: 'center' },
              onChange: (e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 2 && n <= 20) patch('maxQueryChars', n);
              },
            })),
          h('div', { style: S.rowMain },
            h('span', { style: S.rowName }, '自定义用法提示'),
            h('span', { style: S.hint }, '整段替换常驻提示，留空用内置文案；改完点保存。'),
            h('textarea', {
              style: S.textarea,
              rows: 5,
              maxLength: 4000,
              spellCheck: false,
              placeholder: settings.guidanceText || '',
              value: guidanceValue,
              disabled: busy,
              onChange: (e) => setDraftGuidance(e.target.value),
            }),
            h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
              settings.guidance
                ? h('button', { type: 'button', style: S.button(false), disabled: busy, onClick: resetGuidance }, '恢复内置')
                : null,
              h('button', { type: 'button', style: S.button(true), disabled: busy, onClick: saveGuidance }, '保存提示')))),

        h('section', { style: S.card },
          h('div', { style: S.cardTitle }, '查词'),
          h('div', { style: S.row },
            h('input', {
              style: S.input,
              placeholder: '输入梗、缩写或黑话，比如 管人痴',
              value: query,
              disabled: busy,
              onChange: (e) => setQuery(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') doLookup(); },
            }),
            h('button', { type: 'button', style: S.button(true), disabled: busy, onClick: doLookup }, '查一下')),
          answer
            ? h('pre', { style: S.mono(!answer.found) }, answer.text)
            : h('span', { style: S.hint }, '查到什么会原样显示在这里，和模型拿到的是同一份。')),

        h('section', { style: S.card },
          h('div', { style: S.cardTitle }, `黑话 · ${terms.length}`),
          h('div', { style: S.row },
            h('input', {
              style: { ...S.input, flex: '0 0 30%' },
              placeholder: '词',
              value: draftName,
              disabled: busy,
              onChange: (e) => setDraftName(e.target.value),
            }),
            h('input', {
              style: S.input,
              placeholder: '它在你群里是什么意思',
              value: draftMeaning,
              disabled: busy,
              onChange: (e) => setDraftMeaning(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') addTerm(); },
            }),
            h('button', { type: 'button', style: S.button(false), disabled: busy, onClick: addTerm }, '加入')),
          terms.length
            ? h('div', null, terms.map((term) => h('div', { key: term.name, style: S.term },
              h('div', null,
                h('span', { style: S.termName }, term.name),
                h('span', { style: S.hint }, term.meaning),
                term.author ? h('span', { style: S.hint }, `　— ${term.author}`) : null),
              h('button', {
                type: 'button',
                style: S.danger,
                disabled: busy,
                onClick: () => removeTerm(term.name),
              }, '删除'))))
            : h('span', { style: S.hint }, '还没有自建黑话。查词时黑话优先于大词库。')),

        message ? h('p', { role: 'status', style: { ...S.hint, color: colors.error, margin: 0 } }, message) : null);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.slots ?? ctx.get?.('slots');
        if (!slots?.register) return;
        slots.inject('settings.section', () => slots.register({
          name: 'settings.section',
          id: 'memewiki',
          order: 44,
          label: '梗百科',
        }, () => h(Panel)));
      },
    };
  },
});
