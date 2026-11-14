/**
 * The plugin page's configuration form for Rich presence.
 *
 * Registered into the official `plugins.bundle.config` slot, which the Plugins
 * page renders on the bundle's own page between its description and its rows.
 * The page supplies no form object for that slot, so this module reads the
 * entry's live values through `ctx.configForms` and writes through the same
 * revisioned queue the official pages use.
 *
 * Values are only written on Save. Leaving the page drops the draft, which is
 * the page owner's rule, so nothing here writes on unmount.
 */
window.__ModuleLoader__.load({
  id: '@dsh-plugin/dsh-rich-presence',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Placeholder keys the renderer understands, offered as hints in the form. */
    const PLACEHOLDERS = [
      '{activity}', '{model}', '{provider}', '{effort}', '{context}', '{tokens}',
      '{folder}', '{progress}', '{turn}', '{step}', '{subagents}',
    ];

    /** Phase-label keys the renderer understands. */
    const LABEL_KEYS = ['approval', 'compacting', 'tool', 'toolHidden', 'thinking', 'working', 'queued', 'idle'];

    const TEXT = {
      en: {
        title: 'Configuration',
        summaryConnected: 'Publishing to Discord',
        summaryLog: 'Writing payloads to the log',
        summaryNoId: 'No application id yet',
        unavailable: 'This profile does not expose editable configuration, so these values can be changed only in the profile patch.',
        readOnly: 'This configuration is read-only: the profile does not accept writes, or a higher layer overrides it.',
        readOnlyBadge: 'Read-only',
        loading: 'Loading configuration…',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        discard: 'Discard changes',
        unsaved: 'Unsaved changes',
        saveFailed: 'The Host refused the change. Check for a higher-priority layer that overrides it.',
        resetOne: 'Reset to the inherited value',
        groupDiscord: 'Discord',
        groupPresence: 'Display',
        groupPrivacy: 'Privacy',
        groupFocus: 'Focus',
        groupConnection: 'Connection',
        groupUpdate: 'Rate limits',
        clientId: 'Application ID',
        clientIdHint: 'From discord.com/developers/applications. Leave empty to write payloads to the log instead of publishing.',
        activityType: 'Activity type',
        type0: 'Playing', type2: 'Listening', type3: 'Watching', type5: 'Competing',
        buttons: 'Buttons',
        buttonsHint: 'One per line as "label | https://…". Discord shows at most two.',
        details: 'First line',
        state: 'Second line',
        largeText: 'Large image tooltip',
        smallText: 'Small image tooltip',
        largeImage: 'Large image asset',
        largeImageHint: 'Must match an asset uploaded to your Discord application. Leave empty to use the application icon.',
        smallImageRunning: 'Small image while working',
        smallImageIdle: 'Small image while idle',
        labels: 'Phase wording',
        labelsHint: 'One per line as "key: text". Keys: ' + LABEL_KEYS.join(', ') + '. Use {tool} inside "tool".',
        elapsed: 'Elapsed timer',
        elapsedTurn: 'This turn', elapsedSession: 'Whole session', elapsedOff: 'Off',
        truncateAt: 'Maximum characters per field',
        showWhenIdle: 'Show a card when no agent is running',
        showToolNames: 'Publish the running tool name',
        showFolder: 'Publish the working folder name',
        privacyHint: 'Both are published on your Discord profile while the agent works.',
        mode: 'Which session to show',
        modeActive: 'The running one', modeLatest: 'The most recently active one',
        includeSubagents: 'Allow a delegated session to be shown',
        transport: 'Transport',
        transportAuto: 'Automatic', transportIpc: 'Discord only', transportLog: 'Log only',
        reconnectMs: 'Reconnect delay (ms)',
        maxReconnectMs: 'Maximum reconnect delay (ms)',
        extraPipePaths: 'Extra IPC endpoints',
        extraPipePathsHint: 'One per line, tried before the platform defaults.',
        debounceMs: 'Quiet time before an update (ms)',
        minIntervalMs: 'Minimum time between updates (ms)',
        invalidNumber: 'Enter a number between {min} and {max}.',
        invalidUrl: 'Each button needs "label | https://…".',
        invalidLabel: 'Each line needs "key: text" with a plain-word key.',
        placeholders: 'Placeholders: ' + PLACEHOLDERS.join(' '),
      },
      zh: {
        title: '配置',
        summaryConnected: '正在推送到 Discord',
        summaryLog: '正在把载荷写入日志',
        summaryNoId: '尚未设置应用 ID',
        unavailable: '此 profile 没有开放可编辑配置，只能在 profile patch 里改这些值。',
        readOnly: '当前配置只读：profile 不接受写入，或者被更高优先级的层覆盖。',
        readOnlyBadge: '只读',
        loading: '正在读取配置…',
        save: '保存',
        saving: '正在保存…',
        saved: '已保存',
        discard: '放弃修改',
        unsaved: '有未保存的修改',
        saveFailed: 'Host 拒绝了这次修改，请检查是否有更高优先级的层覆盖。',
        resetOne: '恢复为继承值',
        groupDiscord: 'Discord',
        groupPresence: '显示',
        groupPrivacy: '隐私',
        groupFocus: '聚焦',
        groupConnection: '连接',
        groupUpdate: '限流',
        clientId: '应用 ID',
        clientIdHint: '在 discord.com/developers/applications 获取。留空则不推送，只把载荷写进日志。',
        activityType: '活动类型',
        type0: '在玩', type2: '在听', type3: '在看', type5: '在比赛',
        buttons: '按钮',
        buttonsHint: '每行一个，格式 "标签 | https://…"。Discord 最多显示两个。',
        details: '第一行',
        state: '第二行',
        largeText: '大图悬停文字',
        smallText: '小图悬停文字',
        largeImage: '大图资产名',
        largeImageHint: '必须和你 Discord 应用里上传的资产同名。留空则使用应用图标。',
        smallImageRunning: '运行中的小图',
        smallImageIdle: '空闲时的小图',
        labels: '状态措辞',
        labelsHint: '每行一个，格式 "键: 文本"。可用键：' + LABEL_KEYS.join(', ') + '。"tool" 里可用 {tool}。',
        elapsed: '计时起点',
        elapsedTurn: '本轮对话', elapsedSession: '整个会话', elapsedOff: '关闭',
        truncateAt: '每个字段最大字符数',
        showWhenIdle: '没有 agent 运行时也显示卡片',
        showToolNames: '公开正在运行的工具名',
        showFolder: '公开工作目录名',
        privacyHint: 'agent 工作时这两项会显示在你的 Discord 个人资料上。',
        mode: '显示哪个会话',
        modeActive: '正在运行的那个', modeLatest: '最近活跃的那个',
        includeSubagents: '允许显示子会话',
        transport: '传输方式',
        transportAuto: '自动', transportIpc: '只走 Discord', transportLog: '只写日志',
        reconnectMs: '重连间隔（毫秒）',
        maxReconnectMs: '最大重连间隔（毫秒）',
        extraPipePaths: '额外的 IPC 端点',
        extraPipePathsHint: '每行一个，会先于平台默认值尝试。',
        debounceMs: '更新前的静默时间（毫秒）',
        minIntervalMs: '两次更新的最小间隔（毫秒）',
        invalidNumber: '请输入 {min} 到 {max} 之间的数字。',
        invalidUrl: '每个按钮都需要 "标签 | https://…"。',
        invalidLabel: '每行都需要 "键: 文本"，键必须是普通单词。',
        placeholders: '可用占位符：' + PLACEHOLDERS.join(' '),
      },
    };

    /**
     * Styling copied from the settings primitives the official configuration
     * pages use: same field metrics, same separators, same control styles, and
     * only theme tokens whose names this build actually defines. An unknown
     * token name resolves to nothing, which is what previously left the inputs
     * without a border and the text without a colour.
     */
    const CSS = [
      '.rp-form{display:flex;flex-direction:column}',
      '.rp-group{display:flex;flex-direction:column}',
      '.rp-group-title{margin:0;padding:18px 0 2px;font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.rp-group:first-child>.rp-group-title{padding-top:2px}',
      '.rp-group>*+*{border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.rp-group>.rp-group-title+*{border-top:0}',
      '.rp-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
      '.rp-row{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}',
      '.rp-label{margin:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.rp-input,.rp-select{box-sizing:border-box;width:100%;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font-family:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.rp-area{box-sizing:border-box;width:100%;min-height:72px;padding:8px 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font-family:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);resize:vertical}',
      '.rp-input:focus-visible,.rp-select:focus-visible,.rp-area:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
      '.rp-input:disabled,.rp-select:disabled,.rp-area:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
      '.rp-input[aria-invalid=true],.rp-area[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}',
      '.rp-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.rp-error{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}',
      '.rp-group>.rp-switch{padding:12px 0}',
      '.rp-switch{display:flex;align-items:center;gap:8px}',
      '.rp-switch button{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}',
      '.rp-switch button[aria-checked=true]{background:var(--dsw-alias-brand-primary)}',
      '.rp-switch button:disabled{cursor:default;opacity:.5}',
      '.rp-switch button:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.rp-switch button span{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s}',
      '.rp-switch button[aria-checked=false] span{background:var(--dsw-alias-switch-thumb)}',
      '.rp-switch button[aria-checked=true] span{transform:translateX(16px)}',
      '.rp-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 0 4px;border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.rp-btn{appearance:none;border:1px solid transparent;border-radius:var(--dsw-radius-md);padding:5px 14px;background:none;font-family:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.rp-btn[data-primary=true]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.rp-btn:disabled{cursor:default;opacity:.5}',
      '.rp-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '@media (hover:hover){.rp-btn[data-primary=true]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.rp-btn:not([data-primary=true]):hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}}',
      '.rp-status{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.rp-status[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.rp-status[data-tone=ok]{color:var(--dsw-alias-brand-primary)}',
      '.rp-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:4px}',
      '.rp-title{font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.rp-badge{padding:1px 8px;border-radius:999px;background:var(--dsw-alias-fill-l2);font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '@media (max-width:520px){.rp-row{grid-template-columns:1fr}}',
    ].join('');

    /** Read a nested value without trusting its shape. */
    function at(value, path) {
      let current = value;
      for (const key of path) {
        if (current === null || typeof current !== 'object') return undefined;
        current = current[key];
      }
      return current;
    }

    /** Render one line per entry of a list value. */
    function linesOf(value) {
      return Array.isArray(value) ? value.filter(item => typeof item === 'string').join('\n') : '';
    }

    /** Render buttons as the text area format. */
    function buttonsOf(value) {
      return Array.isArray(value)
        ? value
            .filter(item => item && typeof item.label === 'string' && typeof item.url === 'string')
            .map(item => `${item.label} | ${item.url}`)
            .join('\n')
        : '';
    }

    /** Render label overrides as the text area format, sorted for stability. */
    function labelsOf(value) {
      if (!value || typeof value !== 'object') return '';
      return Object.keys(value).sort().map(key => `${key}: ${value[key]}`).join('\n');
    }

    /** Parse buttons back, reporting the first problem. */
    function parseButtons(text) {
      const entries = [];
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const cut = line.indexOf('|');
        if (cut < 0) return { error: true };
        const label = line.slice(0, cut).trim();
        const url = line.slice(cut + 1).trim();
        if (!label || !/^https?:\/\//.test(url)) return { error: true };
        entries.push({ label, url });
      }
      return { entries };
    }

    /** Parse label overrides back, reporting the first problem. */
    function parseLabels(text) {
      const records = {};
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const cut = line.indexOf(':');
        if (cut <= 0) return { error: true };
        const key = line.slice(0, cut).trim();
        if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) return { error: true };
        records[key] = line.slice(cut + 1).trim();
      }
      return { records };
    }

    /** Render the injected stylesheet once per mounted form. */
    function useStyles() {
      React.useEffect(() => {
        const tag = document.createElement('style');
        tag.setAttribute('data-plugin', '@dsh-plugin/dsh-rich-presence');
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => { tag.remove(); };
      }, []);
    }

    /** A labelled text/textarea/select control. */
    function Field(props) {
      const { label, hint, error, htmlFor, children } = props;
      return h('div', { className: 'rp-field' },
        label === undefined ? null : h('label', { className: 'rp-label', htmlFor }, label),
        children,
        error ? h('p', { className: 'rp-error', role: 'alert' }, error) : null,
        hint ? h('p', { className: 'rp-hint' }, hint) : null);
    }

    /** A switch matching the host's toggle markup and keyboard behaviour. */
    function Toggle(props) {
      const { checked, disabled, onChange, label } = props;
      return h('div', { className: 'rp-switch' },
        h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          disabled,
          onClick: () => onChange(!checked),
        }, h('span', null)),
        h('span', { className: 'rp-label' }, label));
    }

    /** Parse an integer field, keeping the raw text while it is being typed. */
    function NumberField(props) {
      const { id, label, hint, value, min, max, disabled, onChange, t } = props;
      const [text, setText] = React.useState(String(value));
      React.useEffect(() => { setText(String(value)); }, [value]);
      const parsed = Number(text);
      const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max;
      return h(Field, {
        label, htmlFor: id, hint,
        error: valid ? undefined : t('invalidNumber', { min, max }),
      }, h('input', {
        id, className: 'rp-input', type: 'number', inputMode: 'numeric',
        min, max, value: text, disabled,
        'aria-invalid': valid ? 'false' : 'true',
        onChange: event => {
          setText(event.target.value);
          const next = Number(event.target.value);
          if (Number.isFinite(next) && next >= min && next <= max) onChange(next);
        },
      }));
    }

    /**
     * A text area holding a parsed list value.
     *
     * The committed value is a list, but the person types text, so the raw text
     * is held here while it is being edited: an intermediate line such as a
     * label with no URL yet must stay visible without committing an invalid
     * value. Only a parseable text replaces the draft.
     */
    function ParsedArea(props) {
      const { id, label, hint, disabled, serialize, parse, onChange, value, t, errorText } = props;
      const accepted = serialize(value);
      const [text, setText] = React.useState(accepted);
      const [touched, setTouched] = React.useState(false);
      // A save resets the draft, so the field follows the accepted value again.
      React.useEffect(() => { if (!touched) setText(accepted); }, [accepted, touched]);
      const result = parse(text);
      const invalid = result.error === true;
      return h(Field, {
        label, htmlFor: id, hint,
        error: invalid && touched ? errorText : undefined,
      }, h('textarea', {
        id, className: 'rp-area', spellCheck: false, disabled,
        'aria-invalid': invalid && touched ? 'true' : 'false',
        value: text,
        onChange: event => {
          const next = event.target.value;
          setText(next);
          setTouched(true);
          const parsed = parse(next);
          if (!parsed.error) onChange(parsed);
        },
      }));
    }

    /**
     * Follow one configuration form's snapshot.
     *
     * The form is a mutable controller, not a prop that re-renders: the page
     * re-renders this component only when the slot's own state moves. Subscribing
     * is what makes a save, a Host rejection, and an external patch edit all
     * reach the view.
     */
    function useFormSnapshot(form) {
      const [snapshot, setSnapshot] = React.useState(() => form.getSnapshot());
      React.useEffect(() => {
        setSnapshot(form.getSnapshot());
        return form.subscribe(() => setSnapshot(form.getSnapshot()));
      }, [form]);
      return snapshot;
    }

    /**
     * The configuration form for one bundle page.
     *
     * `plugins.bundle.config` is rendered with `{ view }` only — the page does
     * not supply a form the way it does for an official plugin page — so the
     * registrant resolves its own entry form and passes it down. A form supplied
     * by the owner still wins, so the same view can be reused in another slot.
     */
    function SettingsForm(props) {
      const { t, form } = props;
      // Hooks run before any early return, so the read is unconditional.
      const snapshot = useFormSnapshot(form);
      useStyles();
      const [draft, setDraft] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState(null);

      // A new accepted revision replaces the base; a draft the person is still
      // editing must not be thrown away by an unrelated refresh, so the draft
      // is only rebuilt when none exists.
      const value = snapshot.value;
      React.useEffect(() => {
        if (draft === null && value !== undefined) setDraft(value);
      }, [value, draft]);

      if (snapshot.status === 'loading') return h('p', { className: 'rp-status' }, t('loading'));
      if (snapshot.status === 'unavailable' || value === undefined) {
        return h('p', { className: 'rp-status', role: 'status' }, t('unavailable'));
      }
      const current = draft === null ? value : draft;
      const disabled = !snapshot.writable || busy;

      /** Update one leaf of the draft immutably. */
      const put = (group, key, next) => {
        setDraft(previous => {
          const base = previous === null ? value : previous;
          return { ...base, [group]: { ...(base[group] ?? {}), [key]: next } };
        });
        setNotice(null);
      };

      /** Collect the changed paths into one revisioned write. */
      const ops = () => {
        const changes = [];
        for (const group of ['discord', 'presence', 'privacy', 'focus', 'connection', 'update']) {
          const before = value[group] ?? {};
          const after = current[group] ?? {};
          for (const key of Object.keys(after)) {
            if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) {
              changes.push({ op: 'set', path: [group, key], value: after[key] });
            }
          }
        }
        return changes;
      };

      const dirty = () => JSON.stringify(current) !== JSON.stringify(value);

      const save = async () => {
        const changes = ops();
        if (changes.length === 0) { setNotice({ tone: 'ok', text: t('saved') }); return; }
        setBusy(true);
        setNotice(null);
        try {
          const accepted = await form.mutate(changes, snapshot.revision);
          if (accepted) {
            setDraft(null);
            setNotice({ tone: 'ok', text: t('saved') });
          } else {
            setNotice({ tone: 'error', text: t('saveFailed') });
          }
        } catch (error) {
          setNotice({ tone: 'error', text: String(error) });
        } finally {
          setBusy(false);
        }
      };

      const discard = () => { setDraft(null); setNotice(null); };

      const groups = [
        h('section', { className: 'rp-group', key: 'discord' },
          h('h4', { className: 'rp-group-title' }, t('groupDiscord')),
          h(Field, { label: t('clientId'), hint: t('clientIdHint'), htmlFor: 'rp-client-id' },
            h('input', {
              id: 'rp-client-id', className: 'rp-input', type: 'text', inputMode: 'numeric',
              spellCheck: false, autoComplete: 'off', disabled,
              value: at(current, ['discord', 'clientId']) ?? '',
              onChange: event => put('discord', 'clientId', event.target.value.trim()),
            })),
          h(Field, { label: t('activityType'), htmlFor: 'rp-activity-type' },
            h('select', {
              id: 'rp-activity-type', className: 'rp-select', disabled,
              value: String(at(current, ['discord', 'activityType']) ?? 0),
              onChange: event => put('discord', 'activityType', Number(event.target.value)),
            },
              [0, 2, 3, 5].map(type => h('option', { key: type, value: String(type) }, t('type' + type))))),
          h(ParsedArea, {
            t, id: 'rp-buttons', label: t('buttons'), hint: t('buttonsHint'), disabled,
            errorText: t('invalidUrl'),
            value: at(current, ['discord', 'buttons']) ?? [],
            serialize: buttonsOf, parse: parseButtons,
            onChange: parsed => put('discord', 'buttons', parsed.entries),
          })),

        h('section', { className: 'rp-group', key: 'presence' },
          h('h4', { className: 'rp-group-title' }, t('groupPresence')),
          h('div', { className: 'rp-row' },
            h(Field, { label: t('details'), htmlFor: 'rp-details' },
              h('input', {
                id: 'rp-details', className: 'rp-input', type: 'text', disabled,
                value: at(current, ['presence', 'details']) ?? '',
                onChange: event => put('presence', 'details', event.target.value),
              })),
            h(Field, { label: t('state'), htmlFor: 'rp-state' },
              h('input', {
                id: 'rp-state', className: 'rp-input', type: 'text', disabled,
                value: at(current, ['presence', 'state']) ?? '',
                onChange: event => put('presence', 'state', event.target.value),
              }))),
          h('p', { className: 'rp-hint' }, t('placeholders')),
          h('div', { className: 'rp-row' },
            h(Field, { label: t('largeText'), htmlFor: 'rp-large-text' },
              h('input', {
                id: 'rp-large-text', className: 'rp-input', type: 'text', disabled,
                value: at(current, ['presence', 'largeText']) ?? '',
                onChange: event => put('presence', 'largeText', event.target.value),
              })),
            h(Field, { label: t('smallText'), htmlFor: 'rp-small-text' },
              h('input', {
                id: 'rp-small-text', className: 'rp-input', type: 'text', disabled,
                value: at(current, ['presence', 'smallText']) ?? '',
                onChange: event => put('presence', 'smallText', event.target.value),
              }))),
          h('div', { className: 'rp-row' },
            h(Field, { label: t('largeImage'), hint: t('largeImageHint'), htmlFor: 'rp-large-image' },
              h('input', {
                id: 'rp-large-image', className: 'rp-input', type: 'text', spellCheck: false, disabled,
                value: at(current, ['presence', 'largeImage']) ?? '',
                onChange: event => put('presence', 'largeImage', event.target.value.trim()),
              })),
            h(Field, { label: t('smallImageRunning'), htmlFor: 'rp-small-running' },
              h('input', {
                id: 'rp-small-running', className: 'rp-input', type: 'text', spellCheck: false, disabled,
                value: at(current, ['presence', 'smallImageRunning']) ?? '',
                onChange: event => put('presence', 'smallImageRunning', event.target.value.trim()),
              }))),
          h(Field, { label: t('smallImageIdle'), htmlFor: 'rp-small-idle' },
            h('input', {
              id: 'rp-small-idle', className: 'rp-input', type: 'text', spellCheck: false, disabled,
              value: at(current, ['presence', 'smallImageIdle']) ?? '',
              onChange: event => put('presence', 'smallImageIdle', event.target.value.trim()),
            })),
          h(ParsedArea, {
            t, id: 'rp-labels', label: t('labels'), hint: t('labelsHint'), disabled,
            errorText: t('invalidLabel'),
            value: at(current, ['presence', 'labels']) ?? {},
            serialize: labelsOf, parse: parseLabels,
            onChange: parsed => put('presence', 'labels', parsed.records),
          }),
          h('div', { className: 'rp-row' },
            h(Field, { label: t('elapsed'), htmlFor: 'rp-elapsed' },
              h('select', {
                id: 'rp-elapsed', className: 'rp-select', disabled,
                value: at(current, ['presence', 'elapsed']) ?? 'turn',
                onChange: event => put('presence', 'elapsed', event.target.value),
              },
                h('option', { value: 'turn' }, t('elapsedTurn')),
                h('option', { value: 'session' }, t('elapsedSession')),
                h('option', { value: 'off' }, t('elapsedOff')))),
            h(NumberField, {
              t, id: 'rp-truncate', label: t('truncateAt'), min: 2, max: 128, disabled,
              value: at(current, ['presence', 'truncateAt']) ?? 128,
              onChange: next => put('presence', 'truncateAt', next),
            })),
          h(Toggle, {
            label: t('showWhenIdle'), disabled,
            checked: at(current, ['presence', 'showWhenIdle']) !== false,
            onChange: next => put('presence', 'showWhenIdle', next),
          })),

        h('section', { className: 'rp-group', key: 'privacy' },
          h('h4', { className: 'rp-group-title' }, t('groupPrivacy')),
          h(Toggle, {
            label: t('showToolNames'), disabled,
            checked: at(current, ['privacy', 'showToolNames']) !== false,
            onChange: next => put('privacy', 'showToolNames', next),
          }),
          h(Toggle, {
            label: t('showFolder'), disabled,
            checked: at(current, ['privacy', 'showFolder']) !== false,
            onChange: next => put('privacy', 'showFolder', next),
          }),
          h('p', { className: 'rp-hint' }, t('privacyHint'))),

        h('section', { className: 'rp-group', key: 'focus' },
          h('h4', { className: 'rp-group-title' }, t('groupFocus')),
          h('div', { className: 'rp-row' },
            h(Field, { label: t('mode'), htmlFor: 'rp-mode' },
              h('select', {
                id: 'rp-mode', className: 'rp-select', disabled,
                value: at(current, ['focus', 'mode']) ?? 'active',
                onChange: event => put('focus', 'mode', event.target.value),
              },
                h('option', { value: 'active' }, t('modeActive')),
                h('option', { value: 'latest' }, t('modeLatest')))),
            h('div', { className: 'rp-field' },
              h('span', { className: 'rp-label' }, t('includeSubagents')),
              h(Toggle, {
                label: t('includeSubagents'), disabled,
                checked: at(current, ['focus', 'includeSubagents']) === true,
                onChange: next => put('focus', 'includeSubagents', next),
              })))),

        h('section', { className: 'rp-group', key: 'connection' },
          h('h4', { className: 'rp-group-title' }, t('groupConnection')),
          h(Field, { label: t('transport'), htmlFor: 'rp-transport' },
            h('select', {
              id: 'rp-transport', className: 'rp-select', disabled,
              value: at(current, ['connection', 'transport']) ?? 'auto',
              onChange: event => put('connection', 'transport', event.target.value),
            },
              h('option', { value: 'auto' }, t('transportAuto')),
              h('option', { value: 'ipc' }, t('transportIpc')),
              h('option', { value: 'log' }, t('transportLog')))),
          h('div', { className: 'rp-row' },
            h(NumberField, {
              t, id: 'rp-reconnect', label: t('reconnectMs'), min: 100, max: 600000, disabled,
              value: at(current, ['connection', 'reconnectMs']) ?? 5000,
              onChange: next => put('connection', 'reconnectMs', next),
            }),
            h(NumberField, {
              t, id: 'rp-max-reconnect', label: t('maxReconnectMs'), min: 1000, max: 3600000, disabled,
              value: at(current, ['connection', 'maxReconnectMs']) ?? 60000,
              onChange: next => put('connection', 'maxReconnectMs', next),
            })),
          h(Field, { label: t('extraPipePaths'), hint: t('extraPipePathsHint'), htmlFor: 'rp-extra' },
            h('textarea', {
              id: 'rp-extra', className: 'rp-area', spellCheck: false, disabled,
              value: linesOf(at(current, ['connection', 'extraPipePaths'])),
              onChange: event => put(
                'connection',
                'extraPipePaths',
                event.target.value.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0),
              ),
            }))),

        h('section', { className: 'rp-group', key: 'update' },
          h('h4', { className: 'rp-group-title' }, t('groupUpdate')),
          h('div', { className: 'rp-row' },
            h(NumberField, {
              t, id: 'rp-debounce', label: t('debounceMs'), min: 0, max: 60000, disabled,
              value: at(current, ['update', 'debounceMs']) ?? 400,
              onChange: next => put('update', 'debounceMs', next),
            }),
            h(NumberField, {
              t, id: 'rp-interval', label: t('minIntervalMs'), min: 0, max: 600000, disabled,
              value: at(current, ['update', 'minIntervalMs']) ?? 15000,
              onChange: next => put('update', 'minIntervalMs', next),
            }))),
      ];

      const status = notice === null
        ? dirty() ? h('span', { className: 'rp-status' }, t('unsaved')) : null
        : h('span', { className: 'rp-status', 'data-tone': notice.tone, role: 'status' }, notice.text);

      return h('div', { className: 'rp-form', 'data-plugin': '@dsh-plugin/dsh-rich-presence' },
        h('div', { className: 'rp-head' },
          h('span', { className: 'rp-title' }, t('title')),
          snapshot.writable ? null : h('span', { className: 'rp-badge' }, t('readOnlyBadge'))),
        snapshot.writable ? null : h('p', { className: 'rp-hint', role: 'status' }, t('readOnly')),
        groups,
        h('div', { className: 'rp-actions' },
          h('button', {
            type: 'button', className: 'rp-btn', 'data-primary': 'true',
            disabled: disabled || !dirty(), onClick: save,
          }, busy ? t('saving') : t('save')),
          h('button', {
            type: 'button', className: 'rp-btn',
            disabled: disabled || !dirty(), onClick: discard,
          }, t('discard')),
          status));
    }

    /** The one-line summary the bundle card shows when no description names this page. */
    function summary(props) {
      const { t, form } = props;
      if (form === undefined) return t('summaryNoId');
      const snapshot = form.getSnapshot();
      const clientId = at(snapshot.value, ['discord', 'clientId']);
      const transport = at(snapshot.value, ['connection', 'transport']);
      if (typeof clientId !== 'string' || clientId.trim().length === 0) return t('summaryNoId');
      return transport === 'log' ? t('summaryLog') : t('summaryConnected');
    }

    /** The registered entry: the form on the page view, the one-liner on the summary view. */
    function RichPresenceConfig(props) {
      const form = props.form === undefined ? props.ownForm : props.form;
      if (form === undefined) {
        return props.view === 'summary'
          ? h('span', { className: 'rp-hint' }, props.t('unavailable'))
          : h('p', { className: 'rp-status', role: 'status' }, props.t('unavailable'));
      }
      return props.view === 'summary'
        ? summary({ t: props.t, form })
        : h(SettingsForm, { t: props.t, form });
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('richPresence', TEXT), 'rich-presence: form dictionaries');
        // The page renders this slot with `{ view }` only, so the entry's form is
        // resolved here; without it the component would read `undefined` and the
        // whole slot entry would fail to render. The service memoizes one form per
        // entry and owns its disposal, so this must not dispose it.
        const ownForm = ctx.configForms === undefined ? undefined : ctx.configForms.get('rich-presence');
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: '@dsh-plugin/dsh-rich-presence',
          locale: 'richPresence',
        }, props => h(RichPresenceConfig, { ...props, ownForm })));
      },
    };
  },
});
