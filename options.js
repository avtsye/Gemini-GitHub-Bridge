const $ = id => document.getElementById(id);

function send(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

function setStatus(el, text, ok = true) {
  el.textContent = text || "";
  el.className = "status " + (text ? (ok ? "ok" : "err") : "");
}

async function loadStored() {
  const c = await chrome.storage.local.get({
    token:"", repository:"", branch:"main", defaultMode:"branch_pr", protocolEnabled:true
  });
  $("token").value = c.token || "";
  $("defaultMode").value = c.defaultMode || "branch_pr";
  $("protocolEnabled").checked = !!c.protocolEnabled;
  return c;
}

async function saveTokenOnly() {
  await chrome.storage.local.set({token:$("token").value.trim()});
}

async function loadRepos(selected = "") {
  await saveTokenOnly();
  const r = await send({type:"LIST_REPOS"});
  if (!r?.ok) throw new Error(r?.error || "טעינת המאגרים נכשלה");
  const select = $("repositorySelect");
  select.innerHTML = "";
  for (const repo of r.repos) {
    const o = document.createElement("option");
    o.value = repo.full_name;
    o.textContent = `${repo.full_name}${repo.private ? " 🔒" : ""}`;
    o.dataset.defaultBranch = repo.default_branch || "main";
    select.appendChild(o);
  }
  if (!r.repos.length) {
    select.innerHTML = '<option value="">לא נמצאו מאגרים זמינים לטוקן הזה</option>';
    return;
  }
  select.value = selected && r.repos.some(x => x.full_name === selected) ? selected : r.repos[0].full_name;
}

async function loadBranches(repo, selected = "") {
  if (!repo) return;
  const r = await send({type:"LIST_BRANCHES", repository:repo});
  if (!r?.ok) throw new Error(r?.error || "טעינת הענפים נכשלה");
  const select = $("branchSelect");
  select.innerHTML = "";
  for (const branch of r.branches) {
    const o = document.createElement("option");
    o.value = branch;
    o.textContent = branch;
    select.appendChild(o);
  }
  const repoOption = $("repositorySelect").selectedOptions[0];
  const fallback = repoOption?.dataset.defaultBranch || "main";
  const wanted = selected && r.branches.includes(selected) ? selected : (r.branches.includes(fallback) ? fallback : r.branches[0]);
  if (wanted) select.value = wanted;
}

async function connect() {
  setStatus($("connectionStatus"), "בודק חיבור…");
  await saveTokenOnly();
  const t = await send({type:"TEST_GITHUB"});
  if (!t?.ok) return setStatus($("connectionStatus"), t?.error || "החיבור נכשל", false);
  try {
    const stored = await chrome.storage.local.get({repository:"",branch:"main"});
    await loadRepos(stored.repository);
    await loadBranches($("repositorySelect").value, stored.branch);
    setStatus($("connectionStatus"), `מחובר כ-${t.user.login}. נטענו המאגרים הזמינים.`);
  } catch (e) {
    setStatus($("connectionStatus"), e.message, false);
  }
}

$("connect").onclick = connect;
$("refreshRepos").onclick = async () => {
  try { await loadRepos($("repositorySelect").value); await loadBranches($("repositorySelect").value); }
  catch (e) { setStatus($("connectionStatus"), e.message, false); }
};
$("refreshBranches").onclick = async () => {
  try { await loadBranches($("repositorySelect").value, $("branchSelect").value); }
  catch (e) { setStatus($("connectionStatus"), e.message, false); }
};
$("repositorySelect").onchange = async () => {
  try { await loadBranches($("repositorySelect").value); }
  catch (e) { setStatus($("connectionStatus"), e.message, false); }
};

$("save").onclick = async () => {
  const repository = $("repositorySelect").value;
  const branch = $("branchSelect").value;
  if (!repository || !branch) return setStatus($("saveStatus"), "יש לבחור מאגר וענף", false);
  await chrome.storage.local.set({
    token:$("token").value.trim(),
    repository,
    branch,
    defaultMode:$("defaultMode").value,
    protocolEnabled:$("protocolEnabled").checked
  });
  setStatus($("saveStatus"), `נשמר: ${repository} / ${branch}`);
};

(async () => {
  const stored = await loadStored();
  if (stored.token) {
    try {
      await loadRepos(stored.repository);
      await loadBranches($("repositorySelect").value, stored.branch);
      setStatus($("connectionStatus"), "הגדרות קיימות נטענו");
    } catch (e) {
      setStatus($("connectionStatus"), "לא ניתן לטעון את GitHub כרגע: " + e.message, false);
    }
  }
})();