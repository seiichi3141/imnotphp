'use strict';

/* ---------- 自己診断 ---------- */
(function diagnose() {
  const path = location.pathname;
  const address = document.getElementById('address');
  const i = path.indexOf('.php');
  address.textContent = '';
  if (i >= 0) {
    const mark = document.createElement('mark');
    mark.textContent = '.php';
    address.append(path.slice(0, i), mark, path.slice(i + 4));
  } else {
    address.textContent = path;
  }
  const set = (id, text) => { document.getElementById(id).textContent = text; };
  set('d-url', i >= 0 ? 'あり（文字列として）' : 'なし（おかしいですね）');

  fetch(location.href, { method: 'HEAD', cache: 'no-store' })
    .then((res) => {
      const powered = res.headers.get('x-powered-by');
      set('d-server', res.headers.get('server') || '（非公開）');
      set('d-type', res.headers.get('content-type') || '（不明）');
      set('d-power', powered || 'なし');
      set('d-verdict', /php/i.test(powered || '')
        ? 'PHPのようです。何かがおかしいです'
        : 'PHPではありません');
    })
    .catch(() => {
      ['d-server', 'd-type', 'd-power'].forEach((id) => set(id, '確認できませんでした'));
      set('d-verdict', 'それでもPHPではありません');
    });
})();

/* ---------- PHPの文法に準拠した処理（PHPではない） ---------- */
class NotPhpError extends Error {}

