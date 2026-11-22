// SKILLS of Nova (and Nova 2, which replaces it) ONLY (owner 2026-11-22: every model is independent, a red line: this file is Nova (and Nova 2, which replaces it)'s own copy, edited on its own, shared with no other model): short, exact how-tos the model loads with the `skill` tool before a kind of work it does not do every day (the idea behind the "skills" of the largest assistants:
// a procedure on demand instead of a fact the weights must hold). Each one names the tools to call, in order, with real arguments. Plain text, no network, no secrets.
export const NOVA_SKILLS: Record<string, { title: string; when: string; steps: string }> = {
  pdf: {
    title: "Read or make a PDF", when: "the user gives a PDF to read, or wants a PDF file",
    steps: "Read: computer_run command=\"pip install -q pypdf && python3 -c \\\"import pypdf;r=pypdf.PdfReader('f.pdf');print(len(r.pages));print(r.pages[0].extract_text()[:3000])\\\"\". Scanned PDF (no text): computer_run \"pdftotext -layout f.pdf - | head -200\" or OCR with tesseract if installed.\nMake: computer_write report.py using reportlab (pip install -q reportlab; canvas.Canvas('out.pdf'); drawString; save), computer_run \"python3 report.py\", then send_file path=out.pdf. Arabic text needs arabic-reshaper + python-bidi and an Arabic TTF font.",
  },
  word: {
    title: "Make or edit a Word document", when: "the user wants a .docx",
    steps: "computer_run \"pip install -q python-docx\"; computer_write make_doc.py: from docx import Document; d=Document(); d.add_heading('العنوان',0); d.add_paragraph('النص'); d.add_table(rows,cols); d.save('out.docx'); computer_run \"python3 make_doc.py\"; send_file path=out.docx. To edit an existing file open Document('in.docx'), change paragraphs, save under a new name.",
  },
  spreadsheet: {
    title: "Read, analyse or make a spreadsheet", when: "the user gives an .xlsx/.csv or wants one",
    steps: "computer_run \"pip install -q pandas openpyxl\"; computer_write job.py: import pandas as pd; df=pd.read_excel('in.xlsx') (or read_csv); print(df.head(), df.describe()); df.to_excel('out.xlsx',index=False). Run it with computer_run, read the printed result, answer from the numbers (never guess), then send_file path=out.xlsx if a file was asked for.",
  },
  presentation: {
    title: "Make a slide deck", when: "the user wants a .pptx presentation",
    steps: "computer_run \"pip install -q python-pptx\"; computer_write deck.py: from pptx import Presentation; p=Presentation(); s=p.slides.add_slide(p.slide_layouts[1]); s.shapes.title.text='العنوان'; s.placeholders[1].text='النقاط'; p.save('deck.pptx'); one slide per idea, at most 6 bullets; computer_run \"python3 deck.py\"; send_file path=deck.pptx.",
  },
  chart: {
    title: "Draw a chart", when: "the user wants a graph/plot of data",
    steps: "computer_run \"pip install -q matplotlib\"; computer_write plot.py: import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt; plt.plot(x,y); plt.title('..'); plt.xlabel('..'); plt.savefig('chart.png',dpi=150,bbox_inches='tight'); computer_run \"python3 plot.py\"; send_file path=chart.png caption=what it shows. Label axes and units; one message of explanation, not a long one.",
  },
  scrape: {
    title: "Collect data from web pages", when: "the user wants facts or lists from a site",
    steps: "1) fetch_page url=<page> to read it. 2) If the page needs clicks/typing/JavaScript use browser action=open url=<page>, then browser action=look to get numbered elements, browser action=click id=<n>. 3) For many pages write a small script with requests+bs4 (computer_run \"pip install -q requests beautifulsoup4\"), save results to a CSV, read it back. Respect robots.txt and rate limits; never log in with the user's secrets.",
  },
  git: {
    title: "Change a repository and publish it", when: "the user wants code changed in a GitHub repository",
    steps: "1) computer_repo url=https://github.com/<owner>/<name>. 2) computer_read / computer_search to understand the code. 3) change it: computer_edit for small exact edits, computer_patch for a multi-file diff. 4) computer_test cwd=repos/<owner>-<name>, then computer_job action=log id=<job> until TESTS_EXIT=0. 5) computer_publish repo=<owner>/<name> branch=<new-branch> message=<what and why>; the user confirms. Never claim it is published before the confirmation.",
  },
  debug: {
    title: "Find and fix a bug", when: "something fails, throws an error or gives a wrong result",
    steps: "1) Reproduce first: computer_run the failing command and read the real error. 2) Locate: computer_search the error text or function name, computer_read the file around it. 3) Form ONE hypothesis and change the smallest thing (computer_edit). 4) Run the same command again; if it still fails read the NEW error, do not repeat the same edit. 5) Run the project's tests (computer_test) so the fix breaks nothing. Report what was wrong, what you changed, and the test result you saw.",
  },
  research: {
    title: "Research a question with sources", when: "the user asks something that needs current or checked facts",
    steps: "1) deep_research question=<the question> (or web_search then fetch_page for 2-3 sources). 2) Compare what the sources say; note disagreements. 3) Answer in the user's language: the answer first, then the evidence with the source names/links. Say plainly what you could not confirm. Use memory_save only for durable facts the user would want next time.",
  },
  plan: {
    title: "Plan a long task", when: "the task has more than three steps",
    steps: "Call plan first with items [{step, status:'pending'}...], do one step, call plan again marking it done/doing, and finish by checking every item. If a step fails, change the plan (add the fix step) instead of ignoring it. Keep each step short and verifiable.",
  },
  design: {
    title: "Design a page, app screen or UI with a real point of view", when: "the user wants a web page, landing page, dashboard, Mini App screen or any visual UI built or restyled",
    steps: "Before any code write a SHORT design plan: 1) the subject, the audience and the page's one job (ask the user in one line if unclear); 2) a token set: 4-6 named hex colors, the typefaces and their roles (one family or two clearly different ones, not the default family you would use anywhere), the layout idea in one sentence plus a small ASCII wireframe, and the one thing that will be memorable. 3) Review the plan against the brief: if a part would look the same for any similar page, change it and say what you changed. The user's own words always win over these rules. AVOID the generic defaults: cream background + serif + terracotta accent; near-black + one acid-green accent; identical rounded cards with the same soft shadow and gradient washes; an ALL-CAPS eyebrow above every heading; numbered 01/02/03 markers on content that is not a sequence; one word of a headline in a different color; fade-up on every section; '→' on every button. Spend boldness in ONE place and keep the rest quiet. Open with the most characteristic thing of the subject (a headline, image, live demo or number), not a stock hero. Type: line length under 80 characters, a clear scale, sentence case. Motion only where it answers a user action or draws one deliberate moment. Quality floor without announcing it: responsive to a phone width, visible keyboard focus, prefers-reduced-motion respected, enough contrast. For Arabic set dir=\"rtl\" and lang=\"ar\", use a font with real Arabic glyphs, and mirror the layout. Words are design: buttons say what happens ('Save changes' not 'Submit'), errors say what went wrong and how to fix it without apologising, empty screens invite an action. Build it (computer_write the files), open it with the browser tool at phone width and desktop width, fix what looks wrong, then tell the user the choices you made in three lines.",
  },
  logo: {
    title: "Brief a logo or brand mark (and prompt the image tool for it)", when: "the user wants a logo, icon, app icon, favicon or brand mark",
    steps: "Ask or decide first: the name (spelled exactly), what it does, the audience, three feel-words, and where it will be used (app icon, header, print). Design rules: it must still read at 16 px and in one color; one idea, not a collage; a simple geometric base (letterform, symbol or both) with at most 2 colors plus neutral; no photo detail, no gradients that break in print, no tiny text; leave clear space around it; check it on both a light and a dark background. Give 3 distinct directions (wordmark, symbol, combination) in one line each, let the user pick, then refine ONE. For make_media write the prompt in English as: 'flat vector logo of <symbol idea> for <name>, <style words>, <2 colors named>, centered on a plain white background, simple shapes, no text' - never ask the image model to render long words (it garbles letters): add the name afterwards as real text in an SVG or HTML file with computer_write, and send_file it. Offer the variants: icon only, horizontal lockup, one-color version, dark-background version.",
  },
  self_test: {
    title: "Test yourself for real on a repository and report what is missing", when: "the user asks you to test, audit or evaluate yourself, your abilities or your structure",
    steps: "Never answer from memory: PROVE each ability with a real call and report the real result. 1) tools: call computer_tools and list the groups you actually have. 2) computer: computer_run command=\"uname -a && python3 --version && node --version; git --version\", then computer_write a file and computer_read it back. 3) repo: computer_repo url=<the repo the user named, else the last one used>, then computer_search pattern=TODO, computer_run the project's tests (computer_test). 4) GitHub: github_whoami, github_repo_info, github_ci_status on the default branch. 5) web: web_search a one-line query and fetch_page one result. 6) memory: memory_save a test fact, memory_search it back, memory_forget it. 7) skills: load review, security and performance and run their checks on one real file. 8) speed: note the seconds each step took. Report a table: ability | tried how | result (ok/failed/slow, the real error text) | what is needed to fix it. Say plainly what failed; do not claim an ability you did not just prove. End with 3 concrete improvements ranked by value."
  },
  review: {
    title: "Review code quality before delivering it", when: "you wrote or changed code and are about to deliver it, or the user asks for a code review",
    steps: "1) Re-read your own diff: computer_run command=\"git diff\" (or computer_read each changed file). 2) Check, and fix what you find: correctness on edge cases (empty, None, huge, unicode), error handling that is not swallowed, names and comments that say why, no dead code, no duplicated blocks, no hard-coded secrets or paths. 3) Run the linters the project has: Python `pip install -q ruff && ruff check .`; JS/TS `npx eslint .` and `npx tsc --noEmit`; Go `go vet ./...`; shell `shellcheck`. 4) Run the tests (computer_test); if none cover the change, write one that fails without it and passes with it. 5) In the answer list what you changed, what you verified (the real command and its result) and what you could not verify. Never say \"works\" without a command that showed it."
  },
  security: {
    title: "Find security problems in a repository", when: "the user asks about security or vulnerabilities, or before publishing code that handles users, money, tokens or files",
    steps: "1) Secrets: computer_search pattern=\"(api[_-]?key|secret|token|passwd|password|BEGIN (RSA|PRIVATE))\" and check .env files and git history (computer_run \"git log -p -S<value>\" only with a value you found). Never print a secret in the answer: name the file and line. 2) Dependencies: Python `pip install -q pip-audit && pip-audit -r requirements.txt`; Node `npm audit --omit=dev`; Go `govulncheck ./...`. 3) Code patterns: Python `pip install -q bandit && bandit -r . -ll`; look by hand for string-built SQL, shell=True / exec / eval with user input, unsafe deserialisation (pickle, yaml.load), missing auth checks on routes, open CORS, path traversal in file names, user input in HTML without escaping. 4) Report by severity (high/medium/low) with file:line, why it is exploitable and the smallest fix; offer to apply the fixes. Say what you did not check."
  },
  performance: {
    title: "Measure speed and complexity, then optimise only what is slow", when: "code or a request is slow, or the user asks about complexity, performance or Big-O",
    steps: "1) Measure first: computer_run command=\"time <the command>\" and, for Python, `python3 -m cProfile -s cumtime script.py | head -30`; Node `node --prof`; for pages, curl -w \"%{time_total}\". 2) Complexity: `pip install -q radon && radon cc -s -a <path>` lists complex functions; reason about loops inside loops, repeated work, string concatenation in loops, N+1 queries, reading a file or API many times. State the Big-O of the hot path. 3) Change ONE thing (cache, a set/dict instead of a list scan, batch the calls, stream instead of load all) and measure again; keep it only if the number improved and the tests still pass. 4) Report before/after numbers, not impressions."
  },
  architecture: {
    title: "Understand and review a project's structure and design", when: "the user asks about architecture, structure, how the parts connect, or a design review",
    steps: "1) Map: computer_repo, then computer_run command=\"git ls-files | head -200\" and read README and the manifests (package.json, pyproject, go.mod). 2) Entry points and flow: computer_search for main, routes, handlers, workers, schedulers; follow one request end to end. 3) Dependencies between folders (who imports whom) and where state lives (database, files, caches). 4) Write a short design note: components, data flow, the 3 riskiest places (coupling, duplicated logic, missing tests, unclear ownership) and a prioritised list of improvements, each with the files it touches. 5) Offer to do the first improvement as a small, tested change."
  },
  practices: {
    title: "Best-practice template for the language at hand", when: "you start new code or review code in Python, JavaScript/TypeScript, Go, Java, C++ or shell",
    steps: "Python: type hints, pathlib, f-strings, dataclasses, context managers, no mutable default args, `if __name__ == \"__main__\"`, pytest, ruff+black. JS/TS: strict TypeScript, const/let, async/await with try/catch, no unhandled promises, validate input (zod), eslint+prettier, tests with jest/vitest. Go: errors returned and wrapped (%w), small interfaces, context.Context first, table-driven tests, gofmt+go vet. Java: immutability, Optional not null, try-with-resources, streams only when clearer, JUnit. C++: RAII and smart pointers, const correctness, no raw new/delete, std algorithms, sanitizers (-fsanitize=address,undefined). Shell: `set -euo pipefail`, quote every variable, shellcheck, no parsing ls. All: small functions, one job each; validate input at the edges; log errors with context; no secrets in code; a test for every bug you fix."
  },
  freshness: {
    title: "Check the current version and docs of a library before using it", when: "you use a library, framework or API whose latest version or syntax you are not sure of",
    steps: "Do not trust memory for versions. Python: computer_run \"pip index versions <pkg> | head -3\" or `pip install -q <pkg> && pip show <pkg>`; Node: `npm view <pkg> version dist-tags`; then fetch_page the package's official docs or release notes (web_search \"<pkg> release notes <year>\") and check that the functions you call exist in that version (python -c \"import <pkg>; help(<pkg>.<fn>)\"). If the project pins a version, follow the pin and say if a newer one exists."
  },
  mistakes: {
    title: "Learn from your own mistakes and corrections", when: "a command or test failed, the user corrected you, or you are about to start a task similar to an earlier one",
    steps: "Before similar work: memory_search query=\"lesson <topic>\" and apply what it says. After a real failure or a correction: find the root cause (not the symptom), then memory_save text=\"lesson: <what went wrong> -> <the rule that prevents it>\" (one line, concrete, with the tool or command involved). Do not save guesses or anything private. If the same lesson was saved before and you repeated the mistake, say so and make the rule more specific."
  },
  deliver: {
    title: "Self-review checklist before you hand over any result", when: "you are about to give the final answer of a task",
    steps: "1) Did I do exactly what was asked, nothing else? Re-read the request. 2) Is every claim backed by a real tool result in this task (a command output, a file I read, a page I fetched)? Remove or mark any claim that is not. 3) For code: it ran, the tests ran, the linter ran (skill review). 4) For files: they exist where I say (computer_read / computer_run ls). 5) Anything I could not finish or verify is stated plainly with the reason. 6) The answer is short, in the user's language, the result first."
  },
  data: {
    title: "Analyse data", when: "the user gives numbers/logs/CSV and wants conclusions",
    steps: "Load it with pandas in a script (computer_write + computer_run), print shape, columns, head, describe, missing values; compute exactly what was asked; print the results; answer ONLY from printed numbers and say the sample size. Offer a chart (skill chart) when a picture helps.",
  },
};

export function novaSkillText(name: string): string {
  const key = String(name || "").trim().toLowerCase();
  const s = NOVA_SKILLS[key];
  if (!s) return `unknown skill "${key}". Available: ${Object.entries(NOVA_SKILLS).map(([k, v]) => `${k} (${v.when})`).join("; ")}`;
  return `SKILL ${key}: ${s.title}\nUse when: ${s.when}\n${s.steps}`;
}

export const NOVA_SKILL_NAMES = Object.keys(NOVA_SKILLS);
