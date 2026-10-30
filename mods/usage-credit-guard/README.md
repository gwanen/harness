# Usage Credit Guard

Usage Credit Guard checks Claude Code's reported usage before selected model requests. When either the five-hour or seven-day usage window is at or above 100%, it pauses the pending request and asks what to do. It also asks when usage data is unavailable.

## Load the local plugin

From the `mods/` directory, start the `.claudeb` instance with the local plugin directory:

```sh
CLAUDE_CONFIG_DIR="$HOME/.claudeb" "$HOME/.local/bin/claude" --plugin-dir "$PWD/usage-credit-guard"
```

This loads the local plugin for that invocation only. It does not install the plugin or change settings. There is no slash command and no persistent approval setting. Start future `.claudeb` sessions with the same `--plugin-dir` option.

## Approval behavior

The guard presents an AskUserQuestion dialog with these choices:

- **Stop** (first choice): deny this request.
- **Allow this request**: send only the request currently waiting for approval.

Approval applies only to the one request waiting in that dialog. It does not change a setting, carry over to another request, or create a stored exception. Each later request is checked against the next usage reading: if a limit is still reached, the guard asks again; once both readings are below 100%, requests proceed without approval. Dismissing the dialog, entering other text, or having no available UI denies the request. In non-interactive sessions, the guard cannot ask and denies when approval is required. The dialog uses Claude Code’s AskUserQuestion tool; other loaded mods can hook that call, so trust the mods enabled in the session.

## What it checks

The guard reads Claude Code's session usage and checks both the five-hour and seven-day rate limits. It blocks when either reaches 100%. If either limit is missing, or usage cannot be read, it treats usage as unknown and asks before proceeding. For requests on the covered path, the guard sends nothing until approved. Approving a request while usage is unknown may incur usage credits.

The guard covers main and subagent `turn.step` model requests, plus the separate `model.complete`, `model.fork`, and `model.classify` plugin API calls. Background work may not be observed or stopped reliably. Concurrent work can outlive the usage reading used for a decision, and requests already sent cannot be recalled. Usage data may lag. Model calls made outside these intercepted Claude Code events are outside its coverage. This plugin cannot guarantee a zero-spend session or enforce a hard billing ceiling.

## Usage status

After startup, the status line under the prompt shows the latest reported five-hour and weekly usage. For example:

```text
⚠ usage-credit-guard: Guard active · 5h: 0% · weekly: 8%
```

Values vary by account. An unknown reading appears as `?`; a reading at or above 100% adds `approval required`. The line updates at startup and when Claude Code reports a usage measurement, such as after a turn or a rate-limit percentage change. It is not a live poll.

## Confirm the mod loaded

In the interactive session, run `/plugin`. The header’s `mods active` line should include `usage-credit-guard`. The status line is also evidence that the mod loaded and its usage reading succeeded.

To check whether the current CLI process can load mods without starting a session, run this from the `mods/` directory (which has no hooks module of its own):

```sh
CLAUDE_CONFIG_DIR="$HOME/.claudeb" "$HOME/.local/bin/claude" plugin test
```

`no hooks module to load` means mods are enabled and there is no mod in the current directory to test; it does not by itself confirm that this plugin loaded. A message saying hooks modules are turned off points to `disableAllHooks` or an organization policy. A rollout-switch message means mods were turned off remotely. `--safe-mode` disables installed plugins, and an organization may allow only managed mods. For load errors, check the Errors tab in `/plugin`.

For hard protection against charges, turn off paid usage credits or extra usage in the applicable account or provider settings, such as [Claude usage settings](https://claude.ai/settings/usage). Use this plugin as an additional request gate, not as a billing cap.

## Validate and run the plugin tests

From the repository root:

```sh
claude plugin validate ./usage-credit-guard
claude plugin test ./usage-credit-guard
```

These commands validate the plugin structure and run its local mod tests.
