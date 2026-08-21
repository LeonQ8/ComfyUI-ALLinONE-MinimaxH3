# Contributing

Contributions are welcome. Bug fixes, compatibility improvements, UI improvements, and well-scoped features are appreciated.

## Before You Start

For larger changes or new features, please open an issue first so we can confirm the change fits the project.

Small bug fixes can go directly to a pull request.

## Pull Requests

1. Fork the repository and create a branch for your change.
2. Keep the change focused. Avoid unrelated refactors.
3. Test the affected modes in ComfyUI before opening the PR.
4. Describe what changed and how you tested it.

Screenshots or short videos are appreciated for UI changes.

The automated checks in CI run on every pull request, so you do not need to run them yourself unless you want to.

## Compatibility

This project integrates several MiniMax H3 workflows and optional custom nodes. Please avoid changes that fix one configuration by breaking another. Check [COMPATIBILITY.md](COMPATIBILITY.md) when relevant.

## Reporting Bugs

If you are not comfortable modifying the code, that is completely fine. Open an issue with your ComfyUI version, GPU, error log, and steps to reproduce.
