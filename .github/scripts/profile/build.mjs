// 按北京时间（UTC+8）重绘 GitHub 主页 SVG：动态天际线与明暗自适应终端。
// 零外部依赖，从仓库根目录运行：node .github/scripts/profile/build.mjs
// 支持通过环境变量 PROFILE_DATE=YYYY-MM-DD、PROFILE_TIME=HH:MM 覆盖时间用于本地预览。
// 动画与排版思路参考 MIT 协议开源项目 StarKnightt/StarKnightt，并针对 Xxcool 与武汉时区重构适配。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('./builds.json', import.meta.url), 'utf8'));
const tzOffsetHours = cfg.timezoneOffsetHours ?? 8;
const localNow = new Date(Date.now() + tzOffsetHours * 3600e3);
const today = process.env.PROFILE_DATE || localNow.toISOString().slice(0, 10);
const [hh, mm] = (process.env.PROFILE_TIME || localNow.toISOString().slice(11, 16)).split(':').map(Number);
const hour = hh + mm / 60;

// ---------- 仓库数据拉取与筛选 ----------

/** 分页拉取指定用户公开原创仓库（排除 fork 与私有仓库） */
async function fetchRepos(user) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'xxcool-profile-builder' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const repos = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/users/${user}/repos?type=owner&per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter(r => !r.fork && !r.private);
}

const repos = await fetchRepos(cfg.user);
const buildTopics = new Set(cfg.buildTopics || ['threejs', 'webgl', 'blender']);

// 最近发布：匹配核心技术主题并按创建时间倒序取最新一个
const latest = repos
  .filter(r => !r.archived && r.topics?.some(t => buildTopics.has(t)))
  .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];

// Star 榜前 N：排除归档仓库、主页仓库及 .github，Star 相同时按最近推送倒序
const top = repos
  .filter(r => !r.archived && r.name !== cfg.user && r.name !== '.github')
  .sort((a, b) => b.stargazers_count - a.stargazers_count || (b.pushed_at || '').localeCompare(a.pushed_at || ''))
  .slice(0, cfg.top || 5);

// ---------- 终端像素画像读取 ----------

// 由原始头像去背景采样生成的紧凑行程编码像素数据（支持明暗双主题适配）
const avatarData = JSON.parse(readFileSync(new URL('./avatar-pixels.json', import.meta.url), 'utf8'));

