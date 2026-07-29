# Access control on a live deployment

Checked 2026-07-29 against both testnet deployments at commit `91835dc`.
Raw output: `data/access-control.json`.
Re-run with `npm run check:access-control -- --send`.

## Why this check exists

Everything an anchor is worth rests on one line of `AnchorRegistry.sol`:

```solidity
if (!_allowlist[projectId][msg.sender]) revert NotAllowlisted(projectId, msg.sender);
```

If any account could write anchors under a project identifier, an attacker could
publish the tree hash of their own modified source. A verifier would fetch it,
find a match, and conclude the modified source was the released source. The
registry would not merely fail to help — it would give tampering a credential.

The unit suite covers this rule (`test/AnchorRegistry.test.ts`, "rejects a
submission from an account not allowlisted for the project"), which establishes
that the rule holds in the compiled source. It cannot establish that the bytecode
actually deployed to a given address enforces it, because a deployment can go
wrong in ways a local test never sees — wrong constructor arguments, wrong
compiler settings, or an entirely different contract at the address you recorded.

**If you deploy your own registry, run this against it.** It is a post-deployment
smoke test, and a failure means your deployment is not what you think it is.

## Method

For each deployment: generate a fresh keypair that has never been allowlisted,
confirm `isAllowlisted` returns false for it, then attempt `anchor()` twice — once
as a simulated call, which returns the decoded revert reason at no cost, and once
as a broadcast transaction, which leaves a permanent failed receipt anyone can
look up. Read the stored anchor before and after to confirm nothing moved.

The submitted tree hash is a deliberately forged value, so a success would have
written a hash corresponding to no real commit.

Without `--send` the check only simulates, costs nothing, and needs no funded
account. With `--send` it funds the throwaway account from `ANCHOR_DEPLOYER_KEY`
and broadcasts, leaving a small amount of dust in an address nobody holds the key
to afterwards.

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

The revert decoded with both arguments, naming the project identifier and the
rejected caller:

```
NotAllowlisted(
  projectId = 0xd5a2d84a505835208164492fb3b9cf1331b361eed0e7ad977639f2a7aae6264e,
  caller    = 0x9F6C3cF3633b6d13F32B1d8f35267A81E4492b9E
)
```

## Result

The deployed bytecode enforces the allowlist on both chains. The attempt failed at
the access-control check rather than partway through, so no storage was touched
and the existing anchor kept its original value and revision number. The failed
attempt still cost the caller gas, so rejection is not free to spam.

Decoding the reason required the contract's `error` fragments in
`ANCHOR_REGISTRY_ABI` (`cli/src/lib/chain.ts`). Without them ethers returns raw
selector bytes and the CLI reports an opaque failure instead of a named one.

## What this does not cover

An attacker who obtains an allowlisted key is authorised by construction, and no
contract check can distinguish them from the legitimate holder. The design's
answer is that every anchor records the address that submitted it, making a
compromise attributable after the fact and revocable by the project owner through
`allowlistRemove`. Preventing key theft is out of scope.
