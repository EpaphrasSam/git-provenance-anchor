# Mainnet deployments (Phase A)

Collected 2026-08-12 at source commit `34f16716`.
Raw fees: `data/mainnet-phase-a.json`.

Live `AnchorRegistry` deployments on the three production L2s the project targets,
plus one smoke anchor per chain. Gas **units** still match the testnet EVM column
where the VM is the same; the new data are the **fees actually paid**.

## Registries

| Network | Chain ID | Registry | VM |
| --- | --- | --- | --- |
| Arbitrum One | 42161 | `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` | EVM |
| OP Mainnet | 10 | `0x18600ECbC47aC362240b2CD87d92345eD426DC08` | EVM |
| zkSync Era | 324 | `0x49eD55AD9Ae06f4652cA0082D861Cd4B0aB1fDAB` | EraVM |

Full records under `deployments/{arbitrumOne,opMainnet,zkSyncEra}.json`.
Deployer: `0x52eaE29937b149B7a0f3D7516C81aD561B96c043`.

Arbitrum One and zkSync Era landed at the same addresses as their Sepolia
deployments because the deployer nonce path coincided; OP Mainnet differs because
prior Optimism activity advanced the nonce before deploy.

## Smoke path

Same project id as the testnets (`git-provenance-anchor` / manifest
`0xd5a2d84a…264e`):

1. `gpa register` on each mainnet
2. `gpa allowlist add 0x1318dA3655688daeFc4DA89ABAeDA33eA4A6e341` (CI key)
3. Submit one no-SBOM tag anchor on each mainnet
4. Verify the three no-SBOM tag anchors: **pass** on all three

Tree hash: `bfc4700b1f0376c4a19722440a3c132fea20681b`.

## Fees paid (this session)

ETH amounts from transaction receipts (`receipt.fee`). Rough USD uses ≈ $1900/ETH
at collection time and is illustrative only.

### Arbitrum One

