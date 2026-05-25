export type PlaygroundTemplate = {
  id: string;
  name: string;
  meta: string;
  prompt: string;
};

export const PLAYGROUND_TEMPLATES: PlaygroundTemplate[] = [
  {
    id: "flask-todo",
    name: "Flask todo app w/ SQLite",
    meta: "web · python · 4 models",
    prompt:
      "Build a Flask web app that lets users track LeetCode problems they've solved. Use SQLite for persistence with three columns: problem name, difficulty (easy/medium/hard), and date solved. Add a /stats route returning counts by difficulty. Tailwind via CDN for styling. Bind to 0.0.0.0 on the assigned port.",
  },
  {
    id: "tailwind-landing",
    name: "Static landing page · Tailwind",
    meta: "html · 3 models",
    prompt:
      "Build a static one-page landing for a fictional product called \"Loomstack\". Hero with headline + sub + CTA, three feature cards with icons, footer. Tailwind via CDN. No JS framework. Serve with `python -m http.server` on the assigned port.",
  },
  {
    id: "bash-log-digest",
    name: "Bash script — log digest",
    meta: "cli · 5 models",
    prompt:
      "Write a single bash script `digest.sh` that reads a syslog file from stdin (or a path argument), extracts unique error lines, groups them by signature, and prints a hourly summary. Include a small generated sample log to demo against and a usage line.",
  },
  {
    id: "leetcode-median",
    name: "LeetCode median-of-two-arrays",
    meta: "algo · 5 models",
    prompt:
      "Solve LeetCode 4: Median of Two Sorted Arrays in O(log(min(m, n))) time. Provide the algorithm in Python with full proof in comments, plus a tiny CLI that accepts two JSON arrays and prints the median.",
  },
  {
    id: "csv-chart",
    name: "CSV → matplotlib chart",
    meta: "data · 4 models",
    prompt:
      "Generate a small `sales.csv` (region, month, revenue) and a Python script that reads it and writes `chart.png` — a matplotlib bar chart of revenue by region. Print the path to the file. Use only stdlib + matplotlib.",
  },
  {
    id: "fastapi-auth",
    name: "FastAPI auth boilerplate",
    meta: "backend · 4 models",
    prompt:
      "FastAPI auth boilerplate with signup, login, JWT-bearer, and `/me`. Use SQLAlchemy + SQLite (dependency-injected session). Provide a Postman-friendly README and a curl smoke-test. Bind to 0.0.0.0 on the assigned port.",
  },
];
