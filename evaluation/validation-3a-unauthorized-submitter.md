# Validation 3a — an unauthorised account cannot write an anchor

Run on 2026-07-29 against the live deployments at commit `91835dc`.
Raw output: `data/validation-3a-unauthorized-submitter.json`.
Regenerate with `npx ts-node --transpile-only scripts/validate-unauthorized-submitter.ts --send`.

## What is being tested

Everything an anchor is worth rests on one line of `AnchorRegistry.sol`:

```solidity
if (!_allowlist[projectId][msg.sender]) revert NotAllowlisted(projectId, msg.sender);
```

If any account could write anchors under a project identifier, an attacker could
publish the tree hash of their own modified source. A verifier would fetch it,
find a match, and conclude the modified source was the released source. The
registry would not merely fail to help — it would give tampering a credential.

The unit suite already covers this rule (`test/AnchorRegistry.test.ts`, "rejects a
submission from an account not allowlisted for the project"). That establishes
the rule holds in the compiled source. It cannot establish that the bytecode
actually deployed to a given address enforces it, since a deployment can go
wrong in ways a local test never sees. This test closes that gap on both live
chains, and produces transaction hashes a reader can check independently.

## Method

For each deployment: generate a fresh keypair that has never been allowlisted,
confirm `isAllowlisted` returns false for it, then attempt `anchor()` twice —
once as a simulated call, which returns the decoded revert reason at no cost, and
once as a broadcast transaction, which leaves a permanent failed receipt. Read
the stored anchor before and after to confirm nothing moved.

The submitted tree hash is a deliberately forged value, so a success would have
written a hash corresponding to no real commit.

## Observed

| | Arbitrum Sepolia | OP Sepolia |
| --- | --- | --- |
| Registry | `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` | `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` |
| Unauthorised account | `0x9F6C3cF3633b6d13F32B1d8f35267A81E4492b9E` | `0xF41E78803452A454Dc14A6a48a940b26Ead5cB48` |
| `isAllowlisted` before attempt | `false` | `false` |
| Simulated call | reverted `NotAllowlisted` | reverted `NotAllowlisted` |
| Broadcast transaction | `0xb2f9c47dd4b89da6c50b35c2f2bc89eb52631e447304abe3bb5fbd19114329f2` | `0xefdcdb7acd5c2f885cd7b30e4560bb92e9e4604b54807b128633b3047a9f4256` |
| Receipt status | `0` (reverted) | `0` (reverted) |
| Gas burned on the failed attempt | 28,111 | 28,111 |
| Stored anchor afterwards | unchanged | unchanged |

The revert decoded with both of its arguments, naming the project identifier and
the rejected caller:

```
NotAllowlisted(
  projectId = 0xd5a2d84a505835208164492fb3b9cf1331b361eed0e7ad977639f2a7aae6264e,
  caller    = 0x9F6C3cF3633b6d13F32B1d8f35267A81E4492b9E
)
```

## Result

The deployed bytecode enforces the allowlist on both chains. The attempt failed
at the access-control check rather than partway through, so no storage was
touched and the existing anchor for the reference kept its original value and
revision number. The failed attempt still cost the attacker gas, which is a
minor property but worth noting: rejection is not free to spam.

Custom error decoding required adding the contract's `error` fragments to
`ANCHOR_REGISTRY_ABI` in `cli/src/lib/chain.ts`. Without them ethers returns raw
selector bytes, so the CLI would have reported an opaque failure rather than a
named reason. That improves CLI diagnostics generally, not just this test.

## Scope

This shows an account outside the allowlist cannot write. It says nothing about
an attacker who obtains an allowlisted key — that account is authorised by
construction, and the design's answer there is that the anchor records which
address submitted it, making the compromise attributable after the fact rather
than preventable. Key compromise is not in scope for this test.
