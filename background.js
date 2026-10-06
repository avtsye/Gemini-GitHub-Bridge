const API = "https://api.github.com";

async function getConfig() {
  return await chrome.storage.local.get({
    token: "",
    repository: "",
    branch: "main",
    defaultMode: "branch_pr",
    protocolEnabled: true
  });
}

async function gh(path, options = {}) {
  const { token } = await getConfig();
  if (!token) throw new Error("לא הוגדר GitHub token");
  const res = await fetch(API + path, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!res.ok) {
    const error = new Error(data?.message || `GitHub API error ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

function pathUrl(path) {
  return encodeURIComponent(path).replace(/%2F/g, "/");
}

function decodeGithubContent(file) {
  if (!file?.content) return "";
  const raw = atob(file.content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(raw, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function getFile(repo, path, ref) {
  try {
    return await gh(`/repos/${repo}/contents/${pathUrl(path)}?ref=${encodeURIComponent(ref)}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function listRepos() {
  const repos = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(`/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos
    .filter(r => !r.archived)
    .map(r => ({ full_name:r.full_name, default_branch:r.default_branch, private:r.private, permissions:r.permissions || {} }))
    .sort((a,b) => a.full_name.localeCompare(b.full_name));
}

async function listBranches(repo) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(`/repos/${repo}/branches?per_page=100&page=${page}`);
    out.push(...batch.map(b => b.name));
    if (batch.length < 100) break;
  }
  return out;
}

async function createBranch(repo, baseBranch, requested) {
  const base = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  const clean = (requested || `gemini/change-${Date.now()}`).replace(/[^A-Za-z0-9._\/-]/g, "-");
  let candidate = clean;
  for (let i = 0; i < 3; i++) {
    try {
      await gh(`/repos/${repo}/git/refs`, {
        method:"POST",
        body:JSON.stringify({ref:`refs/heads/${candidate}`, sha:base.object.sha})
      });
      return candidate;
    } catch (e) {
      if (e.status !== 422) throw e;
      candidate = `${clean}-${Date.now()}`;
    }
  }
  throw new Error("לא ניתן ליצור ענף חדש");
}

async function createSingleCommit(repo, branch, files, message) {
  const ref = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const parentSha = ref.object.sha;
  const parentCommit = await gh(`/repos/${repo}/git/commits/${parentSha}`);
  const tree = [];

  for (const file of files) {
    const current = await getFile(repo, file.path, branch);
    if (file.action === "create" && current) throw new Error(`${file.path} כבר קיים`);
    if ((file.action === "update" || file.action === "delete") && !current) throw new Error(`${file.path} לא קיים`);

    if (file.action === "delete") {
      tree.push({path:file.path, mode:"100644", type:"blob", sha:null});
      continue;
    }
    const blob = await gh(`/repos/${repo}/git/blobs`, {
      method:"POST",
      body:JSON.stringify({content:file.content, encoding:"utf-8"})
    });
    tree.push({path:file.path, mode:"100644", type:"blob", sha:blob.sha});
  }

  const nextTree = await gh(`/repos/${repo}/git/trees`, {
    method:"POST",
    body:JSON.stringify({base_tree:parentCommit.tree.sha, tree})
  });
  const commit = await gh(`/repos/${repo}/git/commits`, {
    method:"POST",
    body:JSON.stringify({message:message || "Update from Gemini", tree:nextTree.sha, parents:[parentSha]})
  });
  await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method:"PATCH",
    body:JSON.stringify({sha:commit.sha, force:false})
  });
  return commit.sha;
}

function simpleDiff(oldText, newText, path) {
  if (oldText === newText) return `--- a/${path}\n+++ b/${path}\n (ללא שינוי בתוכן)`;
  const a = oldText.split("\n");
  const b = newText.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let ae = a.length - 1, be = b.length - 1;
  while (ae >= start && be >= start && a[ae] === b[be]) { ae--; be--; }
  const before = Math.max(0, start - 3);
  const afterA = Math.min(a.length - 1, ae + 3);
  const afterB = Math.min(b.length - 1, be + 3);
  const out = [`--- a/${path}`, `+++ b/${path}`, `@@ ${start + 1} @@`];
  for (let i = before; i < start; i++) out.push(" " + (a[i] ?? ""));
  for (let i = start; i <= ae; i++) out.push("-" + (a[i] ?? ""));
  for (let i = start; i <= be; i++) out.push("+" + (b[i] ?? ""));
  const tailCount = Math.max(afterA - ae, afterB - be);
  for (let k = 1; k <= tailCount; k++) {
    const line = a[ae + k] ?? b[be + k];
    if (line !== undefined) out.push(" " + line);
  }
  return out.join("\n");
}

async function previewPlan(plan) {
  const cfg = await getConfig();
  if (plan.repository !== cfg.repository) throw new Error("המאגר בתשובת Gemini אינו המאגר שנבחר");
  const branch = plan.base_branch || cfg.branch || "main";
  const files = [];
  for (const file of plan.files || []) {
    const current = await getFile(plan.repository, file.path, branch);
    const oldText = current ? decodeGithubContent(current) : "";
    let diff;
    if (file.action === "delete") diff = simpleDiff(oldText, "", file.path);
    else diff = simpleDiff(oldText, file.content || "", file.path);
    files.push({path:file.path, action:file.action, exists:!!current, oldText, newText:file.action === "delete" ? "" : (file.content || ""), diff});
  }
  return {branch, files};
}

async function applyPlan(plan) {
  const cfg = await getConfig();
  if (plan.repository !== cfg.repository) throw new Error("המאגר בתשובת Gemini אינו המאגר שנבחר");
  const baseBranch = plan.base_branch || cfg.branch || "main";
  let targetBranch = baseBranch;
  if (plan.mode === "branch_pr") targetBranch = await createBranch(plan.repository, baseBranch, plan.branch_name);

  const commitSha = await createSingleCommit(
    plan.repository,
    targetBranch,
    plan.files,
    plan.commit_message || "Changes from Gemini"
  );

  let pr = null;
  if (plan.mode === "branch_pr") {
    pr = await gh(`/repos/${plan.repository}/pulls`, {
      method:"POST",
      body:JSON.stringify({
        title:plan.pr_title || plan.commit_message || "Changes from Gemini",
        body:plan.pr_body || "נוצר באמצעות Gemini GitHub Bridge לאחר אישור מפורש של המשתמש.",
        head:targetBranch,
        base:baseBranch
      })
    });
  }
  return {branch:targetBranch, commitSha, pr:pr ? {number:pr.number, html_url:pr.html_url} : null};
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "GET_CONFIG") {
      const c = await getConfig();
      return sendResponse({ok:true, config:{
        repository:c.repository, branch:c.branch, defaultMode:c.defaultMode,
        protocolEnabled:c.protocolEnabled, hasToken:!!c.token
      }});
    }
    if (msg.type === "TEST_GITHUB") {
      const c = await getConfig();
      const user = await gh("/user");
      let repo = null;
      if (c.repository) repo = await gh(`/repos/${c.repository}`);
      return sendResponse({ok:true, user:{login:user.login}, repo:repo ? {full_name:repo.full_name,default_branch:repo.default_branch,private:repo.private} : null});
    }
    if (msg.type === "LIST_REPOS") return sendResponse({ok:true, repos:await listRepos()});
    if (msg.type === "LIST_BRANCHES") return sendResponse({ok:true, branches:await listBranches(msg.repository)});
    if (msg.type === "PREVIEW_PLAN") return sendResponse({ok:true, preview:await previewPlan(msg.plan)});
    if (msg.type === "APPLY_PLAN") return sendResponse({ok:true, result:await applyPlan(msg.plan)});
    if (msg.type === "READ_FILES") {
      const c = await getConfig();
      const repo = msg.repository || c.repository;
      const ref = msg.ref || c.branch;
      if (!repo) throw new Error("לא נבחר מאגר");
      const out = [];
      for (const path of msg.paths || []) {
        const file = await getFile(repo, path, ref);
        out.push(file ? {path, content:decodeGithubContent(file), sha:file.sha} : {path, error:"לא נמצא"});
      }
      return sendResponse({ok:true, files:out, repository:repo, ref});
    }
  })().catch(err => sendResponse({ok:false, error:err.message}));
  return true;
});