/** 将像素 RGB 转换为适配终端明暗主题的十六进制颜色 */
function pixelHex(r, g, b, isDark) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const adj = v => (isDark ? clamp(v * 0.92 + 18) : clamp(v));
  return '#' + [adj(r), adj(g), adj(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** 计算仓库创建日期距今的相对英文描述 */
function ago(iso) {
  const days = Math.round((Date.parse(today) - Date.parse(iso.slice(0, 10))) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

// ---------- 终端 SVG 生成 ----------

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
const padL = (s, n) => ' '.repeat(Math.max(0, n - s.length)) + s;

const THEMES = {
  dark: { bg: '#0b0f14', bar: '#11161d', border: '#262c36', fg: '#d1d7e0', dim: '#7d8590', user: '#7ee787', path: '#79c0ff', star: '#e3b341', accent: '#ffa657' },
  light: { bg: '#fbfcfd', bar: '#f0f2f5', border: '#d1d9e0', fg: '#1f2328', dim: '#6e7781', user: '#1a7f37', path: '#0969da', star: '#9a6700', accent: '#bc4c00' },
};

const cmd = text => ({ cmd: true, segs: [['xxcool', 'user'], [' ~ ', 'path'], ['$ ', 'dim'], [text, 'fg']] });
const out = (...segs) => ({ cmd: false, segs });

const lines = [
  cmd('whoami'),
  out(['xxcool · wuhan · frontend, 3d & ai builder', 'fg']),
  cmd(`ls ~/projects --sort=stars | head -${cfg.top || 5}`),
  ...top.map(r => out([pad(clip(r.name, 25), 26), 'fg'], ['★ ', 'star'], [padL(String(r.stargazers_count), 4), 'star'])),
  ...(latest ? [cmd('ls -t ~/builds | head -1'), out([pad(clip(latest.name, 25), 26), 'accent'], [`shipped ${ago(latest.created_at)}`, 'dim'])] : []),
  cmd('which showcase'),
  out(['smart-warehouse-wine.vercel.app', 'path']),
  cmd(''),
];

const W = 860, PADX = 24, BAR = 38, LH = 23, FS = 14, CW = 8.4;
const H = BAR + 18 + lines.length * LH + 10;
// 右侧像素画像区：保持原始纵横比并垂直居中，与左侧命令行保留 30px 以上间距
const MAX_ART_W = 370, MAX_ART_H = lines.length * LH - 4;
const PIXEL = Math.min(MAX_ART_W / avatarData.cols, MAX_ART_H / avatarData.rows);
const AX = W - PADX - avatarData.cols * PIXEL;
const AY = BAR + 16 + (MAX_ART_H - avatarData.rows * PIXEL) / 2;
const FONT = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`;

// SMIL 动画时间轴：命令行逐字输入，输出按行瞬间展开，播完后保持定格仅光标闪烁
const TYPE = 45, AFTER_CMD = 360, OUT_GAP = 70, HOLD = 200, START = 550;
let t = START;
const timeline = lines.map(line => {
  const promptLen = line.segs.slice(0, 3).reduce((n, [s]) => n + s.length, 0);
  const total = line.segs.reduce((n, [s]) => n + s.length, 0);
  const steps = [];
  if (line.cmd) {
    steps.push([t, promptLen]);
    for (let i = 1; i <= total - promptLen; i++) steps.push([t + i * TYPE, promptLen + i]);
    t += (total - promptLen) * TYPE + AFTER_CMD;
  } else {
    steps.push([t, total]);
    t += OUT_GAP;
  }
  return steps;
});
const CYCLE = t + HOLD;

/** 生成严格单调递增的离散 SMIL keyTimes 序列 */
function keyTimes(times) {
  const ks = [0, ...times.map(ms => ms / CYCLE)];
  return ks.map((k, i) => (i === 0 ? 0 : Math.max(k, ks[i - 1] + 1e-5)).toFixed(5)).join(';');
}

/** 渲染终端窗口 SVG（支持 dark / light 双主题） */
function terminalSvg(theme) {
  const c = THEMES[theme];
  const clips = [], texts = [];
  lines.forEach((line, i) => {
    const y = BAR + 18 + i * LH + FS;
    const steps = timeline[i];
    const widths = ['0', ...steps.map(([, n], j) => (j === steps.length - 1 ? W : PADX + n * CW + 1).toFixed(1))];
    clips.push(`<clipPath id="l${i}"><rect x="0" y="${y - FS - 3}" height="${LH}" width="0"><animate attributeName="width" calcMode="discrete" dur="${CYCLE}ms" fill="freeze" values="${widths.join(';')}" keyTimes="${keyTimes(steps.map(([ms]) => ms))}"/></rect></clipPath>`);
    let col = 0;
    const parts = line.segs.filter(([s]) => s.length).map(([s, role]) => {
      const x = PADX + col * CW;
      col += s.length;
      return `<text x="${x.toFixed(1)}" y="${y}" fill="${c[role]}" textLength="${(s.length * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${esc(s)}</text>`;
    });
    texts.push(`<g clip-path="url(#l${i})">${parts.join('')}</g>`);
  });

  const stops = timeline.flatMap((steps, i) => steps.map(([ms, n]) => [ms, PADX + n * CW + 1, BAR + 18 + i * LH]));
  const cx = ['-20', ...stops.map(([, x]) => x.toFixed(1))].join(';');
  const cy = [String(BAR + 18), ...stops.map(([, , y]) => y)].join(';');
  const kt = keyTimes(stops.map(([ms]) => ms));
  const cursor = `<rect width="${CW}" height="${FS + 3}" fill="${c.fg}" opacity="0.85">
    <animate attributeName="x" calcMode="discrete" dur="${CYCLE}ms" fill="freeze" values="${cx}" keyTimes="${kt}"/>
    <animate attributeName="y" calcMode="discrete" dur="${CYCLE}ms" fill="freeze" values="${cy}" keyTimes="${kt}"/>
    <animate attributeName="fill-opacity" calcMode="discrete" dur="1.06s" repeatCount="indefinite" values="1;0" keyTimes="0;0.5"/>
  </rect>`;

  const artStart = timeline[1][0][0];
  const isDark = theme === 'dark';
  const ph = (PIXEL + 0.5).toFixed(1);
  // 随 whoami 输出逐行扫描渲染像素画像，+0.5 轻微重叠消除浏览器缩放缝隙
  const art = avatarData.data.map((runs, i) => {
    if (!runs.length) return '';
    const y = (AY + i * PIXEL).toFixed(1);
    const at = (artStart + i * 16) / CYCLE;
    const rects = runs.map(([sx, len, r, g, b]) =>
      `<rect x="${(AX + sx * PIXEL).toFixed(1)}" y="${y}" width="${(len * PIXEL + 0.5).toFixed(1)}" height="${ph}" fill="${pixelHex(r, g, b, isDark)}"/>`
    ).join('');
    return `<g opacity="0">${rects}<animate attributeName="opacity" calcMode="discrete" dur="${CYCLE}ms" fill="freeze" values="0;1" keyTimes="0;${Math.min(at, 0.999).toFixed(5)}"/></g>`;
  }).join('\n');

  const dots = ['#ff5f57', '#febc2e', '#28c840'].map((f, i) => `<circle cx="${22 + i * 20}" cy="${BAR / 2}" r="6" fill="${f}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="terminal: xxcool, wuhan, frontend 3d and ai builder">
<defs>${clips.join('')}<clipPath id="win"><rect width="${W}" height="${H}" rx="12"/></clipPath></defs>
<g clip-path="url(#win)">
<rect width="${W}" height="${H}" fill="${c.bg}"/>
<rect width="${W}" height="${BAR}" fill="${c.bar}"/>
<line x1="0" y1="${BAR}" x2="${W}" y2="${BAR}" stroke="${c.border}"/>
${dots}
<text x="${W / 2}" y="${BAR / 2 + 4.5}" fill="${c.dim}" font-family="${FONT}" font-size="12.5" text-anchor="middle">xxcool@wuhan: ~</text>
<g shape-rendering="crispEdges">${art}</g>
<g font-family="${FONT}" font-size="${FS}">${texts.join('\n')}</g>
${cursor}
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="11.5" fill="none" stroke="${c.border}"/>
</svg>
`;
}

