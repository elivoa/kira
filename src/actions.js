// 动作注册表：桌宠页面和设置页面共用
// forms: 哪些形态会做；intrusive: 打扰性动作（会跑到屏幕中间/遮挡工作区）
// w: 待机自动播放的权重；auto: 是否进入待机随机池（leave 由「不理她」超时单独触发）
// off: true 默认关闭（设置页里显示为关，可手动再打开）
const ACTIONS = {
  walk:    { name: '走一走',   forms: ['normal', 'chibi', 'back'], intrusive: false, w: 22, auto: true },
  hop:     { name: '跳一下',   forms: ['normal', 'back'],    intrusive: false, w: 10, auto: true },
  spin:    { name: '转个圈',   forms: ['normal', 'chibi', 'back'], intrusive: false, w: 9,  auto: true },
  sway:    { name: '撒个娇',   forms: ['normal'],            intrusive: false, w: 10, auto: true },
  qbounce: { name: '蹦蹦跳',   forms: ['chibi'],             intrusive: false, w: 16, auto: true },
  qsway:   { name: '摇呀摇',   forms: ['chibi'],             intrusive: false, w: 12, auto: true },
  morph:   { name: '变个身',   forms: ['normal', 'chibi'], intrusive: false, w: 8,  auto: true },
  desk:    { name: '来张桌子', forms: ['normal'],            intrusive: false, w: 5,  auto: true },
  seal:    { name: '收进法宝', forms: ['normal'],            intrusive: false, w: 3,  auto: true },
  goledge: { name: '去窗台玩', forms: ['normal', 'chibi'], intrusive: true,  w: 6,  auto: true },
  dash:    { name: '暴走模式', forms: ['normal', 'chibi'], intrusive: true,  w: 4,  auto: true },
  fly:     { name: '御剑飞行', forms: ['normal', 'chibi'], intrusive: true,  w: 4,  auto: true },
  poop:    { name: '你讨厌！', forms: ['normal', 'chibi'], intrusive: true,  w: 3,  auto: true },
  sword:   { name: '化身成剑', forms: ['normal', 'chibi'], intrusive: true,  w: 3,  auto: true },
  drive:   { name: '兜风',     forms: ['normal', 'chibi'], intrusive: true,  w: 3,  auto: true },
  flutefly:{ name: '笛子乱飞', forms: ['normal', 'back'],    intrusive: false, w: 4,  auto: true },
  peek:    { name: '偷偷回头', forms: ['back'],              intrusive: false, w: 10, auto: true },
  brock:   { name: '赌气晃晃', forms: ['back'],              intrusive: false, w: 12, auto: true },
  sleep:   { name: '睡觉',     forms: ['normal', 'chibi'], intrusive: false, w: 5,  auto: true },
  wallbang:{ name: '撞墙（烦躁时）', forms: ['normal', 'chibi'], intrusive: true, w: 0, auto: false },
  work:    { name: '工作模式', forms: ['normal'],            intrusive: false, w: 4,  auto: true },
  mischief:{ name: '捣乱',     forms: ['normal', 'chibi'], intrusive: true,  w: 2,  auto: true },
  leave:   { name: '走了走了（不理她时）', forms: ['normal', 'chibi'], intrusive: false, w: 0, auto: false, off: true },
};

// 设置页分组用：形态分组的展示名
const FORM_GROUPS = [
  { key: 'both', label: '通用动作（多形态）' },
  { key: 'normal', label: '姐姐形态' },
  { key: 'chibi', label: 'Q版形态' },
  { key: 'back', label: '背对形态' },
];

function actionFormGroup(a) {
  return a.forms.length > 1 ? 'both' : a.forms[0];
}
