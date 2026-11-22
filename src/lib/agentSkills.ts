// SKILLS (shared by Sham, Sham v2 and Nova): short, exact how-tos the model loads with the `skill` tool before a kind of work it does not do every day (the idea behind the "skills" of the largest assistants:
// a procedure on demand instead of a fact the weights must hold). Each one names the tools to call, in order, with real arguments. Plain text, no network, no secrets.
export const AGENT_SKILLS: Record<string, { title: string; when: string; steps: string }> = {
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
  data: {
    title: "Analyse data", when: "the user gives numbers/logs/CSV and wants conclusions",
    steps: "Load it with pandas in a script (computer_write + computer_run), print shape, columns, head, describe, missing values; compute exactly what was asked; print the results; answer ONLY from printed numbers and say the sample size. Offer a chart (skill chart) when a picture helps.",
  },
};

export function agentSkillText(name: string): string {
  const key = String(name || "").trim().toLowerCase();
  const s = AGENT_SKILLS[key];
  if (!s) return `unknown skill "${key}". Available: ${Object.entries(AGENT_SKILLS).map(([k, v]) => `${k} (${v.when})`).join("; ")}`;
  return `SKILL ${key}: ${s.title}\nUse when: ${s.when}\n${s.steps}`;
}

export const AGENT_SKILL_NAMES = Object.keys(AGENT_SKILLS);
