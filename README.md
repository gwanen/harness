# Harness

Personal agent tooling and Claude Code extensions.

## Install Usage Credit Guard

Run this once in your terminal (Claude Code 2.1.292 or later):

```sh
claude plugin marketplace add gwanen/harness && claude plugin install usage-credit-guard@harness --scope user
```

Claude Code downloads the mod and enables it for your user across projects. No manual clone or `--plugin-dir` flag is needed. Start a new Claude Code session, or run `/reload-plugins` in an existing one. A dim line above the prompt should show `limit` with five-hour and weekly usage.

Inside Claude Code, you can also run:

```text
/plugin install usage-credit-guard --marketplace gwanen/harness
```

Choose **Install for you** in the plugin panel. For a separate profile such as `claudeb`, run the install through that profile instead of `claude`.

The command works once this marketplace manifest and the mod are merged into the repository's default branch. Repository access is required if the repository is private.

This repository is a fork of [sultanfariz/harness](https://github.com/sultanfariz/harness); the `limit` line above the prompt is a change of this fork.

See [Usage Credit Guard](mods/usage-credit-guard/README.md) for approval behavior, updates, development setup, and billing limitations.
