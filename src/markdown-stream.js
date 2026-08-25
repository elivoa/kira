// MarkdownStream：块级增量 markdown 流式渲染模块（不依赖框架，挂 window.MarkdownStream）。
// 核心思路（参考 kimi-web 流式渲染性能实验）：追加式流式输出中只有最后一个
// 顶层块可能变化，已封口块渲染一次即冻结、DOM 不再触碰；每帧只重渲尾块，
// 单 token 成本从 O(全文) 降到 O(尾块)。
(function () {
  'use strict';

  const md = window.markdownit({
    html: false, // 聊天内容不放行原始 HTML
    linkify: true,
    breaks: true, // 单换行即换行，贴合聊天语气
  });

  // inline/block 公式分隔符；throwOnError:false —— 半截公式原样显示，流式不抛错
  const MATH_OPTIONS = {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
  };

  function renderInto(el, src) {
    el.innerHTML = md.render(src);
    // auto-render 默认跳过 pre/code/script 等标签，代码块里的 $ 不会被误渲染
    if (window.renderMathInElement) window.renderMathInElement(el, MATH_OPTIONS);
  }

  // 把 text 按空行切成顶层块（offset 为绝对值）；``` / ~~~ / $$ 围栏内不切割。
  // 最后一段永远视为「未封口」的开放尾块，由调用方决定是否冻结。
  function splitChunks(text, base) {
    const chunks = [];
    let fence = null; // '```' / '~~~' / '$$'
    let start = 0;
    let offset = 0;
    for (const line of text.split('\n')) {
      const t = line.trim();
      const m = t.match(/^(```|~~~)/);
      if (m && (!fence || fence === m[1])) {
        fence = fence ? null : m[1];
      } else if (!m && (!fence || fence === '$$') && t.startsWith('$$')) {
        // $$ 行：奇数个 $$ 切换数学块（同行 $$…$$ 闭合不算）
        if ((t.match(/\$\$/g) || []).length % 2 === 1) fence = fence ? null : '$$';
      }
      // 空行：仅在围栏外封口分块；围栏内的空行属于块内容
      if (t === '' && !fence) {
        if (start < offset) chunks.push({ start: base + start, end: base + offset });
        start = offset + 1; // 跳过空行
      }
      offset += line.length + 1;
    }
    if (start < text.length) chunks.push({ start: base + start, end: base + text.length });
    return chunks;
  }

  // 平滑吐字参数（算法移植自 kimiapi packages/x/stream/smoother.go；
  // MAX_DELAY 按桌宠场景调快到 90ms（kimiapi 默认 150ms），整体节奏约为其 1.7 倍
  const SMOOTH = {
    MIN_DELAY: 1,     // ms，延迟下限
    MAX_DELAY: 90,    // ms，延迟上限
    KP: 0.8,          // 比例增益
    KD: 0.4,          // 微分增益（Go 版 Ki=0，同为 PD 控制）
    TARGET_LEN: 40,   // 目标缓冲水位（字符数）
    FACTOR: 1.05,     // 乘性调速因子（加速/减速同值）
    COLD_START: 50,   // 前 50 字延迟封顶 MAX/2，防开头太肉
  };

  // 取字符串前 n 个码点（不切开 emoji 等代理对）
  function takeCodePoints(str, n) {
    let i = 0;
    let c = 0;
    while (i < str.length && c < n) {
      i += str.codePointAt(i) > 0xffff ? 2 : 1;
      c++;
    }
    return str.slice(0, i);
  }

  class Session {
    constructor(container, onUpdate) {
      this.container = container;
      this.onUpdate = onUpdate || null;
      this.source = '';
      this.queue = ''; // 已到未显示的文本缓冲（平滑器的水位队列）
      this.done = false;
      this.tailStart = 0; // 未封口区域起点（其前的块均已冻结）
      this.tailEl = null;
      this.timer = 0;
      // —— 平滑器状态（算法移植自 kimiapi packages/x/stream/smoother.go）——
      this.delay = SMOOTH.MAX_DELAY / 4; // 与 Go 版一致：从 1/4 最大延迟起步
      this.emitted = 0;   // 已吐字数（冷启动保护用）
      this.prevErr = 0;   // PD 控制器：上次水位误差
      this.prevT = 0;     // PD 控制器：上次调速时间
    }

    append(delta) {
      this.queue += delta;
      this.pump();
    }

    // 平滑吐字：每吐一个字 sleep 一个自适应 delay，delay 由 PD 控制器按
    // 「当前缓冲水位 − 目标水位」乘性调整——积压则指数加速追赶，枯竭则指数减速，
    // 每步最多 ±5%，多步累积成平滑的速度曲线。流结束后目标水位切 0，自动加速排空。
    pump() {
      if (this.timer) return;
      this.timer = setTimeout(() => {
        this.timer = 0;
        if (!this.queue.length) {
          if (this.done) this.flush(true);
          return;
        }
        // delay 压到低位说明正在大步追赶，一次多吐几个减少渲染次数
        const n = this.delay <= 4 ? Math.min(this.queue.length, 8) : 1;
        const ch = takeCodePoints(this.queue, n); // 按码点取，不切开 emoji
        this.queue = this.queue.slice(ch.length);
        this.source += ch;
        this.emitted += ch.length;
        this.flush(false);
        this.delay = this.calcDelay(this.queue.length, this.done ? 0 : SMOOTH.TARGET_LEN);
        this.pump();
      }, this.delay);
    }

    // PD 控制器：Kp/Kd/目标水位/加减速因子均与 Go 版默认参数一致
    calcDelay(queueLen, targetLen) {
      const now = performance.now();
      const dt = Math.max((now - this.prevT) / 1000, 0.01);
      const err = queueLen - targetLen;
      const sig = SMOOTH.KP * err + SMOOTH.KD * ((err - this.prevErr) / dt);
      this.prevErr = err;
      this.prevT = now;
      // 控制信号压缩到 (-2, 2)，防过冲
      const exp = (sig * 2) / (SMOOTH.KP * SMOOTH.TARGET_LEN + Math.abs(sig));
      let d = this.delay * Math.pow(SMOOTH.FACTOR, -exp);
      d = Math.min(Math.max(d, SMOOTH.MIN_DELAY), SMOOTH.MAX_DELAY);
      if (this.emitted < SMOOTH.COLD_START) d = Math.min(d, SMOOTH.MAX_DELAY / 2); // 冷启动保护
      return d;
    }

    // 重切分未封口区域：除最后一段外全部冻结渲染，尾块重渲
    flush(sealAll) {
      const chunks = splitChunks(this.source.slice(this.tailStart), this.tailStart);
      const sealCount = sealAll ? chunks.length : chunks.length - 1;
      for (let i = 0; i < sealCount; i++) this.seal(chunks[i]);
      if (!sealAll && chunks.length) this.renderTail(chunks[chunks.length - 1]);
      if (this.onUpdate) this.onUpdate();
    }

    // 冻结一个块：优先复用尾块元素，避免 DOM 增删
    seal(c) {
      const el = this.tailEl || document.createElement('div');
      this.tailEl = null;
      el.className = 'md-block';
      renderInto(el, this.source.slice(c.start, c.end));
      this.container.appendChild(el);
      this.tailStart = c.end;
    }

    renderTail(c) {
      if (!this.tailEl) {
        this.tailEl = document.createElement('div');
        this.tailEl.className = 'md-block';
        this.container.appendChild(this.tailEl);
      }
      renderInto(this.tailEl, this.source.slice(c.start, c.end));
    }

    // 流结束：以最终全文校准（差额补进队列），目标水位切 0 后自动加速吐完
    finish(fullText) {
      if (typeof fullText === 'string' && fullText !== this.source + this.queue) {
        this.queue = fullText.slice(this.source.length);
      }
      this.done = true;
      this.pump();
    }
  }

  window.MarkdownStream = {
    create: (container, onUpdate) => new Session(container, onUpdate),
    // 静态一次性渲染（历史消息用）
    render(el, text) {
      renderInto(el, text || '');
    },
    // 暴露给调试/测试
    _splitChunks: splitChunks,
  };
})();
