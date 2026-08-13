# git-provenance-anchor

Trust-minimized software provenance for Git, using selective Layer-2 blockchain anchoring.

Lets anyone verify, without trusting any operator, that the code a project distributes is the code its
maintainers actually released. Research artifact accompanying an MPhil thesis at Kwame Nkrumah
University of Science and Technology.

## What it does

**At release time.** A tag push triggers a dedicated, minimal CI workflow that never invokes the
project's own build scripts. It checks out the tagged state, takes the tree hash Git already maintains
(`git rev-parse <tag>^{tree}`), generates a CycloneDX SBOM with Syft and hashes it, then submits both
hashes to the `AnchorRegistry` contract on each target network. The contract checks the sender is on
that project's allowlist and records the submission permanently.

Only hashes go on-chain, so the cost of anchoring does not depend on repository size.

**At verification time.** A consumer recomputes the tree hash from a downloaded artifact, reads the
anchor from the chain — free and without permission — and compares. Files present in the artifact but
absent from the anchored tree are checked against a repository-tracked manifest declaring expected
build-generated files; undeclared additions are flagged. A separate mode re-checks already-anchored
tags against the repository's current state, catching retroactive tag moves.

The system is a **detective** control, not a preventive one: it converts silent tampering into
detectable mismatch. It does not detect an attacker who has stolen a project's anchoring key, which is
bounded by per-repository keys and on-chain revocation rather than prevented.

## Supported networks

| Network | Status |
|---------|--------|
| Arbitrum One | Live at `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` |
| OP Mainnet | Live at `0x18600ECbC47aC362240b2CD87d92345eD426DC08` |
| zkSync Era | Live at `0x49eD55AD9Ae06f4652cA0082D861Cd4B0aB1fDAB` |
| Arbitrum Sepolia | Live at `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` |
| OP Sepolia | Live at `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` |
| zkSync Era Sepolia | Live at `0x49eD55AD9Ae06f4652cA0082D861Cd4B0aB1fDAB` |
| Any EVM chain | Deployable with `scripts/deploy.ts` and a network entry in `hardhat.config.ts` |

Anchoring to several chains at once is the intended configuration, so that no
single chain's availability determines whether a release can be verified.

## Verified properties

Each claim below has a record under `evaluation/` with the evidence and a command
to reproduce it. Full index in [`evaluation/README.md`](evaluation/README.md).

- A live deployment refuses anchors from accounts outside the project allowlist —
  `evaluation/access-control.md`
- The anchored tree hash is identical on Windows, Linux, a CI runner, and an
  independent reimplementation — `evaluation/cross-platform-determinism.md`
- A tag push anchors on-chain with no human in the loop —
  `evaluation/ci-end-to-end.md`
- Gas per operation, measured on live deployments — `evaluation/gas-and-cost.md`
- The code at each recorded address is the compiled output of a named commit —
  `evaluation/deployed-bytecode.md`
- zkSync Era Sepolia runs the same contract under EraVM with its own gas column —
  `evaluation/zksync-sepolia.md`
- Force-moving an already-anchored tag is flagged by `gpa reverify` —
  `evaluation/tag-retargeting.md`
- Mainnet registries on Arbitrum One, OP Mainnet, and zkSync Era, with fees paid
  for deploy and a smoke anchor — `evaluation/mainnet.md`

If you deploy your own registry, run `npm run check:access-control` against it.
A failure means the deployment is not what you think it is.

## Adopting this in your own repository

1. Deploy `AnchorRegistry`, or reuse an existing deployment record in `deployments/`.
2. Run `gpa init` to create `.provenance-manifest.json`, then `gpa register`.
3. Generate a **dedicated** key for CI, fund it on each target network, and authorise it with
   `gpa allowlist add <address>`. Never reuse a personal wallet.
4. Store that key as the `ANCHOR_DEPLOYER_KEY` repository secret, and optionally set a
   `GPA_NETWORKS` variable to restrict which networks are anchored.
5. Copy `workflows/provenance-anchor.yml` to `.github/workflows/`, add a CODEOWNERS entry for it,
   and protect the branch — **including `enforce_admins`**, see below.
6. Optionally copy `workflows/provenance-reverify.yml` (daily, read-only; on by default in the
   RQ2 recommendation) and, if release cadence is slow, `workflows/provenance-snapshot.yml`
   (weekly `KIND_SNAPSHOT` of the default branch). GitLab twins live beside them.

Pushing a `v*` tag then anchors that tag with no manual step.

### Protect the workflow properly

