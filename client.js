window.__ModuleLoader__.load({
  id: '@local/opencode-usage-ring',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const API = '/opencode-usage-ring/data';
    const REFRESH_MS = 60 * 1000;
    const SIZE = 32;
    const CENTER = SIZE / 2;
    const CARD_WIDTH = 264;

    const STRINGS = {
      ringLabel: 'opencode usage',
      title: 'opencode usage',
      source: 'Usage source: opencode Go plan',
      rolling: '5-hour limit',
      weekly: 'Weekly limit',
      monthly: 'Monthly limit',
      left: '{value}% left',
      resetsIn: 'resets in {value}',
      resetsOn: 'resets {value}',
      resetsNow: 'resets now',
      updated: 'Updated {time}',
      stale: 'Last reading {time}',
      loading: 'Reading opencode plan usage...',
      failed: 'Could not read the opencode plan usage.',
      retry: 'Try again',
    };

    let translate = (key) => STRINGS[key] || key;

    function t(key) {
      try {
        const value = translate(key);
        return typeof value === 'string' ? value : STRINGS[key] || key;
      } catch {
        return STRINGS[key] || key;
      }
    }

    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (whole, name) =>
        Object.prototype.hasOwnProperty.call(values || {}, name) ? String(values[name]) : whole,
      );
    }

    /* ------------------------------------------------------------ formatting */

    function usedOf(window) {
      const value = Number(window && window.percent);
      return Number.isFinite(value) ? Math.max(0, Math.min(999, value)) : 0;
    }

    /** The ring and the numbers both speak "left": a full circle is a full allowance. */
    function leftOf(window) {
      return Math.max(0, Math.min(100, 100 - usedOf(window)));
    }

    function leftText(window) {
      return fill(t('left'), { value: Math.round(leftOf(window)) });
    }

    function isLimited(window) {
      if (!window) return false;
      return usedOf(window) >= 100 || String(window.status || '').toLowerCase() !== 'ok';
    }

    /**
     * One colour per window, so the three rings can be told apart at a glance:
     * 5-hour is blue, weekly is teal, monthly is violet. Red is kept for one
     * meaning only - 20% or less left - and amber is not used at all.
     * The track keeps the theme border token.
     */
    const TONES = {
      rolling: '#4f8cff',
      weekly: '#e3b341',
      monthly: '#a78bfa',
    };
    const TONE_LOW = '#e5484d';
    const LOW_LEFT_PERCENT = 20;

    function isLow(window) {
      return isLimited(window) || leftOf(window) <= LOW_LEFT_PERCENT;
    }

    function toneOf(name, window) {
      if (isLow(window)) return TONE_LOW;
      return TONES[name] || TONES.rolling;
    }

    function clockTime(iso) {
      const date = iso ? new Date(iso) : null;
      if (!date || Number.isNaN(date.getTime())) return '';
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    function resetLabel(iso) {
      const date = iso ? new Date(iso) : null;
      if (!date || Number.isNaN(date.getTime())) return '';
      const remaining = date.getTime() - Date.now();
      if (remaining <= 60 * 1000) return t('resetsNow');
      const minutes = Math.round(remaining / 60000);
      if (minutes < 60) return fill(t('resetsIn'), { value: `${minutes} min` });
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      if (hours < 24) return fill(t('resetsIn'), { value: rest > 0 ? `${hours} h ${rest} min` : `${hours} h` });
      return fill(t('resetsOn'), { value: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
    }

    /* ---------------------------------------------------------------- drawing */

    /** One allowance ring: full track, arc for what is left, empty when spent. */
    function arc(spec) {
      const circumference = 2 * Math.PI * spec.radius;
      const ratio = Math.max(0, Math.min(1, Number(spec.ratio) || 0));
      return h(
        'g',
        { key: spec.key },
        h('circle', {
          cx: CENTER,
          cy: CENTER,
          r: spec.radius,
          fill: 'none',
          stroke: 'var(--dsw-alias-border-l1)',
          strokeWidth: spec.width,
          opacity: 0.85,
        }),
        ratio > 0
          ? h('circle', {
              cx: CENTER,
              cy: CENTER,
              r: spec.radius,
              fill: 'none',
              stroke: spec.color,
              strokeWidth: spec.width,
              strokeLinecap: 'round',
              strokeDasharray: `${circumference * ratio} ${circumference}`,
              transform: `rotate(-90 ${CENTER} ${CENTER})`,
            })
          : null,
      );
    }

    function RingGlyph(props) {
      const windows = (props.data && props.data.windows) || null;
      const parts = [];

      if (windows) {
        // Outer is the longest window, inner the shortest: month, week, 5 hours.
        const rings = [
          { key: 'monthly', window: windows.monthly, radius: 14.2, width: 2.4 },
          { key: 'weekly', window: windows.weekly, radius: 10.8, width: 2.2 },
          { key: 'rolling', window: windows.rolling, radius: 7.4, width: 2 },
        ];
        for (const ring of rings) {
          if (!ring.window) continue;
          parts.push(
            arc({
              key: ring.key,
              radius: ring.radius,
              width: ring.width,
              ratio: leftOf(ring.window) / 100,
              color: toneOf(ring.key, ring.window),
            }),
          );
        }
      } else {
        parts.push(
          h('circle', {
            key: 'idle',
            cx: CENTER,
            cy: CENTER,
            r: 12,
            fill: 'none',
            stroke: '#6b7280',
            strokeWidth: 2,
            strokeDasharray: '2 3.4',
          }),
        );
      }

      if (props.loading) {
        parts.push(
          h('circle', {
            key: 'spin',
            cx: CENTER,
            cy: CENTER,
            r: 5,
            fill: 'none',
            stroke: 'var(--dsw-alias-label-secondary)',
            strokeWidth: 1.6,
            strokeDasharray: '5 26',
            opacity: 0.7,
          }),
        );
      }

      return h(
        'svg',
        {
          width: SIZE,
          height: SIZE,
          viewBox: `0 0 ${SIZE} ${SIZE}`,
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block', overflow: 'visible' },
        },
        parts,
      );
    }

    /* ------------------------------------------------------------------ card */

    function LimitRow(props) {
      const window = props.window || null;
      const reset = resetLabel(window && window.resetsAt);
      const low = isLow(window);
      const color = toneOf(props.name, window);
      const status = window && window.status && window.status !== 'ok' ? String(window.status) : '';
      return h(
        'div',
        { className: 'ocur-row' },
        h(
          'div',
          { className: 'ocur-row-main' },
          h(
            'div',
            { className: 'ocur-row-top' },
            h(
              'span',
              { className: 'ocur-label-row' },
              h('span', { className: 'ocur-dot', style: { backgroundColor: color } }),
              h('span', { className: 'ocur-label' }, props.label),
            ),
            h(
              'span',
              { className: 'ocur-value', style: low ? { color: TONE_LOW } : undefined },
              leftText(window),
            ),
          ),
          h(
            'div',
            { className: 'ocur-row-bottom' },
            reset ? h('span', null, reset) : null,
            reset && status ? h('span', { className: 'ocur-sep' }, ' | ') : null,
            status ? h('span', null, status) : null,
          ),
        ),
      );
    }

    function Card(props) {
      const data = props.data;
      const windows = (data && data.windows) || null;
      const stale = Boolean(data && !data.available && windows);
      const failed = Boolean(data && !data.available && !windows);

      return h(
        'div',
        {
          ref: props.cardRef,
          className: 'ocur-card',
          role: 'dialog',
          'aria-label': t('title'),
          style: props.position,
        },
        h(
          'div',
          { className: 'ocur-head' },
          h('span', { className: 'ocur-title' }, t('title')),
          data && data.updatedAt && !stale
            ? h('span', { className: 'ocur-updated' }, fill(t('updated'), { time: clockTime(data.updatedAt) }))
            : null,
        ),
        h('div', { className: 'ocur-source' }, t('source')),
        windows
          ? h(
              'div',
              { className: stale ? 'ocur-rows ocur-rows-stale' : 'ocur-rows' },
              h(LimitRow, { name: 'rolling', label: t('rolling'), window: windows.rolling }),
              h(LimitRow, { name: 'weekly', label: t('weekly'), window: windows.weekly }),
              h(LimitRow, { name: 'monthly', label: t('monthly'), window: windows.monthly }),
            )
          : h(
              'div',
              { className: 'ocur-empty' },
              h('p', { className: 'ocur-empty-text' }, failed ? data.error || t('failed') : t('loading')),
            ),
        stale
          ? h(
              'p',
              { className: 'ocur-note' },
              fill(t('stale'), { time: clockTime(data.updatedAt) }),
              data.error ? ` - ${data.error}` : null,
            )
          : null,
        failed ? h('button', { type: 'button', className: 'ocur-retry', onClick: props.onReload }, t('retry')) : null,
        h('style', null, CSS),
      );
    }

    /* ------------------------------------------------------------------ ring */

    function UsageRing() {
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [open, setOpen] = useState(false);
      const [position, setPosition] = useState({});
      const buttonRef = useRef(null);
      const cardRef = useRef(null);
      const aliveRef = useRef(true);

      const load = useCallback(async () => {
        try {
          const response = await fetch(API, { method: 'GET', headers: { accept: 'application/json' } });
          const payload = await response.json().catch(() => null);
          if (!aliveRef.current) return;
          if (payload && typeof payload === 'object') {
            setData(payload);
          } else {
            setData((current) => current || { available: false, error: t('failed'), windows: null });
          }
        } catch (error) {
          if (aliveRef.current) {
            setData((current) => current || { available: false, error: String(error && error.message ? error.message : error), windows: null });
          }
          console.warn('[opencode-usage-ring] could not read plan usage', error);
        } finally {
          if (aliveRef.current) setLoading(false);
        }
      }, []);

      useEffect(() => {
        aliveRef.current = true;
        load();
        const timer = setInterval(load, REFRESH_MS);
        const onFocus = () => load();
        const onVisible = () => {
          if (document.visibilityState === 'visible') load();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
          aliveRef.current = false;
          clearInterval(timer);
          window.removeEventListener('focus', onFocus);
          document.removeEventListener('visibilitychange', onVisible);
        };
      }, [load]);

      const place = useCallback(() => {
        const node = buttonRef.current;
        if (!node) return;
        const rect = node.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 8));
        const bottom = Math.max(8, window.innerHeight - rect.top + 8);
        setPosition({ position: 'fixed', left: `${left}px`, bottom: `${bottom}px`, top: 'auto', right: 'auto' });
      }, []);

      useEffect(() => {
        if (!open) return;
        place();
        const close = (event) => {
          if (cardRef.current && cardRef.current.contains(event.target)) return;
          if (buttonRef.current && buttonRef.current.contains(event.target)) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', close, true);
        window.addEventListener('resize', place);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('pointerdown', close, true);
          window.removeEventListener('resize', place);
          document.removeEventListener('keydown', onKey);
        };
      }, [open, place]);

      const windows = (data && data.windows) || null;
      const label = windows
        ? [
            t('ringLabel'),
            windows.rolling ? `${t('rolling')} ${leftText(windows.rolling)}` : '',
            windows.weekly ? `${t('weekly')} ${leftText(windows.weekly)}` : '',
            windows.monthly ? `${t('monthly')} ${leftText(windows.monthly)}` : '',
          ]
            .filter(Boolean)
            .join(', ')
        : t('ringLabel');

      return h(
        'span',
        { className: 'ocur-wrap' },
        h('style', null, CSS),
        h(
          'button',
          {
            ref: buttonRef,
            type: 'button',
            className: 'ocur-btn',
            'aria-label': label,
            'aria-haspopup': 'dialog',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => {
              place();
              setOpen((current) => !current);
            },
          },
          h(RingGlyph, { data, loading }),
        ),
        open
          ? h(Card, {
              data,
              position,
              cardRef,
              onReload: load,
            })
          : null,
      );
    }

    /* ---------------------------------------------------------------- styles */

    const CSS = `
.ocur-wrap{display:inline-flex;align-items:center;justify-content:center;}
.ocur-btn{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:999px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary);transition:background-color .12s ease;}
.ocur-btn:hover{background:var(--dsw-alias-bg-layer-2);}
.ocur-btn:focus-visible{outline:2px solid #4f8cff;outline-offset:1px;}
.ocur-card{inset:auto;margin:0;width:264px;padding:10px 12px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 16px 40px rgba(0,0,0,.5);font:inherit;font-size:12.5px;line-height:1.4;z-index:2147483000;}
.ocur-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
.ocur-title{font-size:12px;font-weight:600;letter-spacing:.01em;}
.ocur-updated{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;}
.ocur-source{margin:2px 0 8px;padding-bottom:8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary);}
.ocur-rows{display:flex;flex-direction:column;}
.ocur-rows-stale{opacity:.6;}
.ocur-row{padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1);}
.ocur-row:last-child{border-bottom:0;padding-bottom:0;}
.ocur-row-main{min-width:0;}
.ocur-row-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}
.ocur-label-row{display:inline-flex;align-items:center;gap:6px;min-width:0;}
.ocur-dot{width:6px;height:6px;border-radius:999px;flex:none;}
.ocur-label{color:var(--dsw-alias-label-secondary);}
.ocur-value{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;}
.ocur-row-bottom{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;}
.ocur-sep{opacity:.6;}
.ocur-empty{padding:2px 0 8px;}
.ocur-empty-text{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);}
.ocur-note{margin:8px 0 0;font-size:11px;line-height:1.45;color:#f2a33c;}
.ocur-retry{font:inherit;font-size:12px;padding:5px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;}
.ocur-retry:hover{background:var(--dsw-alias-bg-layer-2);}
`;

    /* ----------------------------------------------------------------- apply */

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined;
        if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
          try {
            ctx.effect(() => locale.register('opencodeUsageRing', 'en', STRINGS));
            translate = locale.bind('opencodeUsageRing');
          } catch (error) {
            console.warn('[opencode-usage-ring] locale registration failed', error);
          }
        }

        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'opencode-usage', order: 10, label: 'opencode usage' },
            UsageRing,
          ),
        );
      },
    };
  },
});
