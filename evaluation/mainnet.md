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
3. `gpa anchor --tag v0.4.0-m4` on each mainnet
4. `gpa verify --tag v0.4.0-m4 --ref v0.4.0-m4` → **pass** on all three

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
| Anchor `v0.4.0-m4` | [`0xee5213bd…b248`](https://arbiscan.io/tx/0xee5213bd9b25d014aa56734202f486cff2f2e1b3e59e38ba70f599eb8808b248) | 79,708 | 0.00000159 |

### OP Mainnet

| Step | Tx | Gas used | Fee (ETH) |
| --- | --- | --- | --- |
| Deploy | [`0x2d2dcffd…af62`](https://optimistic.etherscan.io/tx/0x2d2dcffd24b739d5a0dbf03c69d17cf1f4e93f3269a642970c7169db8289af62) | 879,549 | ~5.6×10⁻¹⁰ |
| Register | [`0x454474f7…060b`](https://optimistic.etherscan.io/tx/0x454474f7840a0d7860d2fdbfd917ce7ffd4b5e90443015cad260a91d3995060b) | 94,630 | 9.5×10⁻⁸ |
| Allowlist CI | [`0xc7fba234…bf46`](https://optimistic.etherscan.io/tx/0xc7fba2345c737f1ee65271f9623d7968a6cf91c19cd9e84601cfde303814bf46) | 48,679 | 4.9×10⁻⁸ |
| Anchor `v0.4.0-m4` | [`0x560c03a0…45a2`](https://optimistic.etherscan.io/tx/0x560c03a0f69878623de2d71c71bc54ee5bc5868226c404c45e236756185645a2) | 79,276 | 7.9×10⁻⁸ |

OP fees were negligible in this window (sub-cent). Exact deploy tx hash is in
`deployments/opMainnet.json`.

### zkSync Era

| Step | Tx | Gas used (EraVM) | Fee (ETH) |
| --- | --- | --- | --- |
| Deploy | [`0x43483095…180e`](https://explorer.zksync.io/tx/0x43483095359b30fae087d5fc83b4969b1103bfd800c0e1d4e125027494c9180e) | 1,191,265 | 0.00005390 |
| Register | [`0x8ab19581…a582`](https://explorer.zksync.io/tx/0x8ab19581bee210ea47dbb26bb14e0920ca07bc06a510e7df039be0c5e276a582) | 104,755 | 0.00000474 |
| Allowlist CI | [`0x1f05cfff…8196`](https://explorer.zksync.io/tx/0x1f05cfff2e6ca22745b390381ca97182233e33ce0daa42f631811c1f17738196) | 90,960 | 0.00000412 |
| Anchor `v0.4.0-m4` | [`0x485190f0…cf9e`](https://explorer.zksync.io/tx/0x485190f0fb7965d1c047d6f846f50e69023fdbb3bdc0e9f17c113440f053cf9e) | 106,249 | 0.00000481 |

EraVM gas units are not comparable to the EVM column. Report fees in ETH/USD
beside the EVM rows; do not ratio the gas figures.

## Reproduce

```bash
npm run balances
npm run gpa -- verify --tag v0.4.0-m4 --ref v0.4.0-m4 \
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
