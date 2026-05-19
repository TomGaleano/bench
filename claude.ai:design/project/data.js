/* data.js — shared mock data */
window.MODELS = [
  { id: "claude-sonnet-4.5",  short: "sonnet-4.5",   vendor: "Anthropic",  cost_in:  3.0, cost_out: 15.0 },
  { id: "claude-opus-4.1",    short: "opus-4.1",     vendor: "Anthropic",  cost_in: 15.0, cost_out: 75.0 },
  { id: "claude-haiku-4.5",   short: "haiku-4.5",    vendor: "Anthropic",  cost_in:  0.8, cost_out:  4.0 },
  { id: "gpt-5",              short: "gpt-5",        vendor: "OpenAI",     cost_in:  5.0, cost_out: 20.0 },
  { id: "gpt-5-mini",         short: "gpt-5-mini",   vendor: "OpenAI",     cost_in:  0.5, cost_out:  2.0 },
  { id: "o4",                 short: "o4",           vendor: "OpenAI",     cost_in: 15.0, cost_out: 60.0 },
  { id: "gemini-2.5-pro",     short: "gemini-2.5",   vendor: "Google",     cost_in:  2.5, cost_out: 10.0 },
  { id: "gemini-2.5-flash",   short: "g2.5-flash",   vendor: "Google",     cost_in:  0.3, cost_out:  1.2 },
  { id: "deepseek-v3.2",      short: "ds-v3.2",      vendor: "DeepSeek",   cost_in:  0.27, cost_out: 1.1 },
  { id: "qwen3-coder-480b",   short: "qwen3-coder",  vendor: "Alibaba",    cost_in:  0.4,  cost_out: 1.6 },
  { id: "grok-4",             short: "grok-4",       vendor: "xAI",        cost_in:  3.0,  cost_out: 15.0 },
  { id: "llama-4-maverick",   short: "llama-4-mav",  vendor: "Meta",       cost_in:  0.6,  cost_out: 2.4 },
];

window.TASKS = [
  { id: "django__django-14238",       repo: "django/django",                  diff: "M",  files: 4, lines: 64,  fail: 2,  pass: 218 },
  { id: "django__django-15814",       repo: "django/django",                  diff: "L",  files: 7, lines: 142, fail: 5,  pass: 412 },
  { id: "sympy__sympy-21055",         repo: "sympy/sympy",                    diff: "S",  files: 2, lines: 28,  fail: 1,  pass: 91  },
  { id: "scikit-learn__scikit-13241", repo: "scikit-learn/scikit-learn",      diff: "M",  files: 3, lines: 55,  fail: 3,  pass: 187 },
  { id: "matplotlib__matplotlib-23314", repo: "matplotlib/matplotlib",        diff: "L",  files: 5, lines: 178, fail: 4,  pass: 256 },
  { id: "astropy__astropy-12907",     repo: "astropy/astropy",                diff: "S",  files: 1, lines: 18,  fail: 2,  pass: 74  },
  { id: "pytest-dev__pytest-7373",    repo: "pytest-dev/pytest",              diff: "M",  files: 3, lines: 71,  fail: 4,  pass: 162 },
  { id: "pylint-dev__pylint-7080",    repo: "pylint-dev/pylint",              diff: "S",  files: 2, lines: 36,  fail: 2,  pass: 145 },
  { id: "psf__requests-2317",         repo: "psf/requests",                   diff: "S",  files: 1, lines: 12,  fail: 1,  pass: 89  },
  { id: "sphinx-doc__sphinx-8801",    repo: "sphinx-doc/sphinx",              diff: "M",  files: 4, lines: 96,  fail: 3,  pass: 198 },
  { id: "django__django-13447",       repo: "django/django",                  diff: "S",  files: 1, lines: 22,  fail: 1,  pass: 312 },
  { id: "sympy__sympy-18621",         repo: "sympy/sympy",                    diff: "M",  files: 3, lines: 84,  fail: 6,  pass: 102 },
  { id: "scikit-learn__scikit-25500", repo: "scikit-learn/scikit-learn",      diff: "L",  files: 6, lines: 215, fail: 7,  pass: 244 },
  { id: "django__django-16139",       repo: "django/django",                  diff: "S",  files: 2, lines: 31,  fail: 2,  pass: 287 },
  { id: "matplotlib__matplotlib-26011", repo: "matplotlib/matplotlib",        diff: "M",  files: 3, lines: 67,  fail: 3,  pass: 221 },
  { id: "pytest-dev__pytest-11143",   repo: "pytest-dev/pytest",              diff: "S",  files: 2, lines: 41,  fail: 2,  pass: 158 },
];

