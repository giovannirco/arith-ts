# Contributing

[README.md](README.md) is the contract: the API table, the error strings and the deploy steps. A change that breaks a documented command fixes the command or the README in the same commit.

- You need Node.js 24. `.node-version` names the exact Node CI and the image use; run `npm ci` once.
- `make test` and `make lint` pass before you push. `make lint` is ESLint with typescript-eslint's strict type-checked rules, then `tsc --noEmit`, as CI runs them.
- Packages move by hand: `npm install <package>@<version>`, then `make test`, with the `package-lock.json` change in the same commit.
- One concern per commit, with a [conventional](https://www.conventionalcommits.org) subject: `feat:`, `fix(helm):`, `docs:`, `ci:`.
- Image tags stay plain integers: `1`, `2`. Do not add `v` prefixes or semver to image tags.
- The chart version in `deploy/helm/arith-ts/Chart.yaml` is semver. Bump it in the commit that changes a template or a default; CI will not publish a version twice.
- A Helm value and a Kustomize component come together: add a toggle to one, add it to the other.

Open an issue or a pull request in plain words: what you ran, what you expected, what happened.