// ---------- 极客赛博天际线 SVG 生成（支持工作日/周末 + 5 时段昼夜自动切换） ----------

/** 确定性伪随机数生成器（按日期固定当天城市/建筑轮廓） */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 极客赛博昼夜 5 时段色板
const CYBER_MOODS = {
  dawn:   { sky: ['#151b38', '#332e63', '#824372', '#ec9a72'], sun: '#ffe4b5', land: '#0a0f21', glow: 0.50 },
  day:    { sky: ['#162c52', '#26538d', '#4b86c2', '#93c5fd'], sun: '#fde68a', land: '#0f1b30', glow: 0.40 },
  golden: { sky: ['#1c2d52', '#495a88', '#b07268', '#f5b370'], sun: '#fff0c2', land: '#141c2e', glow: 0.50 },
  dusk:   { sky: ['#0c0d29', '#2b1a52', '#7a2b6e', '#df6566'], sun: '#ffaa75', land: '#0b0c20', glow: 0.55 },
  night:  { sky: ['#040612', '#0a112b', '#181942', '#351b5c'], sun: '#ff9e64', land: '#080b18', glow: 0.52 },
};

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const moodAt = h => (h >= 5 && h < 7 ? 'dawn' : h >= 7 && h < 16 ? 'day' : h >= 16 && h < 18 ? 'golden' : h >= 18 && h < 19.5 ? 'dusk' : 'night');
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, k) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * k).toString(16).padStart(2, '0')).join('');

