(() => {
  const PROTOCOL_MARKER = "[Gemini GitHub Bridge protocol]";
  const CONTEXT_MARKER = "[Gemini GitHub Bridge context]";
  let lastFingerprint = "";

  const send = msg => new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
  async function cfg() {
    const r = await send({type:"GET_CONFIG"});
    return r?.config || {};
  }

  function protocolText(c) {
    const repo = c.repository || "OWNER/REPO";
    const branch = c.branch || "main";
    return `\n\n${PROTOCOL_MARKER}
You are connected to GitHub repository ${repo}, base branch ${branch}.
When a coding request requires GitHub changes, keep your normal explanation and append exactly one machine-readable block at the very end:
<GITHUB_EXTENSION>
{"version":1,"repository":"${repo}","base_branch":"${branch}","mode":"${c.defaultMode || "branch_pr"}","commit_message":"Short commit message","branch_name":"gemini/descriptive-name","pr_title":"Pull request title","pr_body":"Summary of the changes","files":[{"path":"relative/path.ext","action":"create|update|delete","content":"FULL FILE CONTENT for create/update"}]}
</GITHUB_EXTENSION>
Rules: inside the tags output valid JSON only, without Markdown fences. For create/update include the complete final file content, not a patch. Group all files that belong to the same change into this single block. Never include credentials or tokens. Never target another repository or base branch. Omit the block when no GitHub write is needed.`;
  }

  function findComposer() {
    const all = [...document.querySelectorAll('div[contenteditable="true"], textarea')];
    return all.filter(el => el.offsetParent !== null && !el.closest("#ggb-panel,#ggb-context-panel")).at(-1) || null;
  }

  function getText(el) {
    return el instanceof HTMLTextAreaElement ? el.value : (el.innerText || "");
  }

  function setText(el, value) {
    if (!el) return;
    if (el instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter ? setter.call(el, value) : (el.value = value);
      el.dispatchEvent(new Event("input", {bubbles:true}));
      el.focus();
      return;
    }
    el.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("insertText", false, value);
    el.dispatchEvent(new InputEvent("input", {bubbles:true, inputType:"insertText", data:value}));
  }

  function appendToComposer(text) {
    const el = findComposer();
    if (!el) throw new Error("לא נמצאה תיבת ההודעה של Gemini");
    const current = getText(el);
    setText(el, current + (current ? "\n\n" : "") + text);
  }

  async function enrichComposer() {
    const c = await cfg();
    if (!c.protocolEnabled || !c.repository) return false;
    const el = findComposer();
    if (!el) return false;
    const text = getText(el);
    if (!text.trim() || text.includes(PROTOCOL_MARKER)) return false;
    const codeish = /\b(code|github|repo|repository|commit|branch|pull request|bug|fix|file|javascript|typescript|python|html|css|json|yaml|קוד|גיטהב|מאגר|קובץ|באג|תיקון|קומיט|ענף|תוסף|פרויקט)\b/i.test(text) ||
      /```|\.(js|ts|py|html|css|json|yml|yaml|md)\b/i.test(text);
    if (!codeish) return false;
    setText(el, text + protocolText(c));
    return true;
  }

  document.addEventListener("keydown", async e => {
    if (e.key === "Enter" && !e.shiftKey && (e.target?.isContentEditable || e.target instanceof HTMLTextAreaElement)) {
      const did = await enrichComposer();
      if (did) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setTimeout(() => {
          const btn = [...document.querySelectorAll("button")].find(b =>
            /send|שלח/i.test((b.getAttribute("aria-label") || "") + " " + (b.textContent || "")) && !b.disabled
          );
          btn?.click();
        }, 100);
      }
    }
  }, true);

  document.addEventListener("click", async e => {
    const btn = e.target.closest?.("button");
    if (!btn || btn.closest("#ggb-panel,#ggb-context-panel")) return;
    const label = (btn.getAttribute("aria-label") || "") + " " + (btn.textContent || "");
    if (/send|שלח/i.test(label)) {
      const did = await enrichComposer();
      if (did) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setTimeout(() => btn.click(), 100);
      }
    }
  }, true);

  function extractBlocks(text) {
    const out = [];
    const re = /<GITHUB_EXTENSION>\s*([\s\S]*?)\s*<\/GITHUB_EXTENSION>/g;
    let m;
    while ((m = re.exec(text))) {
      try { out.push(JSON.parse(m[1])); } catch {}
    }
    return out;
  }

  function validate(plan, c) {
    const errors = [];
    if (plan?.version !== 1) errors.push("גרסת פרוטוקול לא נתמכת");
    if (plan?.repository !== c.repository) errors.push("המאגר אינו תואם למאגר שנבחר");
    if (plan?.base_branch && plan.base_branch !== c.branch) errors.push("ענף הבסיס אינו תואם לענף שנבחר");
    if (!Array.isArray(plan?.files) || !plan.files.length) errors.push("לא התקבלו קבצים");
    if (plan?.files?.length > 50) errors.push("יותר מדי קבצים בפעולה אחת");
    if (!["commit","branch_pr"].includes(plan?.mode)) errors.push("מצב פעולה לא תקין");
    for (const f of plan?.files || []) {
      if (!f.path || f.path.startsWith("/") || f.path.includes("..")) errors.push(`נתיב לא בטוח: ${f.path || "?"}`);
      if (!["create","update","delete"].includes(f.action)) errors.push(`פעולה לא תקינה: ${f.path || "?"}`);
      if (["create","update"].includes(f.action) && typeof f.content !== "string") errors.push(`חסר תוכן מלא: ${f.path || "?"}`);
    }
    return errors;
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function renderPlan(plan, c) {
    document.getElementById("ggb-panel")?.remove();
    const panel = el("div"); panel.id = "ggb-panel";
    const header = el("div","ggb-header");
    const titles = el("div");
    titles.append(el("div","ggb-title","שינויים מ-Gemini ל-GitHub"));
    titles.append(el("div","ggb-meta",`${plan.repository || "?"} • ${plan.base_branch || c.branch || "?"} • ${plan.files?.length || 0} קבצים`));
    const close = el("button","ggb-icon","×"); close.onclick = () => panel.remove();
    header.append(titles, close);
    panel.append(header);

    const errors = validate(plan,c);
    if (errors.length) {
      panel.append(el("div","ggb-error",errors.join(" • ")));
      document.body.appendChild(panel);
      return;
    }

    const loading = el("div","ggb-loading","טוען את הגרסאות הנוכחיות ומכין Diff…");
    panel.append(loading);
    document.body.appendChild(panel);

    const r = await send({type:"PREVIEW_PLAN", plan});
    loading.remove();
    if (!r?.ok) {
      panel.append(el("div","ggb-error",r?.error || "טעינת ה-Diff נכשלה"));
      return;
    }

    const list = el("div","ggb-diff-list");
    for (const f of r.preview.files) {
      const details = document.createElement("details");
      details.className = "ggb-file";
      const summary = document.createElement("summary");
      const badge = el("span",`ggb-badge ${f.action}`, f.action === "create" ? "חדש" : f.action === "delete" ? "מחיקה" : "עדכון");
      summary.append(badge, document.createTextNode(" " + f.path));
      const pre = el("pre","ggb-diff",f.diff);
      details.append(summary,pre);
      list.appendChild(details);
    }
    panel.append(list);

    const note = el("div","ggb-note", plan.mode === "branch_pr"
      ? "כל הקבצים יישמרו ב-commit יחיד על ענף חדש, ולאחר מכן ייפתח Pull Request."
      : "כל הקבצים יישמרו ב-commit יחיד ישירות לענף שנבחר.");
    panel.append(note);

    const actions = el("div","ggb-actions");
    const dismiss = el("button","","ביטול"); dismiss.onclick = () => panel.remove();
    const apply = el("button","primary",plan.mode === "branch_pr" ? "צור Branch + PR" : "בצע Commit");
    apply.onclick = async () => {
      apply.disabled = true;
      apply.textContent = "מבצע…";
      const result = await send({type:"APPLY_PLAN", plan});
      if (!result?.ok) {
        apply.disabled = false;
        apply.textContent = "נסה שוב";
        panel.append(el("div","ggb-error",result?.error || "הפעולה נכשלה"));
        return;
      }
      apply.textContent = "בוצע ✓";
      dismiss.textContent = "סגור";
      const success = el("div","ggb-success",`Commit: ${result.result.commitSha.slice(0,7)}`);
      panel.append(success);
      if (result.result.pr?.html_url) {
        const a = el("a","ggb-pr-link",`פתח PR #${result.result.pr.number}`);
        a.href = result.result.pr.html_url;
        a.target = "_blank";
        actions.appendChild(a);
      }
    };
    actions.append(dismiss,apply);
    panel.append(actions);
  }

  async function openContextPanel() {
    document.getElementById("ggb-context-panel")?.remove();
    const c = await cfg();
    const panel = el("div"); panel.id = "ggb-context-panel";
    const header = el("div","ggb-header");
    const titles = el("div");
    titles.append(el("div","ggb-title","טען קבצים מ-GitHub ל-Gemini"));
    titles.append(el("div","ggb-meta", c.repository ? `${c.repository} • ${c.branch}` : "יש להגדיר מאגר בהגדרות התוסף"));
    const close = el("button","ggb-icon","×"); close.onclick = () => panel.remove();
    header.append(titles,close);
    panel.append(header);

    if (!c.repository) {
      panel.append(el("div","ggb-error","לא הוגדר מאגר. פתח את הגדרות התוסף."));
      document.body.appendChild(panel);
      return;
    }

    const label = el("label","ggb-label","נתיבי קבצים — נתיב אחד בכל שורה");
    const ta = document.createElement("textarea");
    ta.className = "ggb-paths";
    ta.placeholder = "src/app.js\nmanifest.json\nREADME.md";
    const status = el("div","ggb-context-status","");
    const actions = el("div","ggb-actions");
    const cancel = el("button","","ביטול"); cancel.onclick = () => panel.remove();
    const load = el("button","primary","טען לפרומפט");
    load.onclick = async () => {
      const paths = ta.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (!paths.length) return status.textContent = "הכנס לפחות נתיב אחד";
      if (paths.length > 20) return status.textContent = "אפשר לטעון עד 20 קבצים בכל פעם";
      load.disabled = true; load.textContent = "טוען…"; status.textContent = "";
      const r = await send({type:"READ_FILES", paths, repository:c.repository, ref:c.branch});
      load.disabled = false; load.textContent = "טען לפרומפט";
      if (!r?.ok) return status.textContent = r?.error || "הטעינה נכשלה";
      let total = 0;
      const parts = [`${CONTEXT_MARKER}\nRepository: ${r.repository}\nBranch: ${r.ref}\nUse these files as the current GitHub source of truth:`];
      for (const f of r.files) {
        if (f.error) { parts.push(`\nFILE: ${f.path}\nERROR: ${f.error}`); continue; }
        total += f.content.length;
        if (total > 180000) { parts.push("\n[Context truncated: file content limit reached]"); break; }
        parts.push(`\nFILE: ${f.path}\n---BEGIN FILE---\n${f.content}\n---END FILE---`);
      }
      try {
        appendToComposer(parts.join("\n"));
        panel.remove();
      } catch (e) {
        status.textContent = e.message;
      }
    };
    actions.append(cancel,load);
    panel.append(label,ta,status,actions);
    document.body.appendChild(panel);
    ta.focus();
  }

  function ensureLauncher() {
    if (document.getElementById("ggb-launcher")) return;
    const button = el("button","","GitHub");
    button.id = "ggb-launcher";
    button.title = "טען קבצים מ-GitHub לפרומפט";
    button.onclick = openContextPanel;
    document.body.appendChild(button);
  }

  const observer = new MutationObserver(async () => {
    ensureLauncher();
    const text = document.body.innerText || "";
    if (!text.includes("<GITHUB_EXTENSION>")) return;
    const blocks = extractBlocks(text);
    if (!blocks.length) return;
    const plan = blocks.at(-1);
    const fp = JSON.stringify(plan);
    if (fp === lastFingerprint) return;
    lastFingerprint = fp;
    renderPlan(plan, await cfg());
  });

  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  ensureLauncher();
})();