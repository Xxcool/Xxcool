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

// ---------- 武汉城市江畔天际线 SVG 生成（支持昼夜 5 时段 + 工作日/周末细节自动切换） ----------

/** 确定性伪随机数生成器（按日期固定当天楼宇轮廓） */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 城市江畔昼夜 5 时段色板
const MOODS = {
  dawn:   { sky: ['#22304f', '#8a6b8e', '#f2a97e', '#ffd9a8'], sun: '#fff1d6', land: '#2a2a3d', haze: '#f0b996', glow: 0.55 },
  day:    { sky: ['#3f74b5', '#6f9dd0', '#a9c9e6', '#dbe9f2'], sun: '#fffbf0', land: '#2c3a36', haze: '#bcd3e0', glow: 0.35 },
  golden: { sky: ['#3d6491', '#8fa7c0', '#f4c27f', '#ffe2a6'], sun: '#fff4dc', land: '#3b2f2a', haze: '#f2c48c', glow: 0.55 },
  dusk:   { sky: ['#171533', '#4b2f63', '#b4537a', '#f39062'], sun: '#ffd7a8', land: '#1d1526', haze: '#c96a72', glow: 0.55 },
  night:  { sky: ['#03050c', '#0a1124', '#16244a', '#2b3d6b'], sun: '#e9eefc', land: '#05070d', haze: '#2d406c', glow: 0.55 },
};

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const moodAt = h => (h >= 5 && h < 7 ? 'dawn' : h >= 7 && h < 16 ? 'day' : h >= 16 && h < 18 ? 'golden' : h >= 18 && h < 19.5 ? 'dusk' : 'night');
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, k) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * k).toString(16).padStart(2, '0')).join('');