The anchoring job is the only thing that writes to the chain, so disabling it is the cheapest
attack available to anyone with write access. Requiring pull requests and code-owner review is
**not sufficient on its own**: GitHub exempts repository admins from branch protection by default,
so an admin — the account a compromised maintainer holds — can push directly to the protected
branch and GitHub will merely log that it happened.

```bash
gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null
}
JSON
```

`enforce_admins` is the field that matters. Note that a solo maintainer cannot merge under one
required approval, since an author cannot approve their own pull request; use zero required
approvals in that case, which still blocks direct pushes.

The observed behaviour of both configurations is recorded in
`evaluation/workflow-tamper-protection.md`. Even without any protection, editing the workflow
changes the repository's tree hash, so the edit is detectable — but detection after a release is
worse than refusal before one.

## Install

```bash
npm install -g git-provenance-anchor
gpa --help
```

Without a global install:

```bash
npx git-provenance-anchor@0.1.1 --help
```

This is a research prototype, not a production product. Clone this repository to reproduce the
evaluation; `npm run gpa` still runs the local TypeScript tree.

## Requirements

Node.js 20 or later. No wallet or funded account is needed to compile, test, or deploy locally.

## Quick start

```bash
npm install
npm run build          # compile contracts
npm test               # contract + CLI tests (includes Windows and WSL Git oracles)
npm run test:gas       # run tests with a gas report
npm run deploy:local   # deploy to an ephemeral in-process chain
npm run gpa -- --help  # verifier / maintainer CLI
```

### CLI quick path

```bash
npm run gpa -- init
npm run gpa -- register
npm run gpa -- anchor --tag v1.0.0
# Prefer --ref on Windows so core.autocrlf cannot rewrite archive bytes:
npm run gpa -- verify --ref v1.0.0 --tag v1.0.0
npm run gpa -- reverify
```

`verify` against a directory hashes the files on disk. Release tarballs and `verify --ref`
read object-store bytes, which is what CI anchors. On Windows, a plain `git archive` with
`core.autocrlf=true` can inject CRLF and fail verification even when the tag is honest —
`--ref` forces `core.autocrlf=false` for the temporary export.

Deploying to a testnet needs a funded key. Copy `.env.example` to `.env`, set
`ANCHOR_DEPLOYER_KEY`, then:

```bash
npm run deploy:arbitrum-sepolia
npm run deploy:op-sepolia
npm run deploy:zksync-sepolia   # requires npm run build:zk and funded zkSync ETH
npm run deploy:arbitrum-one
npm run deploy:op-mainnet
npm run deploy:zksync-era      # requires zk compile --network zkSyncEra
```

Use a dedicated key, never a personal wallet. Deployment records are written to
`deployments/<network>.json` with the address, block number, gas used, compiler settings, and the
commit `contracts/` was at — without which nothing ties the deployed bytecode to a state of the
repository. Check that link at any time with `npm run verify:bytecode`.

## Repository layout

```
contracts/          AnchorRegistry.sol
test/               contract and CLI test suites
scripts/            deployment, operational and measurement scripts
deployments/        per-network deployment records
cli/                verifier CLI (`gpa`)
workflows/          CI templates for adopting projects
.github/workflows/  this repository's own anchoring workflow
manifest-schema/    JSON Schema for .provenance-manifest.json
evaluation/         measured properties, evidence, and raw collected data
```

`workflows/` holds templates that **adopting projects copy into their own repositories**. It is not CI
configuration for this repository.

`artifacts/`, `cache/`, `typechain-types/` and `node_modules/` are generated and git-ignored. They can
be deleted at any time and rebuilt with `npm install && npm run build`.

## Contract design

The contract's responsibilities are deliberately narrow: record what an authorised account submits,
reject everything else, and serve reads to anyone. It has no ability to fetch a repository or to check
that a submitted hash is correct for a given tag. All substantive verification happens in the CLI.

**No upgrade proxy, no administrative role.** Contract code is fixed at deployment. A proxy would let
an admin key change behaviour after users had begun relying on it, which is the operator-control
pattern this system exists to avoid. A fix means a new deployment at a new address; existing records
remain readable forever. There is no account that can alter another project's records, pause the
registry, or accept ether. A test asserts the complete set of state-changing functions, so adding one
requires a deliberate decision.

**Self-chosen project identifiers.** Projects are identified by a `bytes32` they claim once, not by an
`owner/name` string or a platform ID. Both alternatives would make a hosting provider the naming
authority, and the self-chosen identifier survives renames, transfers, and platform migration. A
human-readable label is stored alongside for display only, never for authorisation. Registration is
first come, first served; the residual risk is that someone claims an identifier resembling a project
they do not own, which correct verification through the manifest defeats and which costs the claimant
a transaction fee to attempt.

