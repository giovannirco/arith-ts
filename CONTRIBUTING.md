# Contributing

[README.md](README.md) is the contract: the API table, the error strings and the deploy steps. A change that breaks a documented command fixes the command or the README in the same commit.

- You need Node.js 24. `.node-version` names the exact Node CI and the image use; run `npm ci` once.
- `make test` and `make lint` pass before you push. `make lint` is ESLint with typescript-eslint's strict type-checked rules, then `tsc --noEmit`, as CI runs them.
- Packages move by hand: `npm install <package>@<version>`, then `make test`, with the `package-lock.json` change in the same commit.
- One concern per commit, with a [conventional](https://www.conventionalcommits.org) subject: `feat:`, `fix(helm):`, `docs:`, `ci:`.
- One version per release, semver: `package.json`, `Chart.yaml` (`version`, `appVersion`, the `artifacthub.io/images` tag) and `deploy/kustomize/base/kustomization.yaml` carry the same one, and CI checks it. A release is a commit that bumps all of them, then a tag `v<version>`; CI never publishes a version twice.
- Image tags are that version (`1.1.0`) or `sha-<commit>`. Never a bare integer, never `latest`. Build locally with `make image TAG=dev`.
- A Helm value and a Kustomize component come together: add a toggle to one, add it to the other.

Open an issue or a pull request in plain words: what you ran, what you expected, what happened.
