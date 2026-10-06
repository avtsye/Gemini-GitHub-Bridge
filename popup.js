chrome.runtime.sendMessage({type:"GET_CONFIG"}, r => {
  const c = r?.config || {};
  document.getElementById("state").textContent =
    c.hasToken && c.repository
      ? `מחובר אל:\n${c.repository}\nענף: ${c.branch}\nמצב: ${c.defaultMode === "branch_pr" ? "Branch + PR" : "Commit ישיר"}`
      : "עדיין לא הוגדר חיבור GitHub";
});
document.getElementById("options").onclick = () => chrome.runtime.openOptionsPage();