(() => {
  const PROTOCOL_MARKER = "[Gemini GitHub Bridge protocol]";
  let lastBlocksFingerprint = "";

  async function cfg() {
    return new Promise(resolve => chrome.runtime.sendMessage({type:"GET_CONFIG"}, r => resolve(r?.config || {})));
  }

  function protocolText(c) {
    const repo = c.repository || "OWNER/REPO";
    const branch = c.branch || "main";
    return `\n\n${PROTOCOL_MARKER}\nWhen this conversation involves code changes for the configured GitHub repository, keep your normal explanation and append exactly one machine-readable block at the very end:\n<GITHUB_EXTENSION>\n{"version":1,"repository":"${repo}","base_branch":"${branch}","mode":"${c.defaultMode || "branch_pr"}","commit_message":"...","branch_name":"...","pr_title":"...","pr_body":"...","files":[{"path":"...","action":"create|update|delete","content":"FULL FILE CONTENT for create/update"}]}\n</GITHUB_EXTENSION>\nInside the tags output valid JSON only, with no markdown fences. Never include credentials or tokens. Never target a repository other than ${repo}. Omit the block if no GitHub change is needed.`;
  }

  function findComposer() {
    const candidates = [...document.querySelectorAll('div[contenteditable="true"], textarea')].filter(el => el.offsetParent !== null);
    return candidates[candidates.length - 1] || null;
  }

  function getText(el) { return el instanceof HTMLTextAreaElement ? el.value : (el.innerText || ""); }
  function setText(el, value) {
    if (el instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter ? setter.call(el, value) : (el.value = value);
      el.dispatchEvent(new Event("input", {bubbles:true}));
    } else {
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, value);
      el.dispatchEvent(new InputEvent("input", {bubbles:true, inputType:"insertText", data:value}));
    }
  }

  async function enrichComposer() {
    const c = await cfg();
    if (!c.protocolEnabled || !c.repository) return false;
    const el = findComposer();
    if (!el) return false;
    const text = getText(el);
    if (!text.trim() || text.includes(PROTOCOL_MARKER)) return false;
    const codeish = /\b(code|github|repo|repository|commit|branch|pull request|bug|fix|file|javascript|typescript|python|html|css|json|yaml|קוד|גיטהב|מאגר|קובץ|באג|תיקון|קומיט|ענף)\b/i.test(text) || /```|\.js\b|\.ts\b|\.py\b|\.html\b|\.css\b/.test(text);
    if (!codeish) return false;
    setText(el, text + protocolText(c));
    return true;
  }

  document.addEventListener("keydown", async e => {
    if (e.key === "Enter" && !e.shiftKey && (e.target?.isContentEditable || e.target instanceof HTMLTextAreaElement)) {
      const did = await enrichComposer();
      if (did) {
        e.preventDefault(); e.stopImmediatePropagation();
        setTimeout(() => {
          const btn = [...document.querySelectorAll('button')].find(b => /send|שלח/i.test((b.getAttribute('aria-label')||'') + ' ' + (b.textContent||'')) && !b.disabled);
          btn?.click();
        }, 80);
      }
    }
  }, true);

  document.addEventListener("click", async e => {
    const btn = e.target.closest?.("button");
    if (!btn) return;
    const label = (btn.getAttribute("aria-label") || "") + " " + (btn.textContent || "");
    if (/send|שלח/i.test(label)) {
      const did = await enrichComposer();
      if (did) { e.preventDefault(); e.stopImmediatePropagation(); setTimeout(() => btn.click(), 80); }
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

  function validate(plan,c) {
    const e=[];
    if(plan.version!==1)e.push("Unsupported protocol version");
    if(plan.repository!==c.repository)e.push("Repository mismatch");
    if(!Array.isArray(plan.files)||!plan.files.length)e.push("No files");
    if(plan.files?.length>50)e.push("Too many files");
    if(!["commit","branch_pr"].includes(plan.mode))e.push("Bad mode");
    for(const f of plan.files||[]){
      if(!f.path||f.path.startsWith("/")||f.path.includes(".."))e.push(`Unsafe path: ${f.path}`);
      if(!["create","update","delete"].includes(f.action))e.push(`Bad action: ${f.action}`);
      if(["create","update"].includes(f.action) && typeof f.content!=="string")e.push(`Missing content: ${f.path}`);
    }
    return e;
  }

  function renderPlan(plan, c) {
    document.getElementById("ggb-panel")?.remove();
    const panel = document.createElement("div"); panel.id = "ggb-panel";
    const title = document.createElement("div"); title.className="ggb-title"; title.textContent="GitHub change detected";
    const meta = document.createElement("div"); meta.className="ggb-meta"; meta.textContent=`${plan.repository || "?"} • ${plan.mode || "?"} • ${plan.files?.length || 0} files`;
    const list = document.createElement("div"); list.className="ggb-files";
    for (const f of plan.files || []) {
      const row=document.createElement("div");
      row.textContent=`${f.action}  ${f.path}`;
      list.appendChild(row);
    }
    const err = validate(plan,c);
    if (err.length) {
      const x=document.createElement("div");
      x.className="ggb-error";
      x.textContent=err.join(" • ");
      panel.append(title,meta,list,x);
      document.body.appendChild(panel);
      return;
    }
    const actions=document.createElement("div"); actions.className="ggb-actions";
    const dismiss=document.createElement("button"); dismiss.textContent="Dismiss"; dismiss.onclick=()=>panel.remove();
    const apply=document.createElement("button"); apply.className="primary"; apply.textContent=plan.mode==="branch_pr"?"Create branch + PR":"Apply commit";
    apply.onclick=async()=>{
      apply.disabled=true; apply.textContent="Applying…";
      const r=await new Promise(resolve=>chrome.runtime.sendMessage({type:"APPLY_PLAN", plan},resolve));
      if(!r?.ok){apply.disabled=false;apply.textContent="Try again";alert(r?.error||"GitHub operation failed");return;}
      apply.textContent="Done";
      if(r.result?.pr?.html_url){
        const a=document.createElement("a");a.href=r.result.pr.html_url;a.target="_blank";a.textContent=`Open PR #${r.result.pr.number}`;actions.appendChild(a);
      }
    };
    actions.append(dismiss,apply);
    panel.append(title,meta,list,actions);
    document.body.appendChild(panel);
  }

  const observer = new MutationObserver(async () => {
    const text = document.body.innerText || "";
    if (!text.includes("<GITHUB_EXTENSION>")) return;
    const blocks = extractBlocks(text);
    if (!blocks.length) return;
    const plan = blocks[blocks.length-1];
    const fp=JSON.stringify(plan);
    if(fp===lastBlocksFingerprint)return;
    lastBlocksFingerprint=fp;
    const c=await cfg();
    renderPlan(plan,c);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
})();