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
  const {token} = await getConfig();
  if (!token) throw new Error("GitHub token is not configured");
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
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(data?.message || `GitHub API error ${res.status}`);
  return data;
}

function b64Unicode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function getFile(repo, path, ref) {
  try {
    return await gh(`/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g,"/")}?ref=${encodeURIComponent(ref)}`);
  } catch (e) {
    if (/Not Found/i.test(e.message)) return null;
    throw e;
  }
}

async function applyFile(repo, branch, file, message) {
  const current = await getFile(repo, file.path, branch);
  if (file.action === "create") {
    if (current) throw new Error(`${file.path} already exists`);
    return gh(`/repos/${repo}/contents/${encodeURIComponent(file.path).replace(/%2F/g,"/")}`, {
      method: "PUT",
      body: JSON.stringify({message, content: b64Unicode(file.content), branch})
    });
  }
  if (file.action === "update") {
    if (!current?.sha) throw new Error(`${file.path} does not exist`);
    return gh(`/repos/${repo}/contents/${encodeURIComponent(file.path).replace(/%2F/g,"/")}`, {
      method: "PUT",
      body: JSON.stringify({message, content: b64Unicode(file.content), sha: current.sha, branch})
    });
  }
  if (file.action === "delete") {
    if (!current?.sha) throw new Error(`${file.path} does not exist`);
    return gh(`/repos/${repo}/contents/${encodeURIComponent(file.path).replace(/%2F/g,"/")}`, {
      method: "DELETE",
      body: JSON.stringify({message, sha: current.sha, branch})
    });
  }
}

async function createBranch(repo, baseBranch, branchName) {
  const base = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  try {
    await gh(`/repos/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ref: `refs/heads/${branchName}`, sha: base.object.sha})
    });
  } catch (e) {
    if (!/Reference already exists/i.test(e.message)) throw e;
  }
  return branchName;
}

async function applyPlan(plan) {
  const cfg = await getConfig();
  if (plan.repository !== cfg.repository) throw new Error("Repository mismatch");
  const baseBranch = plan.base_branch || cfg.branch || "main";
  let targetBranch = baseBranch;
  if (plan.mode === "branch_pr") {
    const safe = (plan.branch_name || `gemini/${Date.now()}`).replace(/[^A-Za-z0-9._\/-]/g, "-");
    targetBranch = await createBranch(plan.repository, baseBranch, safe);
  }
  const results = [];
  for (const file of plan.files) {
    const out = await applyFile(plan.repository, targetBranch, file, plan.commit_message || `Update ${file.path}`);
    results.push({path: file.path, action: file.action, commit: out?.commit?.sha || null});
  }
  let pr = null;
  if (plan.mode === "branch_pr") {
    pr = await gh(`/repos/${plan.repository}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: plan.pr_title || plan.commit_message || "Changes from Gemini",
        body: plan.pr_body || "Created by Gemini GitHub Bridge after explicit user approval.",
        head: targetBranch,
        base: baseBranch
      })
    });
  }
  return {branch: targetBranch, results, pr: pr ? {number: pr.number, html_url: pr.html_url} : null};
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "GET_CONFIG") {
      const c = await getConfig();
      sendResponse({ok:true, config:{repository:c.repository, branch:c.branch, defaultMode:c.defaultMode, protocolEnabled:c.protocolEnabled, hasToken:!!c.token}});
    } else if (msg.type === "TEST_GITHUB") {
      const c = await getConfig();
      if (!c.repository) throw new Error("Repository is not configured");
      const repo = await gh(`/repos/${c.repository}`);
      sendResponse({ok:true, repo:{full_name:repo.full_name, default_branch:repo.default_branch, private:repo.private}});
    } else if (msg.type === "APPLY_PLAN") {
      const result = await applyPlan(msg.plan);
      sendResponse({ok:true, result});
    } else if (msg.type === "READ_FILES") {
      const c = await getConfig();
      const out = [];
      for (const path of msg.paths || []) {
        const file = await getFile(c.repository, path, msg.ref || c.branch);
        if (!file) out.push({path, error:"Not found"});
        else {
          const raw = atob((file.content || "").replace(/\n/g,""));
          const bytes = Uint8Array.from(raw, ch => ch.charCodeAt(0));
          out.push({path, content:new TextDecoder().decode(bytes), sha:file.sha});
        }
      }
      sendResponse({ok:true, files:out});
    }
  })().catch(err => sendResponse({ok:false, error:err.message}));
  return true;
});