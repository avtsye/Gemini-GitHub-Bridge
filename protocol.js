export const PROTOCOL_VERSION = 1;

export function buildProtocolPrompt(config = {}) {
  const repo = config.repository || "OWNER/REPO";
  const branch = config.branch || "main";
  return `\n\n[Gemini GitHub Bridge protocol]\nWhen this conversation involves code changes for the configured GitHub repository, keep your normal explanation and ALSO append exactly one machine-readable block at the end:\n<GITHUB_EXTENSION>\n{"version":1,"repository":"${repo}","base_branch":"${branch}","mode":"${config.defaultMode || "branch_pr"}","commit_message":"...","branch_name":"...","pr_title":"...","pr_body":"...","files":[{"path":"...","action":"create|update|delete","content":"FULL FILE CONTENT for create/update"}]}\n</GITHUB_EXTENSION>\nInside the tags output valid JSON only. Never include credentials or tokens. Never target another repository. Omit the block if no GitHub change is needed.`;
}

export function extractProtocolBlocks(text) {
  const blocks = [];
  const re = /<GITHUB_EXTENSION>\s*([\s\S]*?)\s*<\/GITHUB_EXTENSION>/g;
  let m;
  while ((m = re.exec(text))) {
    try { blocks.push(JSON.parse(m[1])); }
    catch (e) { blocks.push({__parse_error:e.message,__raw:m[1]}); }
  }
  return blocks;
}

export function validatePlan(plan, config) {
  const errors = [];
  if (!plan || typeof plan !== "object") errors.push("Plan must be an object");
  if (plan?.version !== PROTOCOL_VERSION) errors.push("Unsupported protocol version");
  if (plan?.repository !== config.repository) errors.push("Repository does not match the configured repository");
  if (!Array.isArray(plan?.files) || !plan.files.length) errors.push("No files supplied");
  if (plan?.files?.length > 50) errors.push("Too many files in one operation (max 50)");
  if (!["commit","branch_pr"].includes(plan?.mode)) errors.push("Mode must be commit or branch_pr");
  for (const file of plan?.files || []) {
    if (!file.path || typeof file.path !== "string") errors.push("A file is missing path");
    if (file.path?.startsWith("/") || file.path?.includes("..")) errors.push(`Unsafe path: ${file.path}`);
    if (!["create","update","delete"].includes(file.action)) errors.push(`Unsupported action for ${file.path}`);
    if (["create","update"].includes(file.action) && typeof file.content !== "string") errors.push(`Missing full content for ${file.path}`);
  }
  return errors;
}