/** 渲染极客赛博天际线：工作日展示代码矩阵与科技塔阵，周末切换都市桥梁霓虹 */
function horizonSvg(date, h) {
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  const dayTag = WEEKDAYS[dayOfWeek];
  const isWeekend = process.env.PROFILE_MODE ? process.env.PROFILE_MODE === 'weekend' : (dayOfWeek === 0 || dayOfWeek === 6);
  const seed = Number(date.replace(/-/g, '')) + (isWeekend ? 707 : 202);
  const rnd = mulberry32(seed);
  const moodName = moodAt(h);
  const m = { ...CYBER_MOODS[moodName] };
  const isLit = moodName === 'night' || moodName === 'dusk';
  const HW = 860, HH = 170, HY = 112;
  const r1 = n => n.toFixed(1);

  // 工作日夜间偏冷极客蓝白光球，周末夜间保留暖橙赛博落日感
  if (moodName === 'night' && !isWeekend) m.sun = '#cbd5e1';

  // 日月弧线定位
  let sunX, sunY, sunR;
  if (moodName === 'night') {
    const t = ((h - 19.5 + 24) % 24) / 9.5;
    sunX = HW * (0.08 + 0.84 * t);
    sunY = 54 - Math.sin(Math.PI * t) * 28;
    sunR = 13;
  } else {
    const t = (h - 6) / 12;
    sunX = HW * (0.08 + 0.84 * Math.min(1, Math.max(0, t)));
    sunY = 102 - Math.sin(Math.PI * t) * 76;
    sunR = moodName === 'day' ? 18 : 22;
  }

  // 天空层次：夜间闪烁星空 + 流星；工作日叠加极客节点星图，周末白天加掠过飞鸟
  let skyExtras = '';
  if (isLit) {
    const starCount = isWeekend ? 70 : 48;
    for (let i = 0; i < starCount; i++) {
      const x = rnd() * HW, y = rnd() * 94, r = 0.4 + rnd() * 0.9, o = 0.32 + rnd() * 0.6;
      const tw = rnd() < 0.42 ? `<animate attributeName="opacity" values="${o.toFixed(2)};0.12;${o.toFixed(2)}" dur="${r1(2 + rnd() * 4)}s" begin="-${r1(rnd() * 6)}s" repeatCount="indefinite"/>` : '';
      skyExtras += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r.toFixed(2)}" fill="#fff" opacity="${o.toFixed(2)}">${tw}</circle>`;
    }
    if (isWeekend && moodName === 'night') {
      const sx = HW * (0.22 + rnd() * 0.48), sy = 14 + rnd() * 22;
      skyExtras += `<g opacity="0"><line x1="${r1(sx)}" y1="${r1(sy)}" x2="${r1(sx - 46)}" y2="${r1(sy - 14)}" stroke="url(#trail)" stroke-width="1.3" stroke-linecap="round"/>
<animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.76;0.79;0.85;1" dur="14s" repeatCount="indefinite"/>
<animateTransform attributeName="transform" type="translate" values="0 0;0 0;150 44;150 44" keyTimes="0;0.76;0.85;1" dur="14s" repeatCount="indefinite"/></g>`;
    }
  } else if (isWeekend) {
    const n = 3 + Math.floor(rnd() * 2), by = 24 + rnd() * 24, cross = 72 + rnd() * 30, phase = rnd() * cross;
    for (let i = 0; i < n; i++) {
      const ox = (rnd() - 0.5) * 60, oy = (rnd() - 0.5) * 18, s = 3 + rnd() * 2, flap = 0.7 + rnd() * 0.4;
      const up = `M${r1(-s)} ${r1(-s * 0.6)} Q${r1(-s * 0.4)} ${r1(-s)} 0 0 Q${r1(s * 0.4)} ${r1(-s)} ${r1(s)} ${r1(-s * 0.6)}`;
      const down = `M${r1(-s)} ${r1(s * 0.3)} Q${r1(-s * 0.4)} ${r1(-s * 0.2)} 0 0 Q${r1(s * 0.4)} ${r1(-s * 0.2)} ${r1(s)} ${r1(s * 0.3)}`;
      skyExtras += `<g><animateTransform attributeName="transform" type="translate" values="${r1(-60 + ox)} ${r1(by + oy)};${r1(HW + 60 + ox)} ${r1(by + oy - 10)}" dur="${r1(cross)}s" begin="-${r1(phase)}s" repeatCount="indefinite"/>
<path d="${up}" fill="none" stroke="#dbeafe" stroke-opacity="0.55" stroke-width="1.1" stroke-linecap="round"><animate attributeName="d" values="${up};${down};${up}" dur="${flap.toFixed(2)}s" begin="-${r1(rnd())}s" repeatCount="indefinite"/></path></g>`;
    }
  }

  // 工作日附加极客节点拓扑与微弱代码符号
  if (!isWeekend) {
    const nodes = Array.from({ length: 10 }, (_, i) => [60 + i * 82 + (rnd() - 0.5) * 28, 18 + rnd() * 52]);
    for (let i = 0; i < nodes.length - 1; i++) {
      if (rnd() < 0.7) {
        skyExtras += `<line x1="${r1(nodes[i][0])}" y1="${r1(nodes[i][1])}" x2="${r1(nodes[i + 1][0])}" y2="${r1(nodes[i + 1][1])}" stroke="#7dd3fc" stroke-width="0.65" opacity="${isLit ? 0.22 : 0.16}"/>`;
      }
    }
    const tokens = ['</>', '{ }', '=>', 'git', '0x1'];
    nodes.forEach(([nx, ny], i) => {
      const col = i % 2 === 0 ? '#7ee787' : '#79c0ff';
      skyExtras += `<circle cx="${r1(nx)}" cy="${r1(ny)}" r="1.6" fill="${col}" opacity="${isLit ? 0.6 : 0.45}"/>`;
      if (i % 2 === 1) {
        skyExtras += `<text x="${r1(nx + 5)}" y="${r1(ny + 3)}" font-family="${FONT}" font-size="8.5" fill="#ffffff" fill-opacity="${isLit ? 0.22 : 0.18}">${esc(tokens[((i - 1) / 2) % tokens.length])}</text>`;
      }
    });
  }

  // 赛博条纹分切光球（clipPath 裁切，避免背景色块接缝）
  const orb = `<circle cx="${r1(sunX)}" cy="${r1(sunY)}" r="${sunR}" fill="${m.sun}" opacity="0.94" clip-path="url(#orbClip)"/>`;

  // 中景剪影：工作日为科技服务器塔阵，周末为武汉跨江大桥 + 城市夜景剪影
  const neon = isWeekend ? (isLit ? '#c084fc' : '#93c5fd') : (isLit ? '#38bdf8' : '#7dd3fc');
  const accent = isWeekend ? (isLit ? '#fb923c' : '#f59e0b') : '#7ee787';
  let skyline = '';

  if (!isWeekend) {
    let bx = 0;
    while (bx < HW) {
      const w = 14 + rnd() * 26, bh = 10 + rnd() * 32, topY = HY - bh;
      skyline += `<rect x="${r1(bx)}" y="${r1(topY)}" width="${r1(w)}" height="${r1(bh)}" fill="${m.land}" opacity="0.94"/>`;
      if (rnd() < 0.28) {
        const ax = bx + w / 2;
        skyline += `<line x1="${r1(ax)}" y1="${r1(topY)}" x2="${r1(ax)}" y2="${r1(topY - 12)}" stroke="${neon}" stroke-width="0.9" opacity="0.58"/>`;
        if (isLit) {
          skyline += `<circle cx="${r1(ax)}" cy="${r1(topY - 12)}" r="1.4" fill="${accent}"><animate attributeName="opacity" values="1;0.2;1" dur="${r1(1.8 + rnd())}s" repeatCount="indefinite"/></circle>`;
        }
      }
      if (isLit && bh > 22 && rnd() < 0.55) {
        skyline += `<rect x="${r1(bx + 3)}" y="${r1(topY + 4)}" width="${r1(Math.max(4, w - 6))}" height="1.8" fill="${neon}" opacity="0.42"/>`;
      }
      bx += w + 4 + rnd() * 12;
    }
  } else {
    // 周末模式：两岸都市剪影 + 中间跨江斜拉桥（x = 240..500）
    const bridgeColor = mix(m.land, neon, isLit ? 0.24 : 0.14);
    const drawUrban = (startX, endX) => {
      let bx = startX;
      while (bx < endX) {
        const w = Math.min(endX - bx, 16 + rnd() * 24);
        if (w < 12) break;
        const bh = 14 + rnd() * 34, topY = HY - bh;
        skyline += `<rect x="${r1(bx)}" y="${r1(topY)}" width="${r1(w)}" height="${r1(bh)}" fill="${m.land}" opacity="0.95"/>`;
        if (isLit) {
          const cols = Math.floor((w - 5) / 4.5), rows = Math.floor((bh - 6) / 5.5);
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (rnd() < 0.28) {
                skyline += `<rect x="${r1(bx + 3 + c * 4.5)}" y="${r1(topY + 4 + r * 5.5)}" width="2" height="2.6" fill="${rnd() < 0.65 ? '#fde68a' : '#c084fc'}" opacity="0.72"/>`;
              }
            }
          }
        }
        bx += w + 3 + rnd() * 7;
      }
    };
    drawUrban(4, 235);
    drawUrban(505, HW - 4);
    skyline += `<rect x="235" y="${HY - 4}" width="270" height="4" fill="${bridgeColor}"/>`;
    for (const tx of [305, 435]) {
      const top = HY - 44;
      skyline += `<polygon points="${tx - 4},${HY} ${tx - 1.6},${top} ${tx + 1.6},${top} ${tx + 4},${HY}" fill="${bridgeColor}"/>`;
      for (let k = 1; k <= 5; k++) {
        const span = k * 12.5;
        skyline += `<line x1="${tx}" y1="${top + 4}" x2="${tx - span}" y2="${HY - 3}" stroke="${neon}" stroke-width="0.65" opacity="0.52"/>`;
        skyline += `<line x1="${tx}" y1="${top + 4}" x2="${tx + span}" y2="${HY - 3}" stroke="${neon}" stroke-width="0.65" opacity="0.52"/>`;
      }
      if (isLit) {
        skyline += `<circle cx="${tx}" cy="${top - 1}" r="1.5" fill="#ff5f57"><animate attributeName="opacity" values="1;0.15;1" dur="2.1s" repeatCount="indefinite"/></circle>`;
      }
    }
    if (isLit) {
      skyline += `<circle r="1.3" cy="${HY - 5}" fill="${accent}" opacity="0.9"><animate attributeName="cx" values="235;505" dur="6.5s" repeatCount="indefinite"/></circle>`;
    }
  }

  // 前景 3D 透视赛博网格 + 飞驰脉冲光点
  let grid = `<rect x="0" y="${HY}" width="${HW}" height="${HH - HY}" fill="${m.land}"/>`;
  grid += `<line x1="0" y1="${HY}" x2="${HW}" y2="${HY}" stroke="${neon}" stroke-width="1.4" opacity="0.88"/>`;
  const vpX = HW / 2;
  for (let i = -12; i <= 12; i++) {
    grid += `<line x1="${r1(vpX + i * 26)}" y1="${HY}" x2="${r1(vpX + i * 95)}" y2="${HH}" stroke="${neon}" stroke-width="0.7" opacity="0.30"/>`;
  }
  for (let k = 0; k < 6; k++) {
    const t = Math.pow(k / 5, 1.85);
    const y = HY + 3 + t * (HH - HY - 6);
    grid += `<line x1="0" y1="${r1(y)}" x2="${HW}" y2="${r1(y)}" stroke="${neon}" stroke-width="0.75" opacity="${(0.22 + t * 0.45).toFixed(2)}"/>`;
  }
  grid += `<circle r="2.2" fill="${accent}"><animate attributeName="cx" values="${vpX - 28};${vpX - 185}" dur="3.4s" repeatCount="indefinite"/><animate attributeName="cy" values="${HY};${HH}" dur="3.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.2;1;0" dur="3.4s" repeatCount="indefinite"/></circle>`;
  grid += `<circle r="2.2" fill="${neon}"><animate attributeName="cx" values="${vpX + 38};${vpX + 235}" dur="4.1s" begin="-1.5s" repeatCount="indefinite"/><animate attributeName="cy" values="${HY};${HH}" dur="4.1s" begin="-1.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.2;1;0" dur="4.1s" begin="-1.5s" repeatCount="indefinite"/></circle>`;

  const timeLabel = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const modeLabel = isWeekend ? 'cyber-chill' : 'cyber-work';
  const label = `${date} (${dayTag}) · ${timeLabel} utc+${tzOffsetHours} · ${modeLabel} · ${moodName}`;
  const orbTop = sunY - sunR - 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${HW}" height="${HH}" viewBox="0 0 ${HW} ${HH}" role="img" aria-label="cyber horizon in ${cfg.location || 'Wuhan'}: ${modeLabel}, ${moodName}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${m.sky.map((s, i) => `<stop offset="${(i / 3) * 0.8}" stop-color="${s}"/>`).join('')}</linearGradient>