**Anchors are keyed on `keccak256(projectId, kind, ref)`.** The reference is passed as a string and
emitted in readable form in the event, rather than accepted pre-hashed. This is required, not
cosmetic: the CLI's re-verification mode must check *every* anchored reference, and if only a hash
reached the chain a verifier could confirm references it already knew but never discover which exist.
Including `kind` in the key prevents a tag and a branch snapshot sharing a name from overwriting one
another.

**Storage holds the latest record per key; events hold every submission.** Re-anchoring a reference
supersedes the stored record and increments its revision counter, while the superseded submission
remains permanently readable in the event log. Storage is the expensive resource and only the current
record needs cheap direct lookup; history is read exclusively by external tooling, which events serve
at a fraction of the cost.

**Hashes are `bytes32`, left-padded.** A Git tree hash is SHA-1, twenty bytes; `bytes32` accommodates
it with padding and also fits repositories using SHA-256 objects without a contract change. The
padding direction must match in the contract and in off-chain tooling — a mismatch produces
verification failures on entirely honest releases that are indistinguishable from tampering. Zero is
rejected for `treeHash` on submission, which reserves it as an unambiguous "no such anchor" value.
`sbomHash` may be zero, since a repository with no packages the generator recognises is legitimate.

**`Anchor` struct field order is load-bearing.** The timestamp, submitter and revision fields pack into
a single 32-byte slot (8 + 20 + 4), giving three slots in total. Reordering them, or widening the
timestamp to `uint256`, adds a slot to every anchor permanently.

**`ref` must stay unindexed in the event.** Indexing a string retains only its hash and discards the
value, which would break reference enumeration. A test asserts readable references come back out of
the log.

## Measured gas

Solidity 0.8.28, optimizer enabled, 200 runs. Figures from the local test suite
(`npm run test:gas`), using short fixture reference names.

| Operation | Gas |
|-----------|-----|
| Deployment | 879,549 |
| First anchor | 99,524 |
| Re-anchor (supersede) | 45,424 |
| `registerProject` | 94,558 |
| `allowlistAdd` | 48,679 |
| `allowlistRemove` | 26,819 |
| `transferOwnership` | 53,775 |

These are units of work, fixed by the contract and independent of network conditions. Currency cost
is gas multiplied by a live gas price, which no local or test network can meaningfully supply.

A first anchor decomposes as 21,000 for the base transaction, 66,300 for three previously empty
storage slots, and the remainder in calldata and the event. Supersession is cheaper than half a first
anchor because those slots already hold values. Anchoring without an SBOM digest leaves one of those
slots at zero and costs about 20,000 less, since writing zero over zero is free.

The reference name is part of the calldata, so real tag names cost slightly more than the short
fixtures used above. Figures measured against the live deployments, with real tag names, are in
`evaluation/gas-and-cost.md`; run `npm run evidence` to reproduce them against any deployment.

## Testing

```bash
npm test
```

Tests run against an in-process chain, using snapshot-and-restore so each test gets clean state without
redeploying. Signers are named by role — `owner`, `maintainer`, `attacker`, `reader` — because
switching signer is the only way to change what the contract sees as `msg.sender`, and a test asserting
an authorisation boundary should say plainly who is being refused.

Beyond behavioural coverage, the suite asserts properties of *absence*: the exact set of state-changing
functions, and that no route exists to accept ether. Those are the tests defending the claim that no
privileged capability exists, and they are worth more as tests than as prose.

## Toolchain

Versions are pinned exactly, and `package-lock.json` freezes transitive dependencies. Reproducing the
build requires `npm ci` rather than `npm install`.

Hardhat is pinned to 2.x because the zkSync Era plugins do not yet support Hardhat 3. Solidity is
0.8.28. The zkSync stack is pinned together — `@matterlabs/hardhat-zksync-solc` 1.5.1 with
`zksolc` 1.5.15 — because the plugin validates `zksolc` against a remote allow-list; bumping one
without the other can break compile with no source change.

EVM and EraVM compile into separate artifact trees. Always build EVM for tests, and use
`--no-typechain` for zkSync so TypeChain factories stay EVM-compatible:

```bash
npm run build       # EVM → artifacts/ + typechain-types/
npm run build:zk    # EraVM → artifacts-zk/
npm run deploy:zksync-sepolia
```

Fund zkSync Sepolia with `npx ts-node --transpile-only scripts/bridge-zksync.ts` before deploying.
Details, including a Windows path-space caveat in the linker, are in
`evaluation/zksync-sepolia.md`.

The optimizer runs setting affects gas figures, so it is reported alongside them and recorded in every
deployment file.

## Licence

Apache-2.0.
