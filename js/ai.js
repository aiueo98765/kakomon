// Claude API まわり。キーはこの端末のブラウザに保存し、ブラウザから直接 Anthropic に送る。
import Anthropic from '../vendor/anthropic.mjs';
import { settings } from './store.js';

export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5（標準・いちばん正確）' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5（料金は約半分）' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5（最安・難問には不向き）' },
];

export function hasKey() { return !!settings.get('apiKey'); }

function client() {
  const key = settings.get('apiKey');
  if (!key) throw new Error('AI を使うには、設定画面で Anthropic の API キーを入れてください。');
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

function params(extra) {
  const model = settings.get('model', 'claude-opus-5-5');
  const p = { model, ...extra };
  // 安全上の判定で断られたとき、サーバー側で別のモデルに引き継がせる（Haiku は非対応）
  if (!model.startsWith('claude-haiku')) {
    p.betas = ['server-side-fallback-2026-07-01'];
    p.fallbacks = 'default';
  }
  return p;
}

export function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'API キーが正しくありません。設定画面で確認してください。';
  if (e instanceof Anthropic.PermissionDeniedError) return 'この API キーでは使えません（権限・残高を確認してください）。';
  if (e instanceof Anthropic.RateLimitError) return '利用の上限に当たりました。少し待ってからもう一度どうぞ。';
  if (e instanceof Anthropic.BadRequestError) return 'リクエストが受け付けられませんでした：' + (e.message || '');
  if (e instanceof Anthropic.APIConnectionError) return 'ネットにつながりません。接続を確認してください。';
  if (e instanceof Anthropic.APIError) return 'AI 側でエラーが起きました（' + (e.status || '') + '）。もう一度どうぞ。';
  return e?.message || String(e);
}

// ---------------------------------------------------------------- PDF・画像
const b64Cache = new Map();
export async function pdfBlock(src, title, cache = false) {
  let data = b64Cache.get(src.id || src);
  if (!data) {
    let buf;
    if (typeof src === 'string') buf = await (await fetch(src)).arrayBuffer();
    else buf = src.data;
    data = toB64(new Uint8Array(buf));
    b64Cache.set(src.id || src, data);
  }
  const b = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  if (title) b.title = title;
  if (cache) b.cache_control = { type: 'ephemeral' };
  return b;
}
export function imageBlock(dataUrl) {
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.*)$/);
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}
function toB64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}

// ---------------------------------------------------------------- 1 回で JSON を返す呼び出し
async function jsonCall({ system, content, schema, effort = 'medium', maxTokens = 32000, onStatus }) {
  const c = client();
  const stream = c.beta.messages.stream(params({
    max_tokens: maxTokens,
    system,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  }));
  let n = 0;
  stream.on('text', t => { n += t.length; onStatus && onStatus(n); });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('AI がこの依頼を断りました。');
  if (msg.stop_reason === 'max_tokens') throw new Error('出力が長すぎて途中で切れました。');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { data: JSON.parse(text), usage: msg.usage };
}

const KEY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '並び順で一意。例 "1-1", "2-3-2"' },
          label: { type: 'string', description: '表示名。例 "[1] 問1", "[3] 問2 (2)"' },
          answer: { type: 'string', description: '正答。記号・数値・語句。記述は模範解答の要旨' },
          alts: { type: 'array', items: { type: 'string' }, description: '別解として認められる答え（表記ゆれを含む）' },
          points: { type: 'number' },
          kind: { type: 'string', enum: ['choice', 'short', 'essay'], description: 'choice=記号・選択、short=数値や語句など短答、essay=記述・作文・証明・英作文' },
          criteria: { type: 'string', description: '採点上の注意・部分点の条件（なければ空文字）' },
        },
        required: ['id', 'label', 'answer', 'alts', 'points', 'kind', 'criteria'],
        additionalProperties: false,
      },
    },
    total: { type: 'number' },
    pointsEstimated: { type: 'boolean', description: '配点が書かれておらず推定したなら true' },
    note: { type: 'string' },
  },
  required: ['items', 'total', 'pointsEstimated', 'note'],
  additionalProperties: false,
};

// 正答表 PDF から、設問ごとの正答・配点の一覧（解答欄）を作る
export async function buildKey({ title, keyDocs, sheetDocs = [], maxPoints = 100, onStatus }) {
  const content = [];
  for (const d of keyDocs) content.push(await pdfBlock(d.src, '正答表'));
  for (const d of sheetDocs) content.push(await pdfBlock(d.src, '解答用紙'));
  content.push({ type: 'text', text:
`これは高校入試「${title}」の正答表${sheetDocs.length ? 'と解答用紙' : ''}です。
受験生が画面で答えを入力して採点できるように、すべての設問（解答欄）を問題の順番どおりに JSON にしてください。

- 1 つの解答欄を 1 項目にする。ただし「完答」の指示がある組は 1 項目にまとめ、answer に全部を書く。
- 配点は正答表に書かれたとおりに。書かれていなければ、合計が ${maxPoints} 点になるよう妥当に推定し pointsEstimated を true にする。
- answer は正答表の表記のまま（記号は「ア」など、数値は分数・根号もそのまま。根号は √ を使う）。
- 記述・作文・証明・英作文は kind を essay にし、answer に模範解答（または採点基準の要点）を書く。
- 「採点上の注意」や部分点の条件があれば criteria に書く。
- 英語のリスニング問題も含める。` });
  const { data, usage } = await jsonCall({
    system: 'あなたは高校入試の採点補助をする正確な事務担当です。正答表に書かれていないことを作らないでください。',
    content, schema: KEY_SCHEMA, effort: 'medium', onStatus,
  });
  data.source = 'ai';
  data.builtAt = Date.now();
  return { key: data, usage };
}

