# Tying deployed bytecode to a state of the source

Verified 2026-07-29. Re-run with `npm run verify:bytecode`.

## Why this is needed

A deployment record naming an address, a compiler version and optimizer settings
still leaves the important question open: *which source* produced that bytecode.
Without an answer, "the contract at `0x253F…` is this repository's
`AnchorRegistry`" is an assertion the reader has to take on faith — an awkward gap
in a project whose argument is that verification should not require trusting the
author.

`solc` embeds a hash of the source in the compiled output's metadata, so the
match is exact or it is nothing. That makes the property checkable, and it also
means a single changed comment breaks it.

## Method

Compile `contracts/` locally, read `deployedBytecode` from the Hardhat artifact,
fetch `eth_getCode` at each recorded address, and compare. `AnchorRegistry` takes
no constructor arguments, links no libraries, and uses no immutables, so the
runtime bytecode is expected to be byte-identical rather than merely equivalent.

## Result

The commit was established rather than assumed. `contracts/AnchorRegistry.sol` was
byte-identical from `d102d4f` through `fd92f8a` — the same blob hash
`3b38834a90d2cccec5c3ec04a5bfd2ce619bb18f` in every commit in that range — and
`d102d4f` was HEAD when the deployment transactions were mined. Compiling that
version produced an exact match:

| | value |
| --- | --- |
| Source commit | `d102d4fe891c763da02540618bc3771595183781` |
| Runtime bytecode length | 3,825 bytes |
| keccak256 of compiled output | `0x3c29b50bab2a01f087880f46a7b8a9406a1fe3dc1c938fd62ffe106a3c2d99ec` |
| keccak256 on Arbitrum Sepolia | `0x3c29b50bab2a01f087880f46a7b8a9406a1fe3dc1c938fd62ffe106a3c2d99ec` |
| keccak256 on OP Sepolia | `0x3c29b50bab2a01f087880f46a7b8a9406a1fe3dc1c938fd62ffe106a3c2d99ec` |

Both deployments run identical code, and that code is the compiled output of a
named commit. `sourceCommit` and `sourceClean` are now recorded in each file under
`deployments/`, and `scripts/deploy.ts` captures both automatically, warning if
`contracts/` had uncommitted changes at deployment time.

## Current source does not match, and that is expected

`3fca5d3` edited a comment in `AnchorRegistry.sol` to remove a documentation
reference that pointed outside the repository. The bytecode is the same length,
3,825 bytes, but hashes to
`0x709459fb9cd23ea402d0a581914977dbfce4fcc0f9d59f57af53fe4cc55db9d1` — the
metadata hash changed and nothing else did.

`npm run verify:bytecode` therefore distinguishes two cases rather than reporting
any mismatch as a failure:

- `contracts/` is identical to the recorded `sourceCommit` but the bytecode
  differs — a real discrepancy, exit code 1.
- `contracts/` has changed since that commit — expected, reported with the
  `git checkout` command needed to reproduce the match, exit code 0.

To reproduce the match yourself:

```sh
git checkout d102d4fe891c763da02540618bc3771595183781 -- contracts/
npx hardhat compile
npm run verify:bytecode
git checkout HEAD -- contracts/
```

## Consequence for explorer verification

If these contracts are submitted to Arbiscan or a similar explorer, the source
must be the version at `d102d4f`, not at `HEAD`. Submitting current source will
fail the metadata comparison even though the logic is unchanged.
