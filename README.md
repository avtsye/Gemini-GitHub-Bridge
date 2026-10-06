# Gemini GitHub Bridge

Chrome/Edge extension that adds a strict JSON protocol to coding prompts in Gemini and lets the user approve the resulting GitHub changes.

## MVP features
- Detects code-related prompts and appends a machine-readable GitHub protocol.
- Detects `<GITHUB_EXTENSION>…</GITHUB_EXTENSION>` in Gemini replies.
- Validates repository, paths, actions, and protocol version.
- User must explicitly approve before GitHub is changed.
- Supports create/update/delete files.
- Supports direct commit or branch + pull request.
- GitHub token stays in extension storage and is never inserted into Gemini prompts.

## Install
1. Download or clone this repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked** and select this repository folder.
5. Open the extension settings.
6. Paste a GitHub fine-grained personal access token and `owner/repository`.
7. Save and test.

## Recommended fine-grained token permissions
Restrict the token to only the repositories you want the extension to access. For this MVP, grant repository **Contents: Read and write**. If using Branch + PR, also grant **Pull requests: Read and write**. Use the minimum permissions required.

For a distributable/public extension, replace PAT setup with a GitHub App / OAuth authorization-code flow with PKCE.

## Protocol example

```text
<GITHUB_EXTENSION>
{"version":1,"repository":"owner/repo","base_branch":"main","mode":"branch_pr","commit_message":"Fix layout bug","branch_name":"gemini/fix-layout","pr_title":"Fix layout bug","pr_body":"Fix generated with Gemini GitHub Bridge.","files":[{"path":"src/app.js","action":"update","content":"FULL FILE CONTENT"}]}
</GITHUB_EXTENSION>
```

## Important limitation
Gemini's web UI is not a stable public extension API. The content script therefore uses generic DOM detection and may need selector updates when Gemini changes its interface. The GitHub side uses the stable REST API.