window.STATES = ["queued","preparing","planning","judging","implementing","evaluating","resolved","failed","timeout","cancelled"];

window.LEADERBOARD = [
  { model: "claude-sonnet-4.5",  harness: "pi-react/1.4·50t", plan: 78.4, impl: 56.2, e2e: 51.8, costTask: 0.42, costRes: 0.81, lat: 142, ver: "swe-v25.04", trend:[42,46,48,49,52,56], delta:+2.1 },
  { model: "claude-opus-4.1",    harness: "pi-plan+impl·0.9", plan: 81.2, impl: 58.7, e2e: 54.6, costTask: 1.84, costRes: 3.37, lat: 188, ver: "swe-v25.04", trend:[40,44,49,52,55,58], delta:+1.4 },
  { model: "gpt-5",              harness: "pi-react/1.4·50t", plan: 76.8, impl: 53.4, e2e: 48.9, costTask: 0.71, costRes: 1.45, lat: 134, ver: "swe-v25.04", trend:[38,42,46,49,51,53], delta:+0.8 },
  { model: "o4",                 harness: "pi-react/1.4·50t", plan: 79.5, impl: 51.7, e2e: 47.2, costTask: 1.92, costRes: 4.07, lat: 219, ver: "swe-v25.04", trend:[36,41,45,48,50,51], delta:-0.3 },
  { model: "gemini-2.5-pro",     harness: "pi-react/1.4·50t", plan: 74.3, impl: 49.8, e2e: 45.1, costTask: 0.38, costRes: 0.84, lat: 121, ver: "swe-v25.04", trend:[34,38,42,46,48,49], delta:+1.7 },
  { model: "grok-4",             harness: "pi-react/1.4·50t", plan: 71.2, impl: 46.8, e2e: 42.3, costTask: 0.58, costRes: 1.37, lat: 156, ver: "swe-v25.04", trend:[30,35,38,42,44,46], delta:-0.2 },
  { model: "claude-haiku-4.5",   harness: "pi-react/1.4·30t", plan: 68.1, impl: 44.6, e2e: 39.8, costTask: 0.11, costRes: 0.28, lat: 94,  ver: "swe-v25.04", trend:[28,32,36,40,42,44], delta:+0.9 },
  { model: "qwen3-coder-480b",   short: "qwen3-coder",        plan: 65.8, impl: 42.1, e2e: 37.6, costTask: 0.06, costRes: 0.16, lat: 117, ver: "swe-v25.04", trend:[24,29,33,37,39,42], delta:+0.7, harness: "pi-react/1.4·50t" },
  { model: "gpt-5-mini",         harness: "pi-react/1.4·30t", plan: 64.7, impl: 41.3, e2e: 36.4, costTask: 0.07, costRes: 0.19, lat: 88,  ver: "swe-v25.04", trend:[26,30,33,37,39,41], delta:+0.4 },
  { model: "deepseek-v3.2",      harness: "pi-react/1.4·50t", plan: 62.4, impl: 38.9, e2e: 33.7, costTask: 0.04, costRes: 0.12, lat: 102, ver: "swe-v25.04", trend:[22,26,30,33,36,38], delta:+1.2 },
  { model: "gemini-2.5-flash",   harness: "pi-react/1.4·30t", plan: 58.3, impl: 35.4, e2e: 30.1, costTask: 0.03, costRes: 0.10, lat: 71,  ver: "swe-v25.04", trend:[20,24,28,30,33,35], delta:+0.6 },
  { model: "llama-4-maverick",   harness: "pi-react/1.4·50t", plan: 56.4, impl: 31.2, e2e: 26.8, costTask: 0.09, costRes: 0.34, lat: 108, ver: "swe-v25.04", trend:[18,22,25,27,29,31], delta:+0.3 },
];

window.fmt = {
  cost: (n) => "$" + (n < 0.01 ? n.toFixed(4) : n.toFixed(2)),
  pct:  (n) => n.toFixed(1) + "%",
  num:  (n) => n.toLocaleString(),
  k:    (n) => n >= 1000 ? (n/1000).toFixed(1)+"k" : ""+n,
};
window.modelById = (id) => window.MODELS.find(m => m.id === id) || { id, short: id };
