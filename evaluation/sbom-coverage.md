# What Syft plus CycloneDX actually inventories

Collected 2026-08-12. Raw figures: `data/sbom-coverage.json`.
Regenerate with `npm run sample:sbom` (needs Syft 1.51.0 on PATH, or
`tools/syft.exe` as used here). Sample clones from `evaluation/sample-clone.sh`.

Chapter 2 said a claim to "generate SBOMs" is not informative until the tool, the
format, and the integrity of generation are named. Chapter 3 fixed the first two
(Syft, CycloneDX) and deferred the coverage question to this record: what that
choice covers and misses against the twelve sampled repositories.

This is not a comparison with Trivy, and it is not a claim that Syft is the
better generator. O'Donoghue et al. already documented that Syft and Trivy
disagree on the same images, and that Syft-in-SPDX analysed by Trivy reports
close to zero vulnerabilities for most of them. CycloneDX was chosen because of
that finding. What follows is what Syft-in-CycloneDX produces when it is run the
way this system's workflow actually runs it: `syft dir:. -o cyclonedx-json` on a
tagged source checkout, not on a built container image.

## Method

Syft **1.51.0** (`windows/amd64`, git `2293641`, 2026-08-10) against the same
pinned commits as `repository-sample.md`. Output format is CycloneDX JSON, which
is what the anchoring workflow hashes and submits. Every successful document in
this run used **CycloneDX spec 1.7**. O'Donoghue et al. measured CycloneDX 1.5
and SPDX 2.3; the format version has moved on, and the pin is in this file so
that fact stays dated.

A component count is not a score. The interesting question is whether Syft saw
the packages the project itself declares. Lockfiles, `go.mod`, `pyproject.toml`,
`package.json`, CMake `find_package`, and `.gitmodules` were read independently
of Syft so that a two-component BOM can be judged against a two-dependency
project rather than against an imagined complete universe.

## Observed

| Repository | Ecosystem | Components | What the BOM is made of |
| --- | --- | --- | --- |
| spf13/cobra | Go | 10 | 4 `pkg:golang` (matches `go.mod`'s 4 direct requires) + 6 GitHub Actions |
| junegunn/fzf | Go | 45 | 11 `pkg:golang` (matches `go.mod`) + 15 Ruby gems + 19 GitHub Actions |
| BurntSushi/ripgrep | Rust | 65 | 51 `pkg:cargo` + 10 without a purl (Cargo.lock has 61 `[[package]]`) + 4 Actions |
| sharkdp/bat | Rust | 294 | 256 `pkg:cargo` (Cargo.lock 257) + 28 PyPI + 8 Actions; 92 gitlinks not checked out |
| pallets/click | Python | 101 | 81 `pkg:pypi` (matches `uv.lock`'s 81 packages) + 20 Actions |
| psf/requests | Python | 23 | 2 `pkg:pypi` + 21 Actions |
| axios/axios | JavaScript | 1,057 | 1,029 `pkg:npm` (has `package-lock.json`) + 28 Actions |
| expressjs/express | JavaScript | 9 | 9 GitHub Actions, **zero** `pkg:npm` |
| curl/curl | C / autotools | 29 | 29 GitHub Actions. CMake has 32 `find_package` calls; none appear |
| libarchive/libarchive | C / autotools | 18 | 17 Actions + 1 stray Maven `seed`. CMake has 13 `find_package` calls; none appear |
| godotengine/godot-demo-projects | GDScript / assets | 6 | 6 GitHub Actions. No package manager in the tree |
| microsoft/fluentui-system-icons | SVG / generated | see below | full-tree `syft dir:.` timed out at 900 s |

Two rows need the longer explanation, because a count would mislead.

**requests.** `pyproject.toml` declares four runtime dependencies (`charset_normalizer`,
`idna`, `urllib3`, `certifi`). None of them are in the BOM. The two PyPI
components Syft did emit are `sphinx@7.2.6` from `docs/requirements.txt` and
`pytest-httpbin@2.1.0` from `requirements-dev.txt`. Click, which ships a `uv.lock`,
is the contrast: 81 lockfile packages, 81 PyPI components.

**express.** `package.json` lists 31 runtime dependencies and 16 devDependencies.
There is no lockfile and no `node_modules` in the tagged tree. Syft emitted no
npm components at all. axios, which does ship `package-lock.json`, produced 1,029.
The difference is the lockfile, not the ecosystem.

**fluentui-system-icons.** 118,432 files, mostly generated SVGs. The same
`syft dir:.` the workflow uses did not finish in 15 minutes. A second pass with
`--exclude '**/*.svg'` completed in about four minutes and produced 2,033
components: 1,952 npm, 43 Maven, 4 CocoaPods, 31 GitHub Actions, 2 pub, 1 Swift.
Syft also warned it could not parse Yarn v2 `__metadata`; the repo pins Yarn
4.17.1. The exclude pass is not what CI runs. It is recorded so the timeout is
not mistaken for "this project has no packages."

## What this supports

Three coverage characteristics, not a ranking.

**Lockfiles are what Syft sees.** Go modules, Cargo.lock, package-lock.json, and
uv.lock produced BOMs that match the lockfile. A `package.json` or a PEP 621
`dependencies` list without a lockfile did not. That is why express and requests
look empty of their own runtime libraries, and why axios and click do not.

**C system libraries are out of scope for this invocation.** curl and libarchive
declare dozens of optional dependencies through CMake (`OpenSSL`, `ZLIB`,
`LibXml2`, and so on). None of those libraries live in the Git tree as packages,
so `syft dir:.` cannot name them. The BOMs for both projects are almost entirely
GitHub Actions from `.github/workflows`. Vendored-C and autotools were the cases
the sample was built to include; this is what that axis shows.

**GitHub Actions are first-class components.** On cobra they are a minority. On
curl, libarchive, express, godot, and requests they are most of the document, and
on express they are the entire document. An SBOM hashed at release time therefore
often commits to the project's CI actions as much as, or more than, to its
runtime libraries. That is a property of scanning a source checkout rather than a
built artifact.

O'Donoghue et al. measured a different disagreement (tool × format on container
images, with a specific Syft-SPDX × Trivy failure). This record does not repeat
that experiment and does not claim to. What it adds is that even after fixing the
tool and the format, coverage on source trees still varies sharply with whether a
lockfile is present and whether the dependencies are packages in the tree at all.
Choosing CycloneDX avoids the SPDX-analysis hole they reported; it does not make
the inventory complete.

The hash this system anchors is a hash of whatever document Syft emitted. Binding
it to the tree hash still does what Gap 2 asked for. It does not make a thin BOM
into a full one.

## Limitations

- Syft 1.51.0 on Windows, 2026-08-12. Cataloger behaviour is version-dated.
- The scan is a source checkout, matching the workflow. O'Donoghue et al. scanned
  images. The two results are not interchangeable.
- No Trivy run, by design: Chapter 3 forbids a superiority claim.
- `microsoft/fluentui-system-icons` full-tree scan timed out at 900 s. The
  exclude-SVG pass is a diagnostic, not the CI command.
- `sharkdp/bat`'s 92 submodules were not present in the depth-1 sample clone, and
  the anchoring workflow does not recurse submodules either.
- Duplicate Actions entries (the same `actions/checkout` cited from several
  workflow files) inflate component counts without adding packages.