const NOT_IMPLEMENTED = /^(if|else|elseif|for|foreach|while|do|switch|function|fn|class|interface|trait|try|match|return|namespace|use|new)$/i;
const FORBIDDEN = {
  phpinfo: 'phpinfo() はありません。PHPではないので、お見せできる情報がありません。',
  phpversion: 'phpversion() はありません。バージョンという概念以前に、PHPではありません。',
  eval: 'eval() はありません。ご安心ください。',
  system: 'system() はありません。ここはブラウザの中です。サーバーには何も届きません。',
  exec: 'exec() はありません。ここはブラウザの中です。',
  shell_exec: 'shell_exec() はありません。シェルもありません。',
  passthru: 'passthru() はありません。通り抜ける先もありません。',
  include: 'include はありません。読み込めるPHPファイルが存在しません。',
  require: 'require はありません。必要とされていません。',
  mysqli_connect: 'mysqli_connect() はありません。データベースもありません。',
};

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('//', i) || c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    let m;
    const rest = src.slice(i);
    if ((m = /^\$[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
      tokens.push({ t: 'var', v: m[0].slice(1) });
    } else if ((m = /^\d+(\.\d+)?/.exec(rest))) {
      tokens.push({ t: 'num', v: Number(m[0]) });
    } else if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
      tokens.push({ t: 'id', v: m[0] });
    } else if (c === '"' || c === "'") {
      const end = readString(src, i);
      const raw = src.slice(i + 1, end);
      tokens.push(c === '"' ? { t: 'dq', v: raw } : { t: 'sq', v: raw.replace(/\\(['\\])/g, '$1') });
      i = end + 1;
      continue;
    } else if ('=.+-*/(),;'.includes(c)) {
      tokens.push({ t: c });
      i++;
      continue;
    } else {
      throw new NotPhpError(`Parse error: 「${c}」は解釈できません。対応する文法を限定しております。`);
    }
    i += m[0].length;
  }
  return tokens;
}

function readString(src, start) {
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === src[start]) return i;
  }
  throw new NotPhpError('Parse error: 文字列が閉じられていません。');
}

function toText(v) { return typeof v === 'number' ? String(v) : v; }

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (/^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  throw new NotPhpError(`TypeError: 「${v}」で計算はできません。本家PHPの挙動も再現しておりません。`);
}

function byteLength(s) { return new TextEncoder().encode(s).length; }

const BUILTINS = {
  strlen: (s) => byteLength(toText(s)),
  strtoupper: (s) => toText(s).replace(/[a-z]/g, (c) => c.toUpperCase()),
  strtolower: (s) => toText(s).replace(/[A-Z]/g, (c) => c.toLowerCase()),
  str_repeat: (s, n) => {
    const count = toNumber(n);
    if (count < 0 || count > 1000) throw new NotPhpError('str_repeat() の回数は0〜1000に限定しております。');
    return toText(s).repeat(count);
  },
};

function run(source) {
  let src = source.trim();
  if (src.startsWith('<?php')) src = src.slice(5);
  if (src.endsWith('?>')) src = src.slice(0, -2);

  const tokens = tokenize(src);
  const vars = Object.create(null);
  let pos = 0;
  let out = '';
  const peek = (t) => tokens[pos] && tokens[pos].t === t;
  const accept = (t) => (peek(t) ? tokens[pos++] : null);
  const expect = (t, label) => {
    if (!accept(t)) throw new NotPhpError(`Parse error: ${label} が必要です。ここはPHPに準拠しています。`);
  };

  const lookup = (name) => {
    if (name in vars) return vars[name];
    out += `Warning: 変数 $${name} は未定義です。\n`;
    return '';
  };

  const interpolate = (s) => s.replace(/\\(n|t|"|\\|\$)|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, esc, name) => (
    esc ? ({ n: '\n', t: '\t' }[esc] ?? esc) : toText(lookup(name))
  ));

  function primary() {
    const tok = tokens[pos++];
    if (!tok) throw new NotPhpError('Parse error: コードが途中で終わっています。');
    if (tok.t === 'num' || tok.t === 'sq') return tok.v;
    if (tok.t === 'dq') return interpolate(tok.v);
    if (tok.t === 'var') return lookup(tok.v);
    if (tok.t === '(') {
      const v = concat();
      expect(')', '「)」');
      return v;
    }
    if (tok.t === 'id') {
      const name = tok.v.toLowerCase();
      if (FORBIDDEN[name]) throw new NotPhpError(`Fatal error: ${FORBIDDEN[name]}`);
      if (NOT_IMPLEMENTED.test(name)) {
        throw new NotPhpError(`Fatal error: ${tok.v} は未実装です。ページの提供に必要な機能に限定しております。`);
      }
      if (name === 'true') return 1;
      if (name === 'false' || name === 'null') return '';
      const fn = Object.prototype.hasOwnProperty.call(BUILTINS, name) ? BUILTINS[name] : null;
      if (!fn) throw new NotPhpError(`Fatal error: ${tok.v}() は未実装です。PHP本体の実装は流用していません。`);
      expect('(', '「(」');
      const args = [];
      if (!peek(')')) {
        do { args.push(concat()); } while (accept(','));
      }
      expect(')', '「)」');
      if (args.length !== fn.length) throw new NotPhpError(`Fatal error: ${tok.v}() の引数は${fn.length}個です。`);
      return fn(...args);
    }
    throw new NotPhpError('Parse error: ここには値が必要です。');
  }

  function unary() {
    if (accept('-')) return -toNumber(unary());
    return primary();
  }

  function term() {
    let v = unary();
    while (peek('*') || peek('/')) {
      const op = tokens[pos++].t;
      const r = toNumber(unary());
      if (op === '/' && r === 0) throw new NotPhpError('DivisionByZeroError: 0では割れません。ここはPHPと同じです。');
      v = op === '*' ? toNumber(v) * r : toNumber(v) / r;
    }
    return v;
  }

  function sum() {
    let v = term();
    while (peek('+') || peek('-')) {
      const op = tokens[pos++].t;
      const r = toNumber(term());
      v = op === '+' ? toNumber(v) + r : toNumber(v) - r;
    }
    return v;
  }

  function concat() {
    let v = sum();
    while (accept('.')) v = toText(v) + toText(sum());
    return v;
  }

  try {
    while (pos < tokens.length) {
      if (accept(';')) continue;
      const tok = tokens[pos];
      if (tok.t === 'id' && (tok.v.toLowerCase() === 'echo' || tok.v.toLowerCase() === 'print')) {
        pos++;
        do { out += toText(concat()); } while (accept(','));
      } else if (tok.t === 'var' && tokens[pos + 1] && tokens[pos + 1].t === '=') {
        pos += 2;
        vars[tok.v] = concat();
      } else {
        concat();
      }
      expect(';', '「;」');
    }
  } catch (e) {
    if (e instanceof NotPhpError) e.partial = out;
    throw e;
  }
  return out;
}

/* ---------- 画面 ---------- */
const SAMPLES = {
  hello: `<?php\n$name = "このページ";\necho "$name はPHPではありません\\n";\necho "URLの" . ".php" . "は文字列です";\n?>`,
  len: `<?php\n$ext = ".php";\necho "「" . $ext . "」の長さ: " . strlen($ext) . "バイト\\n";\necho "PHPの使用量: " . 0 * 100 . "%";\n?>`,
  info: `<?php\nphpinfo();\n?>`,
  loop: `<?php\nfor ($i = 0; $i < 3; $i++) {\n  echo "PHP";\n}\n?>`,
  sys: `<?php\nsystem("cat /etc/passwd");\n?>`,
};

const code = document.getElementById('code');
const output = document.getElementById('output');

function execute() {
  output.textContent = '';
  try {
    output.textContent = run(code.value) || '（出力はありません）';
  } catch (e) {
    if (!(e instanceof NotPhpError)) throw e;
    if (e.partial) output.append(e.partial);
    const line = document.createElement('span');
    line.className = 'err';
    line.textContent = e.message;
    output.append(line);
  }
}

document.querySelectorAll('[data-sample]').forEach((button) => {
  button.addEventListener('click', () => {
    code.value = SAMPLES[button.dataset.sample];
    execute();
  });
});
document.getElementById('run').addEventListener('click', execute);
code.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    execute();
  }
});

code.value = SAMPLES.hello;
execute();