/** 渲染武汉城市江畔天际线：两岸高楼、跨江斜拉大桥、电视塔与江面倒影 */
function horizonSvg(date, h) {
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  const dayTag = WEEKDAYS[dayOfWeek];
  const isWeekend = process.env.PROFILE_MODE ? process.env.PROFILE_MODE === 'weekend' : (dayOfWeek === 0 || dayOfWeek === 6);
  const seed = Number(date.replace(/-/g, '')) + 101;
  const rnd = mulberry32(seed);
  const moodName = moodAt(h);
  const m = MOODS[moodName];
  const isLit = moodName === 'night' || moodName === 'dusk';
  const HW = 860, HH = 170;
  const r1 = n => n.toFixed(1);

  // 日月弧线定位：06:00-18:00 太阳弧行，19:30-05:00 月亮巡游
  let sunX, sunY, sunR;
  if (moodName === 'night') {
    const t = ((h - 19.5 + 24) % 24) / 9.5;
    sunX = HW * (0.08 + 0.84 * t);
    sunY = 54 - Math.sin(Math.PI * t) * 28;
    sunR = 11;
  } else {
    const t = (h - 6) / 12;
    sunX = HW * (0.08 + 0.84 * Math.min(1, Math.max(0, t)));
    sunY = 102 - Math.sin(Math.PI * t) * 76;
    sunR = moodName === 'day' ? 16 : 20;
  }

  // 天空层：夜间与黄昏显示星空和流星，白天显示飞鸟
  let bgExtras = '';
  if (isLit) {
    const starCount = isWeekend ? 72 : 56;
    for (let i = 0; i < starCount; i++) {
      const x = rnd() * HW, y = rnd() * 96, r = 0.4 + rnd() * 0.9, o = 0.35 + rnd() * 0.6;
      const tw = rnd() < 0.42
        ? `<animate attributeName="opacity" values="${o.toFixed(2)};0.12;${o.toFixed(2)}" dur="${r1(2 + rnd() * 4)}s" begin="-${r1(rnd() * 6)}s" repeatCount="indefinite"/>`
        : '';
      bgExtras += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r.toFixed(2)}" fill="#fff" opacity="${o.toFixed(2)}">${tw}</circle>`;
    }
    if (moodName === 'night') {
      const sx = HW * (0.35 + rnd() * 0.38), sy = 14 + rnd() * 22;
      bgExtras += `<g opacity="0"><line x1="${r1(sx)}" y1="${r1(sy)}" x2="${r1(sx - 44)}" y2="${r1(sy - 13)}" stroke="url(#trail)" stroke-width="1.3" stroke-linecap="round"/><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.78;0.8;0.86;1" dur="14s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;0 0;140 42;140 42" keyTimes="0;0.78;0.86;1" dur="14s" repeatCount="indefinite"/></g>`;
    }
  } else {
    const n = 3 + Math.floor(rnd() * 3), by = 24 + rnd() * 26, cross = 70 + rnd() * 36, phase = rnd() * cross;
    const ink = mix(m.land, m.sky[1], 0.28);
    for (let i = 0; i < n; i++) {
      const ox = (rnd() - 0.5) * 68, oy = (rnd() - 0.5) * 18, s = 3 + rnd() * 2.2, flap = 0.7 + rnd() * 0.45;
      const up = `M${r1(-s)} ${r1(-s * 0.6)} Q${r1(-s * 0.4)} ${r1(-s)} 0 0 Q${r1(s * 0.4)} ${r1(-s)} ${r1(s)} ${r1(-s * 0.6)}`;
      const down = `M${r1(-s)} ${r1(s * 0.3)} Q${r1(-s * 0.4)} ${r1(-s * 0.2)} 0 0 Q${r1(s * 0.4)} ${r1(-s * 0.2)} ${r1(s)} ${r1(s * 0.3)}`;
      bgExtras += `<g><animateTransform attributeName="transform" type="translate" values="${r1(-60 + ox)} ${r1(by + oy)};${r1(HW + 60 + ox)} ${r1(by + oy - 10)}" dur="${r1(cross)}s" begin="-${r1(phase)}s" repeatCount="indefinite"/>
<path d="${up}" fill="none" stroke="${ink}" stroke-width="1.1" stroke-linecap="round"><animate attributeName="d" values="${up};${down};${up}" dur="${flap.toFixed(2)}s" begin="-${r1(rnd())}s" repeatCount="indefinite"/></path></g>`;
    }
  }

  // 远景薄雾楼群（江心桥跨区保持低矮开阔，突出斜拉桥轮廓）
  let farBldgs = '';
  let x = 0;
  const farColor = mix(m.haze, m.land, 0.36);
  while (x < HW) {
    const inSpan = x > 210 && x < 510;
    const bw = 18 + rnd() * 26;
    const bh = inSpan ? (10 + rnd() * 18) : (26 + rnd() * 44);
    farBldgs += `<rect x="${r1(x)}" y="${r1(142 - bh)}" width="${r1(bw + 1)}" height="${r1(bh)}" fill="${farColor}"/>`;
    x += bw + rnd() * 4;
  }

  // 跨江斜拉桥（主跨位于 x=210..510 开阔江面；工作日桥面车流更密集，周末悠闲）
  const bridgeY = 124, t1 = 278, t2 = 448, towerTop = 50;
  const bridgeColor = mix(m.haze, m.land, 0.68);
  const cableColor = isLit ? mix(bridgeColor, '#93c5fd', 0.25) : bridgeColor;
  let bridge = `<rect x="0" y="${bridgeY}" width="${HW}" height="3" fill="${bridgeColor}"/>`;
  for (const tx of [t1, t2]) {
    bridge += `<polygon points="${tx - 6},${bridgeY + 20} ${tx - 2.3},${towerTop} ${tx + 2.3},${towerTop} ${tx + 6},${bridgeY + 20}" fill="${bridgeColor}"/>`;
    bridge += `<rect x="${tx - 4.5}" y="${towerTop + 26}" width="9" height="3" fill="${bridgeColor}"/>`;
    for (let k = 1; k <= 7; k++) {
      const span = k * 14.5;
      bridge += `<line x1="${tx}" y1="${towerTop + 5}" x2="${tx - span}" y2="${bridgeY}" stroke="${cableColor}" stroke-width="0.75" opacity="0.82"/>`;
      bridge += `<line x1="${tx}" y1="${towerTop + 5}" x2="${tx + span}" y2="${bridgeY}" stroke="${cableColor}" stroke-width="0.75" opacity="0.82"/>`;
    }
    if (isLit) {
      bridge += `<circle cx="${tx}" cy="${towerTop - 1}" r="1.7" fill="#ff5f57"><animate attributeName="opacity" values="1;0.15;1" dur="2.2s" repeatCount="indefinite"/></circle>`;
    }
  }
  if (isLit) {
    const durA = isWeekend ? '15s' : '9.5s';
    const durB = isWeekend ? '18s' : '11.5s';
    bridge += `<circle r="1.5" cy="${bridgeY - 1.2}" fill="#ffd480" opacity="0.9"><animate attributeName="cx" values="-20;${HW + 20}" dur="${durA}" repeatCount="indefinite"/></circle>`;
    bridge += `<circle r="1.5" cy="${bridgeY - 1.2}" fill="#ff7b72" opacity="0.85"><animate attributeName="cx" values="${HW + 20};-20" dur="${durB}" repeatCount="indefinite"/></circle>`;
    if (!isWeekend) {
      bridge += `<circle r="1.3" cy="${bridgeY - 1.2}" fill="#ffd480" opacity="0.78"><animate attributeName="cx" values="-20;${HW + 20}" dur="12.5s" begin="-5s" repeatCount="indefinite"/></circle>`;
    }
  }

  // 两岸前景摩天大楼群 + 夜景窗格（工作日写字楼青白灯光略多，周末偏暖金灯光）
  const nearColor = mix(m.haze, m.land, 0.88);
  let nearBldgs = '', windows = '', beacons = '';
  const litRatio = isWeekend ? 0.26 : 0.34;
  const warmRatio = isWeekend ? 0.82 : 0.62;
  const drawBank = (startX, endX) => {
    let bx = startX;
    while (bx < endX) {
      const bw = Math.min(endX - bx, 20 + rnd() * 30);
      if (bw < 14) break;
      const bh = 28 + rnd() * 72, topY = 144 - bh;
      const isSpire = rnd() < 0.25 && bh > 58;
      nearBldgs += `<rect x="${r1(bx)}" y="${r1(topY)}" width="${r1(bw)}" height="${r1(bh)}" fill="${nearColor}"/>`;
      if (isSpire) {
        const sx = bx + bw / 2;
        nearBldgs += `<rect x="${r1(bx + bw * 0.22)}" y="${r1(topY - 8)}" width="${r1(bw * 0.56)}" height="8" fill="${nearColor}"/>`;
        nearBldgs += `<line x1="${r1(sx)}" y1="${r1(topY - 8)}" x2="${r1(sx)}" y2="${r1(topY - 22)}" stroke="${nearColor}" stroke-width="1.4"/>`;
        if (isLit) beacons += `<circle cx="${r1(sx)}" cy="${r1(topY - 22)}" r="1.5" fill="#ff5f57"><animate attributeName="opacity" values="1;0.1;1" dur="${r1(1.8 + rnd())}s" begin="-${r1(rnd() * 2)}s" repeatCount="indefinite"/></circle>`;
      }
      if (isLit) {
        const cols = Math.floor((bw - 6) / 5), rows = Math.floor((bh - 8) / 6);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (rnd() < litRatio) {
              const wc = rnd() < warmRatio ? '#ffd480' : '#8be9fd';
              windows += `<rect x="${r1(bx + 4 + c * 5)}" y="${r1(topY + 5 + r * 6)}" width="2.4" height="3.2" fill="${wc}" opacity="${(0.35 + rnd() * 0.55).toFixed(2)}"/>`;
            }
          }
        }
      }
      bx += bw + 3 + rnd() * 7;
    }
  };
  drawBank(6, 205);
  drawBank(515, HW - 6);

  // 电视塔地标（右岸点缀）
  const tvX = 635;
  nearBldgs += `<polygon points="${tvX - 6},144 ${tvX - 2},72 ${tvX + 2},72 ${tvX + 6},144" fill="${nearColor}"/>`;
  nearBldgs += `<ellipse cx="${tvX}" cy="70" rx="8" ry="4" fill="${nearColor}"/>`;
  nearBldgs += `<line x1="${tvX}" y1="66" x2="${tvX}" y2="42" stroke="${nearColor}" stroke-width="1.5"/>`;
  if (isLit) beacons += `<circle cx="${tvX}" cy="42" r="1.6" fill="#ff5f57"><animate attributeName="opacity" values="1;0.1;1" dur="1.9s" repeatCount="indefinite"/></circle>`;

  // 江面区域 + 日月倒影（周末附加缓缓驶过的江轮微光）
  const waterTop = 144;
  const waterCol = mix(m.land, m.sky[2], 0.30);
  let water = `<rect x="0" y="${waterTop}" width="${HW}" height="${HH - waterTop}" fill="${waterCol}"/>`;
  for (let i = 0; i < 18; i++) {
    const ry = waterTop + 3 + i * 1.4;
    const rw = Math.max(8, (64 - i * 2.5) * (0.6 + rnd() * 0.6));
    const rx = sunX - rw / 2 + (rnd() - 0.5) * 16;
    water += `<rect x="${r1(rx)}" y="${r1(ry)}" width="${r1(rw)}" height="0.9" rx="0.4" fill="${m.sun}" opacity="${(0.32 - i * 0.014).toFixed(2)}"><animate attributeName="x" values="${r1(rx - 4)};${r1(rx + 4)};${r1(rx - 4)}" dur="${r1(3 + rnd() * 3)}s" repeatCount="indefinite"/></rect>`;
  }
  if (isWeekend) {
    const boatCol = mix(nearColor, '#ffffff', isLit ? 0.18 : 0.1);
    const boatLit = isLit ? `<rect x="3" y="1.5" width="12" height="1.5" fill="#ffd480" opacity="0.85"/><circle cx="17" cy="3" r="1.1" fill="#8be9fd"/>` : '';
    water += `<g opacity="0.85"><animateTransform attributeName="transform" type="translate" values="405 148;575 148" dur="36s" repeatCount="indefinite"/>
      <polygon points="0,5 20,5 23,2 2,2" fill="${boatCol}"/><rect x="4" y="0" width="11" height="2.2" fill="${boatCol}"/>${boatLit}
    </g>`;
  }

  const timeLabel = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const modeLabel = isWeekend ? 'weekend' : 'workday';
  const label = `${date} (${dayTag}) · ${timeLabel} utc+${tzOffsetHours} · ${(cfg.location || 'wuhan').toLowerCase()} · ${modeLabel} · ${moodName}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${HW}" height="${HH}" viewBox="0 0 ${HW} ${HH}" role="img" aria-label="the riverfront skyline right now in ${cfg.location || 'Wuhan'}: ${modeLabel}, ${moodName}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${m.sky.map((s, i) => `<stop offset="${(i / 3) * 0.78}" stop-color="${s}"/>`).join('')}</linearGradient>
<radialGradient id="glow" cx="${r1(sunX)}" cy="${r1(sunY)}" r="${sunR * 7}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${m.sun}" stop-opacity="${m.glow}"/><stop offset="1" stop-color="${m.sun}" stop-opacity="0"/></radialGradient>
<linearGradient id="trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="frame"><rect width="${HW}" height="${HH}" rx="12"/></clipPath>
</defs>
<g clip-path="url(#frame)">
<rect width="${HW}" height="${HH}" fill="url(#sky)"/>
${bgExtras}
<rect width="${HW}" height="${HH}" fill="url(#glow)"><animate attributeName="opacity" values="0.8;1;0.8" dur="8s" repeatCount="indefinite"/></rect>
<circle cx="${r1(sunX)}" cy="${r1(sunY)}" r="${r1(sunR)}" fill="${m.sun}"/>
${farBldgs}
${bridge}
${nearBldgs}
${windows}
${beacons}
${water}
<text x="16" y="${HH - 11}" font-family="${FONT}" font-size="10.5" fill="#fff" fill-opacity="0.6">${label}</text>
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
