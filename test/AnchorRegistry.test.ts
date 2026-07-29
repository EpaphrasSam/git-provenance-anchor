import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { FunctionFragment } from "ethers";
import { AnchorRegistry__factory } from "../typechain-types";

const KIND_TAG = 0;
const KIND_SNAPSHOT = 1;

const PROJECT_ID = ethers.id("example/project");
const OTHER_PROJECT_ID = ethers.id("someone-else/project");
const LABEL = "example/project";

/// A Git tree hash is SHA-1: 20 bytes left-padded into bytes32, the convention the CLI must match.
const TREE_HASH = ethers.zeroPadValue("0x" + "ab".repeat(20), 32);
const TREE_HASH_2 = ethers.zeroPadValue("0x" + "cd".repeat(20), 32);
const SBOM_HASH = ethers.keccak256(ethers.toUtf8Bytes("cyclonedx-sbom"));

describe("AnchorRegistry", () => {
  async function deployFixture() {
    const [owner, maintainer, attacker, reader] = await ethers.getSigners();
    const registry = await new AnchorRegistry__factory(owner).deploy();
    await registry.waitForDeployment();
    return { registry, owner, maintainer, attacker, reader };
  }

  async function registeredFixture() {
    const base = await deployFixture();
    await base.registry.registerProject(PROJECT_ID, LABEL);
    return base;
  }

  describe("project registration", () => {
    it("claims an identifier, sets the caller as owner, and allowlists them", async () => {
      const { registry, owner } = await loadFixture(deployFixture);

      await expect(registry.registerProject(PROJECT_ID, LABEL))
        .to.emit(registry, "ProjectRegistered")
        .withArgs(PROJECT_ID, owner.address, LABEL)
        .and.to.emit(registry, "AllowlistChanged")
        .withArgs(PROJECT_ID, owner.address, true);

      const [storedOwner, storedLabel] = await registry.getProject(PROJECT_ID);
      expect(storedOwner).to.equal(owner.address);
      expect(storedLabel).to.equal(LABEL);
      expect(await registry.isAllowlisted(PROJECT_ID, owner.address)).to.be.true;
    });

    it("rejects a second claim on the same identifier", async () => {
      const { registry, attacker } = await loadFixture(registeredFixture);

      await expect(registry.connect(attacker).registerProject(PROJECT_ID, "impostor"))
        .to.be.revertedWithCustomError(registry, "ProjectAlreadyRegistered")
        .withArgs(PROJECT_ID);
    });

    it("rejects the zero identifier", async () => {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.registerProject(ethers.ZeroHash, LABEL)).to.be.revertedWithCustomError(
        registry,
        "ProjectIdZero"
      );
    });
  });

  describe("anchoring", () => {
    it("records a tree hash and SBOM hash at revision one", async () => {
      const { registry, owner } = await loadFixture(registeredFixture);

      await expect(registry.anchor(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH, SBOM_HASH))
        .to.emit(registry, "AnchorSubmitted")
        .withArgs(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH, SBOM_HASH, owner.address, 1);

      const record = await registry.getAnchor(PROJECT_ID, KIND_TAG, "v1.0.0");
      expect(record.treeHash).to.equal(TREE_HASH);
      expect(record.sbomHash).to.equal(SBOM_HASH);
      expect(record.submitter).to.equal(owner.address);
      expect(record.revision).to.equal(1);
      expect(record.timestamp).to.be.greaterThan(0);
    });

    it("accepts a zero SBOM hash, since a repository may have no recognised packages", async () => {
      const { registry } = await loadFixture(registeredFixture);
      await expect(registry.anchor(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH, ethers.ZeroHash)).not.to
        .be.reverted;
    });

    it("rejects a zero tree hash, reserving zero as the not-found sentinel", async () => {
      const { registry } = await loadFixture(registeredFixture);
      await expect(
        registry.anchor(PROJECT_ID, KIND_TAG, "v1.0.0", ethers.ZeroHash, SBOM_HASH)
      ).to.be.revertedWithCustomError(registry, "TreeHashZero");
    });

    it("rejects an unknown kind", async () => {
      const { registry } = await loadFixture(registeredFixture);
      await expect(registry.anchor(PROJECT_ID, 2, "v1.0.0", TREE_HASH, SBOM_HASH))
        .to.be.revertedWithCustomError(registry, "UnknownKind")
        .withArgs(2);
    });

    it("rejects an empty reference", async () => {
      const { registry } = await loadFixture(registeredFixture);
      await expect(
        registry.anchor(PROJECT_ID, KIND_TAG, "", TREE_HASH, SBOM_HASH)
      ).to.be.revertedWithCustomError(registry, "EmptyRef");
    });

    it("rejects anchoring against an unregistered project", async () => {
      const { registry } = await loadFixture(registeredFixture);
      await expect(registry.anchor(OTHER_PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH, SBOM_HASH))
        .to.be.revertedWithCustomError(registry, "ProjectNotRegistered")
        .withArgs(OTHER_PROJECT_ID);
    });

    it("keeps a tag and a branch snapshot of the same name independent", async () => {
      const { registry } = await loadFixture(registeredFixture);

      await registry.anchor(PROJECT_ID, KIND_TAG, "main", TREE_HASH, SBOM_HASH);
      await registry.anchor(PROJECT_ID, KIND_SNAPSHOT, "main", TREE_HASH_2, SBOM_HASH);

      expect((await registry.getAnchor(PROJECT_ID, KIND_TAG, "main")).treeHash).to.equal(TREE_HASH);
      expect((await registry.getAnchor(PROJECT_ID, KIND_SNAPSHOT, "main")).treeHash).to.equal(
        TREE_HASH_2
      );
    });

    it("returns a zeroed record for a reference never anchored", async () => {
      const { registry } = await loadFixture(registeredFixture);
      const record = await registry.getAnchor(PROJECT_ID, KIND_TAG, "v9.9.9");
      expect(record.treeHash).to.equal(ethers.ZeroHash);
      expect(record.revision).to.equal(0);
    });
  });

  describe("supersession", () => {
    it("updates storage and increments the revision", async () => {
      const { registry } = await loadFixture(registeredFixture);

      await registry.anchor(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH, SBOM_HASH);
      await registry.anchor(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH_2, SBOM_HASH);

      const record = await registry.getAnchor(PROJECT_ID, KIND_TAG, "v1.0.0");
      expect(record.treeHash).to.equal(TREE_HASH_2);
      expect(record.revision).to.equal(2);
    });

    it("leaves the superseded submission permanently readable in the event log", async () => {
      const { registry } = await loadFixture(registeredFixture);

      await registry.anchor(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH, SBOM_HASH);
      await registry.anchor(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH_2, SBOM_HASH);

      const events = await registry.queryFilter(registry.filters.AnchorSubmitted(PROJECT_ID));
      expect(events).to.have.lengthOf(2);
      expect(events[0].args.treeHash).to.equal(TREE_HASH);
      expect(events[0].args.revision).to.equal(1);
      expect(events[1].args.treeHash).to.equal(TREE_HASH_2);
      expect(events[1].args.revision).to.equal(2);
    });

    it("carries the reference in readable form so anchors can be enumerated", async () => {
      const { registry } = await loadFixture(registeredFixture);

      await registry.anchor(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH, SBOM_HASH);
      await registry.anchor(PROJECT_ID, KIND_TAG, "v1.1.0", TREE_HASH_2, SBOM_HASH);

      const events = await registry.queryFilter(registry.filters.AnchorSubmitted(PROJECT_ID));
      expect(events.map((e) => e.args.ref)).to.deep.equal(["v1.0.0", "v1.1.0"]);
    });
  });

  describe("allowlist enforcement", () => {
    it("rejects a submission from an account not allowlisted for the project", async () => {
      const { registry, attacker } = await loadFixture(registeredFixture);

      await expect(
        registry.connect(attacker).anchor(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH, SBOM_HASH)
      )
        .to.be.revertedWithCustomError(registry, "NotAllowlisted")
        .withArgs(PROJECT_ID, attacker.address);

      const record = await registry.getAnchor(PROJECT_ID, KIND_TAG, "v1.0.0");
      expect(record.treeHash).to.equal(ethers.ZeroHash);
    });

    it("lets an added account anchor", async () => {
      const { registry, maintainer } = await loadFixture(registeredFixture);

      await expect(registry.allowlistAdd(PROJECT_ID, maintainer.address))
        .to.emit(registry, "AllowlistChanged")
        .withArgs(PROJECT_ID, maintainer.address, true);

      await expect(
        registry.connect(maintainer).anchor(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH, SBOM_HASH)
      ).not.to.be.reverted;
    });

    it("stops a removed account from anchoring, the leaked-key revocation path", async () => {
      const { registry, maintainer } = await loadFixture(registeredFixture);

      await registry.allowlistAdd(PROJECT_ID, maintainer.address);
      await registry.connect(maintainer).anchor(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH, SBOM_HASH);

      await expect(registry.allowlistRemove(PROJECT_ID, maintainer.address))
        .to.emit(registry, "AllowlistChanged")
        .withArgs(PROJECT_ID, maintainer.address, false);

      await expect(
        registry.connect(maintainer).anchor(PROJECT_ID, KIND_TAG, "v1.1.0", TREE_HASH_2, SBOM_HASH)
      ).to.be.revertedWithCustomError(registry, "NotAllowlisted");
    });

    it("restricts allowlist changes to the project owner", async () => {
      const { registry, attacker } = await loadFixture(registeredFixture);

      await expect(registry.connect(attacker).allowlistAdd(PROJECT_ID, attacker.address))
        .to.be.revertedWithCustomError(registry, "NotProjectOwner")
        .withArgs(PROJECT_ID, attacker.address);
    });

    it("rejects the zero address", async () => {
      const { registry } = await loadFixture(registeredFixture);
      await expect(
        registry.allowlistAdd(PROJECT_ID, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });
  });

  describe("ownership handover", () => {
    it("moves control and allowlists the incoming owner", async () => {
      const { registry, owner, maintainer } = await loadFixture(registeredFixture);

      await expect(registry.transferOwnership(PROJECT_ID, maintainer.address))
        .to.emit(registry, "OwnershipTransferred")
        .withArgs(PROJECT_ID, owner.address, maintainer.address);

      const [storedOwner] = await registry.getProject(PROJECT_ID);
      expect(storedOwner).to.equal(maintainer.address);
      expect(await registry.isAllowlisted(PROJECT_ID, maintainer.address)).to.be.true;
    });

    it("removes the outgoing owner's control while leaving its pipeline able to anchor", async () => {
      const { registry, owner, maintainer, attacker } = await loadFixture(registeredFixture);

      await registry.transferOwnership(PROJECT_ID, maintainer.address);

      await expect(registry.allowlistAdd(PROJECT_ID, attacker.address))
        .to.be.revertedWithCustomError(registry, "NotProjectOwner")
        .withArgs(PROJECT_ID, owner.address);

      await expect(registry.anchor(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH, SBOM_HASH)).not.to.be
        .reverted;
    });

    it("rejects transfer to the zero address", async () => {
      const { registry } = await loadFixture(registeredFixture);
      await expect(
        registry.transferOwnership(PROJECT_ID, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });
  });

  describe("permissionless retrieval", () => {
    it("serves records to an account with no relationship to the project", async () => {
      const { registry, reader } = await loadFixture(registeredFixture);
      await registry.anchor(PROJECT_ID, KIND_TAG, "v1.0.0", TREE_HASH, SBOM_HASH);

      const record = await registry.connect(reader).getAnchor(PROJECT_ID, KIND_TAG, "v1.0.0");
      expect(record.treeHash).to.equal(TREE_HASH);
    });
  });

  describe("key derivation", () => {
    it("matches an off-chain computation, so tooling can derive keys independently", async () => {
      const { registry } = await loadFixture(registeredFixture);

      const onChain = await registry.anchorKey(PROJECT_ID, KIND_TAG, "v1.0.0");
      const offChain = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "uint8", "string"],
          [PROJECT_ID, KIND_TAG, "v1.0.0"]
        )
      );
      expect(onChain).to.equal(offChain);
    });
  });

  describe("absence of privileged capability", () => {
    it("exposes no state-changing function beyond the five the design names", async () => {
      const { registry } = await loadFixture(deployFixture);

      const mutating = registry.interface.fragments
        .filter((f): f is FunctionFragment => f.type === "function")
        .filter((f) => f.stateMutability !== "view" && f.stateMutability !== "pure")
        .map((f) => f.name)
        .sort();

      expect(mutating).to.deep.equal([
        "allowlistAdd",
        "allowlistRemove",
        "anchor",
        "registerProject",
        "transferOwnership",
      ]);
    });

    // A fallback fragment covers both `fallback` and `receive`; asserting none exist means the
    // contract cannot accept ETH by any route, payable functions aside.
    it("cannot accept ether by any route", async () => {
      const { registry } = await loadFixture(deployFixture);

      const payableFunctions = registry.interface.fragments
        .filter((f): f is FunctionFragment => f.type === "function")
        .filter((f) => f.stateMutability === "payable");

      const fallbacks = registry.interface.fragments.filter((f) => f.type === "fallback");

      expect(payableFunctions).to.have.lengthOf(0);
      expect(fallbacks).to.have.lengthOf(0);
      expect(await ethers.provider.getBalance(await registry.getAddress())).to.equal(0);
    });
  });
});