| Step | Tx | Gas used | Fee (ETH) |
| --- | --- | --- | --- |
| Deploy | [`0x2aa7ab32…90eb`](https://arbiscan.io/tx/0x2aa7ab323682ead3af237d0805c3ea2cd53ff2549ef4790db4d43c6e392a90eb) | 883,340 | 0.00001772 |
| Register | [`0x75d36c1e…6b8c`](https://arbiscan.io/tx/0x75d36c1e3661276bf282c5ce9285e92bd8c425597bffd2b700904aab2ece6b8c) | 95,005 | 0.00000190 |
| Allowlist CI | [`0xb48e5582…fc26`](https://arbiscan.io/tx/0xb48e5582a36eecb9b771425e1bfb5ff6a72254e5da9d4331540b7b33635afc26) | 48,953 | 0.00000098 |
| No-SBOM smoke anchor | [`0xee5213bd…b248`](https://arbiscan.io/tx/0xee5213bd9b25d014aa56734202f486cff2f2e1b3e59e38ba70f599eb8808b248) | 79,708 | 0.00000159 |

### OP Mainnet

Fees in this table are the **L2 execution component only**; see the note beneath
it for the `l1Fee` that OP Stack reports separately.

| Step | Tx | Gas used | Fee (ETH, L2 only) |
| --- | --- | --- | --- |
| Deploy | [`0x2d2dcffd…af62`](https://optimistic.etherscan.io/tx/0x2d2dcffd24b739d5a0dbf03c69d17cf1f4e93f3269a642970c7169db8289af62) | 879,549 | ~5.6×10⁻¹⁰ |
| Register | [`0x454474f7…060b`](https://optimistic.etherscan.io/tx/0x454474f7840a0d7860d2fdbfd917ce7ffd4b5e90443015cad260a91d3995060b) | 94,630 | 9.5×10⁻⁸ |
| Allowlist CI | [`0xc7fba234…bf46`](https://optimistic.etherscan.io/tx/0xc7fba2345c737f1ee65271f9623d7968a6cf91c19cd9e84601cfde303814bf46) | 48,679 | 4.9×10⁻⁸ |
| No-SBOM smoke anchor | [`0x560c03a0…45a2`](https://optimistic.etherscan.io/tx/0x560c03a0f69878623de2d71c71bc54ee5bc5868226c404c45e236756185645a2) | 79,276 | 7.9×10⁻⁸ |
| Snapshot anchor `main` | [`0x5fb9a342…1a73`](https://optimistic.etherscan.io/tx/0x5fb9a3421140f4d07e64e3c366d05958c3e6de2f3019ab82a36ab04690aa1a73) | 79,216 | 7.9×10⁻⁸ |

OP fees were negligible in this window (sub-cent). Exact deploy tx hash is in
`deployments/opMainnet.json`.

### The snapshot anchor

Submitted 2026-08-12T18:14:23Z in block 155,479,843, one transaction only, with no
schedule enabled. It exists so that the second mechanism in `rq2-strategies.md` is
a demonstrated write path rather than a described one.

Decoded from the `AnchorSubmitted` log:

| Field | Value |
| --- | --- |
| Project id | `0xd5a2d84a…264e` (same as the tag anchors) |
| Kind | `1`, `KIND_SNAPSHOT` |
| Ref | `main` |
| Tree hash | `9bbb494a8d862b597e27bfd69f798ba6ce00fc41` |
| SBOM hash | zero, not generated for a snapshot |
| Revision | 1 |
| Calldata | 228 bytes, identical to the Phase A no-SBOM tag smoke anchor |

At 79,216 gas it costs 60 gas less than the Phase A no-SBOM tag smoke anchor's
79,276, the difference being the shorter reference string. This is the transaction
shape used by the RQ2 snapshot cost table. It is separate from RQ1's 99,512-gas OP
release anchor with a non-zero SBOM hash.

The anchored tree is that of commit `dced3a8`, the committed state of `main`, not
the working tree, so the uncommitted workflow templates are correctly absent from
it. `gpa reverify --network opMainnet` passes on both the tag and the snapshot.

One operational note worth recording. The first attempt failed on an OP nonce
race: the provider offered nonce 0 while the account's next nonce was 6.
`getWriteContract` now waits for the network and primes the nonce manager before
signing, and the retry confirmed at nonce 6. Anyone anchoring to several chains
from one key should expect this.

**The historical OP table reports the L2 execution component only.** Ethers'
`receipt.fee` omits the separate `l1Fee` field that OP Stack receipts carry for
posting to L1. RQ1 instead uses the final revision-1 receipt: `l1Fee` is
2.257258350e9 wei, the true total is 1.01805679742e-7 ETH, and L1 accounts for
2.22%. See `fee-distribution.md`.
Arbitrum and zkSync are unaffected: both price L1 costs inside `gasUsed`, so their
receipt fees are already complete.

### zkSync Era

| Step | Tx | Gas used (EraVM) | Fee (ETH) |
| --- | --- | --- | --- |
| Deploy | [`0x43483095…180e`](https://explorer.zksync.io/tx/0x43483095359b30fae087d5fc83b4969b1103bfd800c0e1d4e125027494c9180e) | 1,191,265 | 0.00005390 |
| Register | [`0x8ab19581…a582`](https://explorer.zksync.io/tx/0x8ab19581bee210ea47dbb26bb14e0920ca07bc06a510e7df039be0c5e276a582) | 104,755 | 0.00000474 |
| Allowlist CI | [`0x1f05cfff…8196`](https://explorer.zksync.io/tx/0x1f05cfff2e6ca22745b390381ca97182233e33ce0daa42f631811c1f17738196) | 90,960 | 0.00000412 |
| No-SBOM smoke anchor | [`0x485190f0…cf9e`](https://explorer.zksync.io/tx/0x485190f0fb7965d1c047d6f846f50e69023fdbb3bdc0e9f17c113440f053cf9e) | 106,249 | 0.00000481 |

EraVM gas units are not comparable to the EVM column. Report fees in ETH/USD
beside the EVM rows; do not ratio the gas figures.

## Reproduce

```bash
npm run balances
npm run gpa -- verify --tag v1.0.1 --ref v1.0.1 \
  --network arbitrumOne --network opMainnet --network zkSyncEra
```

Deploy again only if you intend a **new** registry; these addresses are already live.

## Commands used to deploy

```bash
npm run deploy:arbitrum-one
npm run deploy:op-mainnet
npx hardhat compile --network zkSyncEra --force --no-typechain
npm run deploy:zksync-era
```

## The v1.0.1 freeze: dual-platform anchors on all three mainnets

The final freeze is npm `git-provenance-anchor@1.0.1`, tag `v1.0.1`, commit
`505671a747ad353ca197401ed845fa472ac728df`, and tree
`c292e36f7a3a2455432b4a3670807f4e133ed559`. It contains the current verifier and
workflow templates. Both CI platforms anchored the tag to all three production
networks. GitHub Actions
([run 31694857846](https://github.com/EpaphrasSam/git-provenance-anchor/actions/runs/31694857846))
wrote revision 1, and GitLab CI
([pipeline 2757243164](https://gitlab.com/EpaphrasSam/git-provenance-anchor/-/pipelines/2757243164),
[job 15878624224](https://gitlab.com/EpaphrasSam/git-provenance-anchor/-/jobs/15878624224))
wrote revision 2. Both jobs succeeded, and post-submit tree and SBOM verification
passed on all three networks.

Both revisions record the same Git tree. Each platform generated its own CycloneDX
document, so the SBOM hashes differ: GitHub recorded
`4c21791f4b8c7cc9bb5200cf195309223457207a054c48986199c9a5e333a154`, while
GitLab recorded
`ff6970bcffdcee3e13bea94d20c88fad7f159416db5afffff90d7837a287a8fb`.
The latest getter returns GitLab revision 2. GitHub revision 1 remains available
in the event history.

| Network | GitHub (rev 1) | GitLab (rev 2) |
| --- | --- | --- |
| Arbitrum One | `0x100a342fa6383ab540cb5da85c90a7d5dda2db382b4ac381bedb0ce8099ad654` | `0x72ebb095616fcfc70b8d828b2b9742687d25fcd7f6438e3fbccece05d4042314` |
| OP Mainnet | `0x46f8761006ee59236ed579469b5b46873efd3db086d6039dc6ba5758c95ab3ba` | `0xc3b3294fa6f6e332f78cb8eb574577e8c6d4729cb8b5dd0ecb5af204ee59b66c` |
| zkSync Era | `0x57a58f76c90cfe99efdd1977461567113b9a8c2c4fc0eb66f3abd3654e85b1a3` | `0xf184545e7b83bdbe4e41a2e56df0c76069ae44e48a643d1be2eba254f7b39932` |

The revision-1 receipt shapes used for RQ1 are 100,095 gas on Arbitrum One,
99,512 gas on OP Mainnet, and 125,161 EraVM gas on zkSync Era. EraVM units should
not be ratioed against EVM units.