const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          read: { type: 'string', description: '受験生の答え（手書きなら読み取った内容。読めない・空欄なら空文字）' },
          points: { type: 'number' },
          verdict: { type: 'string', enum: ['ok', 'part', 'ng'] },
          comment: { type: 'string', description: '減点理由や良い点を 1〜2 文で' },
        },
        required: ['id', 'read', 'points', 'verdict', 'comment'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

// 入力された答え（記述など）を正答表・採点のポイントに照らして採点する
export async function gradeTyped({ title, items, answers, refDocs = [], onStatus }) {
  const content = [];
  for (const d of refDocs) content.push(await pdfBlock(d.src, d.label));
  const rows = items.map(it => ({ id: it.id, label: it.label, max: it.points, kind: it.kind, correct: it.answer,
    alts: it.alts, criteria: it.criteria, student: answers[it.id] ?? '' }));
  content.push({ type: 'text', text:
`高校入試「${title}」の答案です。各設問を、正答・別解・採点上の注意に従って採点してください。
- 表記ゆれ（全角半角、√ の書き方、分数の書き方、大文字小文字、句読点）は同じ答えとして扱う。
- 記述・英作文は採点基準に沿って部分点をつけてよい。points は 0〜max の範囲。
- 空欄は 0 点。read には受験生の答えをそのまま入れる。

${JSON.stringify(rows)}` });
  return jsonCall({ system: '公正で一貫した採点者として、正答表の基準どおりに採点します。', content, schema: GRADE_SCHEMA, effort: 'medium', onStatus });
}

// 手書きの解答用紙（画像）を読み取って採点する
export async function gradeHandwritten({ title, items, images, refDocs = [], onStatus }) {
  const content = [];
  for (const d of refDocs) content.push(await pdfBlock(d.src, d.label));
  images.forEach(im => content.push(imageBlock(im)));
  const rows = items.map(it => ({ id: it.id, label: it.label, max: it.points, kind: it.kind, correct: it.answer, alts: it.alts, criteria: it.criteria }));
  content.push({ type: 'text', text:
`画像は高校入試「${title}」の、受験生が手書きで答えを書き込んだ解答用紙です。
設問一覧の各項目について、解答用紙の該当欄に書かれた答えを読み取り（read）、正答と照らして採点してください。
- 読み取れない・空欄は read を空文字、0 点。
- 読み取りに自信がないものは comment に「読み取り不確か」と書く。
- マークシートは塗られた記号を読む。

設問一覧: ${JSON.stringify(rows)}` });
  return jsonCall({ system: '手書き文字の読み取りが得意な、公正な採点者です。読めないものを推測で正解扱いしないでください。', content, schema: GRADE_SCHEMA, effort: 'high', onStatus });
}

// ---------------------------------------------------------------- 解説チャット（ストリーミング）
export const TUTOR_SYSTEM = `あなたは高校受験生（中学3年生）の家庭教師です。偏差値60以上の高校を目指す生徒に、入試問題の解説をします。
- 正答は添付の正答表が正しいものとして扱う。正答表と自分の計算が食い違ったら、その旨を正直に伝える。
- 中学の範囲の考え方で、手順を飛ばさずに説明する。必要なら「なぜその方針を思いつくか」も書く。
- 数式は LaTeX を使わず、√ ² ³ × ÷ π ≦ ≧ などの記号と、分数は a/b の形で書く。
- 国語は本文のどこが根拠かを引用して示す（引用は短く）。英語は該当箇所の和訳と文法のポイントを示す。
- 見出し・箇条書き（Markdown）で読みやすく。長すぎないように。`;

export async function streamChat({ context, history, onText, onDone, effort = 'high', signal }) {
  const c = client();
  const messages = [{ role: 'user', content: context }, { role: 'assistant', content: 'はい、添付の問題・正答表・あなたの結果を読みました。何でも聞いてください。' }, ...history];
  const stream = c.beta.messages.stream(params({
    max_tokens: 32000,
    system: TUTOR_SYSTEM,
    output_config: { effort },
    messages,
  }), { signal });
  let text = '';
  stream.on('text', t => { text += t; onText && onText(text); });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') text += '\n\n（AI が回答を控えました）';
  onDone && onDone(text, msg.usage);
  return text;
}

// 料金の目安（1 回分）。ドル → 円は大まかに 150 円で計算
const PRICE = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };
export function costYen(usage, model = settings.get('model', 'claude-opus-5-5')) {
  if (!usage) return 0;
  const [pi, po] = PRICE[model] || PRICE['claude-opus-5-5'];
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  const usd = inTok / 1e6 * pi + (usage.output_tokens || 0) / 1e6 * po;
  return usd * 150;
}