<radialGradient id="glow" cx="${r1(sunX)}" cy="${r1(sunY)}" r="${sunR * 6.5}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${m.sun}" stop-opacity="${m.glow}"/><stop offset="1" stop-color="${m.sun}" stop-opacity="0"/></radialGradient>
<linearGradient id="trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="orbClip">
  <rect x="${r1(sunX - sunR - 2)}" y="${r1(orbTop)}" width="${(sunR + 2) * 2}" height="${r1(sunR + 5)}"/>
  <rect x="${r1(sunX - sunR - 2)}" y="${r1(sunY + 5)}" width="${(sunR + 2) * 2}" height="2.4"/>
  <rect x="${r1(sunX - sunR - 2)}" y="${r1(sunY + 9.2)}" width="${(sunR + 2) * 2}" height="2.1"/>
  <rect x="${r1(sunX - sunR - 2)}" y="${r1(sunY + 13.2)}" width="${(sunR + 2) * 2}" height="1.8"/>
  <rect x="${r1(sunX - sunR - 2)}" y="${r1(sunY + 17)}" width="${(sunR + 2) * 2}" height="4"/>
</clipPath>
<clipPath id="frame"><rect width="${HW}" height="${HH}" rx="12"/></clipPath>
</defs>
<g clip-path="url(#frame)">
<rect width="${HW}" height="${HH}" fill="url(#sky)"/>
<rect width="${HW}" height="${HH}" fill="url(#glow)"><animate attributeName="opacity" values="0.82;1;0.82" dur="8s" repeatCount="indefinite"/></rect>
${orb}
${skyExtras}
${skyline}
${grid}
<text x="16" y="${HH - 10}" font-family="${FONT}" font-size="10.5" fill="#fff" fill-opacity="0.62">${label}</text>
</g>
</svg>
`;
}

// ---------- 输出 SVG 文件 ----------

mkdirSync('assets', { recursive: true });
writeFileSync('assets/terminal-dark.svg', terminalSvg('dark'));
writeFileSync('assets/terminal-light.svg', terminalSvg('light'));
writeFileSync('assets/horizon.svg', horizonSvg(today, hour));

console.log(`[profile] ${today} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} (UTC+${tzOffsetHours}) · top: ${top.map(r => r.name).join(', ')} · latest: ${latest?.name ?? 'none'} · cycle ${(CYCLE / 1000).toFixed(1)}s`);
