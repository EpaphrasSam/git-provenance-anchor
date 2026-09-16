# Ethereum mainnet cost comparator

Collected 2026-09-16. Raw fees: `data/ethereum-mainnet.json`.

One live `AnchorRegistry` deployment on Ethereum mainnet, plus one with-SBOM
release-shaped `anchor`. This is the missing paid L1 figure the cost comparison
needed. It is not a year-long series.

## Registry

| | |
| --- | --- |
| Network | Ethereum (chain id 1) |
| Registry | `0x253F20c2b74dc44B4ea908bE6674EEC8deA72622` |
| Deployer | `0x52eaE29937b149B7a0f3D7516C81aD561B96c043` |
| Source commit | `d6e43b68` |
| solc | 0.8.28, optimizer 200 runs |

The CREATE address matches the Arbitrum One registry because this key's Ethereum
nonce was 0, the same coincidence already noted for Arbitrum One and zkSync Era.
They are different chains and different contracts.

## Fees paid

ETH amounts from receipts (`gasUsed x effectiveGasPrice`). Rough USD uses ≈ $2500/ETH
at collection and is only illustrative.

| Step | Tx | Gas used | Fee (ETH) |
| --- | --- | --- | --- |
| Deploy | [`0x35137804…18f8`](https://etherscan.io/tx/0x351378041bad33d5a427422ec46bbd97ab1cccaf1309533eaea23fd309a418f8) | 879,549 | 0.00024394 |
| Register | [`0xd2a278e8…1316`](https://etherscan.io/tx/0xd2a278e88b7b45b0123bc2eb11e2b6c916c59eb593e3722f33ece66c1d921316) | 94,630 | 0.00002017 |
| With-SBOM tag anchor `v1.0.1` | [`0x77e6af33…3271`](https://etherscan.io/tx/0x77e6af3367e178c8f7e13e9a553e2f96f7e3102cde8f4e75616da6e848683271) | 99,512 | 0.00002187 |

The anchor used the frozen `v1.0.1` tree `c292e36f7a3a2455432b4a3670807f4e133ed559`
and the GitHub SBOM digest from that tag, so the storage writes match the L2
first-write with-SBOM shape. Gas used is 99,512, identical to the OP Mainnet
revision-1 receipt.

## Against the three L2 receipts

Comparator receipts are the retained `v1.0.1` revision-1 anchors, paid on
2026-08-12, not today.

| Network | Anchor fee (ETH) | This L1 fee / that fee |
| --- | --- | --- |
| Ethereum | 0.00002187 | 1 |
| Arbitrum One | 2.00550342e-6 | 10.9 |
| zkSync Era | 5.66353525e-6 | 3.86 |
| OP Mainnet | 1.01805679742e-7 | 215 |

OP Mainnet remains the cheapest of the four paid figures. Ethereum is about
eleven times Arbitrum One and about four times zkSync Era in this pair of
receipts. The L2 transactions were not submitted in the same block as the L1
one, so the ratios compare two real payments, not a simultaneous auction.

## What this does not show

A 365-point L1 distribution is still a reconstruction, not 365 live mainnet
anchors. Blob fees are not part of this call. GitHub Actions `GPA_NETWORKS`
must stay on the three L2s; the CI key is not funded or allowlisted here.